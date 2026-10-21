import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Footprints, Hourglass, Monitor, PhoneCall, Printer, Search, Ticket, UserCheck, UserPlus, UserRoundX } from 'lucide-react';
import { useMe } from '../../app/auth';
import { Avatar, AvatarStack, HeroBanner, heroButton, heroPrimary, StatCard } from '../../components/kit';
import { useMemo, useState } from 'react';
import { usePollInterval } from '../../app/live';
import { useToast } from '../../app/toast';
import { PauseBanner, TokenStub } from '../../components/token';
import {
  Button,
  Card,
  ConfirmDialog,
  cx,
  EmptyState,
  ErrorState,
  errorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  StatusBadge,
  Tabs,
} from '../../components/ui';
import { ApiError, get, patch, post } from '../../lib/api';
import { dateLong, dayDate, etaRange, minutes, time } from '../../lib/format';
import type { Eta, ReceptionQueue, ReceptionRow, ReceptionToday } from '../../lib/types';

interface IssuedToken {
  tokenLabel: string;
  patientName: string;
  doctorName: string;
  room: string;
  position: number | null;
  eta: Eta | null;
}

function IssuedTokenModal({ issued, onClose }: { issued: IssuedToken | null; onClose: () => void }) {
  return (
    <Modal
      open={!!issued}
      onClose={onClose}
      title="Token issued"
      description="Tell the patient their token number. Their phone and the waiting-room board update automatically."
      size="sm"
      footer={
        <>
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print slip
          </Button>
          <Button data-autofocus onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {issued && (
        <TokenStub
          token={issued.tokenLabel}
          status="WAITING"
          caption={
            <span>
              <strong className="text-ink">{issued.patientName}</strong> for {issued.doctorName}, {issued.room}.
              <br />
              {issued.eta?.status === 'PAUSED'
                ? 'Doctor has paused the queue; wait time unavailable.'
                : issued.position
                  ? `Position ${issued.position}. Estimated wait ${etaRange(issued.eta?.lowSec ?? null, issued.eta?.highSec ?? null)}.`
                  : ''}
            </span>
          }
        />
      )}
    </Modal>
  );
}

function WalkInModal({ open, onClose, doctors, onIssued }: { open: boolean; onClose: () => void; doctors: ReceptionQueue[]; onIssued: (t: IssuedToken) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [doctorId, setDoctorId] = useState('');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [patientId, setPatientId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const search = useQuery({
    queryKey: ['patientSearch', q],
    queryFn: () => get<{ id: string; name: string; phone: string | null; email: string | null }[]>(`/reception/patients?q=${encodeURIComponent(q)}`),
    enabled: open && mode === 'existing',
  });
  const reset = () => {
    setDoctorId('');
    setMode('existing');
    setQ('');
    setPatientId(null);
    setName('');
    setPhone('');
    setTouched(false);
  };
  const m = useMutation({
    mutationFn: () =>
      post<{ ticket: { tokenLabel: string }; patient: { name: string }; position: number | null; eta: Eta | null }>(
        '/walkins',
        mode === 'existing' ? { doctorId, patientId } : { doctorId, newPatient: { name: name.trim(), phone: phone.trim() || undefined } },
      ),
    onSuccess: (r) => {
      const d = doctors.find((x) => x.id === doctorId)!;
      qc.invalidateQueries({ queryKey: ['reception'] });
      onIssued({ tokenLabel: r.ticket.tokenLabel, patientName: r.patient.name, doctorName: d.name, room: d.room, position: r.position, eta: r.eta });
      reset();
      onClose();
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't register walk-in", body: errorMessage(e) }),
  });
  const invalid = !doctorId || (mode === 'existing' ? !patientId : name.trim().length < 2);
  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Register a walk-in"
      description="Walk-ins join the doctor's queue directly. They are called after every two booked patients."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={m.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) m.mutate();
            }}
            icon={<UserPlus className="h-4 w-4" />}
          >
            Issue token
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Doctor" htmlFor="wi-doctor" error={touched && !doctorId ? 'Choose a doctor' : undefined}>
          <Select id="wi-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} invalid={touched && !doctorId} data-autofocus>
            <option value="">Select a doctor…</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}, {d.department} ({d.waiting.length} waiting{d.paused ? ', paused' : ''})
              </option>
            ))}
          </Select>
        </Field>
        <Tabs
          label="Patient type"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setPatientId(null);
          }}
          options={[
            { value: 'existing', label: 'Existing patient' },
            { value: 'new', label: 'New walk-in profile' },
          ]}
        />
        {mode === 'existing' ? (
          <div className="space-y-2">
            <Field label="Find patient" htmlFor="wi-search" error={touched && !patientId ? 'Select a patient from the list' : undefined}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input id="wi-search" className="pl-9" placeholder="Name or phone number" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </Field>
            <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Matching patients">
              {search.data?.length ? (
                search.data.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={patientId === p.id}
                      onClick={() => setPatientId(p.id)}
                      className={cx('flex w-full items-center justify-between px-3 py-2 text-left text-[14px]', patientId === p.id ? 'bg-teal-50' : 'hover:bg-paper')}
                    >
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-[12.5px] text-muted">{p.phone ?? p.email ?? 'walk-in profile'}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-4 text-center text-[13.5px] text-muted">{search.isLoading ? 'Searching…' : 'No matching patients. Create a new walk-in profile instead.'}</li>
              )}
            </ul>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="wi-name" error={touched && name.trim().length < 2 ? 'Enter the patient name' : undefined}>
              <Input id="wi-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} invalid={touched && name.trim().length < 2} />
            </Field>
            <Field label="Phone (optional)" htmlFor="wi-phone">
              <Input id="wi-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <p className="text-[12.5px] text-muted sm:col-span-2">Use fictional details only. No symptoms or medical notes are recorded.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ArrivalsTable({ data, onIssued }: { data: ReceptionToday; onIssued: (t: IssuedToken) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [doctor, setDoctor] = useState('');
  const [status, setStatus] = useState('ACTION');
  const [lateFor, setLateFor] = useState<ReceptionRow | null>(null);
  const [noShowFor, setNoShowFor] = useState<ReceptionRow | null>(null);
  const [cancelFor, setCancelFor] = useState<ReceptionRow | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['reception'] });
  const checkIn = useMutation({
    mutationFn: ({ row, reason }: { row: ReceptionRow; reason?: string }) =>
      post<{ alreadyCheckedIn: boolean; ticket: { tokenLabel: string }; position: number | null; eta: Eta | null }>(`/appointments/${row.id}/check-in`, reason ? { overrideReason: reason } : {}),
    onSuccess: (r, { row }) => {
      setLateFor(null);
      refresh();
      onIssued({ tokenLabel: r.ticket.tokenLabel, patientName: row.patient.name, doctorName: row.doctor.name, room: row.doctor.room, position: r.position, eta: r.eta });
    },
    onError: (e, { row }) => {
      if (e instanceof ApiError && e.code === 'LATE_ARRIVAL_REASON_REQUIRED') setLateFor(row);
      else toast({ tone: 'error', title: "Couldn't check in", body: errorMessage(e) });
    },
  });
  const noShow = useMutation({
    mutationFn: ({ row, reason }: { row: ReceptionRow; reason?: string }) => post(`/appointments/${row.id}/no-show`, reason ? { reason } : {}),
    onSuccess: (_r, { row }) => {
      setNoShowFor(null);
      refresh();
      toast({ tone: 'success', title: 'Marked as no-show', body: `${row.patient.name} has been notified.` });
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't mark no-show", body: errorMessage(e) }),
  });
  const cancel = useMutation({
    mutationFn: ({ row, reason }: { row: ReceptionRow; reason?: string }) => patch(`/appointments/${row.id}/cancel`, { reason }),
    onSuccess: (_r, { row }) => {
      setCancelFor(null);
      refresh();
      toast({ tone: 'success', title: 'Appointment cancelled', body: `${row.patient.name} has been notified.` });
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't cancel", body: errorMessage(e) }),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return data.appointments.filter((a) => {
      if (doctor && a.doctor.id !== doctor) return false;
      if (status === 'ACTION' && a.status !== 'BOOKED') return false;
      if (status !== 'ACTION' && status !== 'ALL' && a.status !== status) return false;
      if (s && !`${a.patient.name} ${a.patient.phone ?? ''} ${a.ticket?.tokenLabel ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data.appointments, search, doctor, status]);

  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_200px_200px]">
        <div className="relative">
          <label htmlFor="arr-search" className="sr-only">
            Search arrivals
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input id="arr-search" className="pl-9" placeholder="Search name, phone or token" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Filter by doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
          <option value="">All doctors</option>
          {data.queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTION">Not yet arrived</option>
          <option value="ALL">All appointments</option>
          <option value="CHECKED_IN">Checked in</option>
          <option value="COMPLETED">Completed</option>
          <option value="NO_SHOW">No-show</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[14px] [&_td]:whitespace-nowrap">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-muted">
                <th className="px-4 py-2.5 font-semibold">Time</th>
                <th className="px-4 py-2.5 font-semibold">Patient</th>
                <th className="px-4 py-2.5 font-semibold">Doctor</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-paper/70">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={cx('tabular inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold', a.flags.late ? 'bg-amber-bg text-amber-ink' : 'bg-paper-2 text-ink')}>
                      <Clock3 className="h-3.5 w-3.5" aria-hidden />
                      {time(a.slot.startAt)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={a.patient.name} src={a.patient.avatarUrl} size="md" />
                      <div className="min-w-0">
                        <p className="font-semibold">{a.patient.name}</p>
                        <p className="text-[12.5px] text-muted">{a.patient.phone ?? 'No phone on file'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={a.doctor.name} src={a.doctor.avatarUrl} size="sm" />
                      <div>
                        <p className="text-[13.5px]">{a.doctor.name}</p>
                        <p className="text-[12px] text-muted">{a.doctor.room}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={a.status} />
                      {a.ticket && <span className="font-display text-[14px] font-semibold">{a.ticket.tokenLabel}</span>}
                      {a.flags.late && (
                        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-ink">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          {a.flags.minutesLate} min late
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {a.flags.canCheckIn && (
                        <Button size="sm" loading={checkIn.isPending && checkIn.variables?.row.id === a.id} onClick={() => (a.flags.late ? setLateFor(a) : checkIn.mutate({ row: a }))}>
                          Check in
                        </Button>
                      )}
                      {a.status === 'BOOKED' && (
                        <Button size="sm" variant="secondary" icon={<UserRoundX className="h-3.5 w-3.5" />} onClick={() => setNoShowFor(a)}>
                          No-show
                        </Button>
                      )}
                      {(a.status === 'BOOKED' || (a.status === 'CHECKED_IN' && a.ticket?.status !== 'IN_CONSULTATION')) && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelFor(a)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={status === 'ACTION' ? 'Everyone booked for today has been handled' : 'No appointments match'} body="Change the filters to see other appointments." />
      )}

      <ConfirmDialog
        open={!!lateFor}
        onClose={() => setLateFor(null)}
        onConfirm={(reason) => lateFor && checkIn.mutate({ row: lateFor, reason })}
        loading={checkIn.isPending}
        title={`Admit late arrival${lateFor ? `: ${lateFor.patient.name}` : ''}`}
        description={lateFor ? `Booked for ${time(lateFor.slot.startAt)}, now ${lateFor.flags.minutesLate} minutes late. Clinic policy asks for a reason after ${data.policy.lateAfterMinutes} minutes.` : undefined}
        reasonLabel="Reason for admitting"
        reasonPlaceholder="e.g. Called ahead about traffic"
        confirmLabel="Check in"
      />
      <ConfirmDialog
        open={!!noShowFor}
        onClose={() => setNoShowFor(null)}
        onConfirm={(reason) => noShowFor && noShow.mutate({ row: noShowFor, reason })}
        loading={noShow.isPending}
        tone="danger"
        title={`Mark ${noShowFor?.patient.name ?? 'patient'} as no-show?`}
        description={
          noShowFor?.flags.noShowEligible
            ? `The ${data.policy.graceMinutes}-minute grace period has passed. A reason is optional.`
            : `The ${data.policy.graceMinutes}-minute grace period has not ended yet. To override it, give a reason.`
        }
        reasonLabel={noShowFor?.flags.noShowEligible ? 'Note (optional)' : 'Reason for override'}
        reasonRequired={!noShowFor?.flags.noShowEligible}
        confirmLabel="Mark no-show"
      />
      <ConfirmDialog
        open={!!cancelFor}
        onClose={() => setCancelFor(null)}
        onConfirm={(reason) => cancelFor && cancel.mutate({ row: cancelFor, reason })}
        loading={cancel.isPending}
        tone="danger"
        title={`Cancel ${cancelFor?.patient.name ?? ''}'s appointment?`}
        description="The patient is notified with your reason. A booked slot becomes free again."
        reasonLabel="Reason"
        reasonPlaceholder="e.g. Patient asked to reschedule by phone"
        confirmLabel="Cancel appointment"
      />
    </Card>
  );
}

function QueueColumns({ data }: { data: ReceptionToday }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [skipFor, setSkipFor] = useState<{ id: string; tokenLabel: string } | null>(null);
  const [requeueFor, setRequeueFor] = useState<{ id: string; tokenLabel: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['reception'] });
  const call = useMutation({
    mutationFn: (doctorId: string) => post<{ tokenLabel: string; patientName: string }>(`/queues/${doctorId}/call-next`),
    onSuccess: (r) => {
      refresh();
      toast({ tone: 'success', title: `Called ${r.tokenLabel}`, body: `${r.patientName} has been notified.` });
    },
    onError: (e) => toast({ tone: e instanceof ApiError && e.code === 'NO_PATIENTS_WAITING' ? 'info' : 'error', title: 'Nobody called', body: errorMessage(e) }),
  });
  const skip = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/tickets/${id}/skip`, { reason }),
    onSuccess: () => {
      setSkipFor(null);
      refresh();
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't mark absent", body: errorMessage(e) }),
  });
  const requeue = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/tickets/${id}/requeue`, { reason }),
    onSuccess: () => {
      setRequeueFor(null);
      refresh();
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't return to queue", body: errorMessage(e) }),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {data.queues.map((q) => (
        <Card key={q.id} glow className="flex flex-col">
          <div className="border-b border-line px-4 py-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <Avatar name={q.name} src={q.avatarUrl} size="md" status={q.paused ? 'away' : q.active ? 'busy' : 'online'} />
                <div>
                <h3 className="text-[16.5px] font-semibold">{q.name}</h3>
                <p className="text-[13px] text-muted">
                  {q.department}, {q.room}
                </p>
                </div>
              </div>
              <span className="tabular rounded-full bg-green-bg px-2 py-0.5 text-[12px] font-semibold text-green-ink">{q.completed} seen</span>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {q.paused && <PauseBanner reason={q.pauseReason} who={q.name} />}
            <div className="flex items-center justify-between rounded-xl bg-ink px-4 py-3 text-white">
              <div>
                <p className="text-[12px] text-white/60">Now serving</p>
                <p className="token-number text-[30px] text-[#5eead4]">{q.active?.tokenLabel ?? '—'}</p>
              </div>
              <div className="text-right text-[12.5px] text-white/70">
                {q.active ? (
                  <>
                    <p className="font-semibold text-white">{q.active.patientName}</p>
                    <p>{q.active.status === 'CALLED' ? 'Called, on the way' : 'With the doctor'}</p>
                  </>
                ) : (
                  <p>Room free</p>
                )}
              </div>
            </div>
            <Button size="sm" variant="secondary" className="w-full" icon={<PhoneCall className="h-3.5 w-3.5" />} disabled={q.paused || !!q.active || !q.waiting.length} loading={call.isPending && call.variables === q.id} onClick={() => call.mutate(q.id)}>
              Call next for the doctor
            </Button>
          </div>
          <div className="flex-1 border-t border-line">
            <p className="px-4 pb-1 pt-3 text-[12.5px] font-semibold text-muted">Waiting ({q.waiting.length}), in call order</p>
            {q.waiting.length ? (
              <ol className="divide-y divide-line">
                {q.waiting.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="tabular w-5 text-[13px] font-semibold text-muted">{w.position}</span>
                    <span className="font-display text-[16px] font-semibold">{w.tokenLabel}</span>
                    <Avatar name={w.patientName} src={w.patientAvatarUrl} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px]">{w.patientName}</p>
                      <p className="text-[12px] text-muted">
                        {w.source === 'WALK_IN' ? 'Walk-in' : 'Appointment'}
                        {w.etaMin !== null ? `, about ${minutes(w.etaMin * 60)}` : q.paused ? ', paused' : ''}
                      </p>
                    </div>
                    <button className="rounded-md px-2 py-1 text-[12.5px] font-semibold text-ink-soft hover:bg-paper-2 hover:text-ink" onClick={() => setSkipFor(w)}>
                      Absent
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 py-6 text-center text-[13.5px] text-muted">No one waiting</p>
            )}
            {q.skipped.length > 0 && (
              <div className="border-t border-dashed border-line px-4 py-3">
                <p className="text-[12.5px] font-semibold text-muted">Marked absent</p>
                <ul className="mt-1.5 space-y-1.5">
                  {q.skipped.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-[13.5px]">
                      <span>
                        <strong className="font-display">{s.tokenLabel}</strong> {s.patientName}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setRequeueFor(s)}>
                        Return to queue
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      ))}
      <ConfirmDialog
        open={!!skipFor}
        onClose={() => setSkipFor(null)}
        onConfirm={(reason) => skipFor && skip.mutate({ id: skipFor.id, reason: reason! })}
        loading={skip.isPending}
        title={`Mark ${skipFor?.tokenLabel ?? ''} as absent?`}
        description="The patient keeps their token and is notified to see reception. You can return them to the queue later."
        reasonLabel="Reason"
        reasonPlaceholder="e.g. Not in waiting area when called"
        confirmLabel="Mark absent"
      />
      <ConfirmDialog
        open={!!requeueFor}
        onClose={() => setRequeueFor(null)}
        onConfirm={(reason) => requeueFor && requeue.mutate({ id: requeueFor.id, reason: reason! })}
        loading={requeue.isPending}
        title={`Return ${requeueFor?.tokenLabel ?? ''} to the queue?`}
        description="The token goes back to waiting and takes its normal place by policy."
        reasonLabel="Reason"
        reasonPlaceholder="e.g. Patient is back at the desk"
        confirmLabel="Return to queue"
      />
    </div>
  );
}

export default function FrontDesk() {
  const poll = usePollInterval(5000, 30000);
  const q = useQuery({ queryKey: ['reception', 'today'], queryFn: () => get<ReceptionToday>('/reception/today'), refetchInterval: poll });
  const [tab, setTab] = useState<'arrivals' | 'queues'>('arrivals');
  const [walkIn, setWalkIn] = useState(false);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const d = q.data;
  const { data: me } = useMe();
  const onDuty = d?.queues.filter((x) => !x.paused) ?? [];

  return (
    <>
      <HeroBanner
        eyebrow={d ? dateLong(dayDate(d.serviceDate)) : 'Today'}
        title="Front desk"
        subtitle={
          d
            ? `${d.counts.booked} still to arrive, ${d.counts.waiting} waiting across ${d.queues.length} doctors. Hello, ${me?.user.name.split(' ')[0] ?? ''}.`
            : 'Loading today at the clinic…'
        }
        actions={
          <>
            <button className={heroPrimary} onClick={() => setWalkIn(true)} disabled={!d}>
              <UserPlus className="h-4 w-4" aria-hidden /> Register walk-in
            </button>
            <a className={heroButton} href="/board" target="_blank" rel="noreferrer">
              <Monitor className="h-4 w-4" aria-hidden /> Waiting-room board
            </a>
          </>
        }
        aside={
          d && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
              <p className="text-[12px] text-white/60">Doctors seeing patients</p>
              <div className="mt-2 flex items-center gap-3">
                <AvatarStack people={onDuty.map((x) => ({ name: x.name, avatarUrl: x.avatarUrl }))} />
                <span className="font-display text-[22px] font-bold">
                  {onDuty.length}
                  <span className="text-[14px] font-semibold text-white/60"> of {d.queues.length}</span>
                </span>
              </div>
            </div>
          )
        }
      />
      {q.isLoading ? (
        <Card>
          <LoadingBlock rows={6} />
        </Card>
      ) : q.isError || !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <StatCard icon={CalendarClock} tone="blue" label="Still to arrive" value={d.counts.booked} />
            <StatCard icon={UserCheck} tone="teal" label="Checked in" value={d.counts.checkedIn} />
            <StatCard icon={Hourglass} tone="amber" label="Waiting now" value={d.counts.waiting} />
            <StatCard icon={Footprints} tone="violet" label="Walk-ins" value={d.counts.walkIns} />
            <StatCard icon={CheckCircle2} tone="green" label="Seen today" value={d.counts.completed} />
            <StatCard icon={AlertTriangle} tone={d.counts.overdue ? 'rose' : 'slate'} label="Overdue" value={d.counts.overdue} sub={`${d.counts.noShow} marked no-show`} />
          </div>
          <div className="mb-4">
            <Tabs
              label="Front desk views"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'arrivals', label: <span className="inline-flex items-center gap-1.5"><Ticket className="h-4 w-4" aria-hidden />Arrivals</span>, count: d.counts.booked },
                { value: 'queues', label: <span className="inline-flex items-center gap-1.5"><Hourglass className="h-4 w-4" aria-hidden />Doctor queues</span>, count: d.counts.waiting },
              ]}
            />
          </div>
          {tab === 'arrivals' ? <ArrivalsTable data={d} onIssued={setIssued} /> : <QueueColumns data={d} />}
          <WalkInModal open={walkIn} onClose={() => setWalkIn(false)} doctors={d.queues} onIssued={setIssued} />
        </>
      )}
      <IssuedTokenModal issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
