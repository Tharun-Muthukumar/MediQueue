/**
 * MySQL 8 (InnoDB) implementation of the repository contracts using Prisma 6.
 *
 * Concurrency: correctness rests on database guards — conditional UPDATEs
 * (reservedCount < capacity, status compare-and-set) and UNIQUE indexes
 * (doctor+day+token, appointmentId) — which the concurrency tests exercise.
 * Write transactions from this API process also pass through an in-process FIFO queue, so
 * they never deadlock each other; if MySQL still reports a deadlock or write conflict
 * (for example from a second process), the whole transaction is retried a few times.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { Mutex } from '../../shared/util';
import { UniqueViolation, type Repos, type Store } from '../../repositories/types';
import type { User } from '../../domain/types';

type Db = PrismaClient | Prisma.TransactionClient;

const doctorRefSelect = {
  id: true,
  code: true,
  department: true,
  room: true,
  user: { select: { name: true, avatarUrl: true } },
} as const;

const personSelect = { id: true, name: true, email: true, phone: true, avatarUrl: true } as const;

const appointmentFullInclude = {
  slot: true,
  doctor: { select: doctorRefSelect },
  patient: { select: personSelect },
  ticket: true,
} as const;

function mapUnique<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = (e.meta?.target as string[] | string | undefined) ?? 'unknown';
      throw new UniqueViolation(Array.isArray(target) ? target.join(',') : String(target));
    }
    throw e;
  });
}

export function makeRepos(db: Db): Repos {
  return {
    clinics: {
      get: (id) => db.clinic.findUnique({ where: { id } }),
      getDefault: () => db.clinic.findFirst({ orderBy: { createdAt: 'asc' } }),
      update: (id, patch) => db.clinic.update({ where: { id }, data: patch }),
    },

    users: {
      findByEmail: (email) => db.user.findUnique({ where: { email: email.toLowerCase() } }),
      findById: (id) => db.user.findUnique({ where: { id } }),
      create: (data) => mapUnique(db.user.create({ data: { ...data, email: data.email.toLowerCase() } })),
      update: (id, patch) => db.user.update({ where: { id }, data: patch }),
      list: ({ clinicId, roles, q, limit }) =>
        db.user.findMany({
          where: {
            clinicId,
            ...(roles?.length ? { role: { in: roles } } : {}),
            ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q.toLowerCase() } }, { phone: { contains: q } }] } : {}),
          },
          orderBy: { name: 'asc' },
          take: limit ?? 100,
        }),
    },

    sessions: {
      create: async (data) => {
        await db.session.create({ data });
      },
      findWithUser: (id) => db.session.findUnique({ where: { id }, include: { user: true } }) as Promise<{ id: string; expiresAt: Date; user: User } | null>,
      delete: async (id) => {
        await db.session.deleteMany({ where: { id } });
      },
      deleteForUser: async (userId) => {
        await db.session.deleteMany({ where: { userId } });
      },
      deleteForUserExcept: async (userId, keepId) => (await db.session.deleteMany({ where: { userId, id: { not: keepId } } })).count,
      deleteExpired: async (now) => (await db.session.deleteMany({ where: { expiresAt: { lt: now } } })).count,
    },

    doctors: {
      list: ({ clinicId, includeInactive, department }) =>
        db.doctor.findMany({
          where: {
            clinicId,
            ...(includeInactive ? {} : { status: 'ACTIVE', user: { isActive: true } }),
            ...(department ? { department } : {}),
          },
          include: { user: { select: { id: true, name: true, email: true, isActive: true, avatarUrl: true } } },
          orderBy: { code: 'asc' },
        }),
      findById: (id) =>
        db.doctor.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, email: true, isActive: true, avatarUrl: true } } } }),
      findByUserId: (userId) => db.doctor.findUnique({ where: { userId } }),
      create: (data) => mapUnique(db.doctor.create({ data })),
      update: (id, patch) => db.doctor.update({ where: { id }, data: patch }),
    },

    slots: {
      findById: (id) => db.slot.findUnique({ where: { id } }),
      listForDoctorDate: (doctorId, serviceDate) => db.slot.findMany({ where: { doctorId, serviceDate }, orderBy: { startAt: 'asc' } }),
      listForDoctorRange: (doctorId, from, to) =>
        db.slot.findMany({ where: { doctorId, serviceDate: { gte: from, lte: to } }, orderBy: { startAt: 'asc' } }),
      listForDateRange: (from, to) => db.slot.findMany({ where: { serviceDate: { gte: from, lte: to } } }),
      tryReserve: async (id) =>
        (await db.$executeRaw`UPDATE Slot SET reservedCount = reservedCount + 1 WHERE id = ${id} AND reservedCount < capacity`) === 1,
      release: async (id) =>
        (await db.$executeRaw`UPDATE Slot SET reservedCount = reservedCount - 1 WHERE id = ${id} AND reservedCount > 0`) === 1,
      createMany: async (slots) => {
        if (!slots.length) return 0;
        const r = await db.slot.createMany({ data: slots });
        return r.count;
      },
      deleteIfUnreserved: async (id) => (await db.slot.deleteMany({ where: { id, reservedCount: 0, appointments: { none: {} } } })).count === 1,
    },

    appointments: {
      create: (data) => db.appointment.create({ data }),
      findFull: (id) => db.appointment.findUnique({ where: { id }, include: appointmentFullInclude }),
      transition: async (id, from, to, patch = {}) => {
        const r = await db.appointment.updateMany({ where: { id, status: { in: from } }, data: { ...patch, status: to } });
        return r.count === 1;
      },
      listForPatient: (patientId) =>
        db.appointment.findMany({ where: { patientId }, include: appointmentFullInclude, orderBy: { slot: { startAt: 'desc' } } }),
      findActiveForPatientDoctorDate: (patientId, doctorId, serviceDate) =>
        db.appointment.findFirst({ where: { patientId, doctorId, serviceDate, status: { in: ['BOOKED', 'CHECKED_IN'] } } }),
      listForDate: (serviceDate, doctorId) =>
        db.appointment.findMany({
          where: { serviceDate, ...(doctorId ? { doctorId } : {}) },
          include: appointmentFullInclude,
          orderBy: [{ slot: { startAt: 'asc' } }, { bookedAt: 'asc' }],
        }),
      listForDateRange: (from, to) => db.appointment.findMany({ where: { serviceDate: { gte: from, lte: to } } }),
      listBookedStartingBefore: (before) =>
        db.appointment.findMany({ where: { status: 'BOOKED', slot: { startAt: { lt: before } } }, include: appointmentFullInclude }),
    },

    tickets: {
      create: (data) => mapUnique(db.queueTicket.create({ data })),
      findById: (id) => db.queueTicket.findUnique({ where: { id }, include: { patient: { select: personSelect } } }),
      findByAppointment: (appointmentId) => db.queueTicket.findUnique({ where: { appointmentId } }),
      listForDoctorDate: (doctorId, serviceDate) =>
        db.queueTicket.findMany({
          where: { doctorId, serviceDate },
          include: { patient: { select: personSelect } },
          orderBy: { tokenNumber: 'asc' },
        }),
      listForDate: (serviceDate) =>
        db.queueTicket.findMany({ where: { serviceDate }, include: { doctor: { select: doctorRefSelect } }, orderBy: { tokenNumber: 'asc' } }),
      listForDateRange: (from, to) => db.queueTicket.findMany({ where: { serviceDate: { gte: from, lte: to } } }),
      listActiveForPatient: (patientId, serviceDate) =>
        db.queueTicket.findMany({
          where: { patientId, serviceDate, status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION', 'SKIPPED'] } },
          include: { doctor: { select: doctorRefSelect } },
          orderBy: { checkedInAt: 'asc' },
        }),
      findActiveWalkIn: (patientId, doctorId, serviceDate) =>
        db.queueTicket.findFirst({
          where: { patientId, doctorId, serviceDate, source: 'WALK_IN', status: { in: ['WAITING', 'CALLED', 'IN_CONSULTATION', 'SKIPPED'] } },
        }),
      transition: async (id, from, to, patch = {}) => {
        const r = await db.queueTicket.updateMany({ where: { id, status: { in: from } }, data: { ...patch, status: to } });
        return r.count === 1;
      },
    },

    counters: {
      next: async (doctorId, serviceDate) => {
        const c = await db.queueCounter.upsert({
          where: { doctorId_serviceDate: { doctorId, serviceDate } },
          create: { doctorId, serviceDate, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        return c.lastNumber;
      },
    },

    queueStates: {
      find: (doctorId, serviceDate) => db.doctorQueueState.findUnique({ where: { doctorId_serviceDate: { doctorId, serviceDate } } }),
      getOrCreate: (doctorId, serviceDate) =>
        db.doctorQueueState.upsert({
          where: { doctorId_serviceDate: { doctorId, serviceDate } },
          create: { doctorId, serviceDate },
          update: {},
        }),
      update: (doctorId, serviceDate, patch) =>
        db.doctorQueueState.upsert({
          where: { doctorId_serviceDate: { doctorId, serviceDate } },
          create: { doctorId, serviceDate, ...patch },
          update: patch,
        }),
      listForDate: (serviceDate) => db.doctorQueueState.findMany({ where: { serviceDate } }),
    },

    consultations: {
      create: (data) => mapUnique(db.consultation.create({ data })),
      complete: async (queueTicketId, endedAt, durationSec) => {
        await db.consultation.update({ where: { queueTicketId }, data: { endedAt, durationSec } });
      },
      recentDurations: async (doctorId, limit, before) => {
        const rows = await db.consultation.findMany({
          where: { doctorId, durationSec: { not: null }, endedAt: before ? { lt: before } : { not: null } },
          orderBy: { endedAt: 'desc' },
          take: limit,
          select: { durationSec: true },
        });
        return rows.map((r) => r.durationSec as number);
      },
      listCompletedBetween: (from, to) =>
        db.consultation.findMany({ where: { endedAt: { gte: from, lt: to }, durationSec: { not: null } } }),
    },

    notifications: {
      createMany: async (items) => {
        if (items.length) await db.notification.createMany({ data: items });
      },
      listForUser: (userId, limit) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit }),
      unreadCount: (userId) => db.notification.count({ where: { userId, readAt: null } }),
      markRead: async (id, userId, at) => (await db.notification.updateMany({ where: { id, userId }, data: { readAt: at } })).count === 1,
      markAllRead: async (userId, at) => (await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: at } })).count,
    },

    audit: {
      create: async (e) => {
        await db.auditEvent.create({ data: e });
      },
      list: async (f, page, pageSize) => {
        const where: Prisma.AuditEventWhereInput = {
          ...(f.action ? { action: f.action } : {}),
          ...(f.actorId ? { actorId: f.actorId } : {}),
          ...(f.entityType ? { entityType: f.entityType } : {}),
          ...(f.from || f.to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
        };
        const [items, total] = await Promise.all([
          db.auditEvent.findMany({
            where,
            include: { actor: { select: { name: true, email: true, avatarUrl: true } } },
            orderBy: { at: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.auditEvent.count({ where }),
        ]);
        return { items, total };
      },
    },

    idempotency: {
      find: (userId, route, key) => db.idempotencyRecord.findUnique({ where: { userId_route_key: { userId, route, key } } }),
      create: async (r) => {
        await mapUnique(db.idempotencyRecord.create({ data: r }));
      },
      deleteExpired: async (now) => (await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } })).count,
    },
  };
}

export async function createPrismaStore(url?: string): Promise<Store> {
  const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
  await prisma.$connect();
  const writeLock = new Mutex();
  /** P2034 = deadlock or write conflict; MySQL has already rolled the transaction back, so rerunning it is safe. */
  const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (e) {
        const retryable = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
        if (!retryable || attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 20 * attempt));
      }
    }
  };
  const root = makeRepos(prisma);

  return {
    ...root,
    transaction: (fn) =>
      writeLock.run(() => withRetry(() => prisma.$transaction((tx) => fn(makeRepos(tx)), { maxWait: 15_000, timeout: 20_000 }))),
    ping: async () => {
      try {
        await prisma.$queryRawUnsafe('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    close: () => prisma.$disconnect(),
  };
}
