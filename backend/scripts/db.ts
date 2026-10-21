/**
 * Small database helper used by setup, tests and the browser suite.
 *   npx tsx scripts/db.ts create            create the database in DATABASE_URL if it is missing
 *   npx tsx scripts/db.ts fresh <suffix>    drop + recreate <database>_<suffix> and apply migrations
 *   npx tsx scripts/db.ts url <suffix>      print the URL of <database>_<suffix>
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { ensureDatabase } from '../src/shared/dbAdmin';
import { baseDatabaseUrl, siblingDatabaseUrl } from '../src/shared/dbUrl';

async function main() {
  const [cmd, suffix] = process.argv.slice(2);
  const url = suffix ? siblingDatabaseUrl(suffix) : baseDatabaseUrl();
  if (cmd === 'url') {
    process.stdout.write(url);
  } else if (cmd === 'create') {
    await ensureDatabase(url);
    console.log(`Database ready: ${new URL(url).pathname.slice(1)} on ${new URL(url).host}`);
  } else if (cmd === 'fresh') {
    await ensureDatabase(url, { fresh: true });
    execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  } else {
    console.error('Usage: tsx scripts/db.ts create | fresh <suffix> | url <suffix>');
    process.exit(2);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nCould not reach MySQL: ${msg.split('\n').filter(Boolean).slice(-1)[0]}`);
  console.error('Check that MySQL is running and that DATABASE_URL in backend/.env has the right user and password (see docs/mysql.md).');
  process.exit(1);
});
