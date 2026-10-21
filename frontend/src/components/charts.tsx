import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';

/** Chart palette (validated with the dataviz checker: chroma, CVD ΔE 12.9, contrast ≥ 3:1). */
export const SERIES = ['#009096', '#eb6834'] as const;
const GRID = '#e6ebe9';
const AXIS = { fontSize: 12, fill: '#6b7a8c' };

function TipBox({ title, rows }: { title: ReactNode; rows: { color?: string; label: string; value: ReactNode }[] }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-ink-soft">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          {r.label}: <span className="tabular font-semibold text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TipProps = { active?: boolean; label?: any; payload?: readonly { name?: string | number; value?: any; color?: string; payload?: any }[] };

export function HourlyBars({ data }: { data: { hour: string; arrivals: number; completed: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={1} />
        <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'rgb(18 38 67 / 0.04)' }}
          content={({ active, label, payload }: TipProps) =>
            active && payload?.length ? <TipBox title={label} rows={payload.map((p) => ({ color: p.color, label: String(p.name), value: p.value ?? '—' }))} /> : null
          }
        />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12.5, color: '#2a3d5c' }} />
        <Bar dataKey="arrivals" name="Arrivals (check-ins)" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="completed" name="Visits completed" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, dataKey, name, unit, labelFor }: { data: Record<string, unknown>[]; dataKey: string; name: string; unit: string; labelFor: (d: string) => string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={labelFor} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ stroke: '#c4cfcc', strokeDasharray: '3 3' }}
          content={({ active, label, payload }: TipProps) =>
            active && payload?.length ? <TipBox title={labelFor(String(label))} rows={[{ color: SERIES[0], label: name, value: payload[0].value === null ? 'no data' : `${payload[0].value} ${unit}` }]} /> : null
          }
        />
        <Line type="monotone" dataKey={dataKey} name={name} stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: SERIES[0], stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function EtaScatter({ points }: { points: { token: string; predictedMin: number; actualMin: number }[] }) {
  const max = Math.max(10, ...points.map((p) => Math.max(p.predictedMin, p.actualMin))) * 1.05;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 10, right: 16, left: -10, bottom: 14 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey="predictedMin" name="Predicted" domain={[0, Math.ceil(max)]} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} label={{ value: 'Predicted wait (min)', position: 'insideBottom', offset: -8, fontSize: 12, fill: '#52637a' }} />
        <YAxis type="number" dataKey="actualMin" name="Actual" domain={[0, Math.ceil(max)]} tick={AXIS} tickLine={false} axisLine={false} label={{ value: 'Actual (min)', angle: -90, position: 'insideLeft', offset: 18, fontSize: 12, fill: '#52637a' }} />
        <ZAxis range={[70, 70]} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.ceil(max), y: Math.ceil(max) }]} stroke="#9aa8a5" strokeDasharray="4 4" ifOverflow="extendDomain" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }: TipProps) => {
            const p = active && payload?.[0]?.payload;
            return p ? (
              <TipBox
                title={`Token ${p.token}`}
                rows={[
                  { label: 'Predicted', value: `${p.predictedMin} min` },
                  { label: 'Actual', value: `${p.actualMin} min` },
                ]}
              />
            ) : null;
          }}
        />
        <Scatter data={points} fill={SERIES[0]} fillOpacity={0.85} stroke="#fff" strokeWidth={1.5} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
