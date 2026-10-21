import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, CalendarCheck2, CheckCircle2, Download, Hourglass, LineChart, Monitor, PauseCircle, Radio, ScatterChart, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../../app/auth';
import { usePollInterval } from '../../app/live';
import { useToast } from '../../app/toast';
import { auditKind } from '../../components/auditKinds';
import { EtaScatter, HourlyBars, TrendLine } from '../../components/charts';
import { Avatar, greetingFor, HeroBanner, heroButton, heroPrimary, IconTile, SectionTitle, StatCard } from '../../components/kit';
import { Card, cx, EmptyState, ErrorState, errorMessage, LoadingBlock, Skeleton, StatusBadge } from '../../components/ui';
import { download, get } from '../../lib/api';
import { clinicDate, dateLong, dayDate, displayTz, relative } from '../../lib/format';
import type { AuditItem, Metrics, ReceptionToday } from '../../lib/types';

const shortDay = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(dayDate(d));
const n = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit}`);

function HeroFigure({ label, value, tone }: { label: string; value: number | string; tone?: 'warn' }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-3 backdrop-blur sm:min-w-[104px] sm:px-4">
      <p className="text-[12px] text-white/60">{label}</p>
      <p className={cx('tabular mt-0.5 font-display text-[28px] font-bold leading-none', tone === 'warn' ? 'text-[#fcd34d]' : 'text-white')}>{value}</p>
    </div>
  );
}

function Bar({ value, max = 100, tone = '#009096' }: { value: number | null; max?: number; tone?: string }) {
  const pct = value === null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper-2" role="img" aria-label={value === null ? 'No data' : `${value}${max === 100 ? '%' : ''}`}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

export default function AdminOverview() {
  const { data: me } = useMe();
  const [date, setDate] = useState(clinicDate());
  const isToday = date === clinicDate();
  const poll = usePollInterval(10000, 60000);
  const toast = useToast();
  const q = useQuery({ queryKey: ['metrics', date], queryFn: () => get<Metrics>(`/admin/metrics?date=${date}`), refetchInterval: poll });
  const live = useQuery({ queryKey: ['reception', 'today'], queryFn: () => get<ReceptionToday>('/reception/today'), refetchInterval: poll });
  const activity = useQuery({ queryKey: ['audit', 'recent'], queryFn: () => get<{ items: AuditItem[] }>('/admin/audit?pageSize=40'), refetchInterval: poll });
  const csv = useMutation({
    mutationFn: () => download(`/admin/reports/daily.csv?date=${date}`, `mediqueue-daily-${date}.csv`),
    onSuccess: () => toast({ tone: 'success', title: 'Report downloaded', body: 'Patients appear only as short reference codes.' }),
    onError: (e) => toast({ tone: 'error', title: "Couldn't download report", body: errorMessage(e) }),
  });
  const m = q.data;
  const t = m?.trend ?? [];
  const firstName = me?.user.name.split(' ')[0] ?? '';

  return (
    <>
      <HeroBanner
        eyebrow={dateLong(dayDate(date))}
        title={isToday ? `${greetingFor(displayTz())}, ${firstName}` : 'Clinic overview'}
        subtitle={isToday ? `Here is how ${me?.clinic?.name ?? 'the clinic'} is running today. Figures update live.` : 'Viewing a past day. Choose today to see live figures.'}
        actions={
          <>
            <label className="sr-only" htmlFor="ov-date">
              Report date
            </label>
            <input
              id="ov-date"
              type="date"
              value={date}
              max={clinicDate()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-10 rounded-lg border border-white/15 bg-white/10 px-3 text-[14px] font-semibold text-white [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-[#5eead4]"
            />
            <button className={heroPrimary} onClick={() => csv.mutate()} disabled={csv.isPending}>
              <Download className="h-4 w-4" aria-hidden /> Daily CSV
            </button>
            <a className={heroButton} href="/board" target="_blank" rel="noreferrer">
              <Monitor className="h-4 w-4" aria-hidden /> Waiting-room board
            </a>
          </>
        }
        aside={
          m && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <HeroFigure label="Waiting now" value={m.totals.waitingNow} />
              <HeroFigure label="Seen" value={m.totals.completed} />
              <HeroFigure label="No-shows" value={m.totals.noShows} tone={m.totals.noShows ? 'warn' : undefined} />
            </div>
          )
        }
      />

      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[150px]" />
          ))}
        </div>
      ) : q.isError || !m ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard icon={CalendarCheck2} tone="teal" label="Appointments" value={m.totals.appointments} sub={`${m.totals.walkIns} walk-ins, ${m.totals.cancelled} cancelled`} trend={t.map((x) => x.appointments)} />
            <StatCard icon={CheckCircle2} tone="blue" label="Visits completed" value={m.totals.completed} sub={`${m.consults.medianMin ?? '—'} min median visit`} trend={t.map((x) => x.completed)} />
            <StatCard icon={Hourglass} tone="amber" label="Median wait" value={m.waits.medianMin} suffix="min" sub={`90% of patients within ${n(m.waits.p90Min, ' min')}`} trend={t.map((x) => x.avgWaitMin)} />
            <StatCard
              icon={Target}
              tone="violet"
              label="Wait-estimate error"
              value={m.eta.maeMin}
              suffix="min"
              delta={m.eta.maeMin !== null && m.eta.baselineMaeMin !== null ? { text: m.eta.maeMin <= m.eta.baselineMaeMin ? 'beats baseline' : 'above baseline', good: m.eta.maeMin <= m.eta.baselineMaeMin } : null}
              sub={m.eta.samples ? `Fixed 12-min rule: ${n(m.eta.baselineMaeMin, ' min')}, ${m.eta.samples} visits` : 'No calls recorded yet'}
              trend={t.map((x) => x.etaMaeMin)}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr] [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={BarChart3} title="Arrivals and completed visits" description="By hour, clinic local time. Hover a bar for counts." />
              <div className="p-4">{m.hourly.some((h) => h.arrivals || h.completed) ? <HourlyBars data={m.hourly} /> : <EmptyState title="No activity on this day" />}</div>
              <div className="grid grid-cols-3 gap-4 border-t border-line px-5 py-4 text-[13px]">
                <div>
                  <p className="text-muted">Slot utilisation</p>
                  <p className="mt-0.5 font-display text-[18px] font-bold">{n(m.totals.slotUtilization, '%')}</p>
                  <Bar value={m.totals.slotUtilization} />
                </div>
                <div>
                  <p className="text-muted">No-show rate</p>
                  <p className="mt-0.5 font-display text-[18px] font-bold">{n(m.totals.noShowRate, '%')}</p>
                  <Bar value={m.totals.noShowRate} tone="#e8590c" />
                </div>
                <div>
                  <p className="text-muted">Walk-in share</p>
                  <p className="mt-0.5 font-display text-[18px] font-bold">
                    {m.totals.appointments + m.totals.walkIns ? Math.round((m.totals.walkIns / (m.totals.appointments + m.totals.walkIns)) * 100) : 0}%
                  </p>
                  <Bar value={m.totals.appointments + m.totals.walkIns ? (m.totals.walkIns / (m.totals.appointments + m.totals.walkIns)) * 100 : 0} tone="#6741d9" />
                </div>
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Radio} tone="green" title="Live queues" description="Right now, per doctor." action={<Link to="/admin/doctors" className="text-[13px] font-semibold text-teal hover:underline">Manage</Link>} />
              {live.isLoading ? (
                <LoadingBlock rows={3} />
              ) : (
                <ul className="divide-y divide-line">
                  {live.data?.queues.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-3.5">
                      <Avatar name={d.name} src={d.avatarUrl} size="md" status={d.paused ? 'away' : d.active ? 'busy' : 'online'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{d.name}</p>
                        <p className="text-[12.5px] text-muted">
                          {d.department}, {d.room}
                        </p>
                      </div>
                      <div className="text-right">
                        {d.paused ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-bg px-2 py-0.5 text-[12px] font-semibold text-amber-ink">
                            <PauseCircle className="h-3.5 w-3.5" aria-hidden /> Paused
                          </span>
                        ) : (
                          <p className="font-display text-[16px] font-bold text-teal-700">{d.active?.tokenLabel ?? 'Free'}</p>
                        )}
                        <p className="tabular text-[12px] text-muted">{d.waiting.length} waiting</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={ScatterChart} tone="violet" title="Predicted against actual wait" description="One dot per patient. Dots near the dashed line were accurate." />
              <div className="p-4">{m.eta.points.length ? <EtaScatter points={m.eta.points} /> : <EmptyState title="No calls recorded yet" body="Points appear once checked-in patients are called." />}</div>
            </Card>
            <Card>
              <SectionTitle icon={LineChart} tone="amber" title="Average wait, last 7 days" description="Check-in to being called, in minutes." />
              <div className="p-4">
                <TrendLine data={m.trend} dataKey="avgWaitMin" name="Average wait" unit="min" labelFor={shortDay} />
              </div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr] [&>*]:min-w-0">
            <Card>
              <SectionTitle icon={Trophy} tone="blue" title="Doctor performance" description="Utilisation is booked slots as a share of slots offered that day." />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-[14px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[12.5px] text-muted">
                      <th className="whitespace-nowrap px-5 py-2.5 font-semibold">Doctor</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Booked</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Seen</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Avg wait</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Avg visit</th>
                      <th className="whitespace-nowrap px-5 py-2.5 font-semibold">Utilisation</th>
                    </tr>
                  </thead>
                  <tbody className="tabular divide-y divide-line">
                    {m.perDoctor.map((d) => (
                      <tr key={d.doctorId} className="transition-colors hover:bg-paper/70">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={d.name} src={d.avatarUrl} size="sm" />
                            <div>
                              <p className="font-semibold">{d.name}</p>
                              <p className="text-[12px] text-muted">
                                {d.code}, {d.department}
                              </p>
                            </div>
                            {d.status === 'INACTIVE' && <StatusBadge status="INACTIVE" />}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right">{d.appointments + d.walkIns}</td>
                        <td className="px-3 py-3 text-right font-semibold">{d.completed}</td>
                        <td className="px-3 py-3 text-right">{n(d.avgWaitMin, ' min')}</td>
                        <td className="px-3 py-3 text-right">{n(d.avgConsultMin, ' min')}</td>
                        <td className="w-[180px] px-5 py-3">
                          {d.utilization === null ? (
                            <span className="text-[13px] text-muted">No slots</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Bar value={d.utilization} />
                              <span className="w-12 text-right text-[12.5px] font-semibold">{d.utilization}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <SectionTitle icon={Activity} tone="slate" title="Recent activity" action={<Link to="/admin/audit" className="text-[13px] font-semibold text-teal hover:underline">Audit log</Link>} />
              {activity.isLoading ? (
                <LoadingBlock rows={4} />
              ) : !activity.data?.items.some((e) => e.action !== 'LOGIN') ? (
                <EmptyState title="Nothing yet today" body="Bookings, check-ins and queue actions will appear here." />
              ) : (
                <ol className="relative px-5 py-4">
                  <span className="absolute bottom-6 left-[37px] top-6 w-px bg-line" aria-hidden />
                  {activity.data?.items.filter((e) => e.action !== 'LOGIN').slice(0, 7).map((e) => {
                    const k = auditKind(e.action);
                    return (
                      <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                        <IconTile icon={k.icon} tone={k.tone} size="sm" className="relative z-10 ring-4 ring-white" />
                        <div className="min-w-0 flex-1 pt-0.5">
                          <p className="text-[13.5px] leading-snug">
                            <span className="font-semibold">{e.actor.name}</span> <span className="text-ink-soft">{k.verb}</span>
                          </p>
                          <p className="text-[12px] text-muted">{relative(e.at)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
