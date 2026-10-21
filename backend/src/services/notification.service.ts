import type { Actor } from '../domain/types';
import { errors } from '../shared/errors';
import { getClinic, today, type Deps } from './context';
import { snapshotQueue } from './queue.service';

export class NotificationService {
  constructor(private d: Deps) {}

  async list(actor: Actor) {
    const [items, unread] = await Promise.all([
      this.d.store.notifications.listForUser(actor.id, 40),
      this.d.store.notifications.unreadCount(actor.id),
    ]);
    return { unread, items: items.map(({ userId: _u, ...n }) => n) };
  }

  async markRead(actor: Actor, id: string) {
    const ok = await this.d.store.notifications.markRead(id, actor.id, this.d.clock.now());
    if (!ok) throw errors.notFound('Notification'); // also covers other users' notifications
    return { id, read: true };
  }

  async markAllRead(actor: Actor) {
    const n = await this.d.store.notifications.markAllRead(actor.id, this.d.clock.now());
    return { updated: n };
  }
}

/** Public waiting-room board: token labels and doctor rooms only — never patient identity. */
export class BoardService {
  constructor(private d: Deps) {}

  async board() {
    const { store, clock } = this.d;
    const clinic = await store.clinics.getDefault();
    if (!clinic) throw errors.notFound('Clinic');
    const serviceDate = today(clinic, clock);
    const now = clock.now();
    const doctors = await store.doctors.list({ clinicId: clinic.id });
    const rows = await Promise.all(
      doctors.map(async (doc) => {
        const snap = await snapshotQueue(store, doc.id, serviceDate, now);
        return {
          code: doc.code,
          doctorName: doc.user.name,
          department: doc.department,
          room: doc.room,
          paused: snap.state.paused,
          nowServing: snap.active ? { tokenLabel: snap.active.tokenLabel, status: snap.active.status } : null,
          upNext: snap.ordered.slice(0, 4).map((o) => o.ticket.tokenLabel),
          waitingCount: snap.ordered.length,
          opensAt: snap.opensAt,
          notStartedYet: snap.preOpenSec > 0,
          approxWaitMin: snap.state.paused ? null : Math.round(((snap.ordered.length ? snap.ordered[snap.ordered.length - 1].eta.waitSec ?? 0 : 0) / 60)),
        };
      }),
    );
    return { clinicName: clinic.name, serviceDate, timezone: clinic.timezone, generatedAt: now, doctors: rows };
  }
}

export async function clinicToday(d: Deps, actor: Actor) {
  const clinic = await getClinic(d.store, actor.clinicId);
  return today(clinic, d.clock);
}
