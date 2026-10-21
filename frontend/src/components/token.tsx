import { Clock3, PauseCircle } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { etaRange, minutes, time } from '../lib/format';
import type { Eta } from '../lib/types';
import { Tilt } from './motion';
import { cx, StatusBadge } from './ui';

/** The paper queue token — MediQueue's signature element. */
export function TokenStub({
  token,
  status,
  caption,
  footer,
  size = 'lg',
  highlight,
  className,
  tilt = true,
}: {
  token: string;
  status?: string;
  caption?: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  highlight?: boolean;
  className?: string;
  tilt?: boolean;
}) {
  const [prefix, num] = token.includes('-') ? token.split('-') : ['', token];
  const sizes = { md: 'text-[44px]', lg: 'text-[68px]', xl: 'text-[96px]' };
  const stub = useRef<HTMLDivElement>(null);
  const tear = useRef<HTMLDivElement>(null);
  // Place the side notches exactly on the tear line, whatever the stub's height.
  useLayoutEffect(() => {
    const s = stub.current;
    const t = tear.current;
    if (!s || !t) return;
    const place = () => s.style.setProperty('--notch-y', `${t.offsetTop}px`);
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(s);
    return () => ro?.disconnect();
  }, []);
  return (
    <Tilt max={tilt ? 10 : 0} glare={false} className={cx('rounded-2xl', highlight && 'attention', className)}>
    <div ref={stub} className={cx('token-stub token-in', highlight && 'ring-2 ring-teal ring-offset-2 ring-offset-paper')}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <span className="text-[12.5px] font-semibold text-muted">Your token</span>
        {status && <StatusBadge status={status} />}
      </div>
      <div className="px-5 pb-6 pt-1" aria-label={`Token ${token}`}>
        <span className="font-display text-[15px] font-semibold text-teal">{prefix}</span>
        <div className={cx('token-number text-ink', sizes[size])}>{num}</div>
      </div>
      <div ref={tear} className="perforation" aria-hidden />
      <div className="px-5 pb-4 pt-5 text-[13.5px] text-ink-soft">{caption}</div>
      {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
    </div>
    </Tilt>
  );
}

export function EtaBlock({ eta, ahead, notStartedYet, opensAt, basis }: { eta: Eta | null; ahead: number | null; notStartedYet?: boolean; opensAt?: string | null; basis?: string }) {
  if (!eta) return null;
  if (eta.status === 'PAUSED') {
    return (
      <div className="flex items-start gap-3">
        <PauseCircle className="mt-0.5 h-6 w-6 text-amber-ink" aria-hidden />
        <div>
          <p className="font-display text-[22px] font-bold leading-tight text-amber-ink">Waiting time unavailable</p>
          <p className="text-[13.5px] text-ink-soft">The doctor has paused the queue. Your place is kept.</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[13px] font-medium text-muted">Estimated wait</p>
      <p className="tabular font-display text-[34px] font-bold leading-tight text-ink" aria-live="polite">
        {eta.highSec !== null && eta.highSec < 90 ? 'Any moment now' : etaRange(eta.lowSec, eta.highSec)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-soft">
        <Clock3 className="h-3.5 w-3.5" aria-hidden />
        {ahead === 0 ? "You're next in line" : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you`}
        {notStartedYet && opensAt ? `, doctor starts at ${time(opensAt)}` : ''}
      </p>
      <p className="mt-2 text-[12px] text-muted">
        Approximate, around {minutes(eta.waitSec)}. {basis === 'ROLLING_MEDIAN' ? "Based on this doctor's recent visit lengths." : "Based on the doctor's usual visit length."} Please stay nearby — order is set by reception policy, not by this estimate.
      </p>
    </div>
  );
}

export function PauseBanner({ reason, who = 'The doctor', title }: { reason?: string | null; who?: string; title?: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-ink/20 bg-amber-bg px-4 py-3 text-amber-ink">
      <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="text-[14px]">
        <p className="font-semibold">{title ?? `${who} has paused the queue`}</p>
        {reason && <p className="mt-0.5 text-amber-ink/85">Reason: {reason}</p>}
      </div>
    </div>
  );
}

export function Logo({ light, className }: { light?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill={light ? '#ffffff' : '#122643'} />
        <path d="M8 10h16v4a2 2 0 0 0 0 4v4H8v-4a2 2 0 0 0 0-4z" fill="#00A3A8" />
        <path d="M14 13h4v6h-4z" fill={light ? '#ffffff' : '#122643'} />
      </svg>
      <span className={cx('font-display text-[20px] font-bold tracking-tight', light ? 'text-white' : 'text-ink')}>MediQueue</span>
    </span>
  );
}
