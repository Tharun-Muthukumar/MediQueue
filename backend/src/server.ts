import fs from 'node:fs';
import path from 'node:path';
import { createPrismaStore } from './adapters/mysql/prismaStore';
import { createApp } from './app';
import { config } from './config';
import { startJobs } from './jobs/scheduler';

async function main() {
  const store = await createPrismaStore();
  const clinic = await store.clinics.getDefault();
  if (!clinic) {
    console.warn('\n⚠  No clinic found. Run "npm run db:seed" in the backend folder to create demo data.\n');
  }
  // Works from both src/ (tsx) and dist/src/ (compiled)
  const dist = [path.resolve(__dirname, '../../frontend/dist'), path.resolve(__dirname, '../../../frontend/dist')].find((p) =>
    fs.existsSync(path.join(p, 'index.html')),
  );
  const serve = config.isProd || process.env.SERVE_FRONTEND === 'true';
  const { app, services } = createApp({ store, serveFrontend: serve ? dist ?? null : null });
  const stopJobs = config.enableJobs ? startJobs(services) : () => {};

  const server = app.listen(config.port, () => {
    console.log(`\n  MediQueue API listening on http://localhost:${config.port}`);
    console.log(`  Health check:  http://localhost:${config.port}/api/v1/health`);
    if (serve && dist) console.log(`  App:           http://localhost:${config.port}\n`);
    else console.log(`  Frontend:      ${config.frontendOrigins[0]}\n`);
  });

  const shutdown = async () => {
    stopJobs();
    server.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('Failed to start MediQueue API:', e);
  process.exit(1);
});
