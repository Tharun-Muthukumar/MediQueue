import type { AppointmentStatus, TicketStatus } from './types';

/** Allowed appointment transitions (blueprint §5.2). Terminal states have no exits. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  BOOKED: ['CANCELLED', 'CHECKED_IN', 'NO_SHOW'],
  CHECKED_IN: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
  NO_SHOW: [],
  COMPLETED: [],
};

/** Allowed queue-ticket transitions (blueprint §5.3). */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  WAITING: ['CALLED', 'CANCELLED', 'SKIPPED'],
  CALLED: ['IN_CONSULTATION', 'WAITING', 'CANCELLED', 'SKIPPED'],
  IN_CONSULTATION: ['COMPLETED'],
  SKIPPED: ['WAITING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionAppointment(from: string, to: AppointmentStatus): boolean {
  return (APPOINTMENT_TRANSITIONS[from as AppointmentStatus] ?? []).includes(to);
}

export function canTransitionTicket(from: string, to: TicketStatus): boolean {
  return (TICKET_TRANSITIONS[from as TicketStatus] ?? []).includes(to);
}

export const ACTIVE_TICKET_STATUSES: TicketStatus[] = ['WAITING', 'CALLED', 'IN_CONSULTATION'];
