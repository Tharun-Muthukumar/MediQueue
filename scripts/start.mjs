#!/usr/bin/env node
/**
 * Production-style local run: builds the frontend and backend, then serves BOTH from one
 * process on http://localhost:4000 (no Vite dev server needed). Useful for demos.
 */
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log('Applying database updates…');
run('npx prisma migrate deploy', path.join(root, 'backend'));
run('npx prisma generate', path.join(root, 'backend'));
console.log('Building frontend…');
run('npm run build', path.join(root, 'frontend'));
console.log('Building backend…');
run('npm run build', path.join(root, 'backend'));

const port = process.env.PORT ?? '4000';
const child = spawn('node dist/src/server.js', {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, SERVE_FRONTEND: 'true', PORT: port, FRONTEND_ORIGIN: `http://localhost:${port}` },
});
child.on('exit', (code) => process.exit(code ?? 0));
