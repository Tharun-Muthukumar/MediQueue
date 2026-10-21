import type { Services } from '../routes/services';

/**
 * Local stand-in for EventBridge Scheduler: a no-show sweep every minute (only acts when the
 * clinic enables auto no-show) and hourly cleanup of expired sessions and idempotency records.
 */
export function startJobs(s: Services, log = console) {
  const noShow = setInterval(async () => {
    try {
      const n = await s.reception.runAutoNoShow();
      if (n) log.info(`[jobs] auto no-show marked ${n} appointment(s)`);
    } catch (e) {
      log.error('[jobs] no-show sweep failed', e);
    }
  }, 60_000);

  const cleanup = setInterval(async () => {
    try {
      const now = s.clock.now();
      await s.store.sessions.deleteExpired(now);
      await s.store.idempotency.deleteExpired(now);
    } catch (e) {
      log.error('[jobs] cleanup failed', e);
    }
  }, 60 * 60_000);

  return () => {
    clearInterval(noShow);
    clearInterval(cleanup);
  };
}
