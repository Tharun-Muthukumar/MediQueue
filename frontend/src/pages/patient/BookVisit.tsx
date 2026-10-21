import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CalendarDays, CalendarX2, Check, Clock, Moon, Stethoscope, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../app/toast';
import { Avatar, Button, Card, cx, EmptyState, ErrorState, LoadingBlock, Modal, Skeleton } from '../../components/ui';
import { HeroBanner, IconTile } from '../../components/kit';
import { ApiError, get, newIdempotencyKey, post } from '../../lib/api';
import { addDays, clinicDate, dateLong, dateShort, dayDate, displayTz, time } from '../../lib/format';
import type { DoctorCard, SlotView } from '../../lib/types';

interface SlotsResponse {
  doctor: { id: string; name: string; code: string; department: string; room: string; active: boolean };
  date: string;
  bookableFrom: string;
  bookableTo: string;
  slots: SlotView[];
}

const PERIOD_ICON: Record<string, LucideIcon> = { Morning: Sunrise, Afternoon: Sun, Evening: Moon };

function Step({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={cx(
          'grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold transition-colors',
          done ? 'bg-[#5eead4] text-ink' : active ? 'bg-white text-ink' : 'bg-white/10 text-white/60 ring-1 ring-white/20',
        )}
        aria-hidden
      >
        {done ? <Check className="h-4 w-4" /> : n}
      </span>
      <span className={cx('text-[13.5px] font-semibold', done || active ? 'text-white' : 'text-white/55')}>{label}</span>
      <span className="sr-only">{done ? ', done' : active ? ', current step' : ''}</span>
    </li>
  );
}

function StepHead({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-[14px] font-bold text-white" aria-hidden>
        {n}
      </span>
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {sub && <p className="text-[12.5px] text-muted">{sub}</p>}
      </div>
    </div>
  );
}

function hourOf(iso: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: displayTz() }).format(new Date(iso)));
}

export default function BookVisit() {
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [dept, setDept] = useState<string>('');
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [date, setDate] = useState(clinicDate());
  const [chosen, setChosen] = useState<SlotView | null>(null);
  const idemKey = useRef<string>('');

  const depts = useQuery({ queryKey: ['doctors', 'departments'], queryFn: () => get<{ name: string; doctorCount: number }[]>('/departments') });
  const doctors = useQuery({ queryKey: ['doctors', dept], queryFn: () => get<DoctorCard[]>(`/doctors${dept ? `?department=${encodeURIComponent(dept)}` : ''}`) });
  const doctor = doctors.data?.find((d) => d.id === doctorId) ?? null;
  const slots = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => get<SlotsResponse>(`/doctors/${doctorId}/slots?date=${date}`),
    enabled: !!doctorId,
    refetchInterval: 15000,
  });

  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(clinicDate(), i)), []);

  const book = useMutation({
    mutationFn: (slotId: string) =>
      post<{ appointmentId: string; startAt: string; doctorName: string }>('/appointments', { slotId }, { 'Idempotency-Key': idemKey.current }),
    onSuccess: (r) => {
      setChosen(null);
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast({ tone: 'success', title: 'Appointment booked', body: `${r.doctorName}, ${dateShort(r.startAt)} at ${time(r.startAt)}.` });
      nav('/patient/appointments');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SLOT_FULL') {
        setChosen(null);
        qc.invalidateQueries({ queryKey: ['slots'] });
        toast({ tone: 'error', title: 'Someone just took that slot', body: 'The times below are refreshed. Please pick another.' });
      }
    },
  });

  const openConfirm = (s: SlotView) => {
    idemKey.current = newIdempotencyKey(); // one key per intended booking; reused if the user retries
    book.reset();
    setChosen(s);
  };

  const groups = useMemo(() => {
    const list = slots.data?.slots ?? [];
    return [
      { name: 'Morning', items: list.filter((s) => hourOf(s.startAt) < 12) },
      { name: 'Afternoon', items: list.filter((s) => hourOf(s.startAt) >= 12 && hourOf(s.startAt) < 17) },
      { name: 'Evening', items: list.filter((s) => hourOf(s.startAt) >= 17) },
    ].filter((g) => g.items.length);
  }, [slots.data]);

  return (
    <>
      <HeroBanner
        eyebrow="New appointment"
        title="Book a visit"
        subtitle="Choose a doctor, then a day and a time. You'll check in at reception when you arrive."
        avatar={
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-[#5eead4] ring-1 ring-white/15">
            <CalendarDays className="h-8 w-8" aria-hidden />
          </span>
        }
        aside={
          <ol className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4" aria-label="Booking steps">
            <Step n={1} label={doctor ? doctor.name : 'Choose a doctor'} done={!!doctor} active={!doctor} />
            <Step n={2} label={doctor ? dateShort(dayDate(date)) : 'Pick a day'} done={!!doctor} active={false} />
            <Step n={3} label="Pick a time" done={false} active={!!doctor} />
          </ol>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="border-b border-line px-5 py-4">
            <StepHead n={1} title="Doctor" sub={doctors.data ? `${doctors.data.length} available` : undefined} />
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by department">
              {[{ name: '', doctorCount: 0 }, ...(depts.data ?? [])].map((d) => (
                <button
                  key={d.name || 'all'}
                  onClick={() => setDept(d.name)}
                  aria-pressed={dept === d.name}
                  className={cx('rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors', dept === d.name ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white text-ink-2 hover:border-ink-soft')}
                >
                  {d.name || 'All departments'}
                </button>
              ))}
            </div>
          </div>
          {doctors.isLoading ? (
            <LoadingBlock rows={3} />
          ) : doctors.isError ? (
            <ErrorState error={doctors.error} onRetry={() => doctors.refetch()} />
          ) : !doctors.data?.length ? (
            <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No doctors in this department" body="Try another department." />
          ) : (
            <ul className="divide-y divide-line">
              {doctors.data.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setDoctorId(d.id)}
                    aria-pressed={doctorId === d.id}
                    className={cx('group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors', doctorId === d.id ? 'bg-teal-50 shadow-[inset_3px_0_0_var(--color-teal)]' : 'hover:bg-paper')}
                  >
                    <Avatar name={d.name} src={d.avatarUrl} size="lg" active={doctorId === d.id} status={d.pausedToday ? 'away' : 'online'} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15.5px] font-semibold">{d.name}</p>
                        <span className="text-[12px] font-semibold text-muted">{d.code}</span>
                      </div>
                      <p className="text-[13.5px] text-ink-soft">
                        {d.department}, {d.room}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
                        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {d.nextAvailableAt ? `Next free: ${dateShort(d.nextAvailableAt)}, ${time(d.nextAvailableAt)}` : 'No free slots in the next two weeks'}
                        {d.pausedToday && ', queue paused today'}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="min-w-0 self-start">
          <div className="border-b border-line px-5 py-4">
            <StepHead n={2} title="Day and time" sub="Up to two weeks ahead" />
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="listbox" aria-label="Choose a day">
              {days.map((d) => {
                const dt = dayDate(d);
                const sel = d === date;
                return (
                  <button
                    key={d}
                    role="option"
                    aria-selected={sel}
                    onClick={() => setDate(d)}
                    className={cx('flex w-[62px] shrink-0 flex-col items-center rounded-xl border py-2 transition-all duration-200', sel ? 'scale-105 border-teal bg-teal text-white shadow-[0_8px_20px_-8px_rgb(0_128_132/0.7)]' : 'border-line bg-white hover:border-ink-soft/50')}
                  >
                    <span className={cx('text-[11.5px] font-semibold', sel ? 'text-white/80' : 'text-muted')}>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(dt)}</span>
                    <span className="tabular font-display text-[20px] font-bold leading-tight">{new Intl.DateTimeFormat('en-IN', { day: 'numeric', timeZone: 'UTC' }).format(dt)}</span>
                    <span className={cx('text-[11px]', sel ? 'text-white/80' : 'text-muted')}>{new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(dt)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5">
            {!doctorId ? (
              <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="Pick a doctor first" body="Available times for the doctor you choose will appear here." />
            ) : slots.isLoading ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <Skeleton key={i} className="h-11" />
                ))}
              </div>
            ) : slots.isError ? (
              <ErrorState error={slots.error} onRetry={() => slots.refetch()} />
            ) : !slots.data?.slots.length ? (
              <EmptyState icon={<CalendarX2 className="h-5 w-5" />} title={`${doctor?.name ?? 'This doctor'} has no sessions on ${dateShort(dayDate(date))}`} body="Choose another day from the strip above." />
            ) : (
              <div className="space-y-5">
                <p className="text-[14px] text-ink-soft">
                  {dateLong(dayDate(date))} with <strong className="text-ink">{slots.data.doctor.name}</strong>, {slots.data.doctor.room}
                </p>
                {groups.map((g) => (
                  <div key={g.name}>
                    <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
                      <IconTile icon={PERIOD_ICON[g.name]} tone={g.name === 'Morning' ? 'amber' : g.name === 'Afternoon' ? 'teal' : 'violet'} size="sm" />
                      {g.name}
                      <span className="font-normal text-muted">{g.items.filter((x) => x.available).length} free</span>
                    </h3>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                      {g.items.map((s) => (
                        <button
                          key={s.id}
                          disabled={!s.available}
                          onClick={() => openConfirm(s)}
                          className={cx(
                            'tabular h-11 rounded-lg border text-[14px] font-semibold transition-colors',
                            s.available ? 'border-teal/40 bg-white text-teal-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal hover:bg-teal-50 hover:shadow-[0_8px_18px_-10px_rgb(0_128_132/0.6)] active:scale-95' : 'cursor-not-allowed border-line bg-paper text-muted line-through decoration-1',
                          )}
                          aria-label={`${time(s.startAt)}${s.available ? '' : s.past ? ', already passed' : ', taken'}`}
                        >
                          {time(s.startAt)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[12.5px] text-muted">Crossed-out times are taken or have passed. The list refreshes every few seconds.</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={!!chosen}
        onClose={() => !book.isPending && setChosen(null)}
        title="Confirm your booking"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setChosen(null)} disabled={book.isPending}>
              Back
            </Button>
            <Button data-autofocus loading={book.isPending} onClick={() => chosen && book.mutate(chosen.id)} icon={<CalendarCheck2 className="h-4 w-4" />}>
              Book this time
            </Button>
          </>
        }
      >
        {chosen && slots.data && (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-paper p-4">
              <p className="font-display text-[20px] font-bold">{dateLong(chosen.startAt)}</p>
              <p className="tabular mt-0.5 flex items-center gap-1.5 text-[16px] font-semibold text-teal">
                <Clock className="h-4 w-4" aria-hidden />
                {time(chosen.startAt)} – {time(chosen.endAt)}
              </p>
              <div className="mt-3 flex items-center gap-2.5 border-t border-line pt-3">
                <Avatar name={slots.data.doctor.name} src={doctor?.avatarUrl} size="sm" />
                <p className="text-[14px] text-ink-soft">
                  <span className="font-semibold text-ink">{slots.data.doctor.name}</span>, {slots.data.doctor.department}, {slots.data.doctor.room}
                </p>
              </div>
            </div>
            <p className="text-[13.5px] text-ink-soft">Arrive a few minutes early and check in at reception. Patients more than 15 minutes late may be asked to wait for a later turn.</p>
            {book.error && !(book.error instanceof ApiError && book.error.code === 'SLOT_FULL') && (
              <p role="alert" className="rounded-lg bg-red-bg px-3 py-2.5 text-[14px] font-medium text-red-ink">
                {book.error.message}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
