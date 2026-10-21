import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CalendarDays, CalendarPlus, CalendarRange, ChevronRight, DoorOpen, Inbox, MapPin, Monitor, Ticket, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMe } from '../../app/auth';
import { EtaBlock, PauseBanner, TokenStub } from '../../components/token';
import { Card, EmptyState, ErrorState, LoadingBlock, StatusBadge, ButtonLink } from '../../components/ui';
import { Avatar, DateTile, greetingFor, HeroBanner, heroButton, heroPrimary, IconTile, SectionTitle, type Tone } from '../../components/kit';
import { notifyKind } from '../../components/notifyKinds';
import { get } from '../../lib/api';
import { dateLong, displayTz, relative, time } from '../../lib/format';
import type { MyTicket, Notification } from '../../lib/types';
import { CancelAppointmentButton } from './MyAppointments';
import { splitAppointments, useMyAppointments, useMyQueue } from './hooks';
import { EnableAlertsButton } from './CallAlerts';

const QUICK: { to: string; label: string; body: string; icon: LucideIcon; tone: Tone; external?: boolean }[] = [
  { to: '/patient/book', label: 'Book a visit', body: 'Pick a doctor and a free time', icon: CalendarPlus, tone: 'teal' },
  { to: '/patient/appointments', label: 'My appointments', body: 'Upcoming, past and cancelled', icon: CalendarDays, tone: 'blue' },
  { to: '/patient/queue', label: 'Live token', body: 'Your place in today\'s queue', icon: Ticket, tone: 'violet' },
  { to: '/board', label: 'Waiting-room board', body: 'The screen in the waiting area', icon: Monitor, tone: 'amber', external: true },
];

export function TicketPanel({ t }: { t: MyTicket }) {
  if (t.status === 'CALLED' || t.status === 'IN_CONSULTATION') {
    return (
      <div className="called-flash attention rounded-2xl border-2 border-teal bg-teal-50 p-5" role="alert">
        <div className="flex items-start gap-3">
          <DoorOpen className="mt-1 h-7 w-7 text-teal" aria-hidden />
          <div>
            <p className="font-display text-[26px] font-bold leading-tight text-ink">{t.status === 'CALLED' ? "It's your turn" : "You're with the doctor"}</p>
            <p className="mt-1 text-[15px] text-ink-2">
              {t.status === 'CALLED' ? `Please go to ${t.doctor.room} now to see ${t.doctor.name}.` : `${t.doctor.name}, ${t.doctor.room}.`}
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (t.status === 'SKIPPED') {
    return (
      <div className="rounded-2xl border border-line bg-slate-bg p-5">
        <p className="font-display text-[20px] font-bold">You were marked absent</p>
        <p className="mt-1 text-[14.5px] text-ink-soft">We couldn't find you when your token was called. Please speak to reception — your token can be put back in the queue.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {t.paused && <PauseBanner reason={t.pauseReason} who={t.doctor.name} />}
      <EtaBlock eta={t.eta} ahead={t.ahead} notStartedYet={t.notStartedYet} opensAt={t.opensAt} basis={t.estimateBasis} />
    </div>
  );
}

export default function PatientHome() {
  const { data: me } = useMe();
  const queue = useMyQueue();
  const appts = useMyAppointments();
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ unread: number; items: Notification[] }>('/notifications') });
  const { upcoming } = splitAppointments(appts.data);
  const nextBooked = upcoming.find((a) => a.status === 'BOOKED');
  const ticket = queue.data?.tickets[0];
  const firstName = me?.user.name.split(' ')[0];

  const summary = ticket
    ? ticket.status === 'CALLED'
      ? `It's your turn: please go to ${ticket.doctor.room}.`
      : `You're checked in with ${ticket.doctor.name}. ${ticket.ahead === 0 ? "You're next in line." : `${ticket.ahead} ${ticket.ahead === 1 ? 'person' : 'people'} ahead of you.`}`
    : nextBooked
      ? `Your next visit is with ${nextBooked.doctor.name} on ${dateLong(nextBooked.slot.startAt)} at ${time(nextBooked.slot.startAt)}.`
      : 'Book a visit, then check in at reception on the day to get your token.';

  return (
    <>
      <HeroBanner
        eyebrow={dateLong(new Date())}
        title={`${greetingFor(displayTz())}, ${firstName}`}
        subtitle={summary}
        avatar={me && <Avatar name={me.user.name} src={me.user.avatarUrl} size="xl" ring />}
        actions={
          <>
            <Link to="/patient/book" className={heroPrimary}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Book a visit
            </Link>
            {ticket && (
              <Link to="/patient/queue" className={heroButton}>
                <Ticket className="h-4 w-4" aria-hidden /> Live token
              </Link>
            )}
          </>
        }
        aside={
          ticket && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.08] px-5 py-4 text-center backdrop-blur">
              <p className="text-[12px] text-white/60">Your token</p>
              <p className="token-number text-[44px] text-[#5eead4]">{ticket.tokenLabel}</p>
              <p className="text-[12.5px] text-white/70">{ticket.status === 'WAITING' && ticket.position ? `Position ${ticket.position} of ${ticket.waitingTotal}` : ticket.status === 'CALLED' ? 'Called now' : 'In progress'}</p>
            </div>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {QUICK.map((q) => {
          const inner = (
            <>
              <IconTile icon={q.icon} tone={q.tone} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug text-ink">{q.label}</p>
                <p className="mt-0.5 hidden text-[12.5px] text-muted sm:block">{q.body}</p>
              </div>
              {q.external ? (
                <ArrowUpRight className="absolute right-3 top-3 h-4 w-4 text-muted sm:static" aria-hidden />
              ) : (
                <ChevronRight className="hidden h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
              )}
            </>
          );
          const cls = 'group card glow lift relative flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center';
          return q.external ? (
            <a key={q.to} href={q.to} target="_blank" rel="noreferrer" className={cls} data-spotlight="">
              {inner}
            </a>
          ) : (
            <Link key={q.to} to={q.to} className={cls} data-spotlight="">
              {inner}
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          {queue.isLoading ? (
            <Card>
              <LoadingBlock rows={3} />
            </Card>
          ) : queue.isError ? (
            <Card>
              <ErrorState error={queue.error} onRetry={() => queue.refetch()} />
            </Card>
          ) : ticket ? (
            <Card glow>
              <SectionTitle icon={Ticket} tone="violet" title="Today's visit" description={`${ticket.doctor.department}, ${ticket.doctor.room}`} action={<Link to="/patient/queue" className="text-[13px] font-semibold text-teal hover:underline">Open full token view</Link>} />
              <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,230px)_1fr] sm:p-6">
                <TokenStub
                  className="self-start"
                  token={ticket.tokenLabel}
                  status={ticket.status}
                  highlight={ticket.status === 'CALLED'}
                  caption={
                    <span className="flex items-center gap-2.5">
                      <Avatar name={ticket.doctor.name} src={ticket.doctor.avatarUrl} size="sm" />
                      <span>
                        {ticket.doctor.name}
                        <br />
                        {ticket.doctor.room}
                      </span>
                    </span>
                  }
                />
                <div className="flex flex-col justify-between gap-5">
                  <TicketPanel t={ticket} />
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-[13.5px] text-ink-soft">
                    <span>
                      Now serving <strong className="font-display text-[15px] text-ink">{ticket.nowServing?.tokenLabel ?? '—'}</strong>
                    </span>
                    <span>{ticket.waitingTotal} waiting</span>
                    <EnableAlertsButton />
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<MapPin className="h-5 w-5" />}
                title="No token yet today"
                body="Your token appears here as soon as reception checks you in. Bring your booking confirmation or tell them your name."
              />
            </Card>
          )}

          <Card>
            <SectionTitle icon={CalendarRange} tone="blue" title="Next appointment" action={<Link to="/patient/appointments" className="text-[13px] font-semibold text-teal hover:underline">All appointments</Link>} />
            {appts.isLoading ? (
              <LoadingBlock rows={1} />
            ) : nextBooked ? (
              <div className="flex items-start gap-4 p-5">
                <DateTile date={nextBooked.slot.startAt} tz={displayTz()} />
                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="tabular whitespace-nowrap font-display text-[20px] font-bold text-ink">
                      {time(nextBooked.slot.startAt)} – {time(nextBooked.slot.endAt)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <Avatar name={nextBooked.doctor.name} src={nextBooked.doctor.avatarUrl} size="sm" />
                      <p className="text-[14px] text-ink-soft">
                        <span className="font-semibold text-ink">{nextBooked.doctor.name}</span>, {nextBooked.doctor.department}, {nextBooked.doctor.room}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={nextBooked.status} />
                    <CancelAppointmentButton appointment={nextBooked} />
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title="Nothing booked" body="Choose a doctor and a time that suits you." action={<ButtonLink to="/patient/book" variant="secondary">Find a slot</ButtonLink>} />
            )}
          </Card>

        </div>

        <Card className="self-start">
          <SectionTitle icon={Inbox} tone="teal" title="Updates" description="Confirmations, check-ins and calls from the clinic." />
          {notes.isLoading ? (
            <LoadingBlock rows={4} />
          ) : notes.data?.items.length ? (
            <ul className="divide-y divide-line">
              {notes.data.items.slice(0, 7).map((n) => {
                const k = notifyKind(n.kind);
                return (
                  <li key={n.id} className="flex gap-3 px-5 py-3.5">
                    <IconTile icon={k.icon} tone={k.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[14px] font-semibold">
                        {n.title}
                        {!n.readAt && <span className="h-2 w-2 rounded-full bg-teal" aria-label="Unread" />}
                      </p>
                      <p className="text-[13px] text-ink-soft">{n.message}</p>
                      <p className="mt-0.5 text-[12px] text-muted">{relative(n.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="No updates yet" body="We'll post booking confirmations and queue calls here." />
          )}
        </Card>
      </div>
    </>
  );
}
