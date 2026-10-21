import bcrypt from 'bcryptjs';
import type { Actor, Clinic, QueueTicket } from '../domain/types';
import { UniqueViolation } from '../repositories/types';
import { errors } from '../shared/errors';
import { addDays, isoWeekday, isValidDateString, localTime, serviceDateOf, zonedTimeToUtc } from '../shared/time';
import { mean, median, percentile, toCsv } from '../shared/util';
import { audit, Effects, getClinic, pad3, today, type Deps } from './context';

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const toMin = (sec: number | null) => (sec === null ? null : round1(sec / 60));

function waitSec(t: QueueTicket) {
  return t.calledAt ? (t.calledAt.getTime() - t.checkedInAt.getTime()) / 1000 : null;
}
function consultSec(t: QueueTicket) {
  return t.startedAt && t.completedAt ? (t.completedAt.getTime() - t.startedAt.getTime()) / 1000 : null;
}

export class AdminService {
  constructor(private d: Deps) {}

  private async dateOrToday(actor: Actor, date?: string) {
    if (date && !isValidDateString(date)) throw errors.validation('Use a date in YYYY-MM-DD format.');
    const clinic = await getClinic(this.d.store, actor.clinicId);
    return { clinic, date: date ?? today(clinic, this.d.clock) };
  }

  // ───────────────────────────── Metrics ─────────────────────────────

  async metrics(actor: Actor, dateArg?: string) {
    const { store } = this.d;
    const { clinic, date } = await this.dateOrToday(actor, dateArg);
    const trendFrom = addDays(date, -6);
    const [appts, tickets, slots, doctors] = await Promise.all([
      store.appointments.listForDateRange(trendFrom, date),
      store.tickets.listForDateRange(trendFrom, date),
      store.slots.listForDateRange(trendFrom, date),
      store.doctors.list({ clinicId: actor.clinicId, includeInactive: true }),
    ]);
    const dayAppts = appts.filter((a) => a.serviceDate === date);
    const dayTickets = tickets.filter((t) => t.serviceDate === date);
    const daySlots = slots.filter((s) => s.serviceDate === date);

    const waits = dayTickets.map(waitSec).filter((x): x is number => x !== null);
    const consults = dayTickets.map(consultSec).filter((x): x is number => x !== null);
    const etaPairs = dayTickets
      .filter((t) => t.predictedWaitSec !== null && t.calledAt)
      .map((t) => ({ token: t.tokenLabel, predictedMin: toMin(t.predictedWaitSec)!, baselineMin: toMin(t.baselineWaitSec), actualMin: toMin(waitSec(t))! }));
    const mae = (key: 'predictedMin' | 'baselineMin') => {
      const errs = etaPairs.filter((p) => p[key] !== null).map((p) => Math.abs((p[key] as number) - p.actualMin));
      return round1(mean(errs));
    };
    const count = (s: string) => dayAppts.filter((a) => a.status === s).length;
    const capacity = daySlots.reduce((a, s) => a + s.capacity, 0);
    const reserved = daySlots.reduce((a, s) => a + s.reservedCount, 0);

    const hourly = new Map<string, { hour: string; arrivals: number; completed: number }>();
    for (let h = 7; h <= 20; h++) hourly.set(String(h).padStart(2, '0'), { hour: `${String(h).padStart(2, '0')}:00`, arrivals: 0, completed: 0 });
    for (const t of dayTickets) {
      const a = localTime(t.checkedInAt, clinic.timezone).slice(0, 2);
      if (!hourly.has(a)) hourly.set(a, { hour: `${a}:00`, arrivals: 0, completed: 0 });
      hourly.get(a)!.arrivals++;
      if (t.completedAt) {
        const c = localTime(t.completedAt, clinic.timezone).slice(0, 2);
        if (!hourly.has(c)) hourly.set(c, { hour: `${c}:00`, arrivals: 0, completed: 0 });
        hourly.get(c)!.completed++;
      }
    }

    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(date, -i);
      const ta = appts.filter((a) => a.serviceDate === d);
      const tt = tickets.filter((t) => t.serviceDate === d);
      const w = tt.map(waitSec).filter((x): x is number => x !== null);
      const errs = tt.filter((t) => t.predictedWaitSec !== null && t.calledAt).map((t) => Math.abs(t.predictedWaitSec! - waitSec(t)!));
      trend.push({
        date: d,
        appointments: ta.filter((a) => a.status !== 'CANCELLED').length,
        completed: tt.filter((t) => t.status === 'COMPLETED').length,
        noShows: ta.filter((a) => a.status === 'NO_SHOW').length,
        walkIns: tt.filter((t) => t.source === 'WALK_IN').length,
        avgWaitMin: toMin(mean(w)),
        etaMaeMin: toMin(mean(errs)),
      });
    }

    const perDoctor = doctors.map((doc) => {
      const dt = dayTickets.filter((t) => t.doctorId === doc.id);
      const da = dayAppts.filter((a) => a.doctorId === doc.id);
      const ds = daySlots.filter((s) => s.doctorId === doc.id);
      const cap = ds.reduce((a, s) => a + s.capacity, 0);
      return {
        doctorId: doc.id,
        code: doc.code,
        name: doc.user.name,
        avatarUrl: doc.user.avatarUrl,
        department: doc.department,
        status: doc.status,
        appointments: da.filter((a) => a.status !== 'CANCELLED').length,
        walkIns: dt.filter((t) => t.source === 'WALK_IN').length,
        completed: dt.filter((t) => t.status === 'COMPLETED').length,
        waiting: dt.filter((t) => t.status === 'WAITING').length,
        noShows: da.filter((a) => a.status === 'NO_SHOW').length,
        avgWaitMin: toMin(mean(dt.map(waitSec).filter((x): x is number => x !== null))),
        avgConsultMin: toMin(mean(dt.map(consultSec).filter((x): x is number => x !== null))),
        utilization: cap ? round1((ds.reduce((a, s) => a + s.reservedCount, 0) / cap) * 100) : null,
      };
    });

    const nonCancelled = dayAppts.filter((a) => a.status !== 'CANCELLED').length;
    // Contiguous hour axis covering clinic hours and any activity outside them.
    const present = [...hourly.keys()].map(Number);
    const lo = Math.min(7, ...present);
    const hi = Math.max(20, ...present);
    const hourAxis = [];
    for (let h = lo; h <= hi; h++) {
      const k = String(h).padStart(2, '0');
      hourAxis.push(hourly.get(k) ?? { hour: `${k}:00`, arrivals: 0, completed: 0 });
    }
    return {
      date,
      timezone: clinic.timezone,
      totals: {
        appointments: nonCancelled,
        booked: count('BOOKED'),
        checkedIn: count('CHECKED_IN'),
        completed: dayTickets.filter((t) => t.status === 'COMPLETED').length,
        cancelled: count('CANCELLED'),
        noShows: count('NO_SHOW'),
        walkIns: dayTickets.filter((t) => t.source === 'WALK_IN').length,
        waitingNow: dayTickets.filter((t) => t.status === 'WAITING').length,
        noShowRate: nonCancelled ? round1((count('NO_SHOW') / nonCancelled) * 100) : null,
        slotUtilization: capacity ? round1((reserved / capacity) * 100) : null,
      },
      waits: {
        meanMin: toMin(mean(waits)),
        medianMin: toMin(median(waits)),
        p90Min: toMin(percentile(waits, 90)),
        samples: waits.length,
      },
      consults: { meanMin: toMin(mean(consults)), medianMin: toMin(median(consults)), samples: consults.length },
      eta: { maeMin: mae('predictedMin'), baselineMaeMin: mae('baselineMin'), samples: etaPairs.length, points: etaPairs },
      hourly: hourAxis,
      trend,
      perDoctor,
    };
  }

  async dailyCsv(actor: Actor, dateArg?: string) {
    const { store } = this.d;
    const { clinic, date } = await this.dateOrToday(actor, dateArg);
    const appts = await store.appointments.listForDate(date);
    const tickets = await store.tickets.listForDate(date);
    const headers = [
      'service_date', 'doctor_code', 'doctor_name', 'department', 'token', 'source', 'patient_ref',
      'appointment_status', 'ticket_status', 'slot_start_local', 'checked_in_local', 'called_local',
      'started_local', 'completed_local', 'wait_min', 'consult_min', 'predicted_wait_min', 'eta_abs_error_min', 'late',
    ];
    const lt = (d: Date | null | undefined) => (d ? localTime(d, clinic.timezone) : '');
    const rows: unknown[][] = [];
    const seen = new Set<string>();
    for (const a of appts) {
      const t = tickets.find((x) => x.appointmentId === a.id);
      if (t) seen.add(t.id);
      const w = t ? waitSec(t) : null;
      rows.push([
        date, a.doctor.code, a.doctor.user.name, a.doctor.department, t?.tokenLabel ?? '', 'SCHEDULED',
        a.patientId.slice(0, 8), a.status, t?.status ?? '', lt(a.slot.startAt), lt(t?.checkedInAt), lt(t?.calledAt),
        lt(t?.startedAt), lt(t?.completedAt), toMin(w) ?? '', t ? toMin(consultSec(t)) ?? '' : '',
        t ? toMin(t.predictedWaitSec) ?? '' : '', t && t.predictedWaitSec !== null && w !== null ? toMin(Math.abs(t.predictedWaitSec - w)) : '',
        t?.isLate ? 'yes' : 'no',
      ]);
    }
    for (const t of tickets.filter((x) => !seen.has(x.id))) {
      const w = waitSec(t);
      rows.push([
        date, t.doctor.code, t.doctor.user.name, t.doctor.department, t.tokenLabel, t.source, t.patientId.slice(0, 8),
        '', t.status, '', lt(t.checkedInAt), lt(t.calledAt), lt(t.startedAt), lt(t.completedAt), toMin(w) ?? '',
        toMin(consultSec(t)) ?? '', toMin(t.predictedWaitSec) ?? '',
        t.predictedWaitSec !== null && w !== null ? toMin(Math.abs(t.predictedWaitSec - w)) : '', 'no',
      ]);
    }
    await store.audit.create({ actorId: actor.id, actorRole: actor.role, action: 'REPORT_EXPORTED', entityType: 'Report', entityId: `daily-${date}`, reason: null, beforeJson: null, afterJson: JSON.stringify({ rows: rows.length }) });
    return { filename: `mediqueue-daily-${date}.csv`, csv: toCsv(headers, rows) };
  }

  async auditLog(actor: Actor, q: { action?: string; entityType?: string; actorId?: string; from?: string; to?: string; page: number; pageSize: number }) {
    const clinic = await getClinic(this.d.store, actor.clinicId);
    const from = q.from ? zonedTimeToUtc(q.from, '00:00', clinic.timezone) : undefined;
    const to = q.to ? zonedTimeToUtc(addDays(q.to, 1), '00:00', clinic.timezone) : undefined;
    const { items, total } = await this.d.store.audit.list({ action: q.action, entityType: q.entityType, actorId: q.actorId, from, to }, q.page, q.pageSize);
    return {
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: items.map((e) => ({
        id: e.id,
        at: e.at,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        reason: e.reason,
        actor: e.actor ? { id: e.actorId, name: e.actor.name, avatarUrl: e.actor.avatarUrl, role: e.actorRole } : { id: null, name: 'System', role: e.actorRole ?? 'SYSTEM' },
        before: e.beforeJson ? JSON.parse(e.beforeJson) : null,
        after: e.afterJson ? JSON.parse(e.afterJson) : null,
      })),
    };
  }

  // ───────────────────────────── Doctors & staff ─────────────────────────────

  async listDoctors(actor: Actor) {
    const { store, clock } = this.d;
    const clinic = await getClinic(store, actor.clinicId);
    const from = today(clinic, clock);
    const doctors = await store.doctors.list({ clinicId: actor.clinicId, includeInactive: true });
    return Promise.all(
      doctors.map(async (doc) => {
        const slots = await store.slots.listForDoctorRange(doc.id, from, addDays(from, 13));
        const state = await store.queueStates.find(doc.id, from);
        return {
          id: doc.id,
          code: doc.code,
          name: doc.user.name,
          avatarUrl: doc.user.avatarUrl,
          email: doc.user.email,
          department: doc.department,
          room: doc.room,
          avgMinutes: doc.avgMinutes,
          bio: doc.bio,
          status: doc.status,
          pausedToday: state?.paused ?? false,
          upcomingSlots: slots.length,
          upcomingBooked: slots.reduce((a, s) => a + s.reservedCount, 0),
          upcomingDays: [...new Set(slots.map((s) => s.serviceDate))].length,
        };
      }),
    );
  }

  async createDoctor(actor: Actor, input: { name: string; email: string; password: string; department: string; room: string; avgMinutes: number; bio?: string | null }) {
    const { store, events } = this.d;
    const passwordHash = await bcrypt.hash(input.password, this.d.bcryptRounds);
    try {
      const out = await store.transaction(async (tx) => {
        const existing = await tx.doctors.list({ clinicId: actor.clinicId, includeInactive: true });
        const max = existing.reduce((m, d) => Math.max(m, Number(d.code.replace(/\D/g, '')) || 0), 0);
        const code = `D${String(max + 1).padStart(2, '0')}`;
        const user = await tx.users.create({ email: input.email, passwordHash, name: input.name, role: 'DOCTOR', clinicId: actor.clinicId });
        const doctor = await tx.doctors.create({
          userId: user.id,
          clinicId: actor.clinicId,
          code,
          department: input.department,
          room: input.room,
          avgMinutes: input.avgMinutes,
          bio: input.bio ?? null,
        });
        await audit(tx, actor, 'DOCTOR_CREATED', 'Doctor', doctor.id, { after: { code, name: input.name, department: input.department, room: input.room } });
        return { id: doctor.id, code, name: user.name, email: user.email };
      });
      events.publish({ type: 'doctors.changed' });
      return out;
    } catch (e) {
      if (e instanceof UniqueViolation) throw errors.conflict('EMAIL_TAKEN', 'That email is already used by another account.');
      throw e;
    }
  }

  async updateDoctor(actor: Actor, doctorId: string, patch: { name?: string; department?: string; room?: string; avgMinutes?: number; bio?: string | null; status?: 'ACTIVE' | 'INACTIVE' }) {
    const { store, events, clock } = this.d;
    const out = await store.transaction(async (tx) => {
      const doc = await tx.doctors.findById(doctorId);
      if (!doc || doc.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
      const { name, ...docPatch } = patch;
      if (name) await tx.users.update(doc.userId, { name });
      await tx.doctors.update(doctorId, docPatch);
      const before = { name: doc.user.name, department: doc.department, room: doc.room, avgMinutes: doc.avgMinutes, status: doc.status };
      const action = patch.status && patch.status !== doc.status ? (patch.status === 'INACTIVE' ? 'DOCTOR_DEACTIVATED' : 'DOCTOR_REACTIVATED') : 'DOCTOR_UPDATED';
      await audit(tx, actor, action, 'Doctor', doctorId, { before, after: { ...before, ...patch } });
      let futureBookings = 0;
      if (patch.status === 'INACTIVE') {
        const clinic = await getClinic(tx, actor.clinicId);
        const slots = await tx.slots.listForDoctorRange(doctorId, today(clinic, clock), addDays(today(clinic, clock), 60));
        futureBookings = slots.reduce((a, s) => a + s.reservedCount, 0);
      }
      return { id: doctorId, futureBookings };
    });
    events.publish({ type: 'doctors.changed' });
    return out;
  }

  async listStaff(actor: Actor) {
    const users = await this.d.store.users.list({ clinicId: actor.clinicId, roles: ['ADMIN', 'RECEPTIONIST', 'DOCTOR'], limit: 200 });
    const patients = await this.d.store.users.list({ clinicId: actor.clinicId, roles: ['PATIENT'], limit: 1000 });
    return {
      staff: users.map((u) => ({ id: u.id, name: u.name, avatarUrl: u.avatarUrl, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt })),
      patientCount: patients.length,
    };
  }

  async createStaff(actor: Actor, input: { name: string; email: string; password: string; role: 'RECEPTIONIST' | 'ADMIN' }) {
    const { store } = this.d;
    const passwordHash = await bcrypt.hash(input.password, this.d.bcryptRounds);
    try {
      return await store.transaction(async (tx) => {
        const u = await tx.users.create({ email: input.email, passwordHash, name: input.name, role: input.role, clinicId: actor.clinicId });
        await audit(tx, actor, 'STAFF_CREATED', 'User', u.id, { after: { name: u.name, role: u.role, email: u.email } });
        return { id: u.id, name: u.name, email: u.email, role: u.role };
      });
    } catch (e) {
      if (e instanceof UniqueViolation) throw errors.conflict('EMAIL_TAKEN', 'That email is already used by another account.');
      throw e;
    }
  }

  async setUserActive(actor: Actor, userId: string, isActive: boolean) {
    if (userId === actor.id) throw errors.conflict('INVALID_STATE', 'You cannot deactivate your own account.');
    return this.d.store.transaction(async (tx) => {
      const u = await tx.users.findById(userId);
      if (!u || u.clinicId !== actor.clinicId) throw errors.notFound('User');
      await tx.users.update(userId, { isActive });
      if (!isActive) await tx.sessions.deleteForUser(userId);
      await audit(tx, actor, isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'User', userId, { before: { isActive: u.isActive }, after: { isActive } });
      return { id: userId, isActive };
    });
  }

  // ───────────────────────────── Slots ─────────────────────────────

  async doctorSlots(actor: Actor, doctorId: string, from: string, to: string) {
    const doc = await this.d.store.doctors.findById(doctorId);
    if (!doc || doc.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
    const slots = await this.d.store.slots.listForDoctorRange(doctorId, from, to);
    return slots.map((s) => ({ id: s.id, serviceDate: s.serviceDate, startAt: s.startAt, endAt: s.endAt, capacity: s.capacity, reservedCount: s.reservedCount }));
  }

  /** Generates slots in clinic-local time, skipping any that overlap existing slots or have already started. */
  async generateSlots(actor: Actor, input: { doctorId: string; fromDate: string; toDate: string; startTime: string; endTime: string; slotMinutes: number; capacity: number; weekdays: number[] }) {
    const { store, clock, events } = this.d;
    if (input.toDate < input.fromDate) throw errors.validation('End date must be on or after the start date.');
    if (input.endTime <= input.startTime) throw errors.validation('End time must be after start time.');
    const clinic = await getClinic(store, actor.clinicId);
    const span = (Date.parse(input.toDate) - Date.parse(input.fromDate)) / 86400000;
    if (span > 62) throw errors.validation('Generate at most 62 days at a time.');
    const fx = new Effects();
    const out = await store.transaction(async (tx) => {
      const now = clock.now();
      const doc = await tx.doctors.findById(input.doctorId);
      if (!doc || doc.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
      const existing = await tx.slots.listForDoctorRange(doc.id, input.fromDate, input.toDate);
      const toCreate: Array<{ doctorId: string; serviceDate: string; startAt: Date; endAt: Date; capacity: number }> = [];
      let conflicts = 0;
      let past = 0;
      for (let d = input.fromDate; d <= input.toDate; d = addDays(d, 1)) {
        if (!input.weekdays.includes(isoWeekday(d))) continue;
        const dayEnd = zonedTimeToUtc(d, input.endTime, clinic.timezone);
        let start = zonedTimeToUtc(d, input.startTime, clinic.timezone);
        while (start.getTime() + input.slotMinutes * 60000 <= dayEnd.getTime()) {
          const end = new Date(start.getTime() + input.slotMinutes * 60000);
          const overlaps = existing.some((s) => s.startAt < end && s.endAt > start) || toCreate.some((s) => s.startAt < end && s.endAt > start);
          if (start <= now) past++;
          else if (overlaps) conflicts++;
          else toCreate.push({ doctorId: doc.id, serviceDate: serviceDateOf(start, clinic.timezone), startAt: start, endAt: end, capacity: input.capacity });
          start = end;
        }
      }
      const created = await tx.slots.createMany(toCreate);
      await audit(tx, actor, 'SLOTS_GENERATED', 'Doctor', doc.id, { after: { ...input, created, conflicts, past } });
      for (const day of new Set(toCreate.map((s) => s.serviceDate))) fx.emit({ type: 'appointments.changed', doctorId: doc.id, serviceDate: day });
      return { created, skippedConflicts: conflicts, skippedPast: past };
    });
    fx.flush(events);
    return out;
  }

  async deleteSlot(actor: Actor, slotId: string) {
    return this.d.store.transaction(async (tx) => {
      const slot = await tx.slots.findById(slotId);
      if (!slot) throw errors.notFound('Slot');
      const doc = await tx.doctors.findById(slot.doctorId);
      if (!doc || doc.clinicId !== actor.clinicId) throw errors.notFound('Slot');
      const ok = await tx.slots.deleteIfUnreserved(slotId);
      if (!ok) throw errors.conflict('INVALID_STATE', 'This slot has bookings. Cancel them before removing the slot.');
      await audit(tx, actor, 'SLOT_DELETED', 'Slot', slotId, { before: { startAt: slot.startAt, doctorId: slot.doctorId } });
      return { id: slotId, deleted: true };
    });
  }

  // ───────────────────────────── Settings ─────────────────────────────

  async settings(actor: Actor) {
    return getClinic(this.d.store, actor.clinicId);
  }

  async updateSettings(actor: Actor, patch: Partial<Pick<Clinic, 'name' | 'walkInRatio' | 'graceMinutes' | 'lateAfterMinutes' | 'autoNoShow' | 'defaultConsultMinutes' | 'bookingHorizonDays'>>) {
    return this.d.store.transaction(async (tx) => {
      const before = await getClinic(tx, actor.clinicId);
      const after = await tx.clinics.update(actor.clinicId, patch);
      await audit(tx, actor, 'SETTINGS_UPDATED', 'Clinic', actor.clinicId, {
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Clinic]])),
        after: patch,
      });
      return after;
    });
  }
}

export { pad3 };
