import { median } from '../shared/util';

/**
 * Explainable waiting-time estimate (blueprint §10.4).
 * expected duration = rolling median of the doctor's last 5–15 plausible consultations,
 * otherwise the doctor's configured default.
 */

export const ETA_MIN_SAMPLES = 5;
export const ETA_MAX_SAMPLES = 15;
export const PLAUSIBLE_MIN_SEC = 60;
export const PLAUSIBLE_MAX_SEC = 90 * 60;
export const RANGE_LOW = 0.8;
export const RANGE_HIGH = 1.25;

export interface DurationEstimate {
  expectedSec: number;
  basis: 'ROLLING_MEDIAN' | 'DEFAULT';
  samples: number;
}

/** `recentDurationsSec` must be newest-first. */
export function estimateConsultDuration(recentDurationsSec: number[], defaultMinutes: number): DurationEstimate {
  const valid = recentDurationsSec
    .filter((d) => Number.isFinite(d) && d >= PLAUSIBLE_MIN_SEC && d <= PLAUSIBLE_MAX_SEC)
    .slice(0, ETA_MAX_SAMPLES);
  if (valid.length >= ETA_MIN_SAMPLES) {
    return { expectedSec: Math.round(median(valid)!), basis: 'ROLLING_MEDIAN', samples: valid.length };
  }
  return { expectedSec: defaultMinutes * 60, basis: 'DEFAULT', samples: valid.length };
}

export interface ActiveVisit {
  status: 'CALLED' | 'IN_CONSULTATION';
  startedAt: Date | null;
}

/** Remaining time of the visit currently with the doctor. Never negative; a CALLED patient counts as a full visit. */
export function activeRemainderSec(active: ActiveVisit | null, expectedSec: number, now: Date): number {
  if (!active) return 0;
  if (active.status === 'CALLED' || !active.startedAt) return expectedSec;
  const elapsed = (now.getTime() - active.startedAt.getTime()) / 1000;
  // If the visit is overrunning, assume at least one more minute rather than zero.
  return Math.max(60, Math.round(expectedSec - elapsed));
}

export interface EtaResult {
  status: 'OK' | 'PAUSED';
  waitSec: number | null;
  lowSec: number | null;
  highSec: number | null;
}

/** ETA for the ticket with `ahead` WAITING tickets in front of it. */
export function computeEta(params: {
  ahead: number;
  expectedSec: number;
  remainderSec: number;
  paused: boolean;
}): EtaResult {
  if (params.paused) return { status: 'PAUSED', waitSec: null, lowSec: null, highSec: null };
  const waitSec = Math.max(0, Math.round(params.remainderSec + params.ahead * params.expectedSec));
  return {
    status: 'OK',
    waitSec,
    lowSec: Math.round(waitSec * RANGE_LOW),
    highSec: Math.round(waitSec * RANGE_HIGH),
  };
}
