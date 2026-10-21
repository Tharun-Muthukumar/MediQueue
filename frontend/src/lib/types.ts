export type Role = 'PATIENT' | 'RECEPTIONIST' | 'DOCTOR' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  createdAt?: string;
  clinicId: string;
}

export interface Me {
  user: User;
  doctor: { id: string; code: string; department: string; room: string } | null;
  clinic: { id: string; name: string; timezone: string } | null;
}

export interface Eta {
  status: 'OK' | 'PAUSED';
  waitSec: number | null;
  lowSec: number | null;
  highSec: number | null;
}

export interface DoctorCard {
  id: string;
  code: string;
  name: string;
  avatarUrl: string | null;
  department: string;
  room: string;
  avgMinutes: number;
  bio: string | null;
  pausedToday: boolean;
  openSlotCount: number;
  nextAvailableAt: string | null;
}

export interface SlotView {
  id: string;
  startAt: string;
  endAt: string;
  capacity: number;
  remaining: number;
  available: boolean;
  past: boolean;
}

export interface AppointmentView {
  id: string;
  status: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW' | 'COMPLETED';
  serviceDate: string;
  bookedAt: string;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  slot: { id: string; startAt: string; endAt: string };
  doctor: { id: string; code: string; name: string; avatarUrl?: string | null; department: string; room: string };
  ticket: { id: string; tokenLabel: string; status: string } | null;
}

export interface MyTicket {
  ticketId: string;
  tokenLabel: string;
  status: 'WAITING' | 'CALLED' | 'IN_CONSULTATION' | 'SKIPPED';
  source: 'SCHEDULED' | 'WALK_IN';
  checkedInAt: string;
  calledAt: string | null;
  startedAt: string | null;
  scheduledAt: string | null;
  doctor: { id: string; code: string; name: string; avatarUrl?: string | null; department: string; room: string };
  position: number | null;
  ahead: number | null;
  eta: Eta | null;
  paused: boolean;
  pauseReason: string | null;
  opensAt: string | null;
  notStartedYet: boolean;
  nowServing: { tokenLabel: string; status: string } | null;
  waitingTotal: number;
  estimateBasis: 'ROLLING_MEDIAN' | 'DEFAULT';
  expectedConsultMin: number;
}

export interface MyQueue {
  serviceDate: string;
  timezone: string;
  tickets: MyTicket[];
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface StaffTicket {
  id: string;
  tokenLabel: string;
  tokenNumber: number;
  source: 'SCHEDULED' | 'WALK_IN';
  status: string;
  patient: { id: string; name: string; avatarUrl?: string | null };
  appointmentId: string | null;
  scheduledAt: string | null;
  checkedInAt: string;
  calledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isLate: boolean;
  statusReason: string | null;
  position?: number;
  eta?: Eta;
}

export interface DoctorQueue {
  doctor: { id: string; code: string; name: string; avatarUrl?: string | null; department: string; room: string; avgMinutes: number; status: string };
  serviceDate: string;
  paused: boolean;
  pauseReason: string | null;
  pausedAt: string | null;
  opensAt: string | null;
  notStartedYet: boolean;
  policy: { scheduledPerWalkIn: number; appointmentStreak: number };
  estimate: { expectedSec: number; basis: 'ROLLING_MEDIAN' | 'DEFAULT'; samples: number };
  active: StaffTicket | null;
  waiting: (StaffTicket & { position: number; eta: Eta })[];
  others: StaffTicket[];
  stats: { total: number; completed: number; waiting: number; skipped: number; avgConsultSec: number | null; medianConsultSec: number | null; avgWaitSec: number | null };
}

export interface ReceptionRow extends Omit<AppointmentView, 'ticket'> {
  ticket: { id: string; tokenLabel: string; status: string } | null;
  patient: { id: string; name: string; phone: string | null; avatarUrl?: string | null };
  flags: { canCheckIn: boolean; late: boolean; noShowEligible: boolean; minutesLate: number };
}

export interface ReceptionQueue {
  id: string;
  code: string;
  name: string;
  avatarUrl?: string | null;
  department: string;
  room: string;
  paused: boolean;
  pauseReason: string | null;
  active: { id: string; tokenLabel: string; status: string; patientName: string; patientAvatarUrl?: string | null } | null;
  waiting: { id: string; tokenLabel: string; source: string; patientName: string; patientAvatarUrl?: string | null; position: number; etaMin: number | null; checkedInAt: string }[];
  skipped: { id: string; tokenLabel: string; patientName: string; reason: string | null }[];
  completed: number;
  expectedConsultMin: number;
}

export interface ReceptionToday {
  serviceDate: string;
  isToday: boolean;
  policy: { graceMinutes: number; lateAfterMinutes: number; walkInRatio: number };
  counts: { booked: number; checkedIn: number; completed: number; cancelled: number; noShow: number; walkIns: number; waiting: number; overdue: number };
  appointments: ReceptionRow[];
  walkIns: { id: string; tokenLabel: string; status: string; doctorCode: string; doctorName: string; checkedInAt: string }[];
  queues: ReceptionQueue[];
}

export interface Board {
  clinicName: string;
  serviceDate: string;
  timezone: string;
  generatedAt: string;
  doctors: {
    code: string;
    doctorName: string;
    department: string;
    room: string;
    paused: boolean;
    nowServing: { tokenLabel: string; status: string } | null;
    upNext: string[];
    waitingCount: number;
    approxWaitMin: number | null;
    opensAt: string | null;
    notStartedYet: boolean;
  }[];
}

export interface Metrics {
  date: string;
  timezone: string;
  totals: { appointments: number; booked: number; checkedIn: number; completed: number; cancelled: number; noShows: number; walkIns: number; waitingNow: number; noShowRate: number | null; slotUtilization: number | null };
  waits: { meanMin: number | null; medianMin: number | null; p90Min: number | null; samples: number };
  consults: { meanMin: number | null; medianMin: number | null; samples: number };
  eta: { maeMin: number | null; baselineMaeMin: number | null; samples: number; points: { token: string; predictedMin: number; baselineMin: number | null; actualMin: number }[] };
  hourly: { hour: string; arrivals: number; completed: number }[];
  trend: { date: string; appointments: number; completed: number; noShows: number; walkIns: number; avgWaitMin: number | null; etaMaeMin: number | null }[];
  perDoctor: { doctorId: string; code: string; name: string; avatarUrl?: string | null; department: string; status: string; appointments: number; walkIns: number; completed: number; waiting: number; noShows: number; avgWaitMin: number | null; avgConsultMin: number | null; utilization: number | null }[];
}

export interface AdminDoctor {
  id: string;
  code: string;
  name: string;
  avatarUrl?: string | null;
  email: string;
  department: string;
  room: string;
  avgMinutes: number;
  bio: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  pausedToday: boolean;
  upcomingSlots: number;
  upcomingBooked: number;
  upcomingDays: number;
}

export interface AuditItem {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  actor: { id: string | null; name: string; role: string | null; avatarUrl?: string | null };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ClinicSettings {
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
