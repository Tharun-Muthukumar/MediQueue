import 'dotenv/config';

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test' || process.env.VITEST === 'true',
  port: num(process.env.PORT, 4000),
  frontendOrigins: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-insecure-secret-change-me-0123456789',
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 12),
  clinicTimezone: process.env.CLINIC_TIMEZONE ?? 'Asia/Kolkata',
  /** Secure cookies require HTTPS; keep false for http://localhost. */
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  enableJobs: (process.env.ENABLE_JOBS ?? 'true') === 'true',
  idempotencyTtlHours: 24,
};

if (config.isProd && config.sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
