/**
 * Transparent, non-clinical queue policy (blueprint §10.1–10.3).
 *
 * When both groups have eligible WAITING tickets, call `ratio` scheduled patients, then one
 * walk-in. If one group is empty, take from the other. The persisted `appointmentStreak`
 * makes the decision consistent across API calls and server restarts.
 * Nothing here looks at symptoms, age or any clinical attribute — by design.
 */

export interface QueueCandidate {
  id: string;
  source: string; // SCHEDULED | WALK_IN
  scheduledAt: Date | null;
  checkedInAt: Date;
}

const t = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);

/** Scheduled group: appointment start ASC, then check-in time ASC, then id ASC. */
export function compareScheduled(a: QueueCandidate, b: QueueCandidate): number {
  return t(a.scheduledAt) - t(b.scheduledAt) || a.checkedInAt.getTime() - b.checkedInAt.getTime() || a.id.localeCompare(b.id);
}

/** Walk-in group: FIFO by check-in, then id. */
export function compareWalkIn(a: QueueCandidate, b: QueueCandidate): number {
  return a.checkedInAt.getTime() - b.checkedInAt.getTime() || a.id.localeCompare(b.id);
}

export interface Selection<T extends QueueCandidate> {
  chosen: T | null;
  nextStreak: number;
}

export function selectNext<T extends QueueCandidate>(waiting: T[], streak: number, ratio: number): Selection<T> {
  const scheduled = waiting.filter((w) => w.source === 'SCHEDULED').sort(compareScheduled);
  const walkIns = waiting.filter((w) => w.source !== 'SCHEDULED').sort(compareWalkIn);
  if (!scheduled.length && !walkIns.length) return { chosen: null, nextStreak: streak };
  const effectiveRatio = Math.max(1, ratio);
  if (scheduled.length && (streak < effectiveRatio || !walkIns.length)) {
    return { chosen: scheduled[0], nextStreak: streak + 1 };
  }
  return { chosen: walkIns[0], nextStreak: 0 };
}

/**
 * Predicted call order for every WAITING ticket, by repeatedly applying `selectNext`.
 * Used for queue positions and ETA, so what patients see matches what "Call next" will do.
 */
export function predictOrder<T extends QueueCandidate>(waiting: T[], streak: number, ratio: number): T[] {
  const remaining = [...waiting];
  const order: T[] = [];
  let s = streak;
  while (remaining.length) {
    const { chosen, nextStreak } = selectNext(remaining, s, ratio);
    if (!chosen) break;
    order.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
    s = nextStreak;
  }
  return order;
}
