// Starts an isolated MediQueue instance for the browser test: a fresh MySQL database
// (`<your database>_e2e`), seeded, with the built frontend served by the API on port 4100.
import { execSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
// Same MySQL server and account as backend/.env, but its own database.
const e2eUrl = execSync('npx tsx scripts/db.ts url e2e', { cwd: backend, encoding: 'utf8' }).trim();
const env = {
  ...process.env,
  DATABASE_URL: e2eUrl,
  PORT: '4100',
  FRONTEND_ORIGIN: 'http://localhost:4100',
  SERVE_FRONTEND: 'true',
  ENABLE_JOBS: 'false',
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
};
const run = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync(path.join(root, 'frontend', 'dist', 'index.html'))) run('npm run build', path.join(root, 'frontend'));
run('npx tsx scripts/db.ts fresh e2e', backend);
run('npx tsx prisma/seed.ts', backend);
const child = spawn('npx tsx src/server.ts', { cwd: backend, env, stdio: 'inherit', shell: true });
const stop = () => child.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (c) => process.exit(c ?? 0));
