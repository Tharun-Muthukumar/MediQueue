import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useLogin } from '../../app/auth';
import { useToast } from '../../app/toast';
import { Logo } from '../../components/token';
import { Button, Field, Input, errorMessage } from '../../components/ui';
import { ApiError, post } from '../../lib/api';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.string().trim().email('Enter a valid email address'),
    phone: z
      .string()
      .trim()
      .regex(/^([+\d][\d\s-]{6,18})?$/, 'Enter a valid phone number, or leave it blank'),
    password: z.string().min(8, 'Use at least 8 characters').regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Form = z.infer<typeof schema>;

export default function Register() {
  const nav = useNavigate();
  const toast = useToast();
  const login = useLogin();
  const { register, handleSubmit, formState, setError } = useForm<Form>({ resolver: zodResolver(schema) });
  const reg = useMutation({
    mutationFn: (v: Form) => post('/auth/register', { name: v.name, email: v.email, password: v.password, phone: v.phone || undefined }),
    onSuccess: async (_d, v) => {
      await login.mutateAsync({ email: v.email, password: v.password });
      toast({ tone: 'success', title: 'Account created', body: 'You can book your first visit now.' });
      nav('/patient/book', { replace: true });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'EMAIL_TAKEN') setError('email', { message: e.message });
    },
  });
  const e = formState.errors;

  return (
    <div className="min-h-screen px-5 py-6 sm:px-10">
      <Link to="/" aria-label="MediQueue home">
        <Logo />
      </Link>
      <div className="mx-auto max-w-[440px] py-10">
        <h1 className="text-[34px] font-bold leading-tight">Create a patient account</h1>
        <p className="mt-2 text-[15px] text-ink-soft">For booking visits at DemoCare OPD. Please use made-up details — this is a demo.</p>
        <form className="card mt-8 space-y-4 p-6" onSubmit={handleSubmit((v) => reg.mutate(v))} noValidate>
          <Field label="Full name" htmlFor="name" error={e.name?.message}>
            <Input id="name" autoComplete="name" invalid={!!e.name} {...register('name')} />
          </Field>
          <Field label="Email" htmlFor="email" error={e.email?.message}>
            <Input id="email" type="email" autoComplete="email" invalid={!!e.email} {...register('email')} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone" error={e.phone?.message} hint="Reception uses this to find you on arrival.">
            <Input id="phone" type="tel" autoComplete="tel" invalid={!!e.phone} {...register('phone')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" htmlFor="password" error={e.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" invalid={!!e.password} {...register('password')} />
            </Field>
            <Field label="Confirm password" htmlFor="confirm" error={e.confirm?.message}>
              <Input id="confirm" type="password" autoComplete="new-password" invalid={!!e.confirm} {...register('confirm')} />
            </Field>
          </div>
          {reg.error && !(reg.error instanceof ApiError && reg.error.code === 'EMAIL_TAKEN') && (
            <p role="alert" className="rounded-lg bg-red-bg px-3 py-2.5 text-[14px] font-medium text-red-ink">
              {errorMessage(reg.error)}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={reg.isPending || login.isPending}>
            Create account
          </Button>
        </form>
        <p className="mt-6 text-[14px] text-ink-soft">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-teal hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
