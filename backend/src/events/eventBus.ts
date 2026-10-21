import { EventEmitter } from 'node:events';

/**
 * In-process event publisher. Locally it feeds Server-Sent Events; in AWS the same
 * `publish` call would become an EventBridge PutEvents. Payloads carry ids only —
 * clients refetch through authorised endpoints, so no patient data travels on the bus.
 */
export type DomainEvent =
  | { type: 'queue.changed'; doctorId: string; serviceDate: string }
  | { type: 'appointments.changed'; doctorId: string; serviceDate: string }
  | { type: 'notification.created'; userId: string }
  | { type: 'doctors.changed' };

export class EventBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(500);
  }
  publish(e: DomainEvent) {
    this.emitter.emit('event', e);
  }
  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
