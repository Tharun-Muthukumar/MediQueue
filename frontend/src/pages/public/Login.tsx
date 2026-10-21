import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardList, LayoutDashboard, Stethoscope, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { homeFor, useLogin, useMe } from '../../app/auth';
import { Logo, TokenStub } from '../../components/token';
import { Button, Field, FullPageLoader, Input, errorMessage } from '../../components/ui';
import { ApiError } from '../../lib/api';

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
type Form = z.infer<typeof schema>;

const DEMO = [
  { role: 'Patient', email: 'patient1@gmail.com', password: 'patient123', icon: UserRound, note: 'Aarav, token D01-004 today' },
  { role: 'Reception', email: 'reception@gmail.com', password: 'reception123', icon: ClipboardList, note: 'Front desk' },
  { role: 'Doctor', email: 'doctor1@gmail.com', password: 'doctor123', icon: Stethoscope, note: 'Dr. Maya Iyer, Room 101' },
  { role: 'Admin', email: 'admin@gmail.com', password: 'admin123', icon: LayoutDashboard, note: 'Clinic operations' },
];

export default function Login() {
  const { data: me, isLoading } = useMe();
  const login = useLogin();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  if (isLoading) return <FullPageLoader />;
  if (me) return <Navigate to={homeFor[me.user.role]} replace />;

  const submit = (v: Form) =>
    login.mutate(v, {
      onSuccess: (r) => nav(loc.state?.from && loc.state.from.startsWith(homeFor[r.user.role]) ? loc.state.from : homeFor[r.user.role], { replace: true }),
    });

  const err = login.error;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link to="/" className="self-start" aria-label="MediQueue home">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="rise text-[34px] font-bold leading-tight">Sign in</h1>
          <p className="mt-2 text-[15px] text-ink-soft">Patients, reception, doctors and administrators all sign in here.</p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit(submit)} noValidate>
            <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="username" invalid={!!formState.errors.email} {...register('email')} />
            </Field>
            <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register('password')} />
            </Field>
            {err && (
              <p role="alert" className="rounded-lg border border-red-ink/20 bg-red-bg px-3 py-2.5 text-[14px] font-medium text-red-ink">
                {err instanceof ApiError && err.code === 'NETWORK' ? err.message : errorMessage(err)}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-[14px] text-ink-soft">
            New patient?{' '}
            <Link to="/register" className="font-semibold text-teal hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </div>

      <div className="dark-field relative flex flex-col justify-center overflow-hidden bg-ink px-5 py-10 text-white sm:px-12" data-surface="dark" data-spotlight="">
        <div className="relative mx-auto w-full max-w-[460px]">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[22px] font-semibold text-white">Demo accounts</h2>
            <span className="rounded-full bg-[#fbbf24]/15 px-2.5 py-0.5 text-[12px] font-semibold text-[#fcd34d]">Local only</span>
          </div>
          <p className="mt-1.5 text-[14px] text-white/65">Fictional people seeded on this computer. Choose one to sign in straight away.</p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {DEMO.map((d) => (
              <button
                key={d.role}
                type="button"
                className="flex items-start gap-3 rounded-xl border border-white/12 bg-white/5 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[#5eead4]/60 hover:bg-white/10 hover:shadow-[0_10px_30px_-12px_rgb(94_234_212/0.45)] focus-visible:outline-[#5eead4]"
                onClick={() => {
                  setValue('email', d.email);
                  setValue('password', d.password);
                  submit({ email: d.email, password: d.password });
                }}
                disabled={login.isPending}
              >
                <d.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5eead4]" aria-hidden />
                <span>
                  <span className="block text-[15px] font-semibold">Sign in as {d.role}</span>
                  <span className="block text-[12.5px] text-white/60">{d.note}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-10 hidden max-w-[300px] rotate-[-3deg] text-ink sm:block">
            <TokenStub token="D01-004" status="WAITING" size="md" caption={<span>Dr. Maya Iyer, Room 101. About 18 minutes.</span>} />
          </div>
        </div>
      </div>
    </div>
  );
}
