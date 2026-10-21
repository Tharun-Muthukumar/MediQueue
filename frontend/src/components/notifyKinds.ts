import {
  BellRing,
  CalendarCheck2,
  CalendarX2,
  CheckCircle2,
  DoorOpen,
  Hand,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Ticket,
  UserRoundX,
  type LucideIcon,
} from 'lucide-react';
import type { Tone } from './kit';

/** Icon + colour for each notification kind, shared by the bell menu and dashboards. */
export const NOTIFY_KINDS: Record<string, { icon: LucideIcon; tone: Tone }> = {
  WELCOME: { icon: Sparkles, tone: 'violet' },
  BOOKING_CONFIRMED: { icon: CalendarCheck2, tone: 'blue' },
  BOOKING_CANCELLED: { icon: CalendarX2, tone: 'slate' },
  CHECKED_IN: { icon: Ticket, tone: 'teal' },
  UP_NEXT: { icon: Hand, tone: 'amber' },
  CALLED: { icon: DoorOpen, tone: 'green' },
  VISIT_COMPLETED: { icon: CheckCircle2, tone: 'green' },
  SKIPPED: { icon: UserRoundX, tone: 'rose' },
  NO_SHOW: { icon: UserRoundX, tone: 'rose' },
  QUEUE_PAUSED: { icon: PauseCircle, tone: 'amber' },
  QUEUE_RESUMED: { icon: PlayCircle, tone: 'teal' },
};
export const notifyKind = (k: string) => NOTIFY_KINDS[k] ?? { icon: BellRing, tone: 'slate' as Tone };
