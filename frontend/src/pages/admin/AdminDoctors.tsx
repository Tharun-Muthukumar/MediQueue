import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCog, CalendarRange, Pencil, Plus, Stethoscope, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useToast } from '../../app/toast';
import { Avatar, Button, Card, CardHeader, ConfirmDialog, cx, EmptyState, ErrorState, errorMessage, Field, Input, LoadingBlock, Modal, PageHeader, StatusBadge, Textarea } from '../../components/ui';
import { ApiError, del, get, patch, post } from '../../lib/api';
import { addDays, clinicDate, dateShort, dayDate, time } from '../../lib/format';
import type { AdminDoctor } from '../../lib/types';

const doctorSchema = z.object({
  name: z.string().trim().min(2, 'Enter the doctor’s name').max(80),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
  department: z.string().trim().min(2, 'Enter a department').max(60),
  room: z.string().trim().min(1, 'Enter a room').max(30),
  avgMinutes: z.coerce.number().int().min(3, 'At least 3 minutes').max(90, 'At most 90 minutes'),
  bio: z.string().max(240).optional(),
});
type DoctorForm = z.infer<typeof doctorSchema>;

function DoctorFormModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: AdminDoctor | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isEdit = !!editing;
  const form = useForm<DoctorForm>({ resolver: zodResolver(doctorSchema) });
  // Layout effect: values are in place before the dialog paints, so early typing is never overwritten.
  useLayoutEffect(() => {
    if (open) form.reset(editing ? { name: editing.name, department: editing.department, room: editing.room, avgMinutes: editing.avgMinutes, bio: editing.bio ?? '', email: editing.email, password: 'unchanged1' /* not sent on edit */ } : { avgMinutes: 12 } as DoctorForm);
    // Reset only when the dialog opens or the edited doctor changes — never on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);
  const save = useMutation({
    mutationFn: (v: DoctorForm) =>
      isEdit ? patch(`/admin/doctors/${editing!.id}`, { name: v.name, department: v.department, room: v.room, avgMinutes: v.avgMinutes, bio: v.bio || null }) : post<{ code: string }>('/admin/doctors', { ...v, bio: v.bio || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['adminDoctors'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
      toast({ tone: 'success', title: isEdit ? 'Doctor updated' : `Doctor added as ${(r as { code: string }).code}`, body: isEdit ? undefined : 'Next, generate their appointment slots.' });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') form.setError('email', { message: e.message });
      else toast({ tone: 'error', title: "Couldn't save", body: errorMessage(e) });
    },
  });
  const er = form.formState.errors;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${editing!.name}` : 'Add a doctor'}
      description={isEdit ? undefined : 'Creates the doctor’s sign-in and profile. The token prefix (D04, D05…) is assigned automatically.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            {isEdit ? 'Save changes' : 'Add doctor'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
        <Field label="Full name" htmlFor="d-name" error={er.name?.message} className="sm:col-span-2">
          <Input id="d-name" data-autofocus placeholder="Dr. …" invalid={!!er.name} {...form.register('name')} />
        </Field>
        {!isEdit && (
          <>
            <Field label="Sign-in email" htmlFor="d-email" error={er.email?.message}>
              <Input id="d-email" type="email" invalid={!!er.email} {...form.register('email')} />
            </Field>
            <Field label="Temporary password" htmlFor="d-pass" error={er.password?.message}>
              <Input id="d-pass" type="text" autoComplete="off" invalid={!!er.password} {...form.register('password')} />
            </Field>
          </>
        )}
        <Field label="Department" htmlFor="d-dept" error={er.department?.message}>
          <Input id="d-dept" list="dept-options" invalid={!!er.department} {...form.register('department')} />
          <datalist id="dept-options">
            <option value="General Medicine" />
            <option value="Dermatology" />
            <option value="Orthopedics" />
            <option value="Pediatrics" />
            <option value="ENT" />
          </datalist>
        </Field>
        <Field label="Room" htmlFor="d-room" error={er.room?.message}>
          <Input id="d-room" placeholder="Room 105" invalid={!!er.room} {...form.register('room')} />
        </Field>
        <Field label="Default visit length (minutes)" htmlFor="d-avg" error={er.avgMinutes?.message} hint="Used for waiting estimates until 5 visits are recorded.">
          <Input id="d-avg" type="number" min={3} max={90} invalid={!!er.avgMinutes} {...form.register('avgMinutes')} />
        </Field>
        <Field label="Short description (optional)" htmlFor="d-bio" className="sm:col-span-2">
          <Textarea id="d-bio" maxLength={240} {...form.register('bio')} />
        </Field>
      </form>
    </Modal>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function GenerateSlotsModal({ doctor, onClose }: { doctor: AdminDoctor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const today = clinicDate();
  const [v, setV] = useState({ fromDate: today, toDate: addDays(today, 13), startTime: '09:00', endTime: '13:00', slotMinutes: 15, capacity: 1, weekdays: [1, 2, 3, 4, 5, 6] });
  const [result, setResult] = useState<{ created: number; skippedConflicts: number; skippedPast: number } | null>(null);
  useEffect(() => setResult(null), [doctor]);
  const gen = useMutation({
    mutationFn: () => post<{ created: number; skippedConflicts: number; skippedPast: number }>('/admin/slots/generate', { doctorId: doctor!.id, ...v }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['adminDoctors'] });
      qc.invalidateQueries({ queryKey: ['adminSlots'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      toast({ tone: 'success', title: `${r.created} slots created` });
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't generate slots", body: errorMessage(e) }),
  });
  const perDay = Math.max(0, Math.floor(((+v.endTime.slice(0, 2) * 60 + +v.endTime.slice(3)) - (+v.startTime.slice(0, 2) * 60 + +v.startTime.slice(3))) / v.slotMinutes));
  return (
    <Modal
      open={!!doctor}
      onClose={onClose}
      title={`Generate slots for ${doctor?.name ?? ''}`}
      description="Times are clinic local time. Slots that overlap existing ones or have already started are skipped, so it is safe to run twice."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button loading={gen.isPending} onClick={() => gen.mutate()} disabled={!v.weekdays.length || perDay < 1}>
            Generate slots
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="g-from">
          <Input id="g-from" type="date" value={v.fromDate} min={today} onChange={(e) => setV({ ...v, fromDate: e.target.value })} />
        </Field>
        <Field label="To" htmlFor="g-to" hint="Up to 62 days at a time.">
          <Input id="g-to" type="date" value={v.toDate} min={v.fromDate} onChange={(e) => setV({ ...v, toDate: e.target.value })} />
        </Field>
        <Field label="Session starts" htmlFor="g-start">
          <Input id="g-start" type="time" value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} />
        </Field>
        <Field label="Session ends" htmlFor="g-end">
          <Input id="g-end" type="time" value={v.endTime} onChange={(e) => setV({ ...v, endTime: e.target.value })} />
        </Field>
        <Field label="Slot length (minutes)" htmlFor="g-len">
          <Input id="g-len" type="number" min={5} max={120} value={v.slotMinutes} onChange={(e) => setV({ ...v, slotMinutes: Number(e.target.value) || 15 })} />
        </Field>
        <Field label="Patients per slot" htmlFor="g-cap" hint="Usually 1.">
          <Input id="g-cap" type="number" min={1} max={5} value={v.capacity} onChange={(e) => setV({ ...v, capacity: Number(e.target.value) || 1 })} />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label mb-2">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, i) => {
              const on = v.weekdays.includes(i + 1);
              return (
                <label key={w} className={cx('cursor-pointer rounded-lg border px-3 py-1.5 text-[13.5px] font-semibold', on ? 'border-teal bg-teal-50 text-teal-700' : 'border-line-strong text-ink-soft')}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => setV({ ...v, weekdays: on ? v.weekdays.filter((x) => x !== i + 1) : [...v.weekdays, i + 1].sort() })}
                  />
                  {w}
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className="rounded-lg bg-paper px-3 py-2.5 text-[13.5px] text-ink-soft sm:col-span-2">
          {perDay > 0 ? `${perDay} slots per working day, ${v.slotMinutes} minutes each.` : 'The session end must be after its start.'}
        </p>
        {result && (
          <p role="status" className="rounded-lg border border-green-ink/20 bg-green-bg px-3 py-2.5 text-[14px] font-medium text-green-ink sm:col-span-2">
            Created {result.created}. Skipped {result.skippedConflicts} overlapping and {result.skippedPast} already started.
          </p>
        )}
      </div>
    </Modal>
  );
}

function SchedulePanel({ doctor }: { doctor: AdminDoctor }) {
  const today = clinicDate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['adminSlots', doctor.id],
    queryFn: () => get<{ id: string; serviceDate: string; startAt: string; endAt: string; capacity: number; reservedCount: number }[]>(`/admin/doctors/${doctor.id}/slots?from=${today}&to=${addDays(today, 13)}`),
  });
  const [openDay, setOpenDay] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/admin/slots/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['adminSlots', doctor.id] }),
    onError: (e) => toast({ tone: 'error', title: "Couldn't remove slot", body: errorMessage(e) }),
  });
  const days = useMemo(() => {
    const map = new Map<string, NonNullable<typeof q.data>>();
    for (const s of q.data ?? []) map.set(s.serviceDate, [...(map.get(s.serviceDate) ?? []), s]);
    return [...map.entries()];
  }, [q.data]);
  if (q.isLoading) return <LoadingBlock rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!days.length) return <EmptyState title="No slots in the next 14 days" body="Use “Generate slots” to open this doctor’s calendar." />;
  return (
    <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {days.map(([day, slots]) => {
        const booked = slots.reduce((a, s) => a + s.reservedCount, 0);
        const cap = slots.reduce((a, s) => a + s.capacity, 0);
        const open = openDay === day;
        return (
          <div key={day} className={cx('rounded-xl border p-3', open ? 'border-teal sm:col-span-2 lg:col-span-4' : 'border-line')}>
            <button className="flex w-full items-center justify-between text-left" onClick={() => setOpenDay(open ? null : day)} aria-expanded={open}>
              <span>
                <span className="block text-[14px] font-semibold">{dateShort(dayDate(day))}</span>
                <span className="tabular block text-[12.5px] text-muted">
                  {time(slots[0].startAt)} – {time(slots[slots.length - 1].endAt)}
                </span>
              </span>
              <span className="tabular text-right text-[12.5px]">
                <span className="block font-semibold text-ink">
                  {booked}/{cap} booked
                </span>
                <span className="block h-1.5 w-20 overflow-hidden rounded-full bg-paper-2">
                  <span className="block h-full bg-[#009096]" style={{ width: `${(booked / cap) * 100}%` }} />
                </span>
              </span>
            </button>
            {open && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {slots.map((s) => (
                  <span key={s.id} className={cx('tabular inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12.5px]', s.reservedCount ? 'border-teal/30 bg-teal-50 text-teal-700' : 'border-line bg-white')}>
                    {time(s.startAt)}
                    {s.reservedCount ? (
                      <span className="sr-only"> booked</span>
                    ) : (
                      <button className="rounded p-0.5 text-muted hover:text-red-ink" onClick={() => remove.mutate(s.id)} aria-label={`Remove ${time(s.startAt)} slot`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AdminDoctors() {
  const q = useQuery({ queryKey: ['adminDoctors'], queryFn: () => get<AdminDoctor[]>('/admin/doctors') });
  const qc = useQueryClient();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminDoctor | null>(null);
  const [slotsFor, setSlotsFor] = useState<AdminDoctor | null>(null);
  const [toggleFor, setToggleFor] = useState<AdminDoctor | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (d: AdminDoctor) => patch<{ futureBookings: number }>(`/admin/doctors/${d.id}`, { status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: (r, d) => {
      setToggleFor(null);
      qc.invalidateQueries({ queryKey: ['adminDoctors'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
      toast({
        tone: 'success',
        title: d.status === 'ACTIVE' ? `${d.name} deactivated` : `${d.name} reactivated`,
        body: d.status === 'ACTIVE' && r.futureBookings ? `${r.futureBookings} existing bookings remain. Reception should contact those patients.` : undefined,
      });
    },
    onError: (e) => toast({ tone: 'error', title: 'Change not saved', body: errorMessage(e) }),
  });

  return (
    <>
      <PageHeader
        icon={Stethoscope}
        tone="violet"
        title="Doctors & schedules"
        description="Add doctors, adjust their details and open appointment slots."
        actions={
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add doctor
          </Button>
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
      ) : (
        <div className="space-y-4">
          {q.data!.map((d) => (
            <Card key={d.id} glow className={cx(d.status === 'INACTIVE' && 'opacity-75')}>
              <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={d.name} src={d.avatarUrl} size="lg" status={d.status === 'INACTIVE' ? 'away' : d.pausedToday ? 'busy' : 'online'} />
                <div className="min-w-[200px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[17px] font-semibold">{d.name}</h2>
                    <span className="rounded-md bg-paper-2 px-1.5 py-0.5 font-display text-[12.5px] font-semibold text-ink-2">{d.code}</span>
                    <StatusBadge status={d.status} />
                    {d.pausedToday && <StatusBadge status="PAUSED" label="Paused today" />}
                  </div>
                  <p className="text-[13.5px] text-ink-soft">
                    {d.department}, {d.room}. Default visit {d.avgMinutes} min. {d.email}
                  </p>
                </div>
                <div className="tabular text-right text-[13px] text-ink-soft">
                  <p>
                    <strong className="text-ink">{d.upcomingSlots}</strong> slots in 14 days
                  </p>
                  <p>{d.upcomingBooked} booked</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon={<CalendarCog className="h-3.5 w-3.5" />} onClick={() => setSlotsFor(d)}>
                    Generate slots
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setExpanded(expanded === d.id ? null : d.id)} aria-expanded={expanded === d.id}>
                    {expanded === d.id ? 'Hide calendar' : 'Calendar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setEditing(d);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant={d.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => setToggleFor(d)}>
                    {d.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
              {expanded === d.id && (
                <div className="border-t border-line">
                  <CardHeader icon={CalendarRange} tone="blue" title="Next 14 days" description="Select a day to see its slots. Unbooked slots can be removed." className="border-b-0 pb-0" />
                  <SchedulePanel doctor={d} />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <DoctorFormModal open={formOpen} onClose={() => setFormOpen(false)} editing={editing} />
      <GenerateSlotsModal doctor={slotsFor} onClose={() => setSlotsFor(null)} />
      <ConfirmDialog
        open={!!toggleFor}
        onClose={() => setToggleFor(null)}
        onConfirm={() => toggleFor && toggle.mutate(toggleFor)}
        loading={toggle.isPending}
        tone={toggleFor?.status === 'ACTIVE' ? 'danger' : 'primary'}
        title={toggleFor?.status === 'ACTIVE' ? `Deactivate ${toggleFor.name}?` : `Reactivate ${toggleFor?.name ?? ''}?`}
        description={toggleFor?.status === 'ACTIVE' ? 'Patients will no longer see this doctor or be able to book. Existing bookings are kept.' : 'The doctor becomes bookable again.'}
        confirmLabel={toggleFor?.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
      />
    </>
  );
}
