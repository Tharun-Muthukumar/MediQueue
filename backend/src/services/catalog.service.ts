import type { Actor } from '../domain/types';
import { errors } from '../shared/errors';
import { addDays } from '../shared/time';
import { getClinic, today, type Deps } from './context';

export class CatalogService {
  constructor(private d: Deps) {}

  async departments(actor: Actor) {
    const doctors = await this.d.store.doctors.list({ clinicId: actor.clinicId });
    const map = new Map<string, number>();
    for (const doc of doctors) map.set(doc.department, (map.get(doc.department) ?? 0) + 1);
    return [...map.entries()].map(([name, doctorCount]) => ({ name, doctorCount })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async doctors(actor: Actor, department?: string) {
    const { store, clock } = this.d;
    const clinic = await getClinic(store, actor.clinicId);
    const from = today(clinic, clock);
    const to = addDays(from, clinic.bookingHorizonDays);
    const now = clock.now();
    const doctors = await store.doctors.list({ clinicId: actor.clinicId, department });
    return Promise.all(
      doctors.map(async (doc) => {
        const slots = await store.slots.listForDoctorRange(doc.id, from, to);
        const open = slots.filter((s) => s.startAt > now && s.reservedCount < s.capacity);
        const state = await store.queueStates.find(doc.id, from);
        return {
          id: doc.id,
          code: doc.code,
          name: doc.user.name,
          avatarUrl: doc.user.avatarUrl,
          department: doc.department,
          room: doc.room,
          avgMinutes: doc.avgMinutes,
          bio: doc.bio,
          pausedToday: state?.paused ?? false,
          openSlotCount: open.length,
          nextAvailableAt: open[0]?.startAt ?? null,
        };
      }),
    );
  }

  async slots(actor: Actor, doctorId: string, date: string) {
    const { store, clock } = this.d;
    const clinic = await getClinic(store, actor.clinicId);
    const doctor = await store.doctors.findById(doctorId);
    if (!doctor || doctor.clinicId !== actor.clinicId) throw errors.notFound('Doctor');
    const now = clock.now();
    const first = today(clinic, clock);
    const last = addDays(first, clinic.bookingHorizonDays);
    const slots = await store.slots.listForDoctorDate(doctorId, date);
    const withinHorizon = date >= first && date <= last;
    return {
      doctor: { id: doctor.id, name: doctor.user.name, avatarUrl: doctor.user.avatarUrl, code: doctor.code, department: doctor.department, room: doctor.room, active: doctor.status === 'ACTIVE' },
      date,
      bookableFrom: first,
      bookableTo: last,
      slots: slots.map((s) => ({
        id: s.id,
        startAt: s.startAt,
        endAt: s.endAt,
        capacity: s.capacity,
        remaining: Math.max(0, s.capacity - s.reservedCount),
        available: doctor.status === 'ACTIVE' && withinHorizon && s.startAt > now && s.reservedCount < s.capacity,
        past: s.startAt <= now,
      })),
    };
  }
}
