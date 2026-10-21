import { config } from '../config';
import type { Actor } from '../domain/types';
import type { AppointmentFull } from '../repositories/types';
import { errors } from '../shared/errors';
import { addDays, localDateLabel, localTime } from '../shared/time';
import { sha256, stableStringify } from '../shared/util';
import { audit, Effects, getClinic, notify, today, type Deps } from './context';

const BOOK_ROUTE = 'POST /appointments';

export function appointmentView(a: AppointmentFull) {
  return {
    id: a.id,
    status: a.status,
    serviceDate: a.serviceDate,
    bookedAt: a.bookedAt,
    checkedInAt: a.checkedInAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
    completedAt: a.completedAt,
    noShowAt: a.noShowAt,
    slot: { id: a.slot.id, startAt: a.slot.startAt, endAt: a.slot.endAt },
    doctor: { id: a.doctor.id, code: a.doctor.code, name: a.doctor.user.name, avatarUrl: a.doctor.user.avatarUrl, department: a.doctor.department, room: a.doctor.room },
    ticket: a.ticket ? { id: a.ticket.id, tokenLabel: a.ticket.tokenLabel, status: a.ticket.status } : null,
  };
}

export class BookingService {
  constructor(private d: Deps) {}

  /**
   * Books a slot for the signed-in patient (blueprint §6.1). Within ONE transaction:
   * idempotency lookup → validation → conditional capacity increment → appointment insert
   * → audit + notification → idempotency record. A failed guard rolls everything back.
   */
  async book(actor: Actor, slotId: string, idempotencyKey: string) {
    const { store, clock, events } = this.d;
    const requestHash = sha256(stableStringify({ slotId }));
    const fx = new Effects();
    const result = await store.transaction(async (tx) => {
      const prior = await tx.idempotency.find(actor.id, BOOK_ROUTE, idempotencyKey);
      if (prior) {
        if (prior.requestHash !== requestHash) {
          throw errors.conflict('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different booking. Refresh and try again.');
        }
        return { status: prior.responseCode, body: JSON.parse(prior.responseJson), replayed: true };
      }

      const now = clock.now();
      const clinic = await getClinic(tx, actor.clinicId);
      const slot = await tx.slots.findById(slotId);
      if (!slot) throw errors.notFound('Slot');
      const doctor = await tx.doctors.findById(slot.doctorId);
      if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Slot');
      if (doctor.status !== 'ACTIVE') throw errors.conflict('DOCTOR_INACTIVE', `${doctor.user.name} is not taking bookings right now.`);
      if (slot.startAt <= now) throw errors.conflict('SLOT_UNAVAILABLE', 'This slot has already started. Pick a later time.');
      if (slot.serviceDate > addDays(today(clinic, clock), clinic.bookingHorizonDays)) {
        throw errors.conflict('SLOT_UNAVAILABLE', `Bookings open ${clinic.bookingHorizonDays} days ahead.`);
      }
      const dup = await tx.appointments.findActiveForPatientDoctorDate(actor.id, doctor.id, slot.serviceDate);
      if (dup) throw errors.conflict('DUPLICATE_BOOKING', `You already have a booking with ${doctor.user.name} on this day.`);

      const reserved = await tx.slots.tryReserve(slot.id);
      if (!reserved) throw errors.conflict('SLOT_FULL', 'That appointment slot has just been filled.');

      const appt = await tx.appointments.create({
        patientId: actor.id,
        doctorId: doctor.id,
        slotId: slot.id,
        serviceDate: slot.serviceDate,
        status: 'BOOKED',
        bookedAt: now,
      });
      await audit(tx, actor, 'APPOINTMENT_BOOKED', 'Appointment', appt.id, { after: { slotId: slot.id, doctorId: doctor.id, status: 'BOOKED' } });
      await notify(tx, fx, [
        {
          userId: actor.id,
          kind: 'BOOKING_CONFIRMED',
          title: 'Appointment confirmed',
          message: `${doctor.user.name} on ${localDateLabel(slot.startAt, clinic.timezone)} at ${localTime(slot.startAt, clinic.timezone)}. Check in at reception when you arrive.`,
        },
      ]);
      fx.emit({ type: 'appointments.changed', doctorId: doctor.id, serviceDate: slot.serviceDate });

      const body = {
        data: {
          appointmentId: appt.id,
          doctorId: doctor.id,
          slotId: slot.id,
          status: appt.status,
          startAt: slot.startAt,
          endAt: slot.endAt,
          serviceDate: slot.serviceDate,
          doctorName: doctor.user.name,
        },
      };
      await tx.idempotency.create({
        key: idempotencyKey,
        userId: actor.id,
        route: BOOK_ROUTE,
        requestHash,
        responseCode: 201,
        responseJson: JSON.stringify(body),
        expiresAt: new Date(now.getTime() + config.idempotencyTtlHours * 3600_000),
      });
      return { status: 201, body, replayed: false };
    });
    fx.flush(events);
    return result;
  }

  async listMine(actor: Actor) {
    const list = await this.d.store.appointments.listForPatient(actor.id);
    return list.map(appointmentView);
  }

  /** Cancel (blueprint §6.5). Patients: own, BOOKED and in the future. Staff: any non-terminal, with reason. */
  async cancel(actor: Actor, appointmentId: string, reason: string | undefined) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const appt = await tx.appointments.findFull(appointmentId);
      // Patients get 404 (not 403) for other people's records so existence is not disclosed.
      if (!appt || (actor.role === 'PATIENT' && appt.patientId !== actor.id)) throw errors.notFound('Appointment');
      const clinic = await getClinic(tx, actor.clinicId);
      if (actor.role === 'PATIENT') {
        if (appt.status !== 'BOOKED') throw errors.conflict('INVALID_STATE', 'Only upcoming bookings can be cancelled online. Please speak to reception.');
        if (appt.slot.startAt <= now) throw errors.conflict('INVALID_STATE', 'This appointment has already started and can no longer be cancelled online.');
      } else {
        if (!['BOOKED', 'CHECKED_IN'].includes(appt.status)) throw errors.conflict('INVALID_STATE', `An appointment that is ${appt.status.toLowerCase().replace('_', ' ')} cannot be cancelled.`);
        if (!reason) throw errors.validation('A reason is required when staff cancel an appointment.');
        if (appt.ticket?.status === 'IN_CONSULTATION') throw errors.conflict('INVALID_STATE', 'This patient is with the doctor. Complete the visit instead.');
      }

      const ok = await tx.appointments.transition(appt.id, [appt.status], 'CANCELLED', {
        cancelledAt: now,
        cancelReason: reason ?? 'Cancelled by patient',
        cancelledById: actor.id,
      });
      if (!ok) throw errors.conflict('INVALID_STATE', 'This appointment changed in the meantime. Refresh and try again.');

      if (appt.status === 'BOOKED') {
        await tx.slots.release(appt.slotId); // capacity returns exactly once: the CAS above guards repeats
      }
      if (appt.ticket && ['WAITING', 'CALLED', 'SKIPPED'].includes(appt.ticket.status)) {
        await tx.tickets.transition(appt.ticket.id, ['WAITING', 'CALLED', 'SKIPPED'], 'CANCELLED', { statusReason: reason ?? 'Appointment cancelled' });
        const state = await tx.queueStates.find(appt.doctorId, appt.serviceDate);
        if (state?.activeTicketId === appt.ticket.id) await tx.queueStates.update(appt.doctorId, appt.serviceDate, { activeTicketId: null });
        fx.emit({ type: 'queue.changed', doctorId: appt.doctorId, serviceDate: appt.serviceDate });
      }
      await audit(tx, actor, 'APPOINTMENT_CANCELLED', 'Appointment', appt.id, {
        before: { status: appt.status },
        after: { status: 'CANCELLED' },
        reason: reason ?? null,
      });
      if (actor.role !== 'PATIENT') {
        await notify(tx, fx, [
          {
            userId: appt.patientId,
            kind: 'BOOKING_CANCELLED',
            title: 'Appointment cancelled',
            message: `Your visit with ${appt.doctor.user.name} on ${localDateLabel(appt.slot.startAt, clinic.timezone)} at ${localTime(appt.slot.startAt, clinic.timezone)} was cancelled by the clinic. Reason: ${reason}`,
          },
        ]);
      }
      fx.emit({ type: 'appointments.changed', doctorId: appt.doctorId, serviceDate: appt.serviceDate });
      return (await tx.appointments.findFull(appt.id))!;
    });
    fx.flush(events);
    return appointmentView(out);
  }
}
