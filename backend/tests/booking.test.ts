import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, client, key, makeApp, prisma, T0, TOMORROW, type Fixture, type TestCtx } from './helpers';

let ctx: TestCtx;
let fx: Fixture;

beforeAll(async () => {
  ctx = await makeApp();
});
beforeEach(async () => {
  fx = await buildFixture();
  ctx.clock.set(T0);
});
afterAll(async () => {
  await ctx.store.close();
});

describe('catalog', () => {
  it('lists doctors and slot availability for a date', async () => {
    const c = await client(ctx, 'p1@test.local');
    const docs = await c.get('/doctors');
    expect(docs.status).toBe(200);
    expect(docs.body.data.map((d: { code: string }) => d.code)).toEqual(['D01', 'D02']);
    const deps = await c.get('/departments');
    expect(deps.body.data).toEqual([{ name: 'Dermatology', doctorCount: 1 }, { name: 'General Medicine', doctorCount: 1 }]);
    const slots = await c.get(`/doctors/${fx.doctors.d1.id}/slots?date=${TOMORROW}`);
    expect(slots.body.data.slots).toHaveLength(12);
    expect(slots.body.data.slots.every((s: { available: boolean }) => s.available)).toBe(true);
  });

  it('T05 a doctor with no slots on a date returns an empty list', async () => {
    const c = await client(ctx, 'p1@test.local');
    const r = await c.get(`/doctors/${fx.doctors.d2.id}/slots?date=${TOMORROW}`);
    expect(r.status).toBe(200);
    expect(r.body.data.slots).toEqual([]);
  });

  it('T27 invalid dates and payloads return structured 400 errors', async () => {
    const c = await client(ctx, 'p1@test.local');
    const r = await c.get(`/doctors/${fx.doctors.d1.id}/slots?date=2026-02-30`);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(r.body.error.requestId).toMatch(/^req_/);
    const b = await c.post('/appointments', { slot: 'x' }, { 'Idempotency-Key': key() });
    expect(b.status).toBe(400);
    expect(Array.isArray(b.body.error.details)).toBe(true);
    const noKey = await c.post('/appointments', { slotId: fx.slots.tomorrow[0].id });
    expect(noKey.status).toBe(400);
  });
});

describe('booking', () => {
  it('T06 books a free capacity-1 slot', async () => {
    const c = await client(ctx, 'p1@test.local');
    const slotId = fx.slots.tomorrow[0].id;
    const r = await c.post('/appointments', { slotId }, { 'Idempotency-Key': key() });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ slotId, status: 'BOOKED', doctorId: fx.doctors.d1.id });
    expect((await prisma.slot.findUnique({ where: { id: slotId } }))!.reservedCount).toBe(1);
    const mine = await c.get('/appointments/me');
    expect(mine.body.data).toHaveLength(1);
    const audit = await prisma.auditEvent.findFirst({ where: { action: 'APPOINTMENT_BOOKED' } });
    expect(audit?.entityId).toBe(r.body.data.appointmentId);
  });

  it('T07 two simultaneous requests for the last slot: exactly one succeeds', async () => {
    const a = await client(ctx, 'p1@test.local');
    const b = await client(ctx, 'p2@test.local');
    const slotId = fx.slots.tomorrow[1].id;
    const results = await Promise.all([
      a.post('/appointments', { slotId }, { 'Idempotency-Key': key() }),
      b.post('/appointments', { slotId }, { 'Idempotency-Key': key() }),
    ]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_FULL');
    expect((await prisma.slot.findUnique({ where: { id: slotId } }))!.reservedCount).toBe(1);
    expect(await prisma.appointment.count({ where: { slotId, status: 'BOOKED' } })).toBe(1);
  });

  it('RQ1 contention: 20 patients racing for one slot never exceed capacity', async () => {
    const clients = await Promise.all(fx.patients.slice(0, 20).map((p) => client(ctx, p.email)));
    const slotId = fx.slots.tomorrow[2].id;
    const results = await Promise.all(clients.map((c) => c.post('/appointments', { slotId }, { 'Idempotency-Key': key() })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(19);
    expect((await prisma.slot.findUnique({ where: { id: slotId } }))!.reservedCount).toBe(1);
  });

  it('T08 the same Idempotency-Key and body replays the original result without a duplicate', async () => {
    const c = await client(ctx, 'p1@test.local');
    const k = key();
    const slotId = fx.slots.tomorrow[3].id;
    const [r1, r2] = await Promise.all([c.post('/appointments', { slotId }, { 'Idempotency-Key': k }), c.post('/appointments', { slotId }, { 'Idempotency-Key': k })]);
    const r3 = await c.post('/appointments', { slotId }, { 'Idempotency-Key': k });
    expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);
    expect(r3.body).toEqual(r1.body);
    expect(r3.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.appointment.count({ where: { slotId } })).toBe(1);
  });

  it('T09 the same key with a different body is an idempotency conflict', async () => {
    const c = await client(ctx, 'p1@test.local');
    const k = key();
    await c.post('/appointments', { slotId: fx.slots.tomorrow[4].id }, { 'Idempotency-Key': k });
    const r = await c.post('/appointments', { slotId: fx.slots.tomorrow[5].id }, { 'Idempotency-Key': k });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await prisma.slot.findUnique({ where: { id: fx.slots.tomorrow[5].id } }))!.reservedCount).toBe(0);
  });

  it('a patient cannot hold two active bookings with the same doctor on one day, or book a past slot', async () => {
    const c = await client(ctx, 'p1@test.local');
    await c.post('/appointments', { slotId: fx.slots.tomorrow[6].id }, { 'Idempotency-Key': key() });
    const dup = await c.post('/appointments', { slotId: fx.slots.tomorrow[7].id }, { 'Idempotency-Key': key() });
    expect(dup.body.error.code).toBe('DUPLICATE_BOOKING');
    ctx.clock.set(new Date('2026-10-21T04:00:00Z')); // 09:30 IST
    const past = await c.post('/appointments', { slotId: fx.slots.today[0].id }, { 'Idempotency-Key': key() });
    expect(past.status).toBe(409);
    expect(past.body.error.code).toBe('SLOT_UNAVAILABLE');
  });
});

describe('cancellation', () => {
  it('T10 cancelling an own future booking releases capacity exactly once', async () => {
    const c = await client(ctx, 'p1@test.local');
    const slotId = fx.slots.tomorrow[0].id;
    const b = await c.post('/appointments', { slotId }, { 'Idempotency-Key': key() });
    const id = b.body.data.appointmentId;
    const [x, y] = await Promise.all([c.patch(`/appointments/${id}/cancel`, {}), c.patch(`/appointments/${id}/cancel`, {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect((await prisma.appointment.findUnique({ where: { id } }))!.status).toBe('CANCELLED');
    expect((await prisma.slot.findUnique({ where: { id: slotId } }))!.reservedCount).toBe(0);
    // the freed slot can be booked again
    const other = await client(ctx, 'p2@test.local');
    expect((await other.post('/appointments', { slotId }, { 'Idempotency-Key': key() })).status).toBe(201);
  });

  it("T04/T11 a patient can neither see nor cancel another patient's booking", async () => {
    const owner = await client(ctx, 'p1@test.local');
    const b = await owner.post('/appointments', { slotId: fx.slots.tomorrow[0].id }, { 'Idempotency-Key': key() });
    const intruder = await client(ctx, 'p2@test.local');
    const r = await intruder.patch(`/appointments/${b.body.data.appointmentId}/cancel`, {});
    expect(r.status).toBe(404);
    expect((await intruder.get('/appointments/me')).body.data).toEqual([]);
    expect((await prisma.appointment.findUnique({ where: { id: b.body.data.appointmentId } }))!.status).toBe('BOOKED');
  });

  it('staff cancellations require a reason and notify the patient', async () => {
    const p = await client(ctx, 'p1@test.local');
    const b = await p.post('/appointments', { slotId: fx.slots.tomorrow[0].id }, { 'Idempotency-Key': key() });
    const rec = await client(ctx, 'reception@test.local');
    expect((await rec.patch(`/appointments/${b.body.data.appointmentId}/cancel`, {})).status).toBe(400);
    const ok = await rec.patch(`/appointments/${b.body.data.appointmentId}/cancel`, { reason: 'Doctor on leave' });
    expect(ok.status).toBe(200);
    const notes = await p.get('/notifications');
    expect(notes.body.data.items.some((n: { kind: string }) => n.kind === 'BOOKING_CANCELLED')).toBe(true);
  });
});
