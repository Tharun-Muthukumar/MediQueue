/**
 * Motion & cursor layer. Everything here is decorative and switches itself off for
 * touch devices (pointer: coarse) and for people who ask the OS for reduced motion.
 */
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cx } from './ui';

const mq = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
export const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)');
export const hasFinePointer = () => mq('(pointer: fine)');
export const motionAllowed = () => !prefersReducedMotion() && hasFinePointer();

const INTERACTIVE = 'a, button, [role="button"], [role="tab"], [role="option"], [role="switch"], select, label[for], summary, [data-cursor="hover"]';
const TEXTY = 'input:not([type="checkbox"]):not([type="radio"]):not([type="date"]):not([type="time"]), textarea';

/**
 * A soft ring that trails the pointer and reacts to what is underneath:
 * grows over clickable things, narrows to a caret over text fields, squeezes on press.
 * The native cursor stays visible, so precision is never lost.
 */
export function CursorFollower() {
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const update = () => setEnabled(motionAllowed());
    update();
    const a = window.matchMedia('(prefers-reduced-motion: reduce)');
    const b = window.matchMedia('(pointer: fine)');
    a.addEventListener?.('change', update);
    b.addEventListener?.('change', update);
    return () => {
      a.removeEventListener?.('change', update);
      b.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let x = -100;
    let y = -100;
    let rx = -100;
    let ry = -100;
    let raf = 0;
    let visible = false;
    let mode: 'idle' | 'hover' | 'text' | 'dark' = 'idle';
    let down = false;

    const paint = () => {
      rx += (x - rx) * 0.2;
      ry += (y - ry) * 0.2;
      const scale = down ? 0.75 : mode === 'hover' ? 1.65 : mode === 'text' ? 0.6 : 1;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%) scale(${scale})`;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      raf = requestAnimationFrame(paint);
    };
    const setMode = (m: typeof mode) => {
      if (m === mode) return;
      mode = m;
      ring.current?.setAttribute('data-mode', m);
    };
    const classify = (t: Element | null) => {
      const onDark = !!t?.closest?.('[data-surface="dark"]');
      ring.current?.setAttribute('data-surface', onDark ? 'dark' : 'light');
      if (t?.closest?.(TEXTY)) setMode('text');
      else if (t?.closest?.(INTERACTIVE)) setMode('hover');
      else setMode('idle');
    };
    // After scrolling, whatever is under the pointer has changed even though the mouse hasn't moved.
    const onScroll = () => visible && classify(document.elementFromPoint(x, y));
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      if (!visible) {
        visible = true;
        rx = x;
        ry = y;
        ring.current?.classList.add('is-visible');
        dot.current?.classList.add('is-visible');
      }
      classify(e.target as Element | null);
    };
    const onLeave = () => {
      visible = false;
      ring.current?.classList.remove('is-visible');
      dot.current?.classList.remove('is-visible');
    };
    const onDown = () => (down = true);
    const onUp = () => (down = false);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    raf = requestAnimationFrame(paint);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden />
      <div ref={dot} className="cursor-dot" aria-hidden />
    </>
  );
}

/**
 * Pointer-position CSS variables (--mx, --my in px, --px, --py in 0..1) on any element
 * marked data-spotlight, used for glow borders and hero spotlights. One listener app-wide.
 */
export function SpotlightTracker() {
  useEffect(() => {
    if (!motionAllowed()) return;
    let last: HTMLElement | null = null;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-spotlight]') as HTMLElement | null;
      if (last && last !== el) last.removeAttribute('data-lit');
      last = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      el.style.setProperty('--px', `${(e.clientX - r.left) / r.width}`);
      el.style.setProperty('--py', `${(e.clientY - r.top) / r.height}`);
      el.setAttribute('data-lit', '');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return null;
}

/** 3D tilt toward the pointer with a moving glare. */
export function Tilt({ children, max = 8, className, style, glare = true }: { children: ReactNode; max?: number; className?: string; style?: CSSProperties; glare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translateZ(0)`;
        el.style.setProperty('--gx', `${(px + 0.5) * 100}%`);
        el.style.setProperty('--gy', `${(py + 0.5) * 100}%`);
        el.setAttribute('data-tilting', '');
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.style.transform = '';
      el.removeAttribute('data-tilting');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [max]);
  return (
    <div ref={ref} className={cx('tilt', glare && 'tilt-glare', className)} style={style}>
      {children}
    </div>
  );
}

/** Pulls its child gently toward the pointer when it comes near. */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !motionAllowed()) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
    };
    const onLeave = () => (el.style.transform = '');
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [strength]);
  return (
    <span ref={ref} className={cx('magnetic inline-block', className)}>
      {children}
    </span>
  );
}

/** Fades content up the first time it scrolls into view. */
export function Reveal({ children, delay = 0, className, as: Tag = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'section' }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(() => prefersReducedMotion());
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (!('IntersectionObserver' in window)) return setShown(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={cx('reveal', shown && 'is-shown', className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

/** Animates a number when it first appears and whenever it changes. */
export function CountUp({ value, duration = 700, format = (n: number) => String(Math.round(n)) }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tabular">{format(shown)}</span>;
}

/** Thin progress bar at the very top while anything is loading or saving. */
export function TopProgress() {
  const fetching = useIsFetching({ predicate: (q) => q.state.status === 'pending' });
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (busy) {
      const t = setTimeout(() => setVisible(true), 120); // avoid flicker on instant responses
      return () => clearTimeout(t);
    }
    setVisible(false);
    return undefined;
  }, [busy]);
  return <div className={cx('top-progress', visible && 'is-active')} role="progressbar" aria-hidden={!visible} aria-label="Loading" />;
}

/** Re-mounts the page with a short enter animation on every route change. */
export function PageTransition({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <div key={loc.pathname} className="page-enter">
      {children}
    </div>
  );
}

/** A short two-note chime (no audio files needed). */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1318.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch {
    /* audio blocked until the user interacts — fine */
  }
}
