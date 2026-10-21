import type { Actor, Clinic } from '../domain/types';
import type { DomainEvent, EventBus } from '../events/eventBus';
import type { Repos, Store } from '../repositories/types';
import { errors } from '../shared/errors';
import { serviceDateOf } from '../shared/time';
import type { Clock } from '../shared/util';

export interface Deps {
  store: Store;
  clock: Clock;
  events: EventBus;
  bcryptRounds: number;
}

/** Collects side effects inside a transaction and publishes them only after commit. */
export class Effects {
  private events: DomainEvent[] = [];
  emit(e: DomainEvent) {
    this.events.push(e);
  }
  flush(bus: EventBus) {
    const seen = new Set<string>();
    for (const e of this.events) {
      const k = JSON.stringify(e);
      if (!seen.has(k)) {
        seen.add(k);
        bus.publish(e);
      }
    }
    this.events = [];
  }
}

export async function audit(
  tx: Repos,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string,
  opts: { before?: unknown; after?: unknown; reason?: string | null; at?: Date } = {},
) {
  await tx.audit.create({
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? 'SYSTEM',
    action,
    entityType,
    entityId,
    reason: opts.reason ?? null,
    beforeJson: opts.before === undefined ? null : JSON.stringify(opts.before),
    afterJson: opts.after === undefined ? null : JSON.stringify(opts.after),
    at: opts.at,
  });
}

export async function notify(
  tx: Repos,
  fx: Effects,
  items: Array<{ userId: string; kind: string; title: string; message: string }>,
) {
  await tx.notifications.createMany(items);
  for (const i of items) fx.emit({ type: 'notification.created', userId: i.userId });
}

export async function getClinic(repos: Repos, clinicId: string): Promise<Clinic> {
  const c = await repos.clinics.get(clinicId);
  if (!c) throw errors.notFound('Clinic');
  return c;
}

export function today(clinic: Clinic, clock: Clock): string {
  return serviceDateOf(clock.now(), clinic.timezone);
}

export const pad3 = (n: number) => String(n).padStart(3, '0');
