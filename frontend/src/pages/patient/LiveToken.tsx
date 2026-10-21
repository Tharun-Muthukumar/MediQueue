import { CheckCircle2, Circle, Info, ListOrdered, RefreshCw, Route, Ticket } from 'lucide-react';
import { TokenStub } from '../../components/token';
import { Card, cx, EmptyState, ErrorState, LoadingBlock, ButtonLink } from '../../components/ui';
import { Avatar, HeroBanner, heroButton, SectionTitle } from '../../components/kit';
import { time } from '../../lib/format';
import type { MyTicket } from '../../lib/types';
import { useMyQueue } from './hooks';
import { EnableAlertsButton } from './CallAlerts';
import { TicketPanel } from './PatientHome';

function Timeline({ t }: { t: MyTicket }) {
  const steps = [
    { label: 'Checked in', at: t.checkedInAt, done: true },
    { label: 'Called', at: t.calledAt, done: ['CALLED', 'IN_CONSULTATION'].includes(t.status) },
    { label: 'With the doctor', at: t.startedAt, done: t.status === 'IN_CONSULTATION' },
  ];
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => (
        <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && <span className={cx('absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5', s.done && steps[i + 1].done ? 'bg-teal' : 'bg-line')} aria-hidden />}
          {s.done ? <CheckCircle2 className="h-6 w-6 shrink-0 text-teal" aria-hidden /> : <Circle className="h-6 w-6 shrink-0 text-line-strong" aria-hidden />}
          <div>
            <p className={cx('text-[15px] font-semibold', !s.done && 'text-muted')}>{s.label}</p>
            <p className="text-[13px] text-muted">{s.done && s.at ? time(s.at) : 'Not yet'}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function LiveToken() {
  const q = useMyQueue();
  const tickets = q.data?.tickets ?? [];
  return (
    <>
      <HeroBanner
        eyebrow="Live token"
        title={tickets[0] ? (tickets[0].status === 'CALLED' ? "It's your turn" : tickets[0].status === 'IN_CONSULTATION' ? 'With the doctor' : 'Waiting your turn') : 'Live token'}
        subtitle="Your place in today's queue. It refreshes on its own; keep this page open while you wait."
        avatar={<span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-[#5eead4] ring-1 ring-white/15"><Ticket className="h-8 w-8" aria-hidden /></span>}
        actions={
          <button type="button" className={heroButton} onClick={() => q.refetch()}>
            <RefreshCw className={cx('h-4 w-4', q.isFetching && 'animate-spin')} aria-hidden /> Refresh
          </button>
        }
      />
      {q.isLoading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : !tickets.length ? (
        <Card>
          <EmptyState
            title="You're not in a queue today"
            body="Tokens are issued when reception checks you in on the day of your visit."
            action={
              <ButtonLink to="/patient/appointments" variant="secondary">See my appointments</ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {tickets.map((t) => (
            <div key={t.ticketId} className="grid gap-6 lg:grid-cols-[320px_1fr]">
              <TokenStub
                className="self-start"
                token={t.tokenLabel}
                status={t.status}
                size="xl"
                highlight={t.status === 'CALLED'}
                caption={
                  <span className="flex items-center gap-3">
                    <Avatar name={t.doctor.name} src={t.doctor.avatarUrl} size="md" />
                    <span>
                      {t.doctor.name}, {t.doctor.department}
                      <br />
                      {t.doctor.room}
                    </span>
                  </span>
                }
              />
              <div className="space-y-6">
                <Card glow className="p-6">
                  <TicketPanel t={t} />
                  <div className="mt-4 border-t border-line pt-3">
                    <EnableAlertsButton />
                  </div>
                </Card>
                <div className="grid gap-6 md:grid-cols-2">
                  <Card>
                    <SectionTitle icon={Route} tone="teal" title="Progress" />
                    <div className="p-5">
                      <Timeline t={t} />
                    </div>
                  </Card>
                  <Card>
                    <SectionTitle icon={ListOrdered} tone="violet" title="The queue right now" />
                    <dl className="divide-y divide-line text-[14px]">
                      <div className="flex justify-between px-5 py-3">
                        <dt className="text-ink-soft">Now serving</dt>
                        <dd className="font-display text-[16px] font-semibold">{t.nowServing?.tokenLabel ?? 'No one yet'}</dd>
                      </div>
                      <div className="flex justify-between px-5 py-3">
                        <dt className="text-ink-soft">Your position</dt>
                        <dd className="tabular font-semibold">{t.position ? `${t.position} of ${t.waitingTotal}` : '—'}</dd>
                      </div>
                      <div className="flex justify-between px-5 py-3">
                        <dt className="text-ink-soft">Typical visit with this doctor</dt>
                        <dd className="tabular font-semibold">{t.expectedConsultMin} min</dd>
                      </div>
                      <div className="flex justify-between px-5 py-3">
                        <dt className="text-ink-soft">You arrived as</dt>
                        <dd className="font-semibold">{t.source === 'WALK_IN' ? 'Walk-in' : `Appointment, ${time(t.scheduledAt)}`}</dd>
                      </div>
                    </dl>
                    <p className="flex gap-2.5 border-t border-line px-5 py-3 text-[12.5px] text-muted">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />
                      <span>The clinic calls two booked patients, then one walk-in, each group in order of time. Medical urgency is decided by staff, never by this app.</span>
                    </p>
                  </Card>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
