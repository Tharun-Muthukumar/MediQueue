import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DoorOpen, ListOrdered, Settings2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../../app/toast';
import { Button, Card, CardHeader, cx, ErrorState, errorMessage, Field, Input, LoadingBlock, PageHeader } from '../../components/ui';
import { get, patch } from '../../lib/api';
import type { ClinicSettings } from '../../lib/types';

type Editable = Pick<ClinicSettings, 'name' | 'walkInRatio' | 'graceMinutes' | 'lateAfterMinutes' | 'autoNoShow' | 'defaultConsultMinutes' | 'bookingHorizonDays'>;

function NumberField({ id, label, hint, value, onChange, min, max, suffix }: { id: string; label: string; hint: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix: string }) {
  const invalid = !Number.isInteger(value) || value < min || value > max;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={invalid ? `Enter a whole number from ${min} to ${max}` : undefined}>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" min={min} max={max} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.valueAsNumber)} className="w-28" invalid={invalid} />
        <span className="text-[14px] text-ink-soft">{suffix}</span>
      </div>
    </Field>
  );
}

export default function AdminSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<ClinicSettings>('/admin/settings') });
  const [v, setV] = useState<Editable | null>(null);
  const pick = (c: ClinicSettings): Editable => ({ name: c.name, walkInRatio: c.walkInRatio, graceMinutes: c.graceMinutes, lateAfterMinutes: c.lateAfterMinutes, autoNoShow: c.autoNoShow, defaultConsultMinutes: c.defaultConsultMinutes, bookingHorizonDays: c.bookingHorizonDays });
  useEffect(() => {
    if (q.data) setV(pick(q.data));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Editable) => patch<ClinicSettings>('/admin/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast({ tone: 'success', title: 'Policy saved', body: 'The change is recorded in the audit log and applies immediately.' });
    },
    onError: (e) => toast({ tone: 'error', title: "Couldn't save", body: errorMessage(e) }),
  });
  const dirty = q.data && v && (Object.keys(v) as (keyof Editable)[]).some((k) => v[k] !== q.data![k]);

  return (
    <>
      <PageHeader icon={Settings2} tone="violet" title="Clinic policy" description="Operational rules for booking, check-in and the queue. They never use medical information." />
      {q.isLoading || !v ? (
        q.isError ? (
          <Card>
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          </Card>
        ) : (
          <Card>
            <LoadingBlock rows={5} />
          </Card>
        )
      ) : (
        <form
          className="grid gap-6 lg:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(v);
          }}
        >
          <Card>
            <CardHeader icon={ListOrdered} tone="teal" title="Queue order" />
            <div className="space-y-5 p-5">
              <NumberField id="ratio" label="Booked patients called per walk-in" hint={`When both groups are waiting, call ${v.walkInRatio} booked patients, then 1 walk-in. Each group keeps its own order.`} value={v.walkInRatio} min={1} max={5} suffix="booked : 1 walk-in" onChange={(n) => setV({ ...v, walkInRatio: n })} />
              <NumberField id="consult" label="Default visit length" hint="Used for waiting estimates until a doctor has 5 recorded visits." value={v.defaultConsultMinutes} min={3} max={90} suffix="minutes" onChange={(n) => setV({ ...v, defaultConsultMinutes: n })} />
            </div>
          </Card>
          <Card>
            <CardHeader icon={DoorOpen} tone="amber" title="Arrivals" />
            <div className="space-y-5 p-5">
              <NumberField id="late" label="Late after" hint="Check-ins later than this after the booked time need a reason from reception." value={v.lateAfterMinutes} min={0} max={120} suffix="minutes" onChange={(n) => setV({ ...v, lateAfterMinutes: n })} />
              <NumberField id="grace" label="No-show grace period" hint="A booking can't be marked no-show before this without an override reason." value={v.graceMinutes} min={0} max={120} suffix="minutes" onChange={(n) => setV({ ...v, graceMinutes: n })} />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="label" id="auto-label">
                    Mark no-shows automatically
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">Checks every minute and marks bookings still not checked in once the grace period ends.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={v.autoNoShow}
                  aria-labelledby="auto-label"
                  onClick={() => setV({ ...v, autoNoShow: !v.autoNoShow })}
                  className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', v.autoNoShow ? 'bg-teal' : 'bg-line-strong')}
                >
                  <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', v.autoNoShow ? 'left-6' : 'left-1')} />
                </button>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader icon={Building2} tone="blue" title="Clinic" />
            <div className="space-y-5 p-5">
              <Field label="Clinic name" htmlFor="cname">
                <Input id="cname" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
              </Field>
              <NumberField id="horizon" label="Booking window" hint="How far ahead patients can book." value={v.bookingHorizonDays} min={1} max={60} suffix="days" onChange={(n) => setV({ ...v, bookingHorizonDays: n })} />
              <p className="text-[13px] text-muted">Time zone: {q.data?.timezone}. All times are stored in UTC and shown in this zone.</p>
            </div>
          </Card>
          <Card className="self-start bg-ink p-5 text-white">
            <h2 className="flex items-center gap-2.5 text-[17px] font-semibold text-white">
              <ShieldAlert className="h-5 w-5 text-[#5eead4]" aria-hidden /> Safety boundary
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">
              MediQueue orders patients by booking time and arrival only. It never infers urgency from anything a patient types. Emergencies are handled by clinical staff outside this system.
            </p>
            <div className="mt-5 flex gap-2">
              <Button type="submit" loading={save.isPending} disabled={!dirty}>
                Save policy
              </Button>
              <Button type="button" variant="ghost" className="text-white hover:bg-white/10" disabled={!dirty} onClick={() => q.data && setV(pick(q.data))}>
                Discard changes
              </Button>
            </div>
          </Card>
        </form>
      )}
    </>
  );
}
