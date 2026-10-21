import { activeRemainderSec, computeEta, estimateConsultDuration, ETA_MAX_SAMPLES } from '../domain/eta';
import { predictOrder, selectNext } from '../domain/queuePolicy';
import type { Actor, DoctorQueueState } from '../domain/types';
import type { Repos, TicketWithPatient } from '../repositories/types';
import { errors } from '../shared/errors';
import { isValidDateString } from '../shared/time';
import { mean, median } from '../shared/util';
import { audit, Effects, getClinic, notify, today, type Deps } from './context';

export interface QueueSnapshot {
  doctor: { id: string; code: string; name: string; avatarUrl: string | null; department: string; room: string; avgMinutes: number; status: string; clinicId: string; userId: string };
  serviceDate: string;
  state: Pick<DoctorQueueState, 'appointmentStreak' | 'activeTicketId' | 'paused' | 'pauseReason' | 'pausedAt'>;
  ratio: number;
  estimate: { expectedSec: number; basis: 'ROLLING_MEDIAN' | 'DEFAULT'; samples: number };
  tickets: TicketWithPatient[];
  active: TicketWithPatient | null;
  opensAt: Date | null;
  preOpenSec: number;
  /** WAITING tickets in the exact order the policy will call them, with ETA. */
  ordered: Array<{ ticket: TicketWithPatient; position: number; ahead: number; eta: ReturnType<typeof computeEta> }>;
}

/** Computes positions and ETAs from persisted state. Derived values are never stored as truth. */
export async function snapshotQueue(repos: Repos, doctorId: string, serviceDate: string, now: Date): Promise<QueueSnapshot> {
  const doctor = await repos.doctors.findById(doctorId);
  if (!doctor) throw errors.notFound('Doctor');
  const clinic = await getClinic(repos, doctor.clinicId);
  const stateRow = await repos.queueStates.find(doctorId, serviceDate);
  const state = stateRow ?? { appointmentStreak: 0, activeTicketId: null, paused: false, pauseReason: null, pausedAt: null };
  const tickets = await repos.tickets.listForDoctorDate(doctorId, serviceDate);
  const durations = await repos.consultations.recentDurations(doctorId, ETA_MAX_SAMPLES);
  const estimate = estimateConsultDuration(durations, doctor.avgMinutes);
  const active =
    tickets.find((t) => t.id === state.activeTicketId && (t.status === 'CALLED' || t.status === 'IN_CONSULTATION')) ??
    tickets.find((t) => t.status === 'IN_CONSULTATION' || t.status === 'CALLED') ??
    null;
  const waiting = tickets.filter((t) => t.status === 'WAITING');
  const order = predictOrder(waiting, state.appointmentStreak, clinic.walkInRatio);
  const activeRemainder = activeRemainderSec(active ? { status: active.status as 'CALLED' | 'IN_CONSULTATION', startedAt: active.startedAt } : null, estimate.expectedSec, now);
  // Until the doctor calls the first patient of the day, waits also include time until the session opens.
  const slotsToday = await repos.slots.listForDoctorDate(doctorId, serviceDate);
  const opensAt = slotsToday[0]?.startAt ?? null;
  const anyCalled = tickets.some((t) => t.calledAt);
  const preOpenSec = !anyCalled && !active && opensAt ? Math.max(0, Math.round((opensAt.getTime() - now.getTime()) / 1000)) : 0;
  const remainderSec = Math.max(activeRemainder, preOpenSec);
  const ordered = order.map((ticket, i) => ({
    ticket,
    position: i + 1,
    ahead: i,
    eta: computeEta({ ahead: i, expectedSec: estimate.expectedSec, remainderSec, paused: state.paused }),
  }));
  return {
    doctor: {
      id: doctor.id,
      code: doctor.code,
      name: doctor.user.name,
      avatarUrl: doctor.user.avatarUrl,
      department: doctor.department,
      room: doctor.room,
      avgMinutes: doctor.avgMinutes,
      status: doctor.status,
      clinicId: doctor.clinicId,
      userId: doctor.userId,
    },
    serviceDate,
    state,
    opensAt,
    preOpenSec,
    ratio: clinic.walkInRatio,
    estimate,
    tickets,
    active,
    ordered,
  };
}

function ticketStaffView(t: TicketWithPatient) {
  return {
    id: t.id,
    tokenLabel: t.tokenLabel,
    tokenNumber: t.tokenNumber,
    source: t.source,
    status: t.status,
    patient: { id: t.patient.id, name: t.patient.name, avatarUrl: t.patient.avatarUrl ?? null },
    appointmentId: t.appointmentId,
    scheduledAt: t.scheduledAt,
    checkedInAt: t.checkedInAt,
    calledAt: t.calledAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    isLate: t.isLate,
    statusReason: t.statusReason,
  };
}

export class QueueService {
  constructor(private d: Deps) {}

  private assertDoctorAccess(actor: Actor, doctorId: string, opts: { allowReception: boolean; allowAdmin: boolean }) {
    if (actor.role === 'DOCTOR') {
      if (actor.doctorId !== doctorId) throw errors.forbidden('You can only manage your own queue.');
      return;
    }
    if (actor.role === 'RECEPTIONIST' && opts.allowReception) return;
    if (actor.role === 'ADMIN' && opts.allowAdmin) return;
    throw errors.forbidden();
  }

  private async resolveDate(actor: Actor, date?: string) {
    if (date && !isValidDateString(date)) throw errors.validation('Use a date in YYYY-MM-DD format.');
    const clinic = await getClinic(this.d.store, actor.clinicId);
    return date ?? today(clinic, this.d.clock);
  }

  /** Staff view of one doctor's day (role-filtered: patient names for staff only). */
  async doctorQueue(actor: Actor, doctorId: string, date?: string) {
    this.assertDoctorAccess(actor, doctorId, { allowReception: true, allowAdmin: true });
    const serviceDate = await this.resolveDate(actor, date);
    const snap = await snapshotQueue(this.d.store, doctorId, serviceDate, this.d.clock.now());
    if (snap.doctor.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
    const done = snap.tickets.filter((t) => t.status === 'COMPLETED' && t.startedAt && t.completedAt);
    const consultSecs = done.map((t) => (t.completedAt!.getTime() - t.startedAt!.getTime()) / 1000);
    const waitSecs = snap.tickets.filter((t) => t.calledAt).map((t) => (t.calledAt!.getTime() - t.checkedInAt.getTime()) / 1000);
    return {
      doctor: snap.doctor,
      serviceDate,
      paused: snap.state.paused,
      pauseReason: snap.state.pauseReason,
      pausedAt: snap.state.pausedAt,
      opensAt: snap.opensAt,
      notStartedYet: snap.preOpenSec > 0,
      policy: { scheduledPerWalkIn: snap.ratio, appointmentStreak: snap.state.appointmentStreak },
      estimate: snap.estimate,
      active: snap.active ? ticketStaffView(snap.active) : null,
      waiting: snap.ordered.map((o) => ({ ...ticketStaffView(o.ticket), position: o.position, eta: o.eta })),
      others: snap.tickets.filter((t) => !['WAITING', 'CALLED', 'IN_CONSULTATION'].includes(t.status)).map(ticketStaffView),
      stats: {
        total: snap.tickets.length,
        completed: done.length,
        waiting: snap.ordered.length,
        skipped: snap.tickets.filter((t) => t.status === 'SKIPPED').length,
        avgConsultSec: mean(consultSecs),
        medianConsultSec: median(consultSecs),
        avgWaitSec: mean(waitSecs),
      },
    };
  }

  /** Patient view: only the caller's own tickets, position and ETA. Other patients appear only as counts. */
  async myQueue(actor: Actor) {
    const { store, clock } = this.d;
    const clinic = await getClinic(store, actor.clinicId);
    const serviceDate = today(clinic, clock);
    const now = clock.now();
    const mine = await store.tickets.listActiveForPatient(actor.id, serviceDate);
    const items = [];
    for (const t of mine) {
      const snap = await snapshotQueue(store, t.doctorId, serviceDate, now);
      const entry = snap.ordered.find((o) => o.ticket.id === t.id);
      items.push({
        ticketId: t.id,
        tokenLabel: t.tokenLabel,
        status: t.status,
        source: t.source,
        checkedInAt: t.checkedInAt,
        calledAt: t.calledAt,
        startedAt: t.startedAt,
        scheduledAt: t.scheduledAt,
        doctor: { id: t.doctor.id, code: t.doctor.code, name: t.doctor.user.name, avatarUrl: t.doctor.user.avatarUrl, department: t.doctor.department, room: t.doctor.room },
        position: entry?.position ?? null,
        ahead: entry?.ahead ?? null,
        eta: t.status === 'WAITING' ? entry?.eta ?? null : null,
        paused: snap.state.paused,
        pauseReason: snap.state.paused ? snap.state.pauseReason : null,
        opensAt: snap.opensAt,
        notStartedYet: snap.preOpenSec > 0,
        nowServing: snap.active ? { tokenLabel: snap.active.tokenLabel, status: snap.active.status } : null,
        waitingTotal: snap.ordered.length,
        estimateBasis: snap.estimate.basis,
        expectedConsultMin: Math.round(snap.estimate.expectedSec / 60),
      });
    }
    return { serviceDate, timezone: clinic.timezone, tickets: items };
  }

  /** Atomic select-and-call (blueprint §10.3). Two rapid clicks cannot both claim a ticket. */
  async callNext(actor: Actor, doctorId: string) {
    this.assertDoctorAccess(actor, doctorId, { allowReception: true, allowAdmin: false });
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const result = await store.transaction(async (tx) => {
      const now = clock.now();
      const clinic = await getClinic(tx, actor.clinicId);
      const serviceDate = today(clinic, clock);
      const doctor = await tx.doctors.findById(doctorId);
      if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
      const state = await tx.queueStates.getOrCreate(doctorId, serviceDate);
      if (state.paused) throw errors.conflict('DOCTOR_PAUSED', 'The queue is paused. Resume it before calling the next patient.');
      if (state.activeTicketId) {
        const current = await tx.tickets.findById(state.activeTicketId);
        if (current && (current.status === 'CALLED' || current.status === 'IN_CONSULTATION')) {
          throw errors.conflict('CONSULTATION_ACTIVE', `Token ${current.tokenLabel} is still ${current.status === 'CALLED' ? 'called' : 'in consultation'}. Finish it first.`);
        }
      }
      const tickets = await tx.tickets.listForDoctorDate(doctorId, serviceDate);
      const waiting = tickets.filter((t) => t.status === 'WAITING');
      const { chosen, nextStreak } = selectNext(waiting, state.appointmentStreak, clinic.walkInRatio);
      if (!chosen) throw errors.conflict('NO_PATIENTS_WAITING', 'No one is waiting right now.');
      const ok = await tx.tickets.transition(chosen.id, ['WAITING'], 'CALLED', { calledAt: now });
      if (!ok) throw errors.conflict('INVALID_STATE', 'That ticket was just updated. Try again.');
      await tx.queueStates.update(doctorId, serviceDate, { appointmentStreak: nextStreak, activeTicketId: chosen.id });
      await audit(tx, actor, 'QUEUE_CALLED', 'QueueTicket', chosen.id, {
        before: { status: 'WAITING', streak: state.appointmentStreak },
        after: { status: 'CALLED', streak: nextStreak, source: chosen.source },
      });
      const notes = [
        { userId: chosen.patientId, kind: 'CALLED', title: `Token ${chosen.tokenLabel}: it's your turn`, message: `Please go to ${doctor.room} to see ${doctor.user.name}.` },
      ];
      // Tell whoever is now first in line, so they can head back to the waiting area.
      const remaining = waiting.filter((w) => w.id !== chosen.id);
      const nextUp = predictOrder(remaining, nextStreak, clinic.walkInRatio)[0];
      if (nextUp) {
        notes.push({ userId: nextUp.patientId, kind: 'UP_NEXT', title: `Token ${nextUp.tokenLabel}: you're next`, message: `${doctor.user.name} will call you after the current visit.` });
      }
      await notify(tx, fx, notes);
      fx.emit({ type: 'queue.changed', doctorId, serviceDate });
      return { ticketId: chosen.id, tokenLabel: chosen.tokenLabel, source: chosen.source, patientName: chosen.patient.name };
    });
    fx.flush(events);
    return result;
  }

  private async loadTicketForDoctor(tx: Repos, actor: Actor, ticketId: string, allowReception: boolean) {
    const ticket = await tx.tickets.findById(ticketId);
    if (!ticket) throw errors.notFound('Ticket');
    const doctor = await tx.doctors.findById(ticket.doctorId);
    if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Ticket');
    this.assertDoctorAccess(actor, ticket.doctorId, { allowReception, allowAdmin: false });
    return { ticket, doctor };
  }

  async start(actor: Actor, ticketId: string) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const { ticket } = await this.loadTicketForDoctor(tx, actor, ticketId, false);
      const ok = await tx.tickets.transition(ticket.id, ['CALLED'], 'IN_CONSULTATION', { startedAt: now });
      if (!ok) throw errors.conflict('INVALID_STATE', `Token ${ticket.tokenLabel} is ${ticket.status.toLowerCase().replace('_', ' ')}; only a called patient can be started.`);
      await tx.consultations.create({ queueTicketId: ticket.id, doctorId: ticket.doctorId, startedAt: now });
      await tx.queueStates.update(ticket.doctorId, ticket.serviceDate, { activeTicketId: ticket.id });
      await audit(tx, actor, 'CONSULT_STARTED', 'QueueTicket', ticket.id, { before: { status: 'CALLED' }, after: { status: 'IN_CONSULTATION' } });
      fx.emit({ type: 'queue.changed', doctorId: ticket.doctorId, serviceDate: ticket.serviceDate });
      return { ticketId: ticket.id, status: 'IN_CONSULTATION', startedAt: now };
    });
    fx.flush(events);
    return out;
  }

  async complete(actor: Actor, ticketId: string) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const { ticket, doctor } = await this.loadTicketForDoctor(tx, actor, ticketId, false);
      if (ticket.status !== 'IN_CONSULTATION' || !ticket.startedAt) {
        throw errors.conflict('INVALID_STATE', `Token ${ticket.tokenLabel} is not in consultation.`);
      }
      const durationSec = Math.max(0, Math.round((now.getTime() - ticket.startedAt.getTime()) / 1000));
      const ok = await tx.tickets.transition(ticket.id, ['IN_CONSULTATION'], 'COMPLETED', { completedAt: now });
      if (!ok) throw errors.conflict('INVALID_STATE', 'This visit was already completed.');
      await tx.consultations.complete(ticket.id, now, durationSec);
      if (ticket.appointmentId) {
        await tx.appointments.transition(ticket.appointmentId, ['CHECKED_IN'], 'COMPLETED', { completedAt: now });
      }
      const state = await tx.queueStates.getOrCreate(ticket.doctorId, ticket.serviceDate);
      if (state.activeTicketId === ticket.id) await tx.queueStates.update(ticket.doctorId, ticket.serviceDate, { activeTicketId: null });
      await audit(tx, actor, 'CONSULT_COMPLETED', 'QueueTicket', ticket.id, {
        before: { status: 'IN_CONSULTATION' },
        after: { status: 'COMPLETED', durationSec },
      });
      await notify(tx, fx, [
        { userId: ticket.patientId, kind: 'VISIT_COMPLETED', title: 'Visit completed', message: `Your visit with ${doctor.user.name} is complete. Thank you for using MediQueue.` },
      ]);
      fx.emit({ type: 'queue.changed', doctorId: ticket.doctorId, serviceDate: ticket.serviceDate });
      fx.emit({ type: 'appointments.changed', doctorId: ticket.doctorId, serviceDate: ticket.serviceDate });
      return { ticketId: ticket.id, status: 'COMPLETED', durationSec };
    });
    fx.flush(events);
    return out;
  }

  /** CALLED → WAITING ("called in error") or SKIPPED → WAITING (patient came back). Reason required. */
  async requeue(actor: Actor, ticketId: string, reason: string) {
    const { store, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const { ticket } = await this.loadTicketForDoctor(tx, actor, ticketId, true);
      if (!['CALLED', 'SKIPPED'].includes(ticket.status)) throw errors.conflict('INVALID_STATE', 'Only a called or skipped ticket can be returned to the waiting list.');
      const ok = await tx.tickets.transition(ticket.id, [ticket.status], 'WAITING', { calledAt: null, statusReason: reason });
      if (!ok) throw errors.conflict('INVALID_STATE', 'This ticket changed in the meantime.');
      const state = await tx.queueStates.getOrCreate(ticket.doctorId, ticket.serviceDate);
      if (state.activeTicketId === ticket.id) await tx.queueStates.update(ticket.doctorId, ticket.serviceDate, { activeTicketId: null });
      await audit(tx, actor, 'QUEUE_REQUEUED', 'QueueTicket', ticket.id, { before: { status: ticket.status }, after: { status: 'WAITING' }, reason });
      fx.emit({ type: 'queue.changed', doctorId: ticket.doctorId, serviceDate: ticket.serviceDate });
      return { ticketId: ticket.id, status: 'WAITING' };
    });
    fx.flush(events);
    return out;
  }

  /** WAITING/CALLED → SKIPPED: patient temporarily absent. They keep their token and can be requeued. */
  async skip(actor: Actor, ticketId: string, reason: string) {
    const { store, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const { ticket } = await this.loadTicketForDoctor(tx, actor, ticketId, true);
      const ok = await tx.tickets.transition(ticket.id, ['WAITING', 'CALLED'], 'SKIPPED', { statusReason: reason });
      if (!ok) throw errors.conflict('INVALID_STATE', 'Only a waiting or called ticket can be marked absent.');
      const state = await tx.queueStates.getOrCreate(ticket.doctorId, ticket.serviceDate);
      if (state.activeTicketId === ticket.id) await tx.queueStates.update(ticket.doctorId, ticket.serviceDate, { activeTicketId: null });
      await audit(tx, actor, 'QUEUE_SKIPPED', 'QueueTicket', ticket.id, { before: { status: ticket.status }, after: { status: 'SKIPPED' }, reason });
      await notify(tx, fx, [
        { userId: ticket.patientId, kind: 'SKIPPED', title: `Token ${ticket.tokenLabel} marked absent`, message: 'We could not find you when called. Please see reception to rejoin the queue.' },
      ]);
      fx.emit({ type: 'queue.changed', doctorId: ticket.doctorId, serviceDate: ticket.serviceDate });
      return { ticketId: ticket.id, status: 'SKIPPED' };
    });
    fx.flush(events);
    return out;
  }

  async setPaused(actor: Actor, doctorId: string, paused: boolean, reason?: string) {
    this.assertDoctorAccess(actor, doctorId, { allowReception: false, allowAdmin: true });
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const clinic = await getClinic(tx, actor.clinicId);
      const serviceDate = today(clinic, clock);
      const doctor = await tx.doctors.findById(doctorId);
      if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
      const state = await tx.queueStates.getOrCreate(doctorId, serviceDate);
      if (state.paused === paused) throw errors.conflict('INVALID_STATE', paused ? 'The queue is already paused.' : 'The queue is not paused.');
      await tx.queueStates.update(doctorId, serviceDate, paused ? { paused: true, pauseReason: reason ?? null, pausedAt: now } : { paused: false, pauseReason: null, pausedAt: null });
      await audit(tx, actor, paused ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED', 'Doctor', doctorId, {
        before: { paused: state.paused },
        after: { paused },
        reason: reason ?? null,
      });
      const waiting = (await tx.tickets.listForDoctorDate(doctorId, serviceDate)).filter((t) => t.status === 'WAITING');
      await notify(
        tx,
        fx,
        waiting.map((t) => ({
          userId: t.patientId,
          kind: paused ? 'QUEUE_PAUSED' : 'QUEUE_RESUMED',
          title: paused ? `${doctor.user.name} has paused the queue` : `${doctor.user.name} is seeing patients again`,
          message: paused
            ? `Your token ${t.tokenLabel} is safe. Waiting time is unavailable until the queue resumes.${reason ? ` Reason: ${reason}` : ''}`
            : `Your token ${t.tokenLabel} is active and your waiting estimate has been updated.`,
        })),
      );
      fx.emit({ type: 'queue.changed', doctorId, serviceDate });
      return { doctorId, paused, reason: paused ? reason ?? null : null };
    });
    fx.flush(events);
    return out;
  }
}
