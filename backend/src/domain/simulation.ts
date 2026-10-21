/**
 * Deterministic synthetic clinic-session simulator. It replays one doctor's session through the
 * SAME policy and ETA functions the API uses, so seeded history and the ETA evaluation script
 * measure the real algorithm rather than a copy of it.
 */
import { activeRemainderSec, computeEta, estimateConsultDuration, ETA_MAX_SAMPLES } from './eta';
import { predictOrder, selectNext, type QueueCandidate } from './queuePolicy';

/** Mulberry32 — small, fast, seedable PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(r: () => number, mean: number, sd: number) {
  const u = Math.max(1e-9, r());
  const v = r();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimSlot {
  startAt: Date;
  booked: boolean;
}

export interface SimInput {
  slots: SimSlot[];
  walkIns: number;
  sessionStart: Date;
  sessionEnd: Date;
  medianConsultMin: number;
  defaultMin: number;
  ratio: number;
  noShowRate: number;
  /** Prior consultation durations (sec), newest first — carries learning across days. */
  history: number[];
  random: () => number;
}

export interface SimVisit {
  key: number;
  source: 'SCHEDULED' | 'WALK_IN';
  slotIndex: number | null;
  noShow: boolean;
  checkedInAt: Date | null;
  calledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationSec: number | null;
  predictedWaitSec: number | null;
  baselineWaitSec: number | null;
  tokenNumber: number | null;
}

interface Cand extends QueueCandidate {
  visit: SimVisit;
}

export function simulateSession(input: SimInput): { visits: SimVisit[]; history: number[]; streak: number } {
  const r = input.random;
  const visits: SimVisit[] = [];
  let key = 0;
  input.slots.forEach((s, i) => {
    if (!s.booked) return;
    const noShow = r() < input.noShowRate;
    const offsetMin = Math.min(20, Math.max(-25, normal(r, -7, 7)));
    visits.push({
      key: key++, source: 'SCHEDULED', slotIndex: i, noShow,
      checkedInAt: noShow ? null : new Date(s.startAt.getTime() + offsetMin * 60000),
      calledAt: null, startedAt: null, completedAt: null, durationSec: null, predictedWaitSec: null, baselineWaitSec: null, tokenNumber: null,
    });
  });
  const span = input.sessionEnd.getTime() - input.sessionStart.getTime();
  for (let w = 0; w < input.walkIns; w++) {
    visits.push({
      key: key++, source: 'WALK_IN', slotIndex: null, noShow: false,
      checkedInAt: new Date(input.sessionStart.getTime() - 10 * 60000 + r() * span * 0.8),
      calledAt: null, startedAt: null, completedAt: null, durationSec: null, predictedWaitSec: null, baselineWaitSec: null, tokenNumber: null,
    });
  }

  const arrivals = visits.filter((v) => v.checkedInAt).sort((a, b) => a.checkedInAt!.getTime() - b.checkedInAt!.getTime());
  arrivals.forEach((v, i) => (v.tokenNumber = i + 1));
  const history = [...input.history];
  const waiting: Cand[] = [];
  let streak = 0;
  let active: { visit: SimVisit; endsAt: Date } | null = null;
  let doctorFreeAt = input.sessionStart;
  let ai = 0;
  let anyCalled = false;
  let clock = input.sessionStart.getTime() - 60 * 60000; // time of the last processed event

  const sampleDurationSec = () => {
    const ln = Math.exp(normal(r, Math.log(input.medianConsultMin), 0.32));
    return Math.round(Math.min(45, Math.max(3, ln)) * 60);
  };

  while (ai < arrivals.length || waiting.length || active) {
    const nextArrival = ai < arrivals.length ? arrivals[ai].checkedInAt! : null;
    const nextFree = active ? active.endsAt : waiting.length ? new Date(Math.max(doctorFreeAt.getTime(), input.sessionStart.getTime(), clock)) : null;

    if (nextArrival && (!nextFree || nextArrival <= nextFree)) {
      const v = arrivals[ai++];
      const now = v.checkedInAt!;
      clock = Math.max(clock, now.getTime());
      const cand: Cand = { id: String(v.key).padStart(6, '0'), source: v.source, scheduledAt: v.slotIndex !== null ? input.slots[v.slotIndex].startAt : null, checkedInAt: now, visit: v };
      waiting.push(cand);
      // Prediction exactly as the API computes it at check-in.
      const est = estimateConsultDuration(history.slice(0, ETA_MAX_SAMPLES), input.defaultMin);
      const order = predictOrder(waiting, streak, input.ratio);
      const ahead = order.indexOf(cand);
      // Until the doctor has called anyone, the wait also includes the time until the session opens.
      const preOpen = anyCalled || active ? 0 : Math.max(0, (input.sessionStart.getTime() - now.getTime()) / 1000);
      const remainder = active
        ? activeRemainderSec({ status: 'IN_CONSULTATION', startedAt: active.visit.startedAt }, est.expectedSec, now)
        : 0;
      v.predictedWaitSec = computeEta({ ahead, expectedSec: est.expectedSec, remainderSec: Math.max(remainder, preOpen), paused: false }).waitSec;
      v.baselineWaitSec = Math.round((ahead + (active ? 1 : 0)) * input.defaultMin * 60 + preOpen);
      continue;
    }

    if (active) {
      const v = active.visit;
      v.completedAt = active.endsAt;
      history.unshift(v.durationSec!);
      doctorFreeAt = active.endsAt;
      clock = Math.max(clock, active.endsAt.getTime());
      active = null;
      continue;
    }

    // Doctor free and someone waiting: call next by policy.
    const callAt = new Date(Math.max(doctorFreeAt.getTime(), input.sessionStart.getTime(), clock) + 30_000);
    const { chosen, nextStreak } = selectNext(waiting, streak, input.ratio);
    if (!chosen) break;
    streak = nextStreak;
    anyCalled = true;
    waiting.splice(waiting.indexOf(chosen), 1);
    const v = chosen.visit;
    v.calledAt = callAt;
    v.startedAt = new Date(callAt.getTime() + Math.round(30 + r() * 60) * 1000);
    v.durationSec = sampleDurationSec();
    active = { visit: v, endsAt: new Date(v.startedAt.getTime() + v.durationSec * 1000) };
  }

  return { visits, history, streak };
}
