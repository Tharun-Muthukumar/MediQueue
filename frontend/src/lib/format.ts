/** Display helpers. Timestamps arrive as UTC ISO strings and are shown in the clinic timezone. */

export const DEFAULT_TZ = (import.meta.env.VITE_DEMO_TIMEZONE as string | undefined) ?? 'Asia/Kolkata';
let tz = DEFAULT_TZ;
export function setDisplayTimezone(t: string | undefined | null) {
  if (t) tz = t;
}
export const displayTz = () => tz;

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const k = tz + JSON.stringify(opts);
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...opts });
    cache.set(k, f);
  }
  return f;
}

export const time = (iso: string | Date | null | undefined) => (iso ? fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '—');
export const dateShort = (iso: string | Date) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
export const dateLong = (iso: string | Date) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const dateTime = (iso: string | Date) => `${dateShort(iso)}, ${time(iso)}`;

/** Clinic-local YYYY-MM-DD for "now" (or a given date). */
export function clinicDate(d: Date = new Date()) {
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** A YYYY-MM-DD string → Date at clinic-day noon UTC-ish (safe for weekday/day labels). */
export const dayDate = (ymd: string) => new Date(`${ymd}T06:30:00Z`);

export function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function minutes(sec: number | null | undefined) {
  if (sec === null || sec === undefined) return '—';
  const m = Math.round(sec / 60);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function etaRange(low: number | null, high: number | null) {
  if (low === null || high === null) return '—';
  const lo = Math.round(low / 60);
  const hi = Math.round(high / 60);
  if (hi <= 1) return 'any moment';
  if (hi >= 60) return `${minutes(low)} – ${minutes(high)}`;
  return `${lo}–${hi} min`;
}

export function relative(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return dateShort(iso);
}

export function elapsed(fromIso: string | null, now = Date.now()) {
  if (!fromIso) return '—';
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const initials = (name: string) =>
  name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
