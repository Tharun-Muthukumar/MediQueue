import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, client, key, makeApp, prisma, T0, TODAY, type Fixture, type TestCtx } from './helpers';

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

async function runOneVisit() {
  const p = await client(ctx, 'p1@test.local');
  const b = await p.post('/appointments', { slotId: fx.slots.today[0].id }, { 'Idempotency-Key': key() });
  const rec = await client(ctx, 'reception@test.local');
  await rec.post(`/appointments/${b.body.data.appointmentId}/check-in`);
  ctx.clock.set(new Date('2026-10-21T03:35:00Z'));
  const doc = await client(ctx, 'doc1@test.local');
  const c = await doc.post(`/queues/${fx.doctors.d1.id}/call-next`);
  await doc.post(`/tickets/${c.body.data.ticketId}/start`);
  ctx.clock.advanceMinutes(12);
  await doc.post(`/tickets/${c.body.data.ticketId}/complete`);
}

describe('admin reporting', () => {
  it('metrics aggregate the day including waits and ETA error', async () => {
    await runOneVisit();
    const admin = await client(ctx, 'admin@test.local');
    const r = await admin.get(`/admin/metrics?date=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.body.data.totals).toMatchObject({ appointments: 1, completed: 1 });
    expect(r.body.data.waits.samples).toBe(1);
    expect(r.body.data.eta.samples).toBe(1);
    expect(r.body.data.trend).toHaveLength(7);
    expect(r.body.data.perDoctor.find((d: { code: string }) => d.code === 'D01').completed).toBe(1);
  });

  it('T25 admin downloads a daily CSV with valid headers and pseudonymous rows', async () => {
    await runOneVisit();
    const admin = await client(ctx, 'admin@test.local');
    const r = await admin.get(`/admin/reports/daily.csv?date=${TODAY}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toContain(`mediqueue-daily-${TODAY}.csv`);
    const lines = r.text.trim().split('\r\n');
    expect(lines[0].split(',')).toEqual(expect.arrayContaining(['service_date', 'token', 'wait_min', 'predicted_wait_min', 'eta_abs_error_min']));
    expect(lines).toHaveLength(2);
    expect(r.text).not.toContain('Patient 1'); // no patient names in exports
    expect(r.text).toContain('D01-001');
  });

  it('T26 patients and receptionists cannot export reports', async () => {
    const p = await client(ctx, 'p1@test.local');
    expect((await p.get('/admin/reports/daily.csv')).status).toBe(403);
    const rec = await client(ctx, 'reception@test.local');
    expect((await rec.get('/admin/reports/daily.csv')).status).toBe(403);
  });

  it('audit trail records actor, before/after state and can be filtered', async () => {
    await runOneVisit();
    const admin = await client(ctx, 'admin@test.local');
    const all = await admin.get('/admin/audit?pageSize=50');
    const actions = all.body.data.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['APPOINTMENT_BOOKED', 'CHECKED_IN', 'QUEUE_CALLED', 'CONSULT_STARTED', 'CONSULT_COMPLETED']));
    const filtered = await admin.get('/admin/audit?action=QUEUE_CALLED');
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0]).toMatchObject({ actor: { role: 'DOCTOR' }, before: { status: 'WAITING' }, after: { status: 'CALLED' } });
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('admin management', () => {
  it('creates a doctor with the next code and the new doctor can sign in', async () => {
    const admin = await client(ctx, 'admin@test.local');
    const r = await admin.post('/admin/doctors', { name: 'Dr. Three', email: 'doc3@test.local', password: 'abc12345', department: 'ENT', room: 'Room 3', avgMinutes: 9 });
    expect(r.status).toBe(201);
    expect(r.body.data.code).toBe('D03');
    const doc = await client(ctx, 'doc3@test.local', 'abc12345');
    expect((await doc.get('/auth/me')).body.data.doctor.code).toBe('D03');
  });

  it('generates slots in clinic time and skips overlaps and past times', async () => {
    const admin = await client(ctx, 'admin@test.local');
    const body = { doctorId: fx.doctors.d1.id, fromDate: TODAY, toDate: '2026-10-23', startTime: '08:00', endTime: '10:00', slotMinutes: 15, capacity: 1, weekdays: [1, 2, 3, 4, 5, 6] };
    const r = await admin.post('/admin/slots/generate', body);
    expect(r.status).toBe(201);
    // today (now 08:30): 08:00, 08:15, 08:30 have started → 3 past; 08:45 new; 09:00–09:45 overlap (4)
    // tomorrow: 08:00–08:45 new (4); 09:00–09:45 overlap (4); 23rd: 8 new
    expect(r.body.data).toEqual({ created: 1 + 4 + 8, skippedConflicts: 8, skippedPast: 3 });
    const again = await admin.post('/admin/slots/generate', body);
    expect(again.body.data.created).toBe(0);
    const bad = await admin.post('/admin/slots/generate', { ...body, endTime: '07:00' });
    expect(bad.status).toBe(400);
  });

  it('deactivated doctors disappear from booking and reject new bookings', async () => {
    const admin = await client(ctx, 'admin@test.local');
    await admin.patch(`/admin/doctors/${fx.doctors.d2.id}`, { status: 'INACTIVE' });
    const p = await client(ctx, 'p1@test.local');
    expect((await p.get('/doctors')).body.data.map((d: { code: string }) => d.code)).toEqual(['D01']);
    const slot = await prisma.slot.findFirst({ where: { doctorId: fx.doctors.d2.id } });
    const r = await p.post('/appointments', { slotId: slot!.id }, { 'Idempotency-Key': key() });
    expect(r.body.error.code).toBe('DOCTOR_INACTIVE');
  });

  it('settings changes are validated and audited', async () => {
    const admin = await client(ctx, 'admin@test.local');
    expect((await admin.patch('/admin/settings', { walkInRatio: 9 })).status).toBe(400);
    const r = await admin.patch('/admin/settings', { walkInRatio: 3, graceMinutes: 20 });
    expect(r.body.data).toMatchObject({ walkInRatio: 3, graceMinutes: 20 });
    const ev = await prisma.auditEvent.findFirst({ where: { action: 'SETTINGS_UPDATED' } });
    expect(JSON.parse(ev!.beforeJson!)).toEqual({ walkInRatio: 2, graceMinutes: 15 });
  });
});

describe('privacy surfaces', () => {
  it('public queue board shows tokens and rooms but no patient identity', async () => {
    await (await client(ctx, 'reception@test.local')).post('/walkins', { doctorId: fx.doctors.d1.id, patientId: fx.patients[0].id });
    const r = await request(ctx.app).get('/api/v1/public/board');
    expect(r.status).toBe(200);
    const d1 = r.body.data.doctors.find((d: { code: string }) => d.code === 'D01');
    expect(d1.upNext).toEqual(['D01-001']);
    expect(JSON.stringify(r.body)).not.toMatch(/Patient|@test\.local|patientId/);
  });

  it('notifications are user-scoped: marking another user notification is not found', async () => {
    const p1 = await client(ctx, 'p1@test.local');
    await p1.post('/appointments', { slotId: fx.slots.tomorrow[0].id }, { 'Idempotency-Key': key() });
    const mine = await p1.get('/notifications');
    expect(mine.body.data.unread).toBe(1);
    const p2 = await client(ctx, 'p2@test.local');
    expect((await p2.patch(`/notifications/${mine.body.data.items[0].id}/read`)).status).toBe(404);
    expect((await p1.patch(`/notifications/${mine.body.data.items[0].id}/read`)).status).toBe(200);
    expect((await p1.get('/notifications')).body.data.unread).toBe(0);
  });
});
