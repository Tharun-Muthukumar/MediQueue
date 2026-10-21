import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { API_BASE } from '../lib/api';

type LiveState = 'connecting' | 'live' | 'offline';
const LiveCtx = createContext<LiveState>('offline');

/**
 * Subscribes to the API's Server-Sent Events stream and invalidates the affected queries.
 * Events carry no personal data — they only say "this changed, refetch".
 * When the stream is down, queries fall back to 5-second polling (see usePollInterval).
 */
export function LiveProvider({ children, path = '/events', enabled = true }: { children: ReactNode; path?: string; enabled?: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let closed = false;
    const pending = new Set<string>();

    const flush = () => {
      timer.current = null;
      for (const k of pending) qc.invalidateQueries({ queryKey: [k] });
      pending.clear();
    };
    const schedule = (...keys: string[]) => {
      keys.forEach((k) => pending.add(k));
      // Batch bursts of events (e.g. check-in emits several) into one refetch.
      if (timer.current === null) timer.current = window.setTimeout(flush, 150);
    };

    const connect = () => {
      setState('connecting');
      es = new EventSource(`${API_BASE}${path}`, { withCredentials: true });
      es.addEventListener('ready', () => setState('live'));
      es.addEventListener('change', (ev) => {
        try {
          const e = JSON.parse((ev as MessageEvent).data) as { type: string };
          if (e.type === 'queue.changed') schedule('queue', 'myQueue', 'reception', 'board', 'metrics', 'doctors');
          else if (e.type === 'appointments.changed') schedule('reception', 'slots', 'appointments', 'doctors', 'metrics', 'myQueue');
          else if (e.type === 'notification.created') schedule('notifications', 'appointments', 'myQueue');
          else if (e.type === 'doctors.changed') schedule('doctors', 'adminDoctors', 'board');
        } catch {
          /* ignore malformed event */
        }
      });
      es.onerror = () => {
        setState('offline');
        // EventSource retries by itself; if the browser gave up, reconnect manually.
        if (es?.readyState === EventSource.CLOSED && !closed) window.setTimeout(connect, 4000);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [qc, path, enabled]);

  return <LiveCtx.Provider value={state}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

/** Poll quickly only while the live stream is unavailable. */
export function usePollInterval(fast = 5000, slow = 30000) {
  return useLive() === 'live' ? slow : fast;
}
