import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CalendarPlus, CalendarRange, CalendarX2, CheckCircle2, History, Ticket } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../../app/toast';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingBlock, StatusBadge, Tabs, errorMessage, ButtonLink } from '../../components/ui';
import { patch } from '../../lib/api';
import { dateLong, displayTz, time } from '../../lib/format';
import { Avatar, DateTile, HeroBanner, heroPrimary, StatCard } from '../../components/kit';
import { Link } from 'react-router-dom';
import type { AppointmentView } from '../../lib/types';
import { splitAppointments, useMyAppointments } from './hooks';

export function CancelAppointmentButton({ appointment }: { appointment: AppointmentView }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: () => patch(`/appointments/${appointment.id}/cancel`, {}),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      toast({ tone: 'success', title: 'Appointment cancelled', body: 'The time is free again for someone else.' });
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't cancel", body: errorMessage(e) }),
  });
  const canCancel = appointment.status === 'BOOKED' && new Date(appointment.slot.startAt).getTime() > Date.now();
  if (!canCancel) return null;
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => cancel.mutate()}
        loading={cancel.isPending}
        tone="danger"
        title="Cancel this appointment?"
        description={`${appointment.doctor.name} on ${dateLong(appointment.slot.startAt)} at ${time(appointment.slot.startAt)}. You can book another time afterwards.`}
        confirmLabel="Cancel appointment"
      />
    </>
  );
}

function Row({ a }: { a: AppointmentView }) {
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-paper/60">
      <DateTile date={a.slot.startAt} tz={displayTz()} tone={a.status === 'BOOKED' ? 'teal' : 'slate'} />
      <Avatar name={a.doctor.name} src={a.doctor.avatarUrl} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{a.doctor.name}</p>
        <p className="text-[13.5px] text-ink-soft">
          <span className="tabular font-semibold text-teal">{time(a.slot.startAt)}</span>, {a.doctor.department}, {a.doctor.room}
        </p>
        {a.ticket && (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-[12px] font-semibold text-teal">
            <Ticket className="h-3.5 w-3.5" aria-hidden /> Token {a.ticket.tokenLabel}
          </p>
        )}
        {a.cancelReason && a.status === 'CANCELLED' && <p className="mt-0.5 text-[12.5px] text-muted">Reason: {a.cancelReason}</p>}
      </div>
      <div className="flex items-center gap-2">
        <StatusBadge status={a.status} />
        <CancelAppointmentButton appointment={a} />
      </div>
    </li>
  );
}

export default function MyAppointments() {
  const q = useMyAppointments();
  const [tab, setTab] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const groups = splitAppointments(q.data);
  const list = groups[tab];
  return (
    <>
      <HeroBanner
        eyebrow="Your visits"
        title="My appointments"
        subtitle="Upcoming bookings can be cancelled here until they start."
        avatar={<span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-[#5eead4] ring-1 ring-white/15"><CalendarRange className="h-8 w-8" aria-hidden /></span>}
        actions={
          <Link to="/patient/book" className={heroPrimary}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Book a visit
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard icon={CalendarCheck2} tone="blue" label="Upcoming" value={q.data ? groups.upcoming.length : null} />
        <StatCard icon={CheckCircle2} tone="green" label="Completed" value={q.data ? groups.past.filter((a) => a.status === 'COMPLETED').length : null} />
        <StatCard icon={CalendarX2} tone="slate" label="Cancelled" value={q.data ? groups.cancelled.length : null} />
      </div>
      <div className="mb-4">
        <Tabs
          label="Appointment groups"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
            { value: 'past', label: 'Past', count: groups.past.length },
            { value: 'cancelled', label: 'Cancelled', count: groups.cancelled.length },
          ]}
        />
      </div>
      <Card>
        {q.isLoading ? (
          <LoadingBlock rows={4} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : list.length ? (
          <ul className="divide-y divide-line">
            {list.map((a) => (
              <Row key={a.id} a={a} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={tab === 'past' ? <History className="h-5 w-5" /> : <CalendarRange className="h-5 w-5" />}
            title={tab === 'upcoming' ? 'No upcoming visits' : tab === 'past' ? 'No past visits yet' : 'Nothing cancelled'}
            body={tab === 'upcoming' ? 'Book a time with any of our doctors.' : undefined}
            action={
              tab === 'upcoming' ? (
                <ButtonLink to="/patient/book" variant="secondary">Find a slot</ButtonLink>
              ) : undefined
            }
          />
        )}
      </Card>
    </>
  );
}
