/**
 * Time helpers. Storage is always UTC; the clinic-local calendar day ("serviceDate")
 * is derived with Intl so day grouping never depends on formatted display strings.
 */

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = dateFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateFmtCache.set(tz, f);
  }
  return f;
}

function zonedParts(d: Date, tz: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Clinic-local calendar date (YYYY-MM-DD) for an instant. */
export function serviceDateOf(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset (minutes) of tz from UTC at the given instant. */
export function tzOffsetMinutes(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** Convert a clinic-local wall-clock date + "HH:mm" into a UTC instant. */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off1 = tzOffsetMinutes(guess, tz);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(first, tz);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO weekday 1 (Mon) … 7 (Sun) for a YYYY-MM-DD string. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Clinic-local "HH:mm" for display/logging. */
export function localTime(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export const minutes = (n: number) => n * 60_000;

/** Human date for messages, e.g. "Fri 23 Oct". */
export function localDateLabel(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}
