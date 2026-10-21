#!/usr/bin/env node
/**
 * One-time setup (Windows, macOS, Linux):
 *   1. checks Node.js version
 *   2. creates backend/.env with a random SESSION_SECRET (if missing)
 *   3. installs dependencies for root, backend and frontend
 *   4. creates the MySQL database (if missing), applies migrations and seeds demo data
 *
 * Needs MySQL 8 running and the account in backend/.env (default mediqueue / mediqueue123).
 * See docs/mysql.md for the one-time MySQL commands.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');

const step = (n, msg) => console.log(`\n\x1b[36m[${n}/5]\x1b[0m ${msg}`);
function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n\x1b[31mFailed:\x1b[0m ${cmd} (in ${path.relative(root, cwd) || '.'})`);
    console.error('See the Troubleshooting section of README.md.');
    process.exit(r.status ?? 1);
  }
}

step(1, 'Checking Node.js');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  console.error(`Node.js ${process.versions.node} is too old. Install Node.js 22 LTS from https://nodejs.org and reopen your terminal.`);
  process.exit(1);
}
console.log(`Node.js ${process.versions.node} OK`);

step(2, 'Preparing backend/.env');
const envPath = path.join(backend, '.env');
if (!fs.existsSync(envPath)) {
  const example = fs.readFileSync(path.join(backend, '.env.example'), 'utf8');
  const secret = randomBytes(32).toString('hex');
  fs.writeFileSync(envPath, example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`));
  console.log('Created backend/.env with a random session secret.');
} else {
  console.log('backend/.env already exists — kept as is.');
}

step(3, 'Installing dependencies (this can take a few minutes the first time)');
run('npm install --no-audit --no-fund', root);
run('npm install --no-audit --no-fund', backend);
run('npm install --no-audit --no-fund', frontend);

step(4, 'Creating the MySQL database and tables');
run('npx prisma generate', backend);
run('npx tsx scripts/db.ts create', backend);
run('npx prisma migrate deploy', backend);

step(5, 'Loading demo data');
run('npm run db:seed', backend);

console.log(`
\x1b[32mSetup complete.\x1b[0m

  Start the app:   npm run dev        (or double-click start-windows.bat)
  Then open:       http://localhost:5173

  Sign in with:    admin@gmail.com / admin123      reception@gmail.com / reception123
                   doctor1@gmail.com / doctor123   patient1@gmail.com / patient123
`);
