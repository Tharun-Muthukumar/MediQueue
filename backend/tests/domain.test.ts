import { describe, expect, it } from 'vitest';
import { activeRemainderSec, computeEta, estimateConsultDuration } from '../src/domain/eta';
import { predictOrder, selectNext, type QueueCandidate } from '../src/domain/queuePolicy';
import { rng, simulateSession } from '../src/domain/simulation';
import { canTransitionAppointment, canTransitionTicket } from '../src/domain/stateMachine';
import { addDays, isoWeekday, serviceDateOf, zonedTimeToUtc } from '../src/shared/time';
import { csvCell, stableStringify, toCsv } from '../src/shared/util';

const at = (m: number) => new Date(Date.UTC(2026, 9, 21, 3, m));
const S = (id: string, sched: number, arrived: number): QueueCandidate => ({ id, source: 'SCHEDULED', scheduledAt: at(sched), checkedInAt: at(arrived) });
const W = (id: string, arrived: number): QueueCandidate => ({ id, source: 'WALK_IN', scheduledAt: null, checkedInAt: at(arrived) });

describe('queue policy (2 scheduled : 1 walk-in)', () => {
  it('T22 orders a mixed queue S, S, W, S, S, W', () => {
    const q = [W('w1', 1), S('s1', 0, 5), S('s2', 15, 2), W('w2', 3), S('s3', 30, 4), S('s4', 45, 6)];
    expect(predictOrder(q, 0, 2).map((c) => c.id)).toEqual(['s1', 's2', 'w1', 's3', 's4', 'w2']);
  });

  it('respects the persisted streak: after two scheduled calls the next is a walk-in', () => {
    const r = selectNext([S('s1', 0, 0), W('w1', 1)], 2, 2);
    expect(r.chosen?.id).toBe('w1');
    expect(r.nextStreak).toBe(0);
  });

  it('falls back to the other group when one is empty', () => {
    expect(selectNext([W('w1', 1), W('w2', 0)], 5, 2).chosen?.id).toBe('w2');
    expect(selectNext([S('s1', 0, 0)], 7, 2).chosen?.id).toBe('s1');
    expect(selectNext([], 0, 2).chosen).toBeNull();
  });

  it('breaks ties by slot time, then arrival time, then id', () => {
    const order = predictOrder([S('b', 0, 5), S('a', 0, 5), S('c', 0, 1), S('z', -15, 9)], 0, 99);
    expect(order.map((c) => c.id)).toEqual(['z', 'c', 'a', 'b']);
  });

  it('predictOrder matches repeated selectNext calls', () => {
    const q = [S('s1', 0, 0), S('s2', 15, 1), S('s3', 30, 2), W('w1', 3), W('w2', 4), S('s4', 45, 5)];
    const seq: string[] = [];
    let rest = [...q];
    let streak = 1;
    while (rest.length) {
      const { chosen, nextStreak } = selectNext(rest, streak, 2);
      seq.push(chosen!.id);
      rest = rest.filter((c) => c !== chosen);
      streak = nextStreak;
    }
    expect(predictOrder(q, 1, 2).map((c) => c.id)).toEqual(seq);
  });

  it('fairness: under sustained scheduled load no walk-in waits behind more than 2 scheduled calls', () => {
    const q: QueueCandidate[] = [];
    for (let i = 0; i < 60; i++) q.push(S(`s${String(i).padStart(2, '0')}`, i * 5, i));
    for (let i = 0; i < 10; i++) q.push(W(`w${i}`, i * 3));
    const order = predictOrder(q, 0, 2);
    order.forEach((c, idx) => {
      if (c.source === 'WALK_IN') {
        const wIndex = Number(c.id.slice(1));
        expect(idx).toBeLessThanOrEqual(3 * wIndex + 2);
      }
    });
  });
});

describe('ETA engine', () => {
  it('blueprint §10.5 example: median 12 min, 3 ahead, 6 min remainder → 42 min (≈34–53)', () => {
    const est = estimateConsultDuration([9, 11, 12, 13, 16].map((m) => m * 60), 12);
    expect(est).toMatchObject({ expectedSec: 720, basis: 'ROLLING_MEDIAN', samples: 5 });
    const eta = computeEta({ ahead: 3, expectedSec: est.expectedSec, remainderSec: 360, paused: false });
    expect(eta.waitSec).toBe(42 * 60);
    expect(Math.round(eta.lowSec! / 60)).toBe(34);
    expect(Math.round(eta.highSec! / 60)).toBe(53);
  });

  it('falls back to the doctor default with fewer than 5 plausible samples and ignores outliers', () => {
    expect(estimateConsultDuration([600, 660, 10, 99999], 15)).toMatchObject({ expectedSec: 900, basis: 'DEFAULT', samples: 2 });
  });

  it('uses at most the 15 most recent samples', () => {
    const recent = Array(15).fill(600);
    const old = Array(20).fill(1800);
    expect(estimateConsultDuration([...recent, ...old], 12).expectedSec).toBe(600);
  });

  it('reports paused queues as unavailable', () => {
    expect(computeEta({ ahead: 2, expectedSec: 600, remainderSec: 0, paused: true })).toEqual({ status: 'PAUSED', waitSec: null, lowSec: null, highSec: null });
  });

  it('active remainder: full visit when only called, at least 1 minute when overrunning', () => {
    const now = new Date('2026-10-21T04:00:00Z');
    expect(activeRemainderSec({ status: 'CALLED', startedAt: null }, 720, now)).toBe(720);
    expect(activeRemainderSec({ status: 'IN_CONSULTATION', startedAt: new Date(now.getTime() - 300_000) }, 720, now)).toBe(420);
    expect(activeRemainderSec({ status: 'IN_CONSULTATION', startedAt: new Date(now.getTime() - 3_600_000) }, 720, now)).toBe(60);
    expect(activeRemainderSec(null, 720, now)).toBe(0);
  });
});

describe('state machines', () => {
  it('rejects illegal appointment and ticket transitions', () => {
    expect(canTransitionAppointment('BOOKED', 'CHECKED_IN')).toBe(true);
    expect(canTransitionAppointment('CANCELLED', 'BOOKED')).toBe(false);
    expect(canTransitionAppointment('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransitionTicket('WAITING', 'IN_CONSULTATION')).toBe(false);
    expect(canTransitionTicket('CALLED', 'WAITING')).toBe(true);
    expect(canTransitionTicket('COMPLETED', 'WAITING')).toBe(false);
  });
});

describe('clinic time', () => {
  it('T24 groups by clinic-local day across midnight UTC', () => {
    expect(serviceDateOf(new Date('2026-10-20T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-10-20');
    expect(serviceDateOf(new Date('2026-10-20T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-21');
    expect(serviceDateOf(new Date('2026-10-20T18:30:00Z'), 'UTC')).toBe('2026-10-20');
  });

  it('converts clinic wall-clock time to UTC', () => {
    expect(zonedTimeToUtc('2026-10-21', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-21T03:30:00.000Z');
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
});

describe('shared utilities', () => {
  it('neutralises spreadsheet formula injection in CSV cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('plain, text')).toBe('"plain, text"');
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n');
  });

  it('hashes payloads independent of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('simulation is deterministic for a fixed seed', () => {
    const mk = () =>
      simulateSession({
        slots: Array.from({ length: 10 }, (_, i) => ({ startAt: new Date(Date.UTC(2026, 9, 21, 3, 30 + i * 15)), booked: i % 3 !== 0 })),
        walkIns: 3,
        sessionStart: new Date(Date.UTC(2026, 9, 21, 3, 30)),
        sessionEnd: new Date(Date.UTC(2026, 9, 21, 6, 0)),
        medianConsultMin: 12,
        defaultMin: 12,
        ratio: 2,
        noShowRate: 0.1,
        history: [],
        random: rng(7),
      });
    const a = mk();
    const b = mk();
    expect(a.visits.map((v) => v.calledAt?.getTime())).toEqual(b.visits.map((v) => v.calledAt?.getTime()));
    expect(a.visits.filter((v) => v.completedAt).length).toBeGreaterThan(5);
    // causality: nobody is called before they check in, and visits never overlap
    const seen = a.visits.filter((v) => v.calledAt).sort((x, y) => x.calledAt!.getTime() - y.calledAt!.getTime());
    for (const v of seen) expect(v.calledAt!.getTime()).toBeGreaterThanOrEqual(v.checkedInAt!.getTime());
    for (let i = 1; i < seen.length; i++) expect(seen[i].startedAt!.getTime()).toBeGreaterThanOrEqual(seen[i - 1].completedAt!.getTime());
  });
});
