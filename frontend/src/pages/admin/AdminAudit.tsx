import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, PageHeader, Select } from '../../components/ui';
import { get } from '../../lib/api';
import { Avatar, IconTile } from '../../components/kit';
import { auditKind } from '../../components/auditKinds';
import { dateTime, titleCase } from '../../lib/format';
import type { AuditItem } from '../../lib/types';

const ACTIONS = [
  'APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'CHECKED_IN', 'WALKIN_REGISTERED', 'WALKIN_PROFILE_CREATED', 'NO_SHOW_MARKED',
  'QUEUE_CALLED', 'CONSULT_STARTED', 'CONSULT_COMPLETED', 'QUEUE_REQUEUED', 'QUEUE_SKIPPED', 'QUEUE_PAUSED', 'QUEUE_RESUMED',
  'DOCTOR_CREATED', 'DOCTOR_UPDATED', 'DOCTOR_DEACTIVATED', 'DOCTOR_REACTIVATED', 'SLOTS_GENERATED', 'SLOT_DELETED',
  'STAFF_CREATED', 'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_REGISTERED', 'SETTINGS_UPDATED', 'REPORT_EXPORTED', 'LOGIN', 'DEMO_SEEDED',
];
const ENTITIES = ['Appointment', 'QueueTicket', 'Doctor', 'Slot', 'User', 'Clinic', 'Report'];

function Change({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <span className="text-muted">—</span>;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].slice(0, 4);
  const fmt = (v: unknown) => (v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <span className="block space-y-0.5 text-[12.5px]">
      {keys.map((k) => (
        <span key={k} className="block">
          <span className="text-muted">{k}: </span>
          {before && k in before && (
            <>
              <span className="text-ink-soft line-through decoration-1">{fmt(before[k])}</span>{' '}
            </>
          )}
          {after && k in after && <span className="font-semibold text-ink">{fmt(after[k])}</span>}
        </span>
      ))}
    </span>
  );
}

export default function AdminAudit() {
  const [f, setF] = useState({ action: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  Object.entries(f).forEach(([k, v]) => v && params.set(k, v));
  const q = useQuery({ queryKey: ['audit', f, page], queryFn: () => get<{ items: AuditItem[]; total: number; page: number; pageSize: number }>(`/admin/audit?${params}`), placeholderData: (p) => p });
  const set = (k: keyof typeof f, v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;

  return (
    <>
      <PageHeader icon={ScrollText} tone="navy" title="Audit log" description="Every booking, check-in, queue action, override and setting change, with who did it and why. No passwords or clinical notes are stored." />
      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_170px_170px_auto]">
          <Field label="Action" htmlFor="au-action">
            <Select id="au-action" value={f.action} onChange={(e) => set('action', e.target.value)}>
              <option value="">All actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {titleCase(a)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Record type" htmlFor="au-entity">
            <Select id="au-entity" value={f.entityType} onChange={(e) => set('entityType', e.target.value)}>
              <option value="">All records</option>
              {ENTITIES.map((a) => (
                <option key={a} value={a}>
                  {a.replace('QueueTicket', 'Queue ticket')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="au-from">
            <Input id="au-from" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="To" htmlFor="au-to">
            <Input id="au-to" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                setF({ action: '', entityType: '', from: '', to: '' });
                setPage(1);
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        {q.isLoading ? (
          <LoadingBlock rows={8} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState title="No events match these filters" body="Widen the date range or clear the filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12.5px] text-muted">
                    <th className="px-4 py-2.5 font-semibold">When</th>
                    <th className="px-4 py-2.5 font-semibold">Who</th>
                    <th className="px-4 py-2.5 font-semibold">Action</th>
                    <th className="px-4 py-2.5 font-semibold">Record</th>
                    <th className="px-4 py-2.5 font-semibold">Change</th>
                    <th className="px-4 py-2.5 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line align-top">
                  {q.data.items.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="hover:bg-paper/60">
                        <td className="tabular whitespace-nowrap px-4 py-3 text-[13px]">{dateTime(e.at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={e.actor.name} src={e.actor.avatarUrl} size="sm" />
                            <div>
                              <p className="font-semibold">{e.actor.name}</p>
                              <p className="text-[12.5px] text-muted">{titleCase(e.actor.role ?? 'SYSTEM')}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5 font-semibold">
                            <IconTile icon={auditKind(e.action).icon} tone={auditKind(e.action).tone} size="sm" />
                            {titleCase(e.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p>{e.entityType.replace('QueueTicket', 'Queue ticket')}</p>
                          <p className="font-mono text-[11.5px] text-muted" title={e.entityId}>
                            {e.entityId.slice(0, 8)}
                          </p>
                        </td>
                        <td className="max-w-[280px] px-4 py-3">
                          <Change before={e.before} after={e.after} />
                        </td>
                        <td className="max-w-[220px] px-4 py-3 text-[13.5px] text-ink-soft">{e.reason ?? '—'}</td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13.5px] text-ink-soft">
              <span className="tabular">
                {q.data.total} events, page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Older <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
