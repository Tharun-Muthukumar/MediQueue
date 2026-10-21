/** Visual building blocks: avatars, icon tiles, stat cards, sparklines, hero banners, rings. */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountUp } from './motion';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────────────────── Avatar ─────────────────────────

const GRADIENTS = [
  ['#0f9b9f', '#5eead4'],
  ['#3b5bdb', '#74c0fc'],
  ['#7048e8', '#b197fc'],
  ['#d9480f', '#ffa94d'],
  ['#c2255c', '#f783ac'],
  ['#2b8a3e', '#8ce99a'],
  ['#1864ab', '#4dabf7'],
  ['#5f3dc4', '#e599f7'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initialsOf(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const AVATAR_SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-[11.5px]', md: 'h-10 w-10 text-[13.5px]', lg: 'h-14 w-14 text-[18px]', xl: 'h-[88px] w-[88px] text-[28px]' };

/** Profile photo when available, otherwise a stable two-tone gradient with initials. */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
  ring,
  status,
  active,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof AVATAR_SIZES;
  className?: string;
  ring?: boolean;
  status?: 'online' | 'busy' | 'away';
  active?: boolean;
}) {
  const [a, b] = GRADIENTS[hash(name) % GRADIENTS.length];
  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      {src ? (
        <img src={src} alt="" className={cx('rounded-full object-cover', AVATAR_SIZES[size], ring && 'ring-2 ring-white', active && 'ring-2 ring-teal ring-offset-2')} />
      ) : (
        <span
          className={cx('grid place-items-center rounded-full font-bold text-white', AVATAR_SIZES[size], ring && 'ring-2 ring-white', active && 'ring-2 ring-teal ring-offset-2')}
          style={{ backgroundImage: `linear-gradient(135deg, ${a}, ${b})`, textShadow: '0 1px 1px rgb(0 0 0 / 0.18)' }}
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
      {status && (
        <span
          className={cx('absolute bottom-0 right-0 block rounded-full ring-2 ring-white', size === 'xl' ? 'h-4 w-4' : 'h-2.5 w-2.5', status === 'online' ? 'bg-[#22c55e]' : status === 'busy' ? 'bg-[#f59e0b]' : 'bg-[#94a3b8]')}
          aria-hidden
        />
      )}
    </span>
  );
}

export function AvatarStack({ people, max = 4 }: { people: { name: string; avatarUrl?: string | null }[]; max?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <Avatar key={p.name + i} name={p.name} src={p.avatarUrl} size="sm" ring className={i ? '-ml-2' : ''} />
      ))}
      {people.length > max && <span className="-ml-2 grid h-8 w-8 place-items-center rounded-full bg-paper-2 text-[11px] font-bold text-ink-2 ring-2 ring-white">+{people.length - max}</span>}
    </span>
  );
}

// ───────────────────────── Icon tile ─────────────────────────

export type Tone = 'teal' | 'blue' | 'amber' | 'violet' | 'rose' | 'green' | 'slate' | 'navy';
const TONES: Record<Tone, string> = {
  teal: 'bg-teal-50 text-teal-700',
  blue: 'bg-[#e8efff] text-[#2f55d4]',
  amber: 'bg-amber-bg text-amber-ink',
  violet: 'bg-[#f1ecff] text-[#6741d9]',
  rose: 'bg-[#ffecf1] text-[#c2255c]',
  green: 'bg-green-bg text-green-ink',
  slate: 'bg-slate-bg text-slate-ink',
  navy: 'bg-ink text-white',
};

export function IconTile({ icon: Icon, tone = 'teal', size = 'md', className }: { icon: LucideIcon; tone?: Tone; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'h-8 w-8 rounded-lg [&>svg]:h-4 [&>svg]:w-4', md: 'h-10 w-10 rounded-xl [&>svg]:h-5 [&>svg]:w-5', lg: 'h-12 w-12 rounded-2xl [&>svg]:h-6 [&>svg]:w-6' }[size];
  return (
    <span className={cx('grid shrink-0 place-items-center', TONES[tone], s, className)} aria-hidden>
      <Icon />
    </span>
  );
}

// ───────────────────────── Sparkline ─────────────────────────

export function Sparkline({ values, color = '#009096', className, label }: { values: (number | null)[]; color?: string; className?: string; label?: string }) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return <span className={cx('block h-9 w-24', className)} />;
  const W = 96;
  const H = 36;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `M${x(pts[0].i)},${H} L${line.replace(/ /g, ' L')} L${x(pts[pts.length - 1].i)},${H} Z`;
  const last = pts[pts.length - 1];
  const id = `sg-${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cx('h-9 w-24 overflow-visible', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="3" fill={color} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

// ───────────────────────── Stat card ─────────────────────────

export function StatCard({
  icon,
  tone = 'teal',
  label,
  value,
  suffix,
  sub,
  trend,
  delta,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  label: string;
  value: number | string | null;
  suffix?: string;
  sub?: ReactNode;
  trend?: (number | null)[];
  delta?: { text: string; good?: boolean } | null;
  className?: string;
}) {
  return (
    <div className={cx('card glow lift relative overflow-hidden p-4', className)} data-spotlight="" data-stat={label}>
      <div className="flex items-start justify-between gap-3">
        <IconTile icon={icon} tone={tone} />
        {trend && <Sparkline values={trend} color={tone === 'amber' ? '#c47a12' : tone === 'violet' ? '#6741d9' : tone === 'blue' ? '#2f55d4' : tone === 'rose' ? '#c2255c' : '#009096'} />}
      </div>
      <p className="mt-3 text-[13px] font-medium text-muted">{label}</p>
      <div className="mt-0.5 flex items-baseline gap-2">
        <p className="tabular font-display text-[30px] font-bold leading-none text-ink" data-value="">
          {value === null ? '—' : typeof value === 'number' ? <CountUp value={value} format={(n) => (Number.isInteger(value) ? String(Math.round(n)) : n.toFixed(1))} /> : value}
          {suffix && value !== null && <span className="ml-1 text-[15px] font-semibold text-ink-soft">{suffix}</span>}
        </p>
        {delta && (
          <span className={cx('rounded-full px-1.5 py-0.5 text-[11.5px] font-bold', delta.good ? 'bg-green-bg text-green-ink' : 'bg-amber-bg text-amber-ink')}>{delta.text}</span>
        )}
      </div>
      {sub && <p className="mt-1.5 text-[12.5px] text-ink-soft">{sub}</p>}
    </div>
  );
}

// ───────────────────────── Hero banner ─────────────────────────

/** Navy welcome banner with a token-pattern backdrop; used at the top of each dashboard. */
export function HeroBanner({ eyebrow, title, subtitle, aside, actions, avatar }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; aside?: ReactNode; actions?: ReactNode; avatar?: ReactNode }) {
  return (
    <section className="dark-field relative mb-6 overflow-hidden rounded-[22px] bg-ink text-white shadow-[0_24px_60px_-30px_rgb(18_38_67/0.65)]" data-surface="dark" data-spotlight="">
      <HeroPattern />
      <div className="relative grid gap-6 p-6 sm:p-7 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-5">
          {avatar}
          <div className="min-w-0">
            {eyebrow && <p className="text-[13px] font-medium text-[#99f6e4]">{eyebrow}</p>}
            <h1 className="mt-0.5 text-[28px] font-bold leading-tight text-white sm:text-[32px]">{title}</h1>
            {subtitle && <div className="mt-1.5 max-w-[62ch] text-[14.5px] text-white/70">{subtitle}</div>}
            {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>
        {aside && <div className="min-w-0">{aside}</div>}
      </div>
    </section>
  );
}

function HeroPattern() {
  return (
    <svg className="pointer-events-none absolute -right-10 -top-10 h-[340px] w-[520px] opacity-[0.13]" viewBox="0 0 520 340" aria-hidden>
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => {
          const x = 30 + c * 100 + (r % 2) * 50;
          const y = 20 + r * 80;
          return (
            <g key={`${r}-${c}`} transform={`translate(${x} ${y}) rotate(-12)`}>
              <path d="M0 0h70v20a8 8 0 0 0 0 16v20H0V36a8 8 0 0 0 0-16z" fill="none" stroke="#5eead4" strokeWidth="2" />
              <path d="M14 28h42" stroke="#5eead4" strokeWidth="2" strokeDasharray="4 4" />
            </g>
          );
        }),
      )}
    </svg>
  );
}

/** Translucent button for use on the navy hero. */
export const heroButton =
  'btn inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 text-[14px] font-semibold text-white backdrop-blur hover:bg-white/20';
export const heroPrimary = 'btn inline-flex h-10 items-center gap-2 rounded-lg bg-[#5eead4] px-4 text-[14px] font-bold text-ink hover:bg-[#99f6e4] shadow-[0_8px_24px_-8px_rgb(94_234_212/0.6)]';

// ───────────────────────── Rings & date tiles ─────────────────────────

export function ProgressRing({ value, max, size = 92, label, sub }: { value: number; max: number; size?: number; label?: ReactNode; sub?: ReactNode }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${max}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(255 255 255 / 0.12)" strokeWidth="10" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#5eead4"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.2,0.8,0.2,1)' }}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-white font-display text-[20px] font-bold">
          {Math.round(pct * 100)}%
        </text>
      </svg>
      {(label || sub) && (
        <div>
          {label && <p className="font-display text-[20px] font-bold leading-tight text-white">{label}</p>}
          {sub && <p className="text-[13px] text-white/65">{sub}</p>}
        </div>
      )}
    </div>
  );
}

/** Calendar-style tile: weekday, big day number, month. */
export function DateTile({ date, tz, tone = 'teal', size = 'md' }: { date: string | Date; tz: string; tone?: 'teal' | 'slate'; size?: 'sm' | 'md' }) {
  const d = new Date(date);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o }).format(d);
  return (
    <span className={cx('flex shrink-0 flex-col items-center overflow-hidden rounded-xl border bg-white text-center', tone === 'teal' ? 'border-teal/30' : 'border-line', size === 'md' ? 'w-[58px]' : 'w-[48px]')} aria-hidden>
      <span className={cx('w-full py-0.5 text-[10.5px] font-bold text-white', tone === 'teal' ? 'bg-teal' : 'bg-slate-ink')}>{f({ weekday: 'short' })}</span>
      <span className={cx('tabular font-display font-bold leading-none text-ink', size === 'md' ? 'pt-1.5 text-[22px]' : 'pt-1 text-[18px]')}>{f({ day: 'numeric' })}</span>
      <span className="pb-1 text-[10.5px] font-semibold text-muted">{f({ month: 'short' })}</span>
    </span>
  );
}

export function SectionTitle({ icon, tone = 'teal', title, description, action }: { icon: LucideIcon; tone?: Tone; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile icon={icon} tone={tone} size="sm" />
        <div className="min-w-0">
          <h2 className="text-[16.5px] font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function greetingFor(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
