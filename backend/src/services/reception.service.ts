import bcrypt from 'bcryptjs';
import type { Actor } from '../domain/types';
import { UniqueViolation, type Repos } from '../repositories/types';
import { errors } from '../shared/errors';
import { isValidDateString, localTime } from '../shared/time';
import { randomToken, uuid } from '../shared/util';
import { appointmentView } from './booking.service';
import { audit, Effects, getClinic, notify, pad3, today, type Deps } from './context';
import { snapshotQueue } from './queue.service';

export class ReceptionService {
  constructor(private d: Deps) {}

  /** After a ticket is inserted, snapshot its predicted wait (and a fixed-duration baseline) for evaluation. */
  private async snapshotPrediction(tx: Repos, ticketId: string, doctorId: string, serviceDate: string, defaultMinutes: number) {
    const snap = await snapshotQueue(tx, doctorId, serviceDate, this.d.clock.now());
    const entry = snap.ordered.find((o) => o.ticket.id === ticketId);
    if (!entry) return { position: null, eta: null };
    const baseline = (entry.ahead + (snap.active ? 1 : 0)) * defaultMinutes * 60 + snap.preOpenSec;
    await tx.tickets.transition(ticketId, ['WAITING'], 'WAITING', {
      predictedWaitSec: entry.eta.waitSec,
      baselineWaitSec: baseline,
    });
    return { position: entry.position, eta: entry.eta };
  }

  /** Check-in (blueprint §6.2): validates day and lateness, then issues exactly one token. Safe to repeat. */
  async checkIn(actor: Actor, appointmentId: string, overrideReason?: string) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const clinic = await getClinic(tx, actor.clinicId);
      const appt = await tx.appointments.findFull(appointmentId);
      if (!appt) throw errors.notFound('Appointment');
      if (appt.status === 'CHECKED_IN' || appt.ticket) {
        // Repeat check-in returns the existing token rather than issuing a second one.
        const t = appt.ticket ?? (await tx.tickets.findByAppointment(appt.id));
        return { alreadyCheckedIn: true, ticket: t ? { id: t.id, tokenLabel: t.tokenLabel, status: t.status } : null, position: null, eta: null };
      }
      if (appt.status !== 'BOOKED') throw errors.conflict('INVALID_STATE', `This appointment is ${appt.status.toLowerCase().replace('_', ' ')} and cannot be checked in.`);
      const serviceDate = today(clinic, clock);
      if (appt.serviceDate !== serviceDate) {
        throw errors.unprocessable('CHECKIN_WINDOW_CLOSED', `Check-in opens on the appointment day (${appt.serviceDate}).`);
      }
      const lateBy = (now.getTime() - appt.slot.startAt.getTime()) / 60000;
      const isLate = lateBy > clinic.lateAfterMinutes;
      if (isLate && !overrideReason) {
        throw errors.unprocessable('LATE_ARRIVAL_REASON_REQUIRED', `Patient is ${Math.round(lateBy)} minutes late. Add a reason to admit them.`);
      }
      const doctor = await tx.doctors.findById(appt.doctorId);
      if (!doctor) throw errors.notFound('Doctor');

      const n = await tx.counters.next(doctor.id, serviceDate); // allocated in the same transaction as the ticket
      let ticket;
      try {
        ticket = await tx.tickets.create({
          doctorId: doctor.id,
          serviceDate,
          tokenNumber: n,
          tokenLabel: `${doctor.code}-${pad3(n)}`,
          patientId: appt.patientId,
          appointmentId: appt.id,
          source: 'SCHEDULED',
          status: 'WAITING',
          scheduledAt: appt.slot.startAt,
          checkedInAt: now,
          isLate,
        });
      } catch (e) {
        if (e instanceof UniqueViolation) throw errors.conflict('INVALID_STATE', 'This appointment was checked in by someone else just now.');
        throw e;
      }
      const ok = await tx.appointments.transition(appt.id, ['BOOKED'], 'CHECKED_IN', {
        checkedInAt: now,
        lateOverrideReason: isLate ? overrideReason ?? null : null,
      });
      if (!ok) throw errors.conflict('INVALID_STATE', 'This appointment changed in the meantime.');
      const pred = await this.snapshotPrediction(tx, ticket.id, doctor.id, serviceDate, clinic.defaultConsultMinutes);
      await audit(tx, actor, 'CHECKED_IN', 'Appointment', appt.id, {
        before: { status: 'BOOKED' },
        after: { status: 'CHECKED_IN', token: ticket.tokenLabel, late: isLate },
        reason: isLate ? overrideReason : null,
      });
      const waitText = pred.eta?.status === 'OK' && pred.eta.waitSec !== null ? ` Estimated wait about ${Math.round(pred.eta.waitSec / 60)} min.` : '';
      await notify(tx, fx, [
        { userId: appt.patientId, kind: 'CHECKED_IN', title: `You're checked in: token ${ticket.tokenLabel}`, message: `Please wait for ${doctor.user.name} (${doctor.room}).${waitText}` },
      ]);
      fx.emit({ type: 'queue.changed', doctorId: doctor.id, serviceDate });
      fx.emit({ type: 'appointments.changed', doctorId: doctor.id, serviceDate });
      return { alreadyCheckedIn: false, ticket: { id: ticket.id, tokenLabel: ticket.tokenLabel, status: 'WAITING' }, position: pred.position, eta: pred.eta };
    });
    fx.flush(events);
    return out;
  }

  /** Walk-in (blueprint §6.4): issues a WALK_IN ticket without inventing a reservation. */
  async walkIn(actor: Actor, input: { doctorId: string; patientId?: string; newPatient?: { name: string; phone?: string | null } }) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    // Hash outside the transaction so the write lock is held briefly.
    const placeholderHash = input.newPatient ? await bcrypt.hash(randomToken(24), this.d.bcryptRounds) : null;
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const clinic = await getClinic(tx, actor.clinicId);
      const serviceDate = today(clinic, clock);
      const doctor = await tx.doctors.findById(input.doctorId);
      if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
      if (doctor.status !== 'ACTIVE') throw errors.conflict('DOCTOR_INACTIVE', `${doctor.user.name} is not seeing patients.`);

      let patientId = input.patientId;
      let patientName: string;
      if (patientId) {
        const p = await tx.users.findById(patientId);
        if (!p || p.role !== 'PATIENT' || p.clinicId !== actor.clinicId) throw errors.notFound('Patient');
        patientName = p.name;
      } else if (input.newPatient) {
        const p = await tx.users.create({
          email: `walkin-${uuid().slice(0, 8)}@walkin.mediqueue.test`,
          passwordHash: placeholderHash!, // random secret: the profile cannot sign in
          name: input.newPatient.name,
          phone: input.newPatient.phone ?? null,
          role: 'PATIENT',
          clinicId: actor.clinicId,
        });
        patientId = p.id;
        patientName = p.name;
        await audit(tx, actor, 'WALKIN_PROFILE_CREATED', 'User', p.id, { after: { name: p.name } });
      } else {
        throw errors.validation('Choose an existing patient or enter a new walk-in name.');
      }

      if (await tx.tickets.findActiveWalkIn(patientId, doctor.id, serviceDate)) {
        throw errors.conflict('DUPLICATE_BOOKING', `${patientName} is already in ${doctor.user.name}'s queue today.`);
      }
      const appt = await tx.appointments.findActiveForPatientDoctorDate(patientId, doctor.id, serviceDate);
      if (appt) {
        throw errors.conflict('DUPLICATE_BOOKING', `${patientName} has a booking with ${doctor.user.name} today. Check in that appointment instead.`);
      }

      const n = await tx.counters.next(doctor.id, serviceDate);
      const ticket = await tx.tickets.create({
        doctorId: doctor.id,
        serviceDate,
        tokenNumber: n,
        tokenLabel: `${doctor.code}-${pad3(n)}`,
        patientId,
        appointmentId: null,
        source: 'WALK_IN',
        status: 'WAITING',
        scheduledAt: null,
        checkedInAt: now,
        isLate: false,
      });
      const pred = await this.snapshotPrediction(tx, ticket.id, doctor.id, serviceDate, clinic.defaultConsultMinutes);
      await audit(tx, actor, 'WALKIN_REGISTERED', 'QueueTicket', ticket.id, { after: { token: ticket.tokenLabel, doctorId: doctor.id, patientId } });
      await notify(tx, fx, [
        { userId: patientId, kind: 'CHECKED_IN', title: `Walk-in registered: token ${ticket.tokenLabel}`, message: `Please wait for ${doctor.user.name} (${doctor.room}).` },
      ]);
      fx.emit({ type: 'queue.changed', doctorId: doctor.id, serviceDate });
      return { ticket: { id: ticket.id, tokenLabel: ticket.tokenLabel, status: 'WAITING', source: 'WALK_IN' }, patient: { id: patientId, name: patientName }, position: pred.position, eta: pred.eta };
    });
    fx.flush(events);
    return out;
  }

  /** No-show (blueprint §5.4). Before the grace period ends, staff must give an override reason. */
  async markNoShow(actor: Actor | null, appointmentId: string, reason?: string, opts: { system?: boolean } = {}) {
    const { store, clock, events } = this.d;
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const appt = await tx.appointments.findFull(appointmentId);
      if (!appt) throw errors.notFound('Appointment');
      const clinicId = actor?.clinicId ?? (await tx.doctors.findById(appt.doctorId))!.clinicId;
      const clinic = await getClinic(tx, clinicId);
      if (appt.status !== 'BOOKED') throw errors.conflict('INVALID_STATE', `Only a booked appointment that was not checked in can be marked no-show (current: ${appt.status}).`);
      const graceEnds = new Date(appt.slot.startAt.getTime() + clinic.graceMinutes * 60000);
      if (now < graceEnds && (!reason || opts.system)) {
        throw errors.unprocessable('GRACE_PERIOD_ACTIVE', `The ${clinic.graceMinutes}-minute grace period ends at ${localTime(graceEnds, clinic.timezone)}. Add a reason to override.`);
      }
      const ok = await tx.appointments.transition(appt.id, ['BOOKED'], 'NO_SHOW', { noShowAt: now });
      if (!ok) throw errors.conflict('INVALID_STATE', 'This appointment changed in the meantime.');
      await audit(tx, actor, 'NO_SHOW_MARKED', 'Appointment', appt.id, {
        before: { status: 'BOOKED' },
        after: { status: 'NO_SHOW', automatic: !!opts.system },
        reason: reason ?? (opts.system ? `Grace period of ${clinic.graceMinutes} min elapsed` : null),
      });
      await notify(tx, fx, [
        {
          userId: appt.patientId,
          kind: 'NO_SHOW',
          title: 'Missed appointment',
          message: `We didn't see you for your ${localTime(appt.slot.startAt, clinic.timezone)} visit with ${appt.doctor.user.name}. You can book a new slot any time.`,
        },
      ]);
      fx.emit({ type: 'appointments.changed', doctorId: appt.doctorId, serviceDate: appt.serviceDate });
      return { appointmentId: appt.id, status: 'NO_SHOW' };
    });
    fx.flush(events);
    return out;
  }

  /** Background job body: marks overdue BOOKED appointments as NO_SHOW when the clinic enables it. */
  async runAutoNoShow(): Promise<number> {
    const { store, clock } = this.d;
    const clinic = await store.clinics.getDefault();
    if (!clinic?.autoNoShow) return 0;
    const cutoff = new Date(clock.now().getTime() - clinic.graceMinutes * 60000);
    const overdue = await store.appointments.listBookedStartingBefore(cutoff);
    let n = 0;
    for (const a of overdue) {
      try {
        await this.markNoShow(null, a.id, undefined, { system: true });
        n++;
      } catch {
        /* changed concurrently — skip */
      }
    }
    return n;
  }

  async today(actor: Actor, date?: string) {
    const { store, clock } = this.d;
    if (date && !isValidDateString(date)) throw errors.validation('Use a date in YYYY-MM-DD format.');
    const clinic = await getClinic(store, actor.clinicId);
    const serviceDate = date ?? today(clinic, clock);
    const isToday = serviceDate === today(clinic, clock);
    const now = clock.now();
    const appts = await store.appointments.listForDate(serviceDate);
    const doctors = await store.doctors.list({ clinicId: actor.clinicId });
    const tickets = await store.tickets.listForDate(serviceDate);

    const queues = await Promise.all(
      doctors.map(async (doc) => {
        const snap = await snapshotQueue(store, doc.id, serviceDate, now);
        return {
          id: doc.id,
          code: doc.code,
          name: doc.user.name,
          avatarUrl: doc.user.avatarUrl,
          department: doc.department,
          room: doc.room,
          paused: snap.state.paused,
          pauseReason: snap.state.pauseReason,
          active: snap.active ? { id: snap.active.id, tokenLabel: snap.active.tokenLabel, status: snap.active.status, patientName: snap.active.patient.name, patientAvatarUrl: snap.active.patient.avatarUrl ?? null } : null,
          waiting: snap.ordered.map((o) => ({
            id: o.ticket.id,
            tokenLabel: o.ticket.tokenLabel,
            source: o.ticket.source,
            patientName: o.ticket.patient.name,
            patientAvatarUrl: o.ticket.patient.avatarUrl ?? null,
            position: o.position,
            etaMin: o.eta.waitSec === null ? null : Math.round(o.eta.waitSec / 60),
            checkedInAt: o.ticket.checkedInAt,
          })),
          skipped: snap.tickets.filter((t) => t.status === 'SKIPPED').map((t) => ({ id: t.id, tokenLabel: t.tokenLabel, patientName: t.patient.name, reason: t.statusReason })),
          completed: snap.tickets.filter((t) => t.status === 'COMPLETED').length,
          expectedConsultMin: Math.round(snap.estimate.expectedSec / 60),
        };
      }),
    );

    const rows = appts.map((a) => {
      const v = appointmentView(a);
      const minsFromStart = (now.getTime() - a.slot.startAt.getTime()) / 60000;
      return {
        ...v,
        patient: { id: a.patient.id, name: a.patient.name, phone: a.patient.phone ?? null, avatarUrl: a.patient.avatarUrl ?? null },
        flags: {
          canCheckIn: isToday && a.status === 'BOOKED',
          late: a.status === 'BOOKED' && isToday && minsFromStart > clinic.lateAfterMinutes,
          noShowEligible: a.status === 'BOOKED' && minsFromStart > clinic.graceMinutes,
          minutesLate: a.status === 'BOOKED' && minsFromStart > 0 ? Math.round(minsFromStart) : 0,
        },
      };
    });

    const count = (s: string) => appts.filter((a) => a.status === s).length;
    return {
      serviceDate,
      isToday,
      policy: { graceMinutes: clinic.graceMinutes, lateAfterMinutes: clinic.lateAfterMinutes, walkInRatio: clinic.walkInRatio },
      counts: {
        booked: count('BOOKED'),
        checkedIn: count('CHECKED_IN'),
        completed: count('COMPLETED'),
        cancelled: count('CANCELLED'),
        noShow: count('NO_SHOW'),
        walkIns: tickets.filter((t) => t.source === 'WALK_IN').length,
        waiting: tickets.filter((t) => t.status === 'WAITING').length,
        overdue: rows.filter((r) => r.flags.noShowEligible).length,
      },
      appointments: rows,
      walkIns: tickets
        .filter((t) => t.source === 'WALK_IN')
        .map((t) => ({ id: t.id, tokenLabel: t.tokenLabel, status: t.status, doctorCode: t.doctor.code, doctorName: t.doctor.user.name, checkedInAt: t.checkedInAt })),
      queues,
    };
  }

  async searchPatients(actor: Actor, q: string) {
    const list = await this.d.store.users.list({ clinicId: actor.clinicId, roles: ['PATIENT'], q: q || undefined, limit: 20 });
    return list.filter((u) => u.isActive).map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, phone: u.phone, email: u.email.endsWith('walkin.mediqueue.test') ? null : u.email }));
  }
}
