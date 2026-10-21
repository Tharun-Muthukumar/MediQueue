import { useQuery } from '@tanstack/react-query';
import { usePollInterval } from '../../app/live';
import { get } from '../../lib/api';
import type { AppointmentView, MyQueue } from '../../lib/types';

export function useMyQueue() {
  const poll = usePollInterval(5000, 30000);
  return useQuery({ queryKey: ['myQueue'], queryFn: () => get<MyQueue>('/queues/me'), refetchInterval: poll });
}

export function useMyAppointments() {
  return useQuery({ queryKey: ['appointments', 'me'], queryFn: () => get<AppointmentView[]>('/appointments/me') });
}

export function splitAppointments(list: AppointmentView[] | undefined) {
  const now = Date.now();
  const all = list ?? [];
  const upcoming = all
    .filter((a) => a.status === 'BOOKED' || a.status === 'CHECKED_IN')
    .filter((a) => a.status === 'CHECKED_IN' || new Date(a.slot.endAt).getTime() > now - 60 * 60_000)
    .sort((a, b) => +new Date(a.slot.startAt) - +new Date(b.slot.startAt));
  const past = all.filter((a) => !upcoming.includes(a) && a.status !== 'CANCELLED');
  const cancelled = all.filter((a) => a.status === 'CANCELLED');
  return { upcoming, past, cancelled };
}
