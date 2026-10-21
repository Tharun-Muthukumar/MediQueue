import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Command,
  Home,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  ScrollText,
  Search,
  Settings2,
  Stethoscope,
  Ticket,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLogout, useMe } from '../app/auth';
import { LiveProvider, useLive, usePollInterval } from '../app/live';
import { get, patch } from '../lib/api';
import { dateLong, relative } from '../lib/format';
import type { Me, Notification, Role } from '../lib/types';
import { PatientCallAlerts } from '../pages/patient/CallAlerts';
import { CommandPalette } from './CommandPalette';
import { Avatar, IconTile } from './kit';
import { PageTransition, TopProgress } from './motion';
import { notifyKind } from './notifyKinds';
import { Logo } from './token';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  external?: boolean;
  mobile?: boolean; // shown in the phone tab bar
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const profileItem: NavItem = { to: '/profile', label: 'My profile', icon: UserRound };
const boardItem: NavItem = { to: '/board', label: 'Waiting-room board', icon: Monitor, external: true };

const NAV: Record<Role, NavGroup[]> = {
  PATIENT: [
    {
      label: 'My care',
      items: [
        { to: '/patient', label: 'Overview', icon: Home, end: true, mobile: true },
        { to: '/patient/book', label: 'Book a visit', icon: CalendarPlus, mobile: true },
        { to: '/patient/appointments', label: 'My appointments', icon: CalendarDays, mobile: true },
        { to: '/patient/queue', label: 'Live token', icon: Ticket, mobile: true },
      ],
    },
    { label: 'Account', items: [{ ...profileItem }] },
  ],
  RECEPTIONIST: [
    { label: 'Today', items: [{ to: '/reception', label: 'Front desk', icon: ClipboardList, end: true, mobile: true }, boardItem] },
    { label: 'Account', items: [{ ...profileItem, mobile: true }] },
  ],
  DOCTOR: [
    { label: 'Today', items: [{ to: '/doctor', label: 'My queue', icon: Stethoscope, end: true, mobile: true }, boardItem] },
    { label: 'Account', items: [{ ...profileItem, mobile: true }] },
  ],
  ADMIN: [
    {
      label: 'Operations',
      items: [
        { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, mobile: true },
        { to: '/admin/doctors', label: 'Doctors & schedules', icon: Stethoscope, mobile: true },
        { to: '/admin/staff', label: 'People', icon: Users, mobile: true },
      ],
    },
    {
      label: 'Governance',
      items: [
        { to: '/admin/audit', label: 'Audit log', icon: ScrollText, mobile: true },
        { to: '/admin/settings', label: 'Clinic policy', icon: Settings2 },
        boardItem,
      ],
    },
    { label: 'Account', items: [{ ...profileItem }] },
  ],
};

const roleLabel: Record<Role, string> = { PATIENT: 'Patient', RECEPTIONIST: 'Reception', DOCTOR: 'Doctor', ADMIN: 'Administrator' };
const allItems = (role: Role) => NAV[role].flatMap((g) => g.items);

function LiveIndicator() {
  const live = useLive();
  const map = {
    live: { dot: 'bg-[#16a34a]', text: 'Live', title: 'Receiving live updates' },
    connecting: { dot: 'bg-amber-ink', text: 'Connecting', title: 'Connecting to live updates' },
    offline: { dot: 'bg-muted', text: 'Refreshing every 5s', title: 'Live stream unavailable — polling instead' },
  }[live];
  return (
    <span className="hidden items-center gap-2 rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink-soft sm:inline-flex" title={map.title}>
      <span className={cx('h-2 w-2 rounded-full', map.dot, live === 'live' && 'live-dot')} aria-hidden />
      {map.text}
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function NotificationBell() {
  const { open, setOpen, ref } = usePopover();
  const qc = useQueryClient();
  const poll = usePollInterval(15000, 60000);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ unread: number; items: Notification[] }>('/notifications'), refetchInterval: poll });
  const markAll = useMutation({ mutationFn: () => patch('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const markOne = useMutation({ mutationFn: (id: string) => patch(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        className={cx('relative grid h-10 w-10 place-items-center rounded-xl border text-ink-2 transition-colors', open ? 'border-teal/40 bg-teal-50' : 'border-line bg-white hover:border-line-strong')}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="tabular absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#e8590c] px-1 text-[10.5px] font-bold text-white ring-2 ring-paper">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="token-in absolute right-0 z-40 mt-2 w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="font-display text-[16px] font-semibold">Notifications</p>
              <p className="text-[12px] text-muted">{unread ? `${unread} unread` : 'All caught up'}</p>
            </div>
            {unread > 0 && (
              <button className="rounded-lg px-2 py-1 text-[13px] font-semibold text-teal hover:bg-teal-50" onClick={() => markAll.mutate()}>
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto p-1.5">
            {q.data?.items.length ? (
              q.data.items.map((n) => {
                const k = notifyKind(n.kind);
                return (
                  <li key={n.id}>
                    <button className={cx('flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-paper', !n.readAt && 'bg-teal-50/45')} onClick={() => !n.readAt && markOne.mutate(n.id)}>
                      <IconTile icon={k.icon} tone={k.tone} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-ink">{n.title}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-soft">{n.message}</p>
                        <p className="mt-1 text-[11.5px] text-muted">{relative(n.createdAt)}</p>
                      </div>
                      {!n.readAt && (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-10 text-center text-[14px] text-muted">{q.isLoading ? 'Loading…' : "You're all caught up."}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className={cx('flex items-center gap-2.5 rounded-xl border py-1 pl-1 pr-2 transition-colors', open ? 'border-teal/40 bg-teal-50' : 'border-transparent hover:border-line hover:bg-white')}
      >
        <Avatar name={me.user.name} src={me.user.avatarUrl} size="sm" status="online" />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[150px] truncate text-[13.5px] font-semibold text-ink">{me.user.name}</span>
          <span className="block text-[11.5px] text-muted">{roleLabel[me.user.role]}</span>
        </span>
        <ChevronDown className={cx('hidden h-4 w-4 text-muted transition-transform sm:block', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="token-in absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-3 rounded-xl bg-paper px-3 py-3">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold">{me.user.name}</p>
              <p className="truncate text-[12px] text-muted">{me.user.email}</p>
            </div>
          </div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-ink-2 hover:bg-paper">
            <UserRound className="h-4 w-4 text-muted" aria-hidden /> My profile
          </Link>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event('mq:open-palette'));
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-ink-2 hover:bg-paper"
          >
            <Keyboard className="h-4 w-4 text-muted" aria-hidden /> Quick search <kbd className="ml-auto text-muted">Ctrl K</kbd>
          </button>
          <div className="my-1 border-t border-line" />
          <button role="menuitem" onClick={onSignOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-red-ink hover:bg-red-bg">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ me, onNavigate, onSignOut }: { me: Me; onNavigate?: () => void; onSignOut: () => void }) {
  const role = me.user.role;
  return (
    <div className="flex h-full flex-col bg-ink text-white" data-surface="dark">
      <div className="px-5 pb-4 pt-5">
        <Logo light />
      </div>
      <div className="mx-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4]/15 text-[#5eead4]">
          <Stethoscope className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13.5px] font-semibold">{me.clinic?.name ?? 'Clinic'}</p>
          <p className="flex items-center gap-1.5 text-[11.5px] text-white/55">
            <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" aria-hidden /> Outpatient clinic
          </p>
        </div>
      </div>

      <nav className="mt-5 flex-1 space-y-5 overflow-y-auto px-3" aria-label="Main">
        {NAV[role].map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1.5 text-[11.5px] font-semibold text-white/40">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((item) =>
                item.external ? (
                  <a key={item.to} href={item.to} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium text-white/70 transition-all hover:translate-x-0.5 hover:bg-white/[0.07] hover:text-white">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] group-hover:bg-white/10">
                      <item.icon className="h-[17px] w-[17px]" aria-hidden />
                    </span>
                    {item.label}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-all duration-200',
                        isActive ? 'bg-white text-ink shadow-[0_8px_24px_-10px_rgb(0_0_0/0.5)]' : 'text-white/75 hover:translate-x-0.5 hover:bg-white/[0.07] hover:text-white',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={cx('grid h-8 w-8 place-items-center rounded-lg transition-colors', isActive ? 'bg-teal text-white' : 'bg-white/[0.06] group-hover:bg-white/10')}>
                          <item.icon className="h-[17px] w-[17px]" aria-hidden />
                        </span>
                        {item.label}
                        {isActive && <ChevronRight className="ml-auto h-4 w-4 text-teal" aria-hidden />}
                      </>
                    )}
                  </NavLink>
                ),
              )}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-3 p-3">
        <button
          onClick={() => window.dispatchEvent(new Event('mq:open-palette'))}
          className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-[12.5px] text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <Command className="h-4 w-4 shrink-0 text-[#5eead4]" aria-hidden />
          <span className="flex-1">Jump anywhere</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-2.5">
          <Link to="/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg" aria-label="My profile">
            <Avatar name={me.user.name} src={me.user.avatarUrl} size="md" status="online" />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[13.5px] font-semibold">{me.user.name}</span>
              <span className="block truncate text-[11.5px] text-white/55">
                {roleLabel[role]}
                {me.doctor ? `, ${me.doctor.room}` : ''}
              </span>
            </span>
          </Link>
          <button onClick={onSignOut} className="grid h-8 w-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileTabBar({ role }: { role: Role }) {
  const items = allItems(role).filter((i) => i.mobile && !i.external).slice(0, 5);
  if (items.length < 2) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden" aria-label="Quick navigation">
      <div className="mx-auto flex max-w-md justify-around">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx('flex min-w-[64px] flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-semibold', isActive ? 'text-teal' : 'text-muted')}>
            {({ isActive }) => (
              <>
                <span className={cx('grid h-8 w-12 place-items-center rounded-full transition-colors', isActive && 'bg-teal-50')}>
                  <i.icon className="h-5 w-5" aria-hidden />
                </span>
                {i.label.replace('My appointments', 'Visits').replace('Book a visit', 'Book').replace('Doctors & schedules', 'Doctors')}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { data: me } = useMe();
  const logout = useLogout();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const announcer = useRef<HTMLParagraphElement>(null);
  const [pageName, setPageName] = useState('');
  useEffect(() => setDrawer(false), [loc.pathname]);
  // On every route change: name the browser tab after the page, announce it to screen readers,
  // and move focus to the top so the next Tab lands on "Skip to content".
  useEffect(() => {
    const t = window.setTimeout(() => {
      const h1 = document.querySelector('main h1')?.textContent?.trim();
      setPageName(h1 || 'MediQueue');
      document.title = h1 ? `${h1} | MediQueue` : 'MediQueue';
      // Only reclaim focus if it was lost; never steal it from a field or dialog.
      const active = document.activeElement;
      if (!active || active === document.body || !document.contains(active)) announcer.current?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [loc.pathname]);
  if (!me) return null;
  const role = me.user.role;
  const signOut = () => logout.mutate(undefined, { onSettled: () => nav('/login') });
  const current = allItems(role).find((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));

  return (
    <LiveProvider>
      <TopProgress />
      {role === 'PATIENT' && <PatientCallAlerts />}
      <CommandPalette commands={allItems(role).filter((n) => !n.external).map((n) => ({ id: n.to, label: n.label, icon: n.icon, to: n.to }))} onSignOut={signOut} />
      <p ref={announcer} tabIndex={-1} className="sr-only" aria-live="polite">
        {pageName}
      </p>
      <a href="#main" className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <div className="min-h-screen lg:grid lg:grid-cols-[272px_1fr]">
        <aside className="sticky top-0 hidden h-screen lg:block">
          <Sidebar me={me} onSignOut={signOut} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
            <div className="token-in relative h-full w-[288px] shadow-2xl">
              <Sidebar me={me} onNavigate={() => setDrawer(false)} onSignOut={signOut} />
              <button className="absolute right-3 top-4 rounded-lg p-1.5 text-white/80 hover:bg-white/10" onClick={() => setDrawer(false)} aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}
        <div className="min-w-0">
          <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-3 px-4 sm:px-6 lg:px-8">
              <button className="-ml-1 rounded-lg p-2 text-ink lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <div className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex">
                <span className="text-muted">{me.clinic?.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-line-strong" aria-hidden />
                <span className="truncate font-semibold text-ink">{current?.label ?? 'My profile'}</span>
                <span className="ml-2 hidden rounded-full bg-white px-2.5 py-0.5 text-[12px] text-muted ring-1 ring-line xl:inline">{dateLong(new Date())}</span>
              </div>
              <span className="lg:hidden">
                <Logo />
              </span>
              <div className="flex-1" />
              <button
                onClick={() => window.dispatchEvent(new Event('mq:open-palette'))}
                className="hidden h-10 w-[240px] items-center gap-2 rounded-xl border border-line bg-white px-3 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink md:inline-flex"
                aria-label="Search pages and actions (Ctrl+K)"
              >
                <Search className="h-4 w-4" aria-hidden />
                <span className="flex-1 text-left">Search or jump to…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <LiveIndicator />
              <NotificationBell />
              <ProfileMenu me={me} onSignOut={signOut} />
            </div>
          </header>
          <main id="main" className="mx-auto max-w-[1360px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
            <PageTransition>{children ?? <Outlet />}</PageTransition>
          </main>
        </div>
      </div>
      <MobileTabBar role={role} />
    </LiveProvider>
  );
}
