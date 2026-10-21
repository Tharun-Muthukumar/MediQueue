/** Plain domain types. Storage adapters return objects structurally compatible with these. */

export const ROLES = ['PATIENT', 'RECEPTIONIST', 'DOCTOR', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const APPOINTMENT_STATUSES = ['BOOKED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const TICKET_STATUSES = ['WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'SKIPPED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type TicketSource = 'SCHEDULED' | 'WALK_IN';

export interface Clinic {
  id: string;
  name: string;
  timezone: string;
  walkInRatio: number;
  graceMinutes: number;
  lateAfterMinutes: number;
  autoNoShow: boolean;
  defaultConsultMinutes: number;
  bookingHorizonDays: number;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  clinicId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface Doctor {
  id: string;
  userId: string;
  clinicId: string;
  code: string;
  department: string;
  room: string;
  avgMinutes: number;
  status: string;
  bio: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoctorWithUser extends Doctor {
  user: { id: string; name: string; email: string; isActive: boolean; avatarUrl: string | null };
}

export interface Slot {
  id: string;
  doctorId: string;
  serviceDate: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  reservedCount: number;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  serviceDate: string;
  status: string;
  bookedAt: Date;
  checkedInAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  cancelledById: string | null;
  noShowAt: Date | null;
  completedAt: Date | null;
  lateOverrideReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueTicket {
  id: string;
  doctorId: string;
  serviceDate: string;
  tokenNumber: number;
  tokenLabel: string;
  patientId: string;
  appointmentId: string | null;
  source: string;
  status: string;
  scheduledAt: Date | null;
  checkedInAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  isLate: boolean;
  predictedWaitSec: number | null;
  baselineWaitSec: number | null;
  statusReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoctorQueueState {
  doctorId: string;
  serviceDate: string;
  appointmentStreak: number;
  activeTicketId: string | null;
  paused: boolean;
  pauseReason: string | null;
  pausedAt: Date | null;
}

export interface Consultation {
  id: string;
  queueTicketId: string;
  doctorId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
}

export interface Notification {
  id: string;
  userId: string;
  kind: string;
  title: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface AuditEvent {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  at: Date;
}

export interface IdempotencyRecord {
  key: string;
  userId: string;
  route: string;
  requestHash: string;
  responseCode: number;
  responseJson: string;
  expiresAt: Date;
}

/** The authenticated principal, always derived server-side from the session. */
export interface Actor {
  id: string;
  role: Role;
  clinicId: string;
  name: string;
  doctorId?: string | null;
}
