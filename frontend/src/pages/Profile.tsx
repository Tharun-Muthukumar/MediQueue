import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Camera, KeyRound, Keyboard, Mail, Phone, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useMe } from '../app/auth';
import { useToast } from '../app/toast';
import { Avatar, HeroBanner, heroButton, IconTile, SectionTitle } from '../components/kit';
import { Button, Card, Field, Input, errorMessage } from '../components/ui';
import { ApiError, patch, post } from '../lib/api';
import { dateLong } from '../lib/format';
import type { Me } from '../lib/types';

const roleNames = { PATIENT: 'Patient', RECEPTIONIST: 'Receptionist', DOCTOR: 'Doctor', ADMIN: 'Administrator' } as const;

/** Centre-crops and resizes an image file to a 256px JPEG data URL (≈15–40 KB). */
async function toAvatarDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('That image is larger than 10 MB.');
  // Read as a data: URL. The app's Content-Security-Policy allows data: images but not blob: URLs.
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsDataURL(file);
  });
  {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be read as an image.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.86);
  }
}

const detailsSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name').max(80),
  phone: z.string().trim().regex(/^([+\d][\d\s-]{6,18})?$/, 'Enter a valid phone number, or leave it blank'),
});
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function Profile() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);

  const saveProfile = useMutation({
    mutationFn: (body: { name?: string; phone?: string | null; avatarUrl?: string | null }) => patch<{ user: Me['user'] }>('/auth/me', body),
    onSuccess: (r) => {
      qc.setQueryData<Me | null>(['me'], (old) => (old ? { ...old, user: { ...old.user, ...r.user } } : old));
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const details = useForm<z.infer<typeof detailsSchema>>({ resolver: zodResolver(detailsSchema) });
  useLayoutEffect(() => {
    if (me) details.reset({ name: me.user.name, phone: me.user.phone ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.user.id]);
  const pwd = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  const changePwd = useMutation({
    mutationFn: (v: z.infer<typeof passwordSchema>) => post<{ otherSessionsSignedOut: number }>('/auth/password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: (r) => {
      pwd.reset({ currentPassword: '', newPassword: '', confirm: '' });
      toast({ tone: 'success', title: 'Password changed', body: r.otherSessionsSignedOut ? `Signed out ${r.otherSessionsSignedOut} other session(s).` : 'You stay signed in on this device.' });
    },
    onError: (e) => {
      if (e instanceof ApiError && /current password/i.test(e.message)) pwd.setError('currentPassword', { message: e.message });
      else toast({ tone: 'error', title: "Couldn't change password", body: errorMessage(e) });
    },
  });

  if (!me) return null;
  const u = me.user;

  const onPick = async (f?: File) => {
    if (!f) return;
    try {
      const dataUrl = await toAvatarDataUrl(f);
      await saveProfile.mutateAsync({ avatarUrl: dataUrl });
      toast({ tone: 'success', title: 'Photo updated', body: 'It now appears across MediQueue.' });
    } catch (e) {
      toast({ tone: 'error', title: "Couldn't use that photo", body: errorMessage(e) });
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <HeroBanner
        eyebrow={roleNames[u.role]}
        title={u.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-4 w-4" aria-hidden /> {u.email}
            </span>
            {me.clinic && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" aria-hidden /> {me.clinic.name}
              </span>
            )}
          </span>
        }
        avatar={
          <button onClick={() => file.current?.click()} className="group relative shrink-0 rounded-full" aria-label="Change profile photo">
            <Avatar name={u.name} src={u.avatarUrl} size="xl" ring />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-ink/55 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-6 w-6 text-white" aria-hidden />
            </span>
          </button>
        }
        actions={
          <>
            <button className={heroButton} onClick={() => file.current?.click()} disabled={saveProfile.isPending}>
              <Camera className="h-4 w-4" aria-hidden /> {u.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {u.avatarUrl && (
              <button
                className={heroButton}
                onClick={() => saveProfile.mutate({ avatarUrl: null }, { onSuccess: () => toast({ tone: 'success', title: 'Photo removed' }) })}
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove photo
              </button>
            )}
          </>
        }
      />
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Profile photo file" onChange={(e) => onPick(e.target.files?.[0])} />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <SectionTitle icon={UserRound} title="Personal details" description="Shown to clinic staff. Your email is your sign-in and can only be changed by an administrator." />
            <form
              className="grid gap-4 p-5 sm:grid-cols-2"
              noValidate
              onSubmit={details.handleSubmit((v) =>
                saveProfile.mutate(
                  { name: v.name, phone: v.phone || null },
                  {
                    onSuccess: () => {
                      details.reset(v);
                      toast({ tone: 'success', title: 'Details saved' });
                    },
                    onError: (e) => toast({ tone: 'error', title: "Couldn't save", body: errorMessage(e) }),
                  },
                ),
              )}
            >
              <Field label="Full name" htmlFor="pf-name" error={details.formState.errors.name?.message}>
                <Input id="pf-name" autoComplete="name" invalid={!!details.formState.errors.name} {...details.register('name')} />
              </Field>
              <Field label="Phone" htmlFor="pf-phone" error={details.formState.errors.phone?.message}>
                <Input id="pf-phone" type="tel" autoComplete="tel" invalid={!!details.formState.errors.phone} {...details.register('phone')} />
              </Field>
              <Field label="Email" htmlFor="pf-email" className="sm:col-span-2">
                <Input id="pf-email" value={u.email} readOnly disabled className="bg-paper text-muted" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" loading={saveProfile.isPending} disabled={!details.formState.isDirty}>
                  Save details
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <SectionTitle icon={KeyRound} tone="violet" title="Password" description="After a change, every other device is signed out." />
            <form className="grid gap-4 p-5 sm:grid-cols-3" noValidate onSubmit={pwd.handleSubmit((v) => changePwd.mutate(v))}>
              <input type="text" name="username" autoComplete="username" value={u.email} readOnly hidden />
              <Field label="Current password" htmlFor="pw-cur" error={pwd.formState.errors.currentPassword?.message}>
                <Input id="pw-cur" type="password" autoComplete="current-password" invalid={!!pwd.formState.errors.currentPassword} {...pwd.register('currentPassword')} />
              </Field>
              <Field label="New password" htmlFor="pw-new" error={pwd.formState.errors.newPassword?.message}>
                <Input id="pw-new" type="password" autoComplete="new-password" invalid={!!pwd.formState.errors.newPassword} {...pwd.register('newPassword')} />
              </Field>
              <Field label="Confirm new password" htmlFor="pw-confirm" error={pwd.formState.errors.confirm?.message}>
                <Input id="pw-confirm" type="password" autoComplete="new-password" invalid={!!pwd.formState.errors.confirm} {...pwd.register('confirm')} />
              </Field>
              <div className="sm:col-span-3">
                <Button type="submit" variant="ink" loading={changePwd.isPending}>
                  Change password
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle icon={BadgeCheck} tone="green" title="Account" />
            <dl className="divide-y divide-line text-[14px]">
              {[
                { icon: ShieldCheck, label: 'Role', value: roleNames[u.role] },
                { icon: Building2, label: 'Clinic', value: me.clinic?.name ?? '—' },
                ...(me.doctor ? [{ icon: UserRound, label: 'Doctor profile', value: `${me.doctor.code}, ${me.doctor.department}, ${me.doctor.room}` }] : []),
                { icon: Phone, label: 'Phone', value: u.phone || 'Not added' },
                ...(u.createdAt ? [{ icon: BadgeCheck, label: 'Member since', value: dateLong(u.createdAt) }] : []),
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3 px-5 py-3">
                  <r.icon className="h-4 w-4 text-muted" aria-hidden />
                  <dt className="w-32 text-ink-soft">{r.label}</dt>
                  <dd className="min-w-0 flex-1 truncate text-right font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <SectionTitle icon={Keyboard} tone="blue" title="Shortcuts" />
            <ul className="space-y-2.5 p-5 text-[14px] text-ink-2">
              <li className="flex items-center justify-between">
                Search pages and actions <kbd>Ctrl K</kbd>
              </li>
              <li className="flex items-center justify-between">
                Close any dialog <kbd>Esc</kbd>
              </li>
              {u.role === 'DOCTOR' && (
                <>
                  <li className="flex items-center justify-between">
                    Call next patient <kbd>N</kbd>
                  </li>
                  <li className="flex items-center justify-between">
                    Start / complete visit
                    <span className="flex gap-1">
                      <kbd>S</kbd> <kbd>C</kbd>
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    Pause or resume the queue <kbd>P</kbd>
                  </li>
                </>
              )}
            </ul>
          </Card>
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-white/60 p-4 text-[13px] text-ink-soft">
            <IconTile icon={ShieldCheck} tone="slate" size="sm" />
            <p>Your photo is stored only in this clinic's local database and is never sent anywhere else. Use a picture you're comfortable sharing with clinic staff.</p>
          </div>
        </div>
      </div>
    </>
  );
}
