import { CircleAlert, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { CountUp } from './motion';
import { IconTile, type Tone } from './kit';
import type { LucideIcon } from 'lucide-react';
import { ApiError } from '../lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────────────────── Buttons ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink';
const variants: Record<Variant, string> = {
  primary: 'btn-primary bg-teal text-white hover:bg-teal-600 active:bg-teal-700 shadow-[0_1px_0_rgb(0_0_0/0.08)]',
  secondary: 'bg-white text-ink border border-line-strong hover:bg-paper hover:border-ink-soft/40',
  ghost: 'text-ink-2 hover:bg-paper-2',
  danger: 'bg-white text-red-ink border border-red-ink/30 hover:bg-red-bg',
  ink: 'bg-ink text-white hover:bg-ink-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-[14px] gap-2', lg: 'h-12 px-5 text-[15px] gap-2' };
  return (
    <button
      ref={ref}
      className={cx(
        'btn inline-flex shrink-0 items-center justify-center rounded-lg font-semibold disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

const sizesFor = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-[14px] gap-2', lg: 'h-12 px-5 text-[15px] gap-2' };

/** A link that looks like a button (never a <button> inside an <a>). */
export function ButtonLink({ to, variant = 'primary', size = 'md', icon, className, children, external }: { to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; className?: string; children: ReactNode; external?: boolean }) {
  const cls = cx('btn inline-flex shrink-0 items-center justify-center rounded-lg font-semibold', variants[variant], sizesFor[size], className);
  if (external)
    return (
      <a href={to} target="_blank" rel="noreferrer" className={cls}>
        {icon}
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  return (
    <Link to={to} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

// ───────────────────────── Surfaces ─────────────────────────

export function Card({ className, children, glow, ...rest }: { className?: string; children: ReactNode; glow?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', glow && 'glow', className)} data-spotlight={glow ? '' : undefined} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className, icon, tone }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon, tone }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <span className="hidden sm:block">
            <IconTile icon={icon} tone={tone} size="lg" className="shadow-[0_10px_24px_-14px_rgb(18_38_67/0.6)]" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight sm:text-[32px]">{title}</h1>
          {description && <p className="mt-1 max-w-[68ch] text-[15px] text-ink-soft">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────── Status ─────────────────────────

const statusStyles: Record<string, { cls: string; label: string }> = {
  BOOKED: { cls: 'bg-blue-bg text-blue-ink', label: 'Booked' },
  CHECKED_IN: { cls: 'bg-teal-50 text-teal-700', label: 'Checked in' },
  COMPLETED: { cls: 'bg-green-bg text-green-ink', label: 'Completed' },
  CANCELLED: { cls: 'bg-slate-bg text-slate-ink', label: 'Cancelled' },
  NO_SHOW: { cls: 'bg-red-bg text-red-ink', label: 'No-show' },
  WAITING: { cls: 'bg-amber-bg text-amber-ink', label: 'Waiting' },
  CALLED: { cls: 'bg-blue-bg text-blue-ink', label: 'Called' },
  IN_CONSULTATION: { cls: 'bg-teal-50 text-teal-700', label: 'With doctor' },
  SKIPPED: { cls: 'bg-slate-bg text-slate-ink', label: 'Marked absent' },
  WALK_IN: { cls: 'bg-paper-2 text-ink-2', label: 'Walk-in' },
  SCHEDULED: { cls: 'bg-paper-2 text-ink-2', label: 'Appointment' },
  PAUSED: { cls: 'bg-amber-bg text-amber-ink', label: 'Paused' },
  ACTIVE: { cls: 'bg-green-bg text-green-ink', label: 'Active' },
  INACTIVE: { cls: 'bg-slate-bg text-slate-ink', label: 'Inactive' },
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = statusStyles[status] ?? { cls: 'bg-paper-2 text-ink-2', label: status };
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold', s.cls, className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-teal', className)} aria-label="Loading" />;
}

export function FullPageLoader() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-lg', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-teal-50 text-teal">{icon}</div>}
      <p className="font-display text-[17px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-[46ch] text-[14px] text-ink-soft">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-bg text-red-ink">
        <CircleAlert className="h-5 w-5" />
      </div>
      <p className="font-display text-[17px] font-semibold">This section didn't load</p>
      <p className="mt-1 max-w-[52ch] text-[14px] text-ink-soft">{msg}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

// ───────────────────────── Form fields ─────────────────────────

export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor: string; className?: string }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="label block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[13px] font-medium text-red-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx('input', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('input appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2352637a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={cx('input min-h-[84px] resize-y', className)} aria-invalid={invalid || undefined} {...rest} />;
});

// ───────────────────────── Dialogs ─────────────────────────

/** Accessible modal: focus moves in, Tab is trapped, Esc closes, focus returns on close. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  // Keep the latest onClose without re-running the focus effect: parents re-render on every
  // live update, and re-running it would yank focus back to the first field mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
      first?.focus();
    }, 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className={cx('token-in max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-[var(--shadow-pop)] sm:rounded-2xl', widths[size])}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 id={titleId} className="text-[20px] font-bold">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-1 text-[14px] text-ink-soft">
                {description}
              </div>
            )}
          </div>
          <button onClick={onClose} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Close dialog">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children && <div className="px-6 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-paper/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation dialog; with `reasonLabel` it collects a required reason (min 3 chars). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = true,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  loading?: boolean;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const id = useId();
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);
  const invalid = !!reasonLabel && reasonRequired && reason.trim().length < 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep as is
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (!invalid) onConfirm(reasonLabel ? reason.trim() || undefined : undefined);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {reasonLabel && (
        <Field label={reasonLabel} htmlFor={id} error={touched && invalid ? 'Give a short reason (3+ characters). It is saved in the audit log.' : undefined} hint="Saved in the audit log.">
          <Textarea id={id} data-autofocus value={reason} placeholder={reasonPlaceholder} onChange={(e) => setReason(e.target.value)} invalid={touched && invalid} maxLength={300} />
        </Field>
      )}
    </Modal>
  );
}

// ───────────────────────── Data display ─────────────────────────

export function Metric({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'warn' | 'good' }) {
  return (
    <div className="card glow px-4 py-3.5" data-spotlight="">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={cx('tabular mt-1 font-display text-[28px] font-bold leading-none', tone === 'warn' ? 'text-amber-ink' : tone === 'good' ? 'text-green-ink' : 'text-ink')}>{typeof value === 'number' ? <CountUp value={value} /> : value}</p>
      {sub && <p className="mt-1.5 text-[12.5px] text-ink-soft">{sub}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-line bg-paper-2/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors', value === o.value ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink')}
        >
          {o.label}
          {o.count !== undefined && <span className={cx('tabular rounded-full px-1.5 text-[11.5px]', value === o.value ? 'bg-teal-50 text-teal-700' : 'bg-white/70 text-muted')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export { Avatar } from './kit';
