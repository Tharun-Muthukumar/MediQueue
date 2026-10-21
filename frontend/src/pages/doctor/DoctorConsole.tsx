import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCheck, CheckCircle2, DoorOpen, Footprints, Gauge, Hourglass, ListOrdered, Pause, PhoneCall, Play, RotateCcw, Stethoscope, Timer, UserRoundX, Users } from 'lucide-react';
import { Avatar, HeroBanner, heroButton, heroPrimary, ProgressRing, SectionTitle, StatCard } from '../../components/kit';
import { useEffect, useState } from 'react';
import { useMe } from '../../app/auth';
import { usePollInterval } from '../../app/live';
import { useToast } from '../../app/toast';
import { PauseBanner } from '../../components/token';
import { Button, Card, ConfirmDialog, cx, EmptyState, ErrorState, errorMessage, LoadingBlock, StatusBadge } from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { elapsed, etaRange, minutes, time } from '../../lib/format';
import type { DoctorQueue, StaffTicket } from '../../lib/types';

function useTick(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function CurrentVisit({ q, onAction, busy }: { q: DoctorQueue; onAction: (a: 'call' | 'start' | 'complete' | 'requeue' | 'skip', t?: StaffTicket) => void; busy: string | null }) {
  const now = useTick();
  const a = q.active;
  const next = q.waiting[0];
  if (!a) {
    return (
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-muted">Room status</p>
          <p className="font-display text-[30px] font-bold leading-tight">Room is free</p>
          {next ? (
            <p className="mt-1 text-[14.5px] text-ink-soft">
              Next by policy: <strong className="font-display text-ink">{next.tokenLabel}</strong>, {next.patient.name} ({next.source === 'WALK_IN' ? 'walk-in' : `appointment ${time(next.scheduledAt)}`})
            </p>
          ) : (
            <p className="mt-1 text-[14.5px] text-ink-soft">Nobody is waiting. New check-ins appear here automatically.</p>
          )}
        </div>
        <Button size="lg" className="h-14 px-7 text-[16px] shadow-[0_10px_30px_-10px_rgb(0_128_132/0.6)]" icon={<PhoneCall className="h-5 w-5" />} disabled={q.paused || !next} loading={busy === 'call'} onClick={() => onAction('call')}>
          Call next patient <kbd aria-hidden className="ml-1 hidden sm:inline">N</kbd>
        </Button>
      </div>
    );
  }
  const inConsult = a.status === 'IN_CONSULTATION';
  const elapsedSec = inConsult && a.startedAt ? (now - new Date(a.startedAt).getTime()) / 1000 : 0;
  const over = inConsult && elapsedSec > q.estimate.expectedSec;
  return (
    <div className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center">
      <div className="token-stub w-full px-6 pb-5 pt-4 md:w-[230px]">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-muted">{inConsult ? 'In the room' : 'Called'}</span>
          <StatusBadge status={a.status} />
        </div>
        <p className="token-number mt-2 text-[56px] text-ink">{a.tokenLabel.split('-')[1]}</p>
        <p className="font-display text-[15px] font-semibold text-teal">{a.tokenLabel}</p>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <Avatar name={a.patient.name} src={a.patient.avatarUrl} size="lg" />
          <p className="font-display text-[28px] font-bold leading-tight">{a.patient.name}</p>
        </div>
        <p className="mt-0.5 text-[14px] text-ink-soft">
          {a.source === 'WALK_IN' ? 'Walk-in' : `Appointment at ${time(a.scheduledAt)}`}, checked in {time(a.checkedInAt)}
          {a.isLate ? ', admitted late' : ''}
        </p>
        {inConsult ? (
          <p className={cx('mt-3 inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] font-semibold', over ? 'bg-amber-bg text-amber-ink' : 'bg-teal-50 text-teal-700')} aria-live="off">
            <Timer className="h-4 w-4" aria-hidden />
            <span className="tabular">{elapsed(a.startedAt, now)}</span>
            <span className="font-normal">of about {Math.round(q.estimate.expectedSec / 60)} min</span>
          </p>
        ) : (
          <p className="mt-3 text-[14px] text-ink-soft">Called at {time(a.calledAt)}. Start the visit when the patient is in the room.</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {inConsult ? (
            <Button size="lg" icon={<CheckCheck className="h-5 w-5" />} loading={busy === 'complete'} onClick={() => onAction('complete', a)}>
              Complete visit <kbd aria-hidden className="ml-1 hidden sm:inline">C</kbd>
            </Button>
          ) : (
            <>
              <Button size="lg" icon={<Play className="h-5 w-5" />} loading={busy === 'start'} onClick={() => onAction('start', a)}>
                Start visit <kbd aria-hidden className="ml-1 hidden sm:inline">S</kbd>
              </Button>
              <Button size="lg" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onAction('requeue', a)}>
                Called by mistake
              </Button>
              <Button size="lg" variant="ghost" icon={<UserRoundX className="h-4 w-4" />} onClick={() => onAction('skip', a)}>
                Patient not here
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DoctorConsole() {
  const { data: me } = useMe();
  const doctorId = me?.doctor?.id;
  const poll = usePollInterval(5000, 30000);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['queue', doctorId], queryFn: () => get<DoctorQueue>(`/queues/${doctorId}`), enabled: !!doctorId, refetchInterval: poll });
  const [pauseOpen, setPauseOpen] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ kind: 'requeue' | 'skip'; t: StaffTicket } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async ({ kind, t, reason }: { kind: string; t?: StaffTicket; reason?: string }) => {
      setBusy(kind);
      if (kind === 'call') return post<{ tokenLabel: string; patientName: string }>(`/queues/${doctorId}/call-next`);
      if (kind === 'start') return post(`/tickets/${t!.id}/start`);
      if (kind === 'complete') return post<{ durationSec: number }>(`/tickets/${t!.id}/complete`);
      if (kind === 'requeue') return post(`/tickets/${t!.id}/requeue`, { reason });
      if (kind === 'skip') return post(`/tickets/${t!.id}/skip`, { reason });
      if (kind === 'pause') return post(`/doctors/${doctorId}/pause`, { reason });
      return post(`/doctors/${doctorId}/resume`);
    },
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['queue'] });
      setReasonFor(null);
      setPauseOpen(false);
      if (v.kind === 'call') {
        const c = r as { tokenLabel: string; patientName: string };
        toast({ tone: 'success', title: `Calling ${c.tokenLabel}`, body: `${c.patientName} has been notified and the board updated.` });
      }
      if (v.kind === 'complete') toast({ tone: 'success', title: 'Visit completed', body: `Duration ${minutes((r as { durationSec: number }).durationSec)}. Waiting estimates updated.` });
      if (v.kind === 'pause') toast({ tone: 'info', title: 'Queue paused', body: 'Waiting patients have been told. Their places are kept.' });
      if (v.kind === 'resume') toast({ tone: 'success', title: 'Queue resumed' });
    },
    onError: (e) => toast({ tone: e instanceof ApiError && e.code === 'NO_PATIENTS_WAITING' ? 'info' : 'error', title: 'Action not completed', body: errorMessage(e) }),
    onSettled: () => setBusy(null),
  });

  const onAction = (a: 'call' | 'start' | 'complete' | 'requeue' | 'skip', t?: StaffTicket) => {
    if (a === 'requeue' || a === 'skip') setReasonFor({ kind: a, t: t! });
    else run.mutate({ kind: a, t });
  };

  const d = q.data;

  // Keyboard shortcuts: N call next · S start · C complete · P pause/resume (ignored while typing or in a dialog)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!d || e.ctrlKey || e.metaKey || e.altKey || busy) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && !d.active && !d.paused && d.waiting.length) run.mutate({ kind: 'call' });
      else if (k === 's' && d.active?.status === 'CALLED') run.mutate({ kind: 'start', t: d.active });
      else if (k === 'c' && d.active?.status === 'IN_CONSULTATION') run.mutate({ kind: 'complete', t: d.active });
      else if (k === 'p') d.paused ? run.mutate({ kind: 'resume' }) : setPauseOpen(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d, busy, run]);

  const nextIsWalkIn = d && d.policy.appointmentStreak >= d.policy.scheduledPerWalkIn;
  return (
    <>
      <HeroBanner
        eyebrow="Doctor console"
        title={me ? me.user.name : 'My queue'}
        avatar={me && <Avatar name={me.user.name} src={me.user.avatarUrl} size="xl" ring status={d?.paused ? 'away' : 'online'} />}
        subtitle={
          me?.doctor ? (
            <>
              <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <Stethoscope className="h-4 w-4" aria-hidden /> {me.doctor.department}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <DoorOpen className="h-4 w-4" aria-hidden /> {me.doctor.room}
                </span>
                {d && (
                  <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold', d.paused ? 'bg-[#fbbf24]/20 text-[#fcd34d]' : 'bg-[#34d399]/15 text-[#6ee7b7]')}>
                    <span className={cx('h-1.5 w-1.5 rounded-full', d.paused ? 'bg-[#fcd34d]' : 'bg-[#34d399]')} aria-hidden />
                    {d.paused ? 'Queue paused' : 'Seeing patients'}
                  </span>
                )}
              </span>
              <span className="mt-2 hidden text-[12.5px] text-white/55 md:block">
                Shortcuts: <kbd>N</kbd> call next, <kbd>S</kbd> start, <kbd>C</kbd> complete, <kbd>P</kbd> pause.
              </span>
            </>
          ) : undefined
        }
        actions={
          d &&
          (d.paused ? (
            <button className={heroPrimary} disabled={busy === 'resume'} onClick={() => run.mutate({ kind: 'resume' })}>
              <Play className="h-4 w-4" aria-hidden /> Resume queue
            </button>
          ) : (
            <button className={heroButton} onClick={() => setPauseOpen(true)}>
              <Pause className="h-4 w-4" aria-hidden /> Pause queue
            </button>
          ))
        }
        aside={d && <ProgressRing value={d.stats.completed} max={d.stats.completed + d.stats.waiting + (d.active ? 1 : 0)} label={`${d.stats.completed} of ${d.stats.completed + d.stats.waiting + (d.active ? 1 : 0)} seen`} sub={d.stats.waiting ? `${d.stats.waiting} still waiting` : 'Queue is clear'} />}
      />
      {!doctorId ? (
        <Card>
          <EmptyState title="No doctor profile linked" body="Ask an administrator to link this account to a doctor profile." />
        </Card>
      ) : q.isLoading ? (
        <Card>
          <LoadingBlock rows={5} />
        </Card>
      ) : q.isError || !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          {d.paused && <PauseBanner reason={d.pauseReason} title="You paused the queue. No one new will be called." />}
          <Card glow>
            <CurrentVisit q={d} onAction={onAction} busy={busy} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start [&>*]:min-w-0">
            <Card>
              <SectionTitle
                icon={ListOrdered}
                title={`Waiting (${d.waiting.length})`}
                description={`Order: ${d.policy.scheduledPerWalkIn} booked, then 1 walk-in. ${nextIsWalkIn ? 'A walk-in is due next if one is waiting.' : `${d.policy.scheduledPerWalkIn - d.policy.appointmentStreak} booked before the next walk-in.`}`}
              />
              {d.waiting.length ? (
                <ol className="divide-y divide-line">
                  {d.waiting.map((w) => (
                    <li key={w.id} className="grid grid-cols-[28px_84px_1fr_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-paper/70">
                      <span className={cx('tabular grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold', w.position === 1 ? 'bg-teal text-white' : 'bg-paper-2 text-ink-2')}>{w.position}</span>
                      <span className="font-display text-[18px] font-semibold">{w.tokenLabel}</span>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={w.patient.name} src={w.patient.avatarUrl} size="sm" />
                        <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-[14.5px] font-semibold">
                          {w.patient.name}
                          {w.source === 'WALK_IN' ? <Footprints className="h-3.5 w-3.5 text-[#6741d9]" aria-label="Walk-in" /> : <CalendarCheck2 className="h-3.5 w-3.5 text-teal" aria-label="Appointment" />}
                        </p>
                        <p className="text-[12.5px] text-muted">
                          {w.source === 'WALK_IN' ? 'Walk-in' : `Appt ${time(w.scheduledAt)}`}, arrived {time(w.checkedInAt)}
                          {w.isLate ? ', late' : ''}
                        </p>
                        </div>
                      </div>
                      <span className="tabular text-right text-[13px] text-ink-soft">{w.eta.status === 'PAUSED' ? 'paused' : etaRange(w.eta.lowSec, w.eta.highSec)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="No one waiting" body={d.notStartedYet ? `Your session starts at ${time(d.opensAt)}.` : 'Reception check-ins will appear here immediately.'} />
              )}
            </Card>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={CheckCircle2} tone="green" label="Seen today" value={d.stats.completed} />
                <StatCard icon={Users} tone="amber" label="Still waiting" value={d.stats.waiting} />
                <StatCard icon={Timer} tone="blue" label="Average visit" value={d.stats.avgConsultSec ? Math.round(d.stats.avgConsultSec / 60) : null} suffix="min" />
                <StatCard icon={Hourglass} tone="violet" label="Average wait" value={d.stats.avgWaitSec ? Math.round(d.stats.avgWaitSec / 60) : null} suffix="min" />
              </div>
              <Card>
                <SectionTitle icon={Gauge} tone="violet" title="Waiting-time basis" />
                <p className="px-5 py-4 text-[14px] text-ink-soft">
                  {d.estimate.basis === 'ROLLING_MEDIAN'
                    ? `Median of your last ${d.estimate.samples} visits: ${Math.round(d.estimate.expectedSec / 60)} min each. Patients see this as a range.`
                    : `Using your default of ${d.doctor.avgMinutes} min until at least 5 visits are recorded.`}
                </p>
              </Card>
              <Card>
                <SectionTitle icon={CheckCheck} tone="green" title="Finished and other tokens" />
                {d.others.length ? (
                  <ul className="max-h-[300px] divide-y divide-line overflow-y-auto">
                    {d.others
                      .slice()
                      .reverse()
                      .map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                          <span className="font-display font-semibold">{t.tokenLabel}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-soft">{t.patient.name}</span>
                          {t.status === 'COMPLETED' && t.startedAt && t.completedAt ? (
                            <span className="tabular text-[13px] text-muted">{minutes((+new Date(t.completedAt) - +new Date(t.startedAt)) / 1000)}</span>
                          ) : (
                            <StatusBadge status={t.status} />
                          )}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="px-5 py-4 text-[14px] text-muted">Nothing yet today.</p>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        onConfirm={(reason) => run.mutate({ kind: 'pause', reason })}
        loading={busy === 'pause'}
        title="Pause your queue?"
        description="No one new will be called. Waiting patients keep their place and see that waiting time is unavailable."
        reasonLabel="Reason shown to patients"
        reasonPlaceholder="e.g. Short break, back in 15 minutes"
        confirmLabel="Pause queue"
      />
      <ConfirmDialog
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        onConfirm={(reason) => reasonFor && run.mutate({ kind: reasonFor.kind, t: reasonFor.t, reason })}
        loading={busy === 'requeue' || busy === 'skip'}
        tone={reasonFor?.kind === 'skip' ? 'danger' : 'primary'}
        title={reasonFor?.kind === 'skip' ? `Mark ${reasonFor.t.tokenLabel} as not here?` : `Return ${reasonFor?.t.tokenLabel ?? ''} to the waiting list?`}
        description={reasonFor?.kind === 'skip' ? 'The patient keeps their token and is asked to see reception, who can put them back in the queue.' : 'Use this if you called the wrong patient. They go back to waiting in their normal place.'}
        reasonLabel="Reason"
        confirmLabel={reasonFor?.kind === 'skip' ? 'Mark not here' : 'Return to waiting'}
      />
    </>
  );
}
