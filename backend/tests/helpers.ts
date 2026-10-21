import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createPrismaStore } from '../src/adapters/mysql/prismaStore';
import { createApp } from '../src/app';
import type { Store } from '../src/repositories/types';
import { zonedTimeToUtc } from '../src/shared/time';
import { ManualClock } from '../src/shared/util';
import { siblingDatabaseUrl } from '../src/shared/dbUrl';

export const TZ = 'Asia/Kolkata';
/** 08:30 IST on Wednesday 21 Oct 2026 — before D01's 09:00 session. */
export const T0 = new Date('2026-10-21T03:00:00.000Z');
export const TODAY = '2026-10-21';
export const TOMORROW = '2026-10-22';
export const PASSWORD = 'Passw0rd!x';

export const TEST_DB = siblingDatabaseUrl('test');
export const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });

export async function wipe() {
  await prisma.consultation.deleteMany();
  await prisma.queueTicket.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.queueCounter.deleteMany();
  await prisma.doctorQueueState.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.session.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.clinic.deleteMany();
}

export interface Fixture {
  clinicId: string;
  doctors: { d1: { id: string; userId: string }; d2: { id: string; userId: string } };
  patients: { id: string; email: string; name: string }[];
  /** D01 slots: today 09:00–12:00 (12 × 15 min) and tomorrow 09:00–12:00 */
  slots: { today: { id: string; startAt: Date }[]; tomorrow: { id: string; startAt: Date }[] };
}

/** Minimal deterministic data set for API tests. */
export async function buildFixture(): Promise<Fixture> {
  await wipe();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', timezone: TZ, walkInRatio: 2, graceMinutes: 15, lateAfterMinutes: 15, defaultConsultMinutes: 12, bookingHorizonDays: 14 } });
  const mk = (email: string, name: string, role: string) => prisma.user.create({ data: { email, name, role, passwordHash: hash, clinicId: clinic.id } });
  await mk('admin@test.local', 'Admin User', 'ADMIN');
  await mk('reception@test.local', 'Reception User', 'RECEPTIONIST');
  const u1 = await mk('doc1@test.local', 'Dr. One', 'DOCTOR');
  const u2 = await mk('doc2@test.local', 'Dr. Two', 'DOCTOR');
  const d1 = await prisma.doctor.create({ data: { userId: u1.id, clinicId: clinic.id, code: 'D01', department: 'General Medicine', room: 'Room 1', avgMinutes: 12 } });
  const d2 = await prisma.doctor.create({ data: { userId: u2.id, clinicId: clinic.id, code: 'D02', department: 'Dermatology', room: 'Room 2', avgMinutes: 10 } });
  const patients = [];
  for (let i = 1; i <= 24; i++) {
    const p = await mk(`p${i}@test.local`, `Patient ${i}`, 'PATIENT');
    patients.push({ id: p.id, email: p.email, name: p.name });
  }
  const mkSlots = async (doctorId: string, date: string) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const hh = 9 + Math.floor((i * 15) / 60);
      const mm = (i * 15) % 60;
      const startAt = zonedTimeToUtc(date, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, TZ);
      const s = await prisma.slot.create({ data: { doctorId, serviceDate: date, startAt, endAt: new Date(startAt.getTime() + 15 * 60000) } });
      out.push({ id: s.id, startAt });
    }
    return out;
  };
  const today = await mkSlots(d1.id, TODAY);
  const tomorrow = await mkSlots(d1.id, TOMORROW);
  await mkSlots(d2.id, TODAY);
  return {
    clinicId: clinic.id,
    doctors: { d1: { id: d1.id, userId: u1.id }, d2: { id: d2.id, userId: u2.id } },
    patients,
    slots: { today, tomorrow },
  };
}

export interface TestCtx {
  store: Store;
  clock: ManualClock;
  app: ReturnType<typeof createApp>['app'];
  services: ReturnType<typeof createApp>['services'];
}

export async function makeApp(clock = new ManualClock(T0)): Promise<TestCtx> {
  const store = await createPrismaStore(TEST_DB);
  const { app, services } = createApp({ store, clock, bcryptRounds: 4 });
  return { store, clock, app, services };
}

/** A signed-in HTTP client that carries the session cookie and CSRF header automatically. */
export async function client(ctx: TestCtx, email?: string, password = PASSWORD) {
  const agent = request.agent(ctx.app);
  const c = await agent.get('/api/v1/auth/csrf');
  let csrf: string = c.body.data.csrfToken;
  if (email) {
    const r = await agent.post('/api/v1/auth/login').set('x-csrf-token', csrf).send({ email, password });
    if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
    csrf = r.body.data.csrfToken;
  }
  const api = (p: string) => `/api/v1${p}`;
  return {
    agent,
    get: (p: string) => agent.get(api(p)),
    post: (p: string, body: object = {}, headers: Record<string, string> = {}) => agent.post(api(p)).set('x-csrf-token', csrf).set(headers).send(body),
    patch: (p: string, body: object = {}) => agent.patch(api(p)).set('x-csrf-token', csrf).send(body),
    del: (p: string) => agent.delete(api(p)).set('x-csrf-token', csrf),
  };
}

export const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
