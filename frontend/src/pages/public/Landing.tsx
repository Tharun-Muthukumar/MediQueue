import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, ShieldCheck, Timer, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMe, homeFor } from '../../app/auth';
import { Logo } from '../../components/token';
import { ButtonLink } from '../../components/ui';
import { Magnetic, Reveal, Tilt } from '../../components/motion';
import { get } from '../../lib/api';
import { dateLong, time } from '../../lib/format';
import type { Board } from '../../lib/types';

function NowServing({ token }: { token: string | null }) {
  // Re-keying on the token replays the flip animation whenever a new patient is called.
  return (
    <p className="token-number text-[34px] text-[#5eead4]" aria-live="polite">
      <span key={token ?? 'none'} className="flip-in">
        {token ?? '—'}
      </span>
    </p>
  );
}

function MiniBoard() {
  const q = useQuery({ queryKey: ['board'], queryFn: () => get<Board>('/public/board'), refetchInterval: 5000 });
  const b = q.data;
  return (
    <Tilt max={7} className="rounded-[22px]">
      <div
        className="dark-field relative overflow-hidden rounded-[22px] bg-ink p-5 text-white shadow-[0_30px_70px_-25px_rgb(18_38_67/0.55)] sm:p-6"
        aria-label="Live waiting-room board"
        data-surface="dark"
        data-spotlight=""
      >
        <div className="relative flex items-center justify-between">
          <div>
            <p className="font-display text-[18px] font-semibold">{b?.clinicName ?? 'DemoCare OPD'}</p>
            <p className="text-[13px] text-white/55">{b ? dateLong(b.generatedAt) : 'Waiting room'}</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold">
            <span className="live-dot h-2 w-2 rounded-full bg-[#34d399]" aria-hidden />
            {b ? `Updated ${time(b.generatedAt)}` : 'Connecting'}
          </span>
        </div>
        <div className="relative mt-5 divide-y divide-white/10">
          {(b?.doctors ?? []).map((d) => (
            <div key={d.code} className="grid grid-cols-[1fr_auto] items-center gap-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{d.doctorName}</p>
                <p className="text-[12.5px] text-white/55">
                  {d.department}, {d.room}
                </p>
                <p className="mt-1 text-[12.5px] text-white/70">
                  {d.paused ? 'Queue paused' : d.upNext.length ? `Next: ${d.upNext.slice(0, 3).join('  ')}` : 'No one waiting'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11.5px] font-medium text-white/55">Now serving</p>
                <NowServing token={d.nowServing?.tokenLabel ?? null} />
              </div>
            </div>
          ))}
          {q.isError && <p className="py-6 text-[14px] text-white/70">Start the backend to see the live board.</p>}
          {q.isLoading && (
            <div className="space-y-3 py-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-white/10" />
              ))}
            </div>
          )}
        </div>
      </div>
    </Tilt>
  );
}

const steps = [
  { title: 'Book', body: 'Pick a doctor and a free 15-minute slot. Two people can never take the same last slot.' },
  { title: 'Check in', body: 'Reception confirms you have arrived and hands you a token like D01-004.' },
  { title: 'Wait anywhere', body: 'Your phone shows your place in line and an honest time range that updates as visits finish.' },
  { title: 'Get called', body: 'When the doctor calls you, your screen and the waiting-room board change at once.' },
];

const roles = [
  { name: 'Patients', does: 'Book and cancel their own visits, follow their token live, get notified when called.' },
  { name: 'Reception', does: 'Check people in, register walk-ins, handle late arrivals and no-shows with a recorded reason.' },
  { name: 'Doctors', does: 'Call the next patient, start and finish visits, pause the queue for a break.' },
  { name: 'Administrators', does: 'Manage doctors and schedules, read daily metrics, export reports, review the audit log.' },
];

export default function Landing() {
  const { data: me } = useMe();
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2" aria-label="Site">
          <a href="/board" className="hidden rounded-lg px-3 py-2 text-[14px] font-semibold text-ink-2 hover:bg-paper-2 sm:inline-flex">
            Waiting-room board
          </a>
          {me ? (
            <ButtonLink to={homeFor[me.user.role]}>Open my dashboard</ButtonLink>
          ) : (
            <>
              <Link to="/login" className="whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-semibold text-ink-2 hover:bg-paper-2">
                Sign in
              </Link>
              <span className="hidden sm:inline-flex">
                <ButtonLink to="/register">Create patient account</ButtonLink>
              </span>
              <span className="sm:hidden">
                <ButtonLink to="/register" size="sm">
                  Register
                </ButtonLink>
              </span>
            </>
          )}
        </nav>
      </header>

      <section className="relative" data-spotlight="">
        <div className="hero-field" aria-hidden />
        <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div>
          <h1 className="max-w-[16ch] text-[42px] font-bold leading-[1.02] sm:text-[60px]">
            <span className="rise block" style={{ animationDelay: '40ms' }}>The clinic</span>
            <span className="rise block" style={{ animationDelay: '140ms' }}>waiting room,</span>
            <span className="rise block text-teal" style={{ animationDelay: '240ms' }}>made predictable.</span>
          </h1>
          <p className="rise mt-5 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft" style={{ animationDelay: '380ms' }}>
            MediQueue joins appointment booking, arrival check-in and a fair token queue, so patients know when they will be seen and staff know exactly who is next.
          </p>
          <div className="rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '480ms' }}>
            <Magnetic>
              <ButtonLink to={me ? homeFor[me.user.role] : '/login'} size="lg" icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">
                {me ? 'Go to my dashboard' : 'Sign in to the demo'}
              </ButtonLink>
            </Magnetic>
            <Magnetic>
              <ButtonLink to="/board" external size="lg" variant="secondary" icon={<ArrowUpRight className="h-4 w-4" />}>
                Open the live board
              </ButtonLink>
            </Magnetic>
          </div>
          <dl className="rise mt-10 grid max-w-[600px] grid-cols-1 gap-4 border-t border-line pt-6 sm:grid-cols-3" style={{ animationDelay: '580ms' }}>
            <div>
              <dt className="text-[12.5px] text-muted">Booking guard</dt>
              <dd className="mt-1 font-display text-[19px] font-semibold">0 double-bookings</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-muted">Queue policy</dt>
              <dd className="mt-1 font-display text-[19px] font-semibold">2 booked : 1 walk-in</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-muted">Wait estimate</dt>
              <dd className="mt-1 font-display text-[19px] font-semibold">Learns each doctor</dd>
            </div>
          </dl>
        </div>
        <div className="rise" style={{ animationDelay: '300ms' }}>
          <MiniBoard />
        </div>
        </div>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-8">
          <Reveal>
            <h2 className="text-[30px] font-bold">How a visit flows</h2>
          </Reveal>
          <ol className="relative mt-8 grid gap-6 md:grid-cols-4">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 110} className="relative">
                <span className="token-number text-[44px] text-teal">{String(i + 1).padStart(2, '0')}</span>
                <span className="absolute left-[64px] right-4 top-[26px] hidden h-px bg-gradient-to-r from-teal/40 to-transparent md:block" aria-hidden />
                <h3 className="mt-2 text-[19px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1200px] gap-12 px-4 py-16 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <h2 className="text-[30px] font-bold">One queue, four views</h2>
          <p className="mt-3 max-w-[48ch] text-[15.5px] leading-relaxed text-ink-soft">
            Every screen reads from the same live queue. What each person can see and change is enforced by the server, not just hidden in the interface.
          </p>
          <dl className="mt-8 divide-y divide-line border-y border-line">
            {roles.map((r) => (
              <div key={r.name} className="grid gap-1 py-4 sm:grid-cols-[150px_1fr] sm:gap-6">
                <dt className="font-display text-[17px] font-semibold">{r.name}</dt>
                <dd className="text-[14.5px] text-ink-soft">{r.does}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
        <div className="space-y-4">
          <Reveal><div className="card glow lift p-6" data-spotlight="">
            <Timer className="h-6 w-6 text-teal" aria-hidden />
            <h3 className="mt-3 text-[19px] font-semibold">Waiting times you can trust</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Estimates use the median of each doctor's last 5 to 15 visits, plus the time left on the current visit. Patients see a range, and "unavailable" when the doctor pauses.
            </p>
          </div></Reveal>
          <Reveal><div className="card glow lift p-6" data-spotlight="">
            <Users className="h-6 w-6 text-teal" aria-hidden />
            <h3 className="mt-3 text-[19px] font-semibold">A published, fair order</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Two booked patients, then one walk-in, each group in arrival order. The rule never looks at symptoms — urgent cases stay with clinical staff.
            </p>
          </div></Reveal>
          <Reveal><div className="card glow lift p-6" data-spotlight="">
            <ShieldCheck className="h-6 w-6 text-teal" aria-hidden />
            <h3 className="mt-3 text-[19px] font-semibold">Every change is accountable</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">
              Bookings, check-ins, calls, pauses and overrides are written to an audit log with who, when, before and after, and the reason.
            </p>
          </div></Reveal>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-muted sm:px-8">
          <Logo />
          <p className="max-w-[60ch]">A student engineering prototype with fictional patients and doctors. Not a medical device and not for emergencies.</p>
        </div>
      </footer>
    </div>
  );
}
