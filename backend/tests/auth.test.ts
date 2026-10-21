import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFixture, client, makeApp, PASSWORD, prisma, type Fixture, type TestCtx } from './helpers';

let ctx: TestCtx;
let fx: Fixture;

beforeAll(async () => {
  ctx = await makeApp();
});
beforeEach(async () => {
  fx = await buildFixture();
});
afterAll(async () => {
  await ctx.store.close();
});

describe('authentication & authorisation', () => {
  it('health endpoint reports database readiness without auth', async () => {
    const r = await request(ctx.app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'ok', database: 'ready' });
  });

  it('T01 registration always creates a PATIENT and cannot request a role', async () => {
    const c = await client(ctx);
    const ok = await c.post('/auth/register', { name: 'New Person', email: 'New@Example.com', password: 'abc12345' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.user).toMatchObject({ role: 'PATIENT', email: 'new@example.com' });
    expect(ok.body.data.user.passwordHash).toBeUndefined();
    const sneaky = await c.post('/auth/register', { name: 'Sneaky', email: 'x@example.com', password: 'abc12345', role: 'ADMIN' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.error.code).toBe('VALIDATION_ERROR');
    const dup = await c.post('/auth/register', { name: 'Dup', email: 'new@example.com', password: 'abc12345' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('T02 wrong password returns 401 with a generic message', async () => {
    const c = await client(ctx);
    const r = await c.post('/auth/login', { email: 'p1@test.local', password: 'wrong-pass1' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    const r2 = await c.post('/auth/login', { email: 'nobody@test.local', password: 'wrong-pass1' });
    expect(r2.body.error.message).toBe(r.body.error.message); // no account enumeration
    expect(JSON.stringify(r.body)).not.toMatch(/hash|stack/i);
  });

  it('unauthenticated calls get 401 and logout invalidates the server-side session', async () => {
    expect((await request(ctx.app).get('/api/v1/auth/me')).status).toBe(401);
    const c = await client(ctx, 'p1@test.local');
    expect((await c.get('/auth/me')).status).toBe(200);
    await c.post('/auth/logout');
    expect((await c.get('/auth/me')).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it('state-changing requests without the CSRF token are rejected', async () => {
    const c = await client(ctx, 'p1@test.local');
    const r = await c.agent.post('/api/v1/appointments').set('Idempotency-Key', 'abcdefgh1').send({ slotId: fx.slots.today[0].id });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_FAILED');
    const evil = await c.agent.post('/api/v1/auth/logout').set('Origin', 'https://evil.example').set('x-csrf-token', 'x');
    expect(evil.status).toBe(403);
  });

  it('T03 patient calling admin APIs gets 403 and nothing changes', async () => {
    const c = await client(ctx, 'p1@test.local');
    expect((await c.get('/admin/metrics')).status).toBe(403);
    const before = await prisma.doctor.count();
    const r = await c.post('/admin/doctors', { name: 'Dr X', email: 'x@x.com', password: 'abc12345', department: 'Any', room: '1', avgMinutes: 10 });
    expect(r.status).toBe(403);
    expect(await prisma.doctor.count()).toBe(before);
  });

  it('role matrix: each role is limited to its own endpoints', async () => {
    const doc = await client(ctx, 'doc1@test.local');
    const rec = await client(ctx, 'reception@test.local');
    const pat = await client(ctx, 'p1@test.local');
    expect((await doc.get('/reception/today')).status).toBe(403);
    expect((await doc.get(`/queues/${fx.doctors.d2.id}`)).status).toBe(403); // other doctor's queue
    expect((await doc.post(`/queues/${fx.doctors.d2.id}/call-next`)).status).toBe(403);
    expect((await doc.get(`/queues/${fx.doctors.d1.id}`)).status).toBe(200);
    expect((await rec.get('/admin/audit')).status).toBe(403);
    expect((await rec.get('/reception/today')).status).toBe(200);
    expect((await pat.get(`/queues/${fx.doctors.d1.id}`)).status).toBe(403);
    expect((await pat.get('/reception/patients?q=Patient')).status).toBe(403);
  });

  it('deactivated accounts cannot sign in and lose existing sessions', async () => {
    const admin = await client(ctx, 'admin@test.local');
    const pat = await client(ctx, 'p2@test.local');
    const r = await admin.patch(`/admin/users/${fx.patients[1].id}/active`, { isActive: false });
    expect(r.status).toBe(200);
    expect((await pat.get('/auth/me')).status).toBe(401);
    const c = await client(ctx);
    expect((await c.post('/auth/login', { email: 'p2@test.local', password: 'Passw0rd!x' })).body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('T30 script-like names are stored and returned as plain JSON text', async () => {
    const c = await client(ctx);
    const name = '<img src=x onerror=alert(1)>';
    const r = await c.post('/auth/register', { name, email: 'xss@example.com', password: 'abc12345' });
    expect(r.status).toBe(201);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body.data.user.name).toBe(name);
  });

  it('profile: users update their own name, phone and photo, but not email or role', async () => {
    const c = await client(ctx, 'p1@test.local');
    const photo = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
    const r = await c.patch('/auth/me', { name: 'Patient One Renamed', phone: '+91 90000 11111', avatarUrl: photo });
    expect(r.status).toBe(200);
    expect(r.body.data.user).toMatchObject({ name: 'Patient One Renamed', phone: '+91 90000 11111', avatarUrl: photo, role: 'PATIENT' });
    expect((await c.get('/auth/me')).body.data.user.avatarUrl).toBe(photo);
    expect((await c.patch('/auth/me', { role: 'ADMIN' })).status).toBe(400);
    expect((await c.patch('/auth/me', { email: 'x@y.com' })).status).toBe(400);
    expect((await c.patch('/auth/me', { avatarUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await c.patch('/auth/me', { avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect((await c.patch('/auth/me', {})).status).toBe(400);
    const cleared = await c.patch('/auth/me', { avatarUrl: null });
    expect(cleared.body.data.user.avatarUrl).toBeNull();
    const ev = await prisma.auditEvent.findFirst({ where: { action: 'PROFILE_UPDATED' } });
    expect(ev!.afterJson).not.toContain('base64'); // image data never copied into the audit log
  });

  it('password change: needs the current password and signs out other sessions', async () => {
    const a = await client(ctx, 'p2@test.local');
    const other = await client(ctx, 'p2@test.local');
    expect((await a.post('/auth/password', { currentPassword: 'wrong-one-1', newPassword: 'NewPassw0rd' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await a.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    const ok = await a.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'NewPassw0rd' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.otherSessionsSignedOut).toBe(1);
    expect((await a.get('/auth/me')).status).toBe(200); // this session stays signed in
    expect((await other.get('/auth/me')).status).toBe(401);
    const fresh = await client(ctx);
    expect((await fresh.post('/auth/login', { email: 'p2@test.local', password: PASSWORD })).status).toBe(401);
    expect((await fresh.post('/auth/login', { email: 'p2@test.local', password: 'NewPassw0rd' })).status).toBe(200);
  });
});
