import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, client, key, makeApp, prisma, T0, type Fixture, type TestCtx } from './helpers';

let ctx: TestCtx;
let fx: Fixture;

beforeAll(async () => {
  ctx = await makeApp();
});
beforeEach(async () => {
  fx = await buildFixture();
  ctx.clock.set(T0); // 08:30 IST, today's slots start at 09:00
});
afterAll(async () => {
  await ctx.store.close();
});

/** Books today's slot i for patient n (1-based) and returns the appointment id. */
async function bookToday(n: number, i: number) {
  const c = await client(ctx, `p${n}@test.local`);
  const r = await c.post('/appointments', { slotId: fx.slots.today[i].id }, { 'Idempotency-Key': key() });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { id: r.body.data.appointmentId as string, patient: c };
}

describe('check-in and tokens', () => {
  it('T12 check-in issues a unique WAITING ticket and marks the appointment CHECKED_IN', async () => {
    const { id } = await bookToday(1, 0);
    const rec = await client(ctx, 'reception@test.local');
    const r = await rec.post(`/appointments/${id}/check-in`);
    expect(r.status).toBe(201);
    expect(r.body.data.ticket).toMatchObject({ tokenLabel: 'D01-001', status: 'WAITING' });
    expect((await prisma.appointment.findUnique({ where: { id } }))!.status).toBe('CHECKED_IN');
    const t = await prisma.queueTicket.findFirst({ where: { appointmentId: id } });
    expect(t!.predictedWaitSec).not.toBeNull();
  });

  it('T13 repeated check-in returns the existing token and never issues a second one', async () => {
    const { id } = await bookToday(1, 0);
    const rec = await client(ctx, 'reception@test.local');
    const [a, b] = await Promise.all([rec.post(`/appointments/${id}/check-in`), rec.post(`/appointments/${id}/check-in`)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.ticket.tokenLabel).toBe(b.body.data.ticket.tokenLabel);
    expect(await prisma.queueTicket.count({ where: { appointmentId: id } })).toBe(1);
  });

  it('T14 concurrent check-ins for one doctor/day get unique serial token numbers', async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push((await bookToday(i + 1, i)).id);
    const rec = await client(ctx, 'reception@test.local');
    const res = await Promise.all(ids.map((id) => rec.post(`/appointments/${id}/check-in`)));
    expect(res.every((r) => r.status === 201)).toBe(true);
    const numbers = (await prisma.queueTicket.findMany({ where: { doctorId: fx.doctors.d1.id } })).map((t) => t.tokenNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('check-in is refused on the wrong day and needs a reason when the patient is late', async () => {
    const c = await client(ctx, 'p1@test.local');
    const tomorrow = await c.post('/appointments', { slotId: fx.slots.tomorrow[0].id }, { 'Idempotency-Key': key() });
    const rec = await client(ctx, 'reception@test.local');
    const wrongDay = await rec.post(`/appointments/${tomorrow.body.data.appointmentId}/check-in`);
    expect(wrongDay.status).toBe(422);
    expect(wrongDay.body.error.code).toBe('CHECKIN_WINDOW_CLOSED');

    const { id } = await bookToday(2, 0); // 09:00
    ctx.clock.set(new Date('2026-10-21T03:50:00Z')); // 09:20 IST → 20 min late
    const late = await rec.post(`/appointments/${id}/check-in`);
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('LATE_ARRIVAL_REASON_REQUIRED');
    const admitted = await rec.post(`/appointments/${id}/check-in`, { overrideReason: 'Traffic on the highway' });
    expect(admitted.status).toBe(201);
    expect((await prisma.queueTicket.findFirst({ where: { appointmentId: id } }))!.isLate).toBe(true);
  });

  it('T15 reception registers a walk-in with a new or existing profile', async () => {
    const rec = await client(ctx, 'reception@test.local');
    const a = await rec.post('/walkins', { doctorId: fx.doctors.d1.id, newPatient: { name: 'Walk In Person' } });
    expect(a.status).toBe(201);
    expect(a.body.data.ticket).toMatchObject({ source: 'WALK_IN', status: 'WAITING', tokenLabel: 'D01-001' });
    const b = await rec.post('/walkins', { doctorId: fx.doctors.d1.id, patientId: fx.patients[3].id });
    expect(b.body.data.ticket.tokenLabel).toBe('D01-002');
    const again = await rec.post('/walkins', { doctorId: fx.doctors.d1.id, patientId: fx.patients[3].id });
    expect(again.status).toBe(409);
    expect((await prisma.appointment.count())).toBe(0); // no fake reservation created
  });
});

describe('doctor queue lifecycle', () => {
  async function setupQueue() {
    const rec = await client(ctx, 'reception@test.local');
    const s1 = await bookToday(1, 0);
    const s2 = await bookToday(2, 1);
    const s3 = await bookToday(3, 2);
    await rec.post(`/appointments/${s1.id}/check-in`);
    await rec.post('/walkins', { doctorId: fx.doctors.d1.id, patientId: fx.patients[9].id });
    await rec.post(`/appointments/${s2.id}/check-in`);
    await rec.post(`/appointments/${s3.id}/check-in`);
    return { rec, s1, s2, s3 };
  }

  it('T16/T18 call → start → complete records duration and closes ticket and appointment', async () => {
    const { s1 } = await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    ctx.clock.set(new Date('2026-10-21T03:30:00Z'));
    const call = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    expect(call.status).toBe(200);
    expect(call.body.data.tokenLabel).toBe('D01-001');
    const tid = call.body.data.ticketId;
    expect((await doc.post(`/tickets/${tid}/complete`)).body.error.code).toBe('INVALID_STATE'); // must start first
    expect((await doc.post(`/tickets/${tid}/start`)).status).toBe(200);
    expect((await prisma.queueTicket.findUnique({ where: { id: tid } }))!.status).toBe('IN_CONSULTATION');
    ctx.clock.advanceMinutes(11);
    const done = await doc.post(`/tickets/${tid}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.data.durationSec).toBe(660);
    expect((await prisma.consultation.findUnique({ where: { queueTicketId: tid } }))!.durationSec).toBe(660);
    expect((await prisma.appointment.findUnique({ where: { id: s1.id } }))!.status).toBe('COMPLETED');
    const notes = await s1.patient.get('/notifications');
    expect(notes.body.data.items.map((n: { kind: string }) => n.kind)).toEqual(expect.arrayContaining(['CALLED', 'VISIT_COMPLETED']));
  });

  it('T17 two simultaneous call-next clicks produce at most one CALLED ticket', async () => {
    await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    const res = await Promise.all([doc.post(`/queues/${fx.doctors.d1.id}/call-next`), doc.post(`/queues/${fx.doctors.d1.id}/call-next`), doc.post(`/queues/${fx.doctors.d1.id}/call-next`)]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'CONSULTATION_ACTIVE')).toBe(true);
    expect(await prisma.queueTicket.count({ where: { status: 'CALLED' } })).toBe(1);
  });

  it('T22 the API calls scheduled, scheduled, walk-in, scheduled (2:1 policy)', async () => {
    await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
      order.push(c.body.data.source);
      await doc.post(`/tickets/${c.body.data.ticketId}/start`);
      ctx.clock.advanceMinutes(10);
      await doc.post(`/tickets/${c.body.data.ticketId}/complete`);
    }
    expect(order).toEqual(['SCHEDULED', 'SCHEDULED', 'WALK_IN', 'SCHEDULED']);
    const none = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    expect(none.body.error.code).toBe('NO_PATIENTS_WAITING');
  });

  it('T19/T20 pause blocks call-next and makes ETA unavailable; resume restores both', async () => {
    const { s3 } = await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    expect((await doc.post(`/doctors/${fx.doctors.d1.id}/pause`, {})).status).toBe(400); // reason required
    expect((await doc.post(`/doctors/${fx.doctors.d1.id}/pause`, { reason: 'Short break' })).status).toBe(200);
    const blocked = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DOCTOR_PAUSED');
    const mine = await s3.patient.get('/queues/me');
    expect(mine.body.data.tickets[0]).toMatchObject({ paused: true, eta: { status: 'PAUSED', waitSec: null } });
    expect((await doc.post(`/doctors/${fx.doctors.d1.id}/resume`)).status).toBe(200);
    expect((await doc.post(`/queues/${fx.doctors.d1.id}/call-next`)).status).toBe(200);
    expect((await s3.patient.get('/queues/me')).body.data.tickets[0].eta.status).toBe('OK');
  });

  it('T23 a patient ETA changes predictably as visits complete', async () => {
    const { s3 } = await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    ctx.clock.set(new Date('2026-10-21T03:30:00Z')); // session open
    const before = (await s3.patient.get('/queues/me')).body.data.tickets[0];
    // queue order: s1, s2, walk-in, s3 → s3 is 4th; no history so default 12 min each
    expect(before.position).toBe(4);
    expect(before.eta.waitSec).toBe(3 * 12 * 60);
    const c = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    await doc.post(`/tickets/${c.body.data.ticketId}/start`);
    ctx.clock.advanceMinutes(4);
    const during = (await s3.patient.get('/queues/me')).body.data.tickets[0];
    expect(during.position).toBe(3);
    expect(during.eta.waitSec).toBe(8 * 60 + 2 * 12 * 60); // 8 min remainder + 2 ahead
    ctx.clock.advanceMinutes(6);
    await doc.post(`/tickets/${c.body.data.ticketId}/complete`);
    const after = (await s3.patient.get('/queues/me')).body.data.tickets[0];
    expect(after.position).toBe(3);
    expect(after.eta.waitSec).toBe(2 * 12 * 60);
    // patients only ever see their own ticket — never other names
    expect(JSON.stringify(after)).not.toMatch(/Patient \d/);
  });

  it('requeue and skip need reasons and keep the token', async () => {
    await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    const c = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    const tid = c.body.data.ticketId;
    expect((await doc.post(`/tickets/${tid}/requeue`, {})).status).toBe(400);
    expect((await doc.post(`/tickets/${tid}/requeue`, { reason: 'Called in error' })).body.data.status).toBe('WAITING');
    const c2 = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    expect((await doc.post(`/tickets/${c2.body.data.ticketId}/skip`, { reason: 'Not in waiting area' })).body.data.status).toBe('SKIPPED');
    const rec = await client(ctx, 'reception@test.local');
    expect((await rec.post(`/tickets/${c2.body.data.ticketId}/requeue`, { reason: 'Patient returned' })).body.data.status).toBe('WAITING');
    const audits = await prisma.auditEvent.findMany({ where: { action: { in: ['QUEUE_REQUEUED', 'QUEUE_SKIPPED'] } } });
    expect(audits.every((a) => a.reason)).toBe(true);
  });

  it('T28 queue state survives a backend restart', async () => {
    await setupQueue();
    const doc = await client(ctx, 'doc1@test.local');
    const c = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
    await doc.post(`/tickets/${c.body.data.ticketId}/start`);
    // simulate restart: brand-new store + app on the same database file
    const fresh = await makeApp(ctx.clock);
    const doc2 = await client(fresh, 'doc1@test.local');
    const q = await doc2.get(`/queues/${fx.doctors.d1.id}`);
    expect(q.body.data.active).toMatchObject({ id: c.body.data.ticketId, status: 'IN_CONSULTATION' });
    expect(q.body.data.waiting).toHaveLength(3);
    expect((await doc2.post(`/queues/${fx.doctors.d1.id}/call-next`)).body.error.code).toBe('CONSULTATION_ACTIVE');
    await fresh.store.close();
  });
});

describe('no-shows', () => {
  it('T21 no-show respects the grace period unless staff give an override reason', async () => {
    const { id, patient } = await bookToday(1, 0); // 09:00 IST
    const rec = await client(ctx, 'reception@test.local');
    ctx.clock.set(new Date('2026-10-21T03:40:00Z')); // 09:10 — inside 15-min grace
    const early = await rec.post(`/appointments/${id}/no-show`);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('GRACE_PERIOD_ACTIVE');
    ctx.clock.set(new Date('2026-10-21T03:46:00Z')); // 09:16 — grace over
    const ok = await rec.post(`/appointments/${id}/no-show`);
    expect(ok.status).toBe(200);
    expect((await prisma.appointment.findUnique({ where: { id } }))!.status).toBe('NO_SHOW');
    expect((await rec.post(`/appointments/${id}/check-in`)).status).toBe(409);
    expect((await patient.get('/notifications')).body.data.items[0].kind).toBe('NO_SHOW');
  });

  it('the automatic sweep only acts when enabled and after the grace period', async () => {
    const { id } = await bookToday(1, 0);
    ctx.clock.set(new Date('2026-10-21T04:00:00Z')); // 09:30
    expect(await ctx.services.reception.runAutoNoShow()).toBe(0); // disabled by default
    await prisma.clinic.update({ where: { id: fx.clinicId }, data: { autoNoShow: true } });
    expect(await ctx.services.reception.runAutoNoShow()).toBe(1);
    expect((await prisma.appointment.findUnique({ where: { id } }))!.status).toBe('NO_SHOW');
    const ev = await prisma.auditEvent.findFirst({ where: { action: 'NO_SHOW_MARKED' } });
    expect(ev!.actorRole).toBe('SYSTEM');
  });
});
