import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/instrument-sans';
import './styles/index.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { homeFor, RequireRole, useMe } from './app/auth';
import { ToastProvider } from './app/toast';
import { AppShell } from './components/shell';
import { FullPageLoader } from './components/ui';
import { CursorFollower, SpotlightTracker } from './components/motion';
import { ApiError } from './lib/api';

const Landing = lazy(() => import('./pages/public/Landing'));
const Login = lazy(() => import('./pages/public/Login'));
const Register = lazy(() => import('./pages/public/Register'));
const QueueBoard = lazy(() => import('./pages/public/QueueBoard'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const Profile = lazy(() => import('./pages/Profile'));
const PatientHome = lazy(() => import('./pages/patient/PatientHome'));
const BookVisit = lazy(() => import('./pages/patient/BookVisit'));
const MyAppointments = lazy(() => import('./pages/patient/MyAppointments'));
const LiveToken = lazy(() => import('./pages/patient/LiveToken'));
const FrontDesk = lazy(() => import('./pages/reception/FrontDesk'));
const DoctorConsole = lazy(() => import('./pages/doctor/DoctorConsole'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview'));
const AdminDoctors = lazy(() => import('./pages/admin/AdminDoctors'));
const AdminStaff = lazy(() => import('./pages/admin/AdminStaff'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function HomeRedirect() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <FullPageLoader />;
  return <Navigate to={me ? homeFor[me.user.role] : '/'} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CursorFollower />
        <SpotlightTracker />
        <BrowserRouter>
          <Suspense fallback={<FullPageLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/board" element={<QueueBoard />} />
              <Route path="/queue-board" element={<Navigate to="/board" replace />} />
              <Route path="/home" element={<HomeRedirect />} />

              <Route element={<RequireRole roles={['PATIENT']}><AppShell /></RequireRole>}>
                <Route path="/patient" element={<PatientHome />} />
                <Route path="/patient/book" element={<BookVisit />} />
                <Route path="/patient/appointments" element={<MyAppointments />} />
                <Route path="/patient/queue" element={<LiveToken />} />
              </Route>
              <Route element={<RequireRole roles={['RECEPTIONIST']}><AppShell /></RequireRole>}>
                <Route path="/reception" element={<FrontDesk />} />
              </Route>
              <Route element={<RequireRole roles={['DOCTOR']}><AppShell /></RequireRole>}>
                <Route path="/doctor" element={<DoctorConsole />} />
              </Route>
              <Route element={<RequireRole roles={['ADMIN']}><AppShell /></RequireRole>}>
                <Route path="/admin" element={<AdminOverview />} />
                <Route path="/admin/doctors" element={<AdminDoctors />} />
                <Route path="/admin/staff" element={<AdminStaff />} />
                <Route path="/admin/audit" element={<AdminAudit />} />
                <Route path="/admin/settings" element={<AdminSettings />} />
              </Route>
              <Route element={<RequireRole roles={['PATIENT', 'RECEPTIONIST', 'DOCTOR', 'ADMIN']}><AppShell /></RequireRole>}>
                <Route path="/profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
