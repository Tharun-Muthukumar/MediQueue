import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, get, post } from '../lib/api';
import { setDisplayTimezone } from '../lib/format';
import type { Me, Role } from '../lib/types';
import { FullPageLoader } from '../components/ui';

export const homeFor: Record<Role, string> = {
  PATIENT: '/patient',
  RECEPTIONIST: '/reception',
  DOCTOR: '/doctor',
  ADMIN: '/admin',
};

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await get<Me | null>('/auth/session');
      setDisplayTimezone(me?.clinic?.timezone);
      return me;
    },
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => post<{ user: Me['user'] }>('/auth/login', v),
    onSuccess: async () => {
      qc.clear();
      await qc.fetchQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me') }).then((me) => setDisplayTimezone(me.clinic?.timezone));
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });
}

/** Route guard: signed-in users with one of `roles`. Hiding UI is not authorisation — the API enforces it too. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <FullPageLoader />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!roles.includes(me.user.role)) return <Navigate to={homeFor[me.user.role]} replace />;
  return <>{children}</>;
}
