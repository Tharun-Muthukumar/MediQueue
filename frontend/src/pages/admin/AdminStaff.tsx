import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ConciergeBell, ShieldCheck, Stethoscope, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { StatCard, type Tone } from '../../components/kit';
import { useLayoutEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMe } from '../../app/auth';
import { useToast } from '../../app/toast';
import { Avatar, Button, Card, CardHeader, ConfirmDialog, ErrorState, errorMessage, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge } from '../../components/ui';
import { ApiError, get, patch, post } from '../../lib/api';
import { dateShort } from '../../lib/format';

interface StaffList {
  staff: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string; avatarUrl?: string | null }[];
  patientCount: number;
}
const roleNames: Record<string, string> = { ADMIN: 'Administrator', RECEPTIONIST: 'Receptionist', DOCTOR: 'Doctor' };

const schema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
  role: z.enum(['RECEPTIONIST', 'ADMIN']),
});
type Form = z.infer<typeof schema>;

const ROLE_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  ADMIN: { icon: ShieldCheck, tone: 'navy' },
  DOCTOR: { icon: Stethoscope, tone: 'violet' },
  RECEPTIONIST: { icon: ConciergeBell, tone: 'amber' },
};
function RoleIcon({ role }: { role: string }) {
  const r = ROLE_ICON[role] ?? ROLE_ICON.ADMIN;
  const Icon = r.icon;
  const cls = { navy: 'text-ink', violet: 'text-[#6741d9]', amber: 'text-amber-ink' }[r.tone as 'navy'] ?? 'text-ink';
  return <Icon className={'h-4 w-4 ' + cls} aria-hidden />;
}

export default function AdminStaff() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => get<StaffList>('/admin/staff') });
  const [open, setOpen] = useState(false);
  const [toggleFor, setToggleFor] = useState<StaffList['staff'][number] | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { role: 'RECEPTIONIST' } });
  // Layout effect: values are in place before the dialog paints, so early typing is never overwritten.
  useLayoutEffect(() => {
    if (open) form.reset({ role: 'RECEPTIONIST', name: '', email: '', password: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: (v: Form) => post('/admin/staff', v),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['staff'] });
      toast({ tone: 'success', title: 'Account created', body: 'Share the temporary password with the staff member in person.' });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') form.setError('email', { message: e.message });
      else toast({ tone: 'error', title: "Couldn't create account", body: errorMessage(e) });
    },
  });
  const toggle = useMutation({
    mutationFn: (u: StaffList['staff'][number]) => patch(`/admin/users/${u.id}/active`, { isActive: !u.isActive }),
    onSuccess: (_r, u) => {
      setToggleFor(null);
      qc.invalidateQueries({ queryKey: ['staff'] });
      toast({ tone: 'success', title: u.isActive ? `${u.name} can no longer sign in` : `${u.name} can sign in again` });
    },
    onError: (e) => toast({ tone: 'error', title: 'Change not saved', body: errorMessage(e) }),
  });
  const er = form.formState.errors;

  return (
    <>
      <PageHeader
        icon={Users}
        tone="blue"
        title="People"
        description="Staff sign-ins for this clinic. Doctors are added from Doctors & schedules."
        actions={
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Add staff member
          </Button>
        }
      />
      {q.isLoading ? (
        <Card>
          <LoadingBlock rows={4} />
        </Card>
      ) : q.isError || !q.data ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard icon={BadgeCheck} tone="navy" label="Staff accounts" value={q.data.staff.length} />
            <StatCard icon={Stethoscope} tone="violet" label="Doctors" value={q.data.staff.filter((s) => s.role === 'DOCTOR').length} />
            <StatCard icon={ConciergeBell} tone="amber" label="Reception" value={q.data.staff.filter((s) => s.role === 'RECEPTIONIST').length} />
            <StatCard icon={Users} tone="teal" label="Registered patients" value={q.data.patientCount} />
          </div>
          <Card>
            <CardHeader icon={ShieldCheck} tone="green" title="Staff" description="Deactivating an account signs it out everywhere immediately." />
            <ul className="divide-y divide-line">
              {q.data.staff.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Avatar name={u.name} src={u.avatarUrl} size="md" status={u.isActive ? 'online' : 'away'} />
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[15px] font-semibold">
                      {u.name} {u.id === me?.user.id && <span className="text-[12.5px] font-normal text-muted">(you)</span>}
                    </p>
                    <p className="text-[13px] text-muted">{u.email}</p>
                  </div>
                  <span className="flex w-36 items-center gap-2 text-[13.5px] font-medium text-ink-2">
                    <RoleIcon role={u.role} />
                    {roleNames[u.role] ?? u.role}
                  </span>
                  <span className="hidden w-28 text-[13px] text-muted md:block">Since {dateShort(u.createdAt)}</span>
                  <StatusBadge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  <Button size="sm" variant={u.isActive ? 'ghost' : 'secondary'} disabled={u.id === me?.user.id} onClick={() => setToggleFor(u)}>
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add staff member"
        description="Creates a reception or administrator sign-in. Patients register themselves."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
              Create account
            </Button>
          </>
        }
      >
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
          <Field label="Full name" htmlFor="s-name" error={er.name?.message} className="sm:col-span-2">
            <Input id="s-name" data-autofocus invalid={!!er.name} {...form.register('name')} />
          </Field>
          <Field label="Email" htmlFor="s-email" error={er.email?.message}>
            <Input id="s-email" type="email" invalid={!!er.email} {...form.register('email')} />
          </Field>
          <Field label="Role" htmlFor="s-role">
            <Select id="s-role" {...form.register('role')}>
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="ADMIN">Administrator</option>
            </Select>
          </Field>
          <Field label="Temporary password" htmlFor="s-pass" error={er.password?.message} className="sm:col-span-2">
            <Input id="s-pass" type="text" autoComplete="off" invalid={!!er.password} {...form.register('password')} />
          </Field>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!toggleFor}
        onClose={() => setToggleFor(null)}
        onConfirm={() => toggleFor && toggle.mutate(toggleFor)}
        loading={toggle.isPending}
        tone={toggleFor?.isActive ? 'danger' : 'primary'}
        title={toggleFor?.isActive ? `Deactivate ${toggleFor.name}?` : `Reactivate ${toggleFor?.name ?? ''}?`}
        description={toggleFor?.isActive ? 'They are signed out at once and cannot sign in until reactivated.' : 'They will be able to sign in again with their existing password.'}
        confirmLabel={toggleFor?.isActive ? 'Deactivate' : 'Reactivate'}
      />
    </>
  );
}
