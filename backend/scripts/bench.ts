/**
 * RQ1 + RQ4 — latency and booking contention on a throwaway MySQL database (`<your database>_bench`).
 *   npm run bench
 * Seeds a fresh copy of the demo data, starts the API on a random local port, then:
 *  - measures p50/p95 latency for GET /doctors, GET /queues/:id, POST /appointments
 *  - fires 50 simultaneous bookings at one free slot and counts accepted/rejected
 * Writes docs/results/benchmark.md.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve(__dirname, '..');
import { siblingDatabaseUrl } from '../src/shared/dbUrl';

const DB = siblingDatabaseUrl('bench');
process.env.DATABASE_URL = DB;
process.env.NODE_ENV = 'test';
process.env.ENABLE_JOBS = 'false';

console.log('Preparing benchmark database…');
execSync('npx tsx scripts/db.ts fresh bench', { cwd: root, env: { ...process.env, DATABASE_URL: DB }, stdio: 'pipe' });
execSync('npx tsx prisma/seed.ts', { cwd: root, env: { ...process.env, DATABASE_URL: DB }, stdio: 'pipe' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

async function main() {
  const { createPrismaStore } = await import('../src/adapters/mysql/prismaStore');
  const { createApp } = await import('../src/app');
  const { percentile, median } = await import('../src/shared/util');
  const store = await createPrismaStore(DB);
  const { app } = createApp({ store, bcryptRounds: 4, apiRateLimitPerMinute: 1_000_000 });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  async function session(email: string, password: string) {
    const jar: Record<string, string> = {};
    const absorb = (r: Response) => {
      for (const c of r.headers.getSetCookie()) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar[kv.slice(0, i)] = kv.slice(i + 1);
      }
    };
    const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const c = await fetch(`${base}/auth/csrf`);
    absorb(c);
    let csrf = (await json(c)).data.csrfToken;
    const l = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(), 'x-csrf-token': csrf }, body: JSON.stringify({ email, password }) });
    absorb(l);
    csrf = (await json(l)).data.csrfToken;
    return {
      get: (p: string) => fetch(`${base}${p}`, { headers: { cookie: cookie() } }),
      post: (p: string, body: object, h: Record<string, string> = {}) =>
        fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(), 'x-csrf-token': csrf, ...h }, body: JSON.stringify(body) }),
    };
  }

  async function time(n: number, fn: () => Promise<Response>) {
    const t: number[] = [];
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const s = performance.now();
      const r = await fn();
      await r.arrayBuffer();
      t.push(performance.now() - s);
      if (r.ok) ok++;
    }
    return { n, ok, p50: median(t)!, p95: percentile(t, 95)! };
  }

  const patient = await session('patient2@gmail.com', 'patient123');
  const doctor = await session('doctor1@gmail.com', 'doctor123');
  const doctors = await json(patient.get('/doctors'));
  const d1 = doctors.data[0].id;
  const d3 = doctors.data[2].id;

  const getDoctors = await time(100, () => patient.get('/doctors'));
  const getQueue = await time(100, () => doctor.get(`/queues/${d1}`));

  // Booking latency: each booking takes a different free future slot (one per day per doctor rule respected via different patients).
  const free: string[] = [];
  for (let day = 2; day <= 13 && free.length < 40; day++) {
    const date = new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
    const s = await json(patient.get(`/doctors/${d3}/slots?date=${date}`));
    for (const slot of s.data.slots) if (slot.available && free.length < 40) free.push(slot.id);
  }
  const bookers: Awaited<ReturnType<typeof session>>[] = [];
  for (let i = 0; i < free.length; i++) {
    const email = `bench${i}@example.com`;
    const c = await fetch(`${base}/auth/csrf`);
    const ck = c.headers.getSetCookie()[0].split(';')[0];
    const tok = (await json(c)).data.csrfToken;
    await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck, 'x-csrf-token': tok }, body: JSON.stringify({ name: `Bench ${i}`, email, password: 'Bench12345' }) });
    bookers.push(await session(email, 'Bench12345'));
  }
  let bi = 0;
  const book = await time(free.length, () => bookers[bi].post('/appointments', { slotId: free[bi++] }, { 'Idempotency-Key': randomUUID() }));

  // Contention: 50 distinct patients race for ONE free slot.
  const target = await (async () => {
    const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const s = await json(patient.get(`/doctors/${d1}/slots?date=${date}`));
    return s.data.slots.find((x: { available: boolean }) => x.available)?.id as string;
  })();
  const racers: Awaited<ReturnType<typeof session>>[] = [];
  for (let i = 0; i < 50; i++) {
    const email = `race${i}@example.com`;
    const c = await fetch(`${base}/auth/csrf`);
    const ck = c.headers.getSetCookie()[0].split(';')[0];
    const tok = (await json(c)).data.csrfToken;
    await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck, 'x-csrf-token': tok }, body: JSON.stringify({ name: `Race ${i}`, email, password: 'Race12345' }) });
    racers.push(await session(email, 'Race12345'));
  }
  const t0 = performance.now();
  const results = await Promise.all(racers.map((r) => r.post('/appointments', { slotId: target }, { 'Idempotency-Key': randomUUID() })));
  const raceMs = performance.now() - t0;
  const statuses = results.map((r) => r.status);
  const accepted = statuses.filter((s) => s === 201).length;
  const rejected = statuses.filter((s) => s === 409).length;
  const slotRow = (await store.slots.findById(target))!;

  server.close();
  await store.close();

  const f = (n: number) => n.toFixed(1);
  const md = `# Benchmark results (RQ1, RQ4)

Generated by \`npm run bench\` on ${new Date().toISOString().slice(0, 10)}.
Machine: ${os.cpus()[0]?.model ?? 'unknown CPU'} × ${os.cpus().length}, ${Math.round(os.totalmem() / 1e9)} GB RAM, ${os.platform()} · Node ${process.version}.
Single local API process, MySQL 8 (InnoDB), sequential requests over loopback HTTP.

## API latency

| Endpoint | Requests | 2xx | p50 (ms) | p95 (ms) | Target p95 |
|---|---|---|---|---|---|
| GET /doctors | ${getDoctors.n} | ${getDoctors.ok} | ${f(getDoctors.p50)} | ${f(getDoctors.p95)} | < 500 |
| GET /queues/:doctorId | ${getQueue.n} | ${getQueue.ok} | ${f(getQueue.p50)} | ${f(getQueue.p95)} | < 500 |
| POST /appointments | ${book.n} | ${book.ok} | ${f(book.p50)} | ${f(book.p95)} | < 500 |

## Booking contention (one capacity-1 slot, 50 simultaneous requests)

| Accepted (201) | Rejected SLOT_FULL (409) | Other | Final reservedCount | Wall time (ms) |
|---|---|---|---|---|
| ${accepted} | ${rejected} | ${50 - accepted - rejected} | ${slotRow.reservedCount} / ${slotRow.capacity} | ${f(raceMs)} |

Result: ${accepted === 1 && slotRow.reservedCount === 1 ? '**no over-capacity booking** — exactly one request succeeded.' : '**UNEXPECTED** — investigate.'}
`;
  const out = path.resolve(root, '../docs/results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'benchmark.md'), md);
  console.log(md);
  for (const f2 of ['bench.db', 'bench.db-wal', 'bench.db-shm']) {
    const p = path.join(root, 'prisma', f2);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
