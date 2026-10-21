import { BellRing } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../app/toast';
import { playChime } from '../../components/motion';
import { useMyQueue } from './hooks';

/**
 * Runs on every patient page: when one of the patient's tokens is called it plays a chime,
 * vibrates (phones), flashes the tab title and, if the patient allowed it, shows a system notification.
 */
export function PatientCallAlerts() {
  const q = useMyQueue();
  const toast = useToast();
  const prev = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const tickets = q.data?.tickets;
    if (!tickets) return;
    const before = prev.current;
    prev.current = new Map(tickets.map((t) => [t.ticketId, t.status]));
    if (!before) return; // first load: don't alert for an existing state
    const called = tickets.find((t) => t.status === 'CALLED' && before.get(t.ticketId) !== 'CALLED');
    if (!called) return;

    playChime();
    navigator.vibrate?.([200, 100, 200]);
    toast({ tone: 'success', title: `Token ${called.tokenLabel}: it's your turn`, body: `Please go to ${called.doctor.room} to see ${called.doctor.name}.` });
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        new Notification(`Token ${called.tokenLabel}: it's your turn`, { body: `Please go to ${called.doctor.room}.`, tag: called.ticketId });
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    }
    const original = document.title;
    let on = false;
    const timer = window.setInterval(() => {
      on = !on;
      document.title = on ? `● Your turn: ${called.doctor.room}` : original;
    }, 900);
    const stop = () => {
      window.clearInterval(timer);
      document.title = original;
    };
    const onVisible = () => !document.hidden && setTimeout(stop, 4000);
    document.addEventListener('visibilitychange', onVisible);
    const auto = window.setTimeout(stop, 30_000);
    return () => {
      stop();
      window.clearTimeout(auto);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [q.data, toast]);

  return null;
}

/** Small opt-in for system notifications (browsers require a user gesture). */
export function EnableAlertsButton() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(supported ? Notification.permission : 'unsupported');
  if (perm !== 'default') {
    return perm === 'granted' ? <p className="text-[12.5px] text-green-ink">Alerts on: you'll be notified when you're called.</p> : null;
  }
  return (
    <button
      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-teal hover:underline"
      onClick={async () => {
        playChime(); // also unlocks audio for later alerts
        setPerm(await Notification.requestPermission());
      }}
    >
      <BellRing className="h-4 w-4" aria-hidden /> Alert me when I'm called
    </button>
  );
}
