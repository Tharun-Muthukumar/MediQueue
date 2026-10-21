import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_DATABASE_URL = 'mysql://mediqueue:mediqueue123@localhost:3306/mediqueue';

/** The app's DATABASE_URL: from the environment, else backend/.env, else the documented default. */
export function baseDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.startsWith('mysql://')) return process.env.DATABASE_URL;
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m?.[1].startsWith('mysql://')) return m[1];
  }
  return DEFAULT_DATABASE_URL;
}

/**
 * Same server and credentials, different database: `mediqueue` → `mediqueue_test`.
 * Tests, the browser suite and the benchmark each get their own throwaway database
 * so they never touch your demo data.
 */
export function siblingDatabaseUrl(suffix: string, base = baseDatabaseUrl()): string {
  const u = new URL(base);
  const db = u.pathname.replace(/^\//, '') || 'mediqueue';
  u.pathname = db.endsWith(`_${suffix}`) ? `/${db}` : `/${db}_${suffix}`; // already the sibling: keep it
  return u.toString();
}

/** Database name from a mysql:// URL, restricted to safe identifier characters. */
export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Database name "${name}" may only contain letters, numbers and underscores.`);
  return name;
}
