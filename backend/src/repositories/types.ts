/**
 * Storage contracts used by the domain services. Services never import Prisma; the MySQL
 * adapter (src/adapters/mysql) implements these today, and a DynamoDB adapter could later
 * implement the same contracts with its own access patterns and conditional writes.
 */
import type {
  Appointment,
  AuditEvent,
  Clinic,
  Consultation,
  Doctor,
  DoctorQueueState,
  DoctorWithUser,
  IdempotencyRecord,
  Notification,
  QueueTicket,
  Slot,
  User,
} from '../domain/types';

export interface PersonRef {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface DoctorRef {
  id: string;
  code: string;
  department: string;
  room: string;
  user: { name: string; avatarUrl: string | null };
}

export type AppointmentFull = Appointment & {
  slot: Slot;
  doctor: DoctorRef;
  patient: PersonRef;
  ticket: QueueTicket | null;
};

export type TicketWithPatient = QueueTicket & { patient: PersonRef };
export type TicketWithDoctor = QueueTicket & { doctor: DoctorRef };

export interface ClinicRepo {
  get(id: string): Promise<Clinic | null>;
  getDefault(): Promise<Clinic | null>;
  update(id: string, patch: Partial<Omit<Clinic, 'id'>>): Promise<Clinic>;
}

export interface UserRepo {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: Pick<User, 'email' | 'passwordHash' | 'name' | 'role' | 'clinicId'> & { phone?: string | null }): Promise<User>;
  update(id: string, patch: Partial<Pick<User, 'name' | 'phone' | 'isActive' | 'avatarUrl' | 'passwordHash'>>): Promise<User>;
  list(filter: { clinicId: string; roles?: string[]; q?: string; limit?: number }): Promise<User[]>;
}

export interface SessionRepo {
  create(data: { id: string; userId: string; expiresAt: Date }): Promise<void>;
  findWithUser(id: string): Promise<{ id: string; expiresAt: Date; user: User } | null>;
  delete(id: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
  deleteForUserExcept(userId: string, keepId: string): Promise<number>;
  deleteExpired(now: Date): Promise<number>;
}

export interface DoctorRepo {
  list(filter: { clinicId: string; includeInactive?: boolean; department?: string }): Promise<DoctorWithUser[]>;
  findById(id: string): Promise<DoctorWithUser | null>;
  findByUserId(userId: string): Promise<Doctor | null>;
  create(data: Pick<Doctor, 'userId' | 'clinicId' | 'code' | 'department' | 'room' | 'avgMinutes'> & { bio?: string | null }): Promise<Doctor>;
  update(id: string, patch: Partial<Pick<Doctor, 'department' | 'room' | 'avgMinutes' | 'status' | 'bio'>>): Promise<Doctor>;
}

export interface SlotRepo {
  findById(id: string): Promise<Slot | null>;
  listForDoctorDate(doctorId: string, serviceDate: string): Promise<Slot[]>;
  listForDoctorRange(doctorId: string, from: string, to: string): Promise<Slot[]>;
  listForDateRange(from: string, to: string): Promise<Slot[]>;
  /** Conditional increment: succeeds only while reservedCount < capacity. */
  tryReserve(id: string): Promise<boolean>;
  /** Conditional decrement: succeeds only while reservedCount > 0. */
  release(id: string): Promise<boolean>;
  createMany(slots: Array<Omit<Slot, 'id' | 'reservedCount'>>): Promise<number>;
  deleteIfUnreserved(id: string): Promise<boolean>;
}

export interface AppointmentRepo {
  create(data: Pick<Appointment, 'patientId' | 'doctorId' | 'slotId' | 'serviceDate' | 'status' | 'bookedAt'>): Promise<Appointment>;
  findFull(id: string): Promise<AppointmentFull | null>;
  /** Compare-and-set status transition; returns false when the current status is not in `from`. */
  transition(id: string, from: string[], to: string, patch?: Partial<Appointment>): Promise<boolean>;
  listForPatient(patientId: string): Promise<AppointmentFull[]>;
  findActiveForPatientDoctorDate(patientId: string, doctorId: string, serviceDate: string): Promise<Appointment | null>;
  listForDate(serviceDate: string, doctorId?: string): Promise<AppointmentFull[]>;
  listForDateRange(from: string, to: string): Promise<Appointment[]>;
  listBookedStartingBefore(before: Date): Promise<AppointmentFull[]>;
}

export interface TicketRepo {
  create(data: Omit<QueueTicket, 'id' | 'createdAt' | 'updatedAt' | 'calledAt' | 'startedAt' | 'completedAt' | 'statusReason' | 'predictedWaitSec' | 'baselineWaitSec'>): Promise<QueueTicket>;
  findById(id: string): Promise<TicketWithPatient | null>;
  findByAppointment(appointmentId: string): Promise<QueueTicket | null>;
  listForDoctorDate(doctorId: string, serviceDate: string): Promise<TicketWithPatient[]>;
  listForDate(serviceDate: string): Promise<TicketWithDoctor[]>;
  listForDateRange(from: string, to: string): Promise<QueueTicket[]>;
  listActiveForPatient(patientId: string, serviceDate: string): Promise<TicketWithDoctor[]>;
  findActiveWalkIn(patientId: string, doctorId: string, serviceDate: string): Promise<QueueTicket | null>;
  transition(id: string, from: string[], to: string, patch?: Partial<QueueTicket>): Promise<boolean>;
}

export interface CounterRepo {
  /** Atomically increments and returns the next token number for doctor + day. */
  next(doctorId: string, serviceDate: string): Promise<number>;
}

export interface QueueStateRepo {
  find(doctorId: string, serviceDate: string): Promise<DoctorQueueState | null>;
  getOrCreate(doctorId: string, serviceDate: string): Promise<DoctorQueueState>;
  update(doctorId: string, serviceDate: string, patch: Partial<Omit<DoctorQueueState, 'doctorId' | 'serviceDate'>>): Promise<DoctorQueueState>;
  listForDate(serviceDate: string): Promise<DoctorQueueState[]>;
}

export interface ConsultationRepo {
  create(data: { queueTicketId: string; doctorId: string; startedAt: Date }): Promise<Consultation>;
  complete(queueTicketId: string, endedAt: Date, durationSec: number): Promise<void>;
  /** Most recent completed durations (seconds), newest first. */
  recentDurations(doctorId: string, limit: number, before?: Date): Promise<number[]>;
  listCompletedBetween(from: Date, to: Date): Promise<Consultation[]>;
}

export interface NotificationRepo {
  createMany(items: Array<Pick<Notification, 'userId' | 'kind' | 'title' | 'message'>>): Promise<void>;
  listForUser(userId: string, limit: number): Promise<Notification[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(id: string, userId: string, at: Date): Promise<boolean>;
  markAllRead(userId: string, at: Date): Promise<number>;
}

export interface AuditFilter {
  action?: string;
  actorId?: string;
  entityType?: string;
  from?: Date;
  to?: Date;
}

export interface AuditRepo {
  create(e: Omit<AuditEvent, 'id' | 'at'> & { at?: Date }): Promise<void>;
  list(filter: AuditFilter, page: number, pageSize: number): Promise<{ items: Array<AuditEvent & { actor: { name: string; email: string; avatarUrl: string | null } | null }>; total: number }>;
}

export interface IdempotencyRepo {
  find(userId: string, route: string, key: string): Promise<IdempotencyRecord | null>;
  create(r: IdempotencyRecord): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface Repos {
  clinics: ClinicRepo;
  users: UserRepo;
  sessions: SessionRepo;
  doctors: DoctorRepo;
  slots: SlotRepo;
  appointments: AppointmentRepo;
  tickets: TicketRepo;
  counters: CounterRepo;
  queueStates: QueueStateRepo;
  consultations: ConsultationRepo;
  notifications: NotificationRepo;
  audit: AuditRepo;
  idempotency: IdempotencyRepo;
}

export interface Store extends Repos {
  /** Runs `fn` atomically. Writes inside either all commit or all roll back. */
  transaction<T>(fn: (tx: Repos) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Thrown by adapters when a unique constraint rejects a write. */
export class UniqueViolation extends Error {
  constructor(public target: string) {
    super(`Unique constraint violated: ${target}`);
  }
}
