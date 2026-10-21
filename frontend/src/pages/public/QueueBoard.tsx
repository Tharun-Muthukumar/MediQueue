import { useQuery } from '@tanstack/react-query';
import { Maximize2, PauseCircle, Volume2, VolumeX } from 'lucide-react';
import { playChime } from '../../components/motion';
import { useEffect, useRef, useState } from 'react';
import { LiveProvider, usePollInterval } from '../../app/live';
import { Logo } from '../../components/token';
import { cx } from '../../components/ui';
import { get } from '../../lib/api';
import { dateLong, minutes, time } from '../../lib/format';
import type { Board } from '../../lib/types';

/** Waiting-room display: anonymised tokens and rooms only. Designed for a TV on the wall. */
function BoardInner() {
  const poll = usePollInterval(5000, 20000);
  const q = useQuery({ queryKey: ['board'], queryFn: () => get<Board>('/public/board'), refetchInterval: poll });
  const [now, setNow] = useState(Date.now());
  const prev = useRef<Record<string, string | undefined>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('mq-board-sound') === 'on';
    } catch {
      return false;
    }
  });
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    if (next) playChime();
    try {
      localStorage.setItem('mq-board-sound', next ? 'on' : 'off');
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!q.data) return;
    const changed: Record<string, number> = {};
    for (const d of q.data.doctors) {
      const cur = d.nowServing?.tokenLabel;
      if (prev.current[d.code] !== undefined && cur && prev.current[d.code] !== cur) changed[d.code] = Date.now();
      prev.current[d.code] = cur ?? '';
    }
    if (Object.keys(changed).length) {
      setFlash((f) => ({ ...f, ...changed }));
      if (sound) playChime();
    }
  }, [q.data, sound]);

  const b = q.data;
  return (
    <div className="dark-field relative min-h-screen overflow-hidden bg-ink px-5 py-6 text-white sm:px-10 sm:py-8" data-surface="dark" data-spotlight="">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <Logo light />
          <div className="hidden border-l border-white/15 pl-5 sm:block">
            <p className="font-display text-[20px] font-semibold">{b?.clinicName ?? 'Waiting room'}</p>
            <p className="text-[14px] text-white/55">{dateLong(new Date(now))}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="tabular font-display text-[40px] font-bold leading-none">{time(new Date(now))}</p>
          <button className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Turn call chime off' : 'Turn call chime on'} title="Chime when a token is called">
            {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <button className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Full screen">
            <Maximize2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mt-8">
        {q.isError && <p className="text-[18px] text-white/70">The board can't reach the clinic server. It will retry automatically.</p>}
        <div className="grid gap-5 lg:grid-cols-3" aria-live="polite">
          {b?.doctors.map((d) => (
            <section key={d.code} className={cx('relative rounded-3xl border border-white/10 bg-white/[0.04] p-6 transition-colors duration-700', !!flash[d.code] && Date.now() - flash[d.code] < 8000 && 'border-[#5eead4] bg-[#5eead4]/10')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-[24px] font-semibold text-white">{d.room}</h2>
                  <p className="text-[15px] text-white/60">
                    {d.doctorName}, {d.department}
                  </p>
                </div>
                {d.paused && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fbbf24]/15 px-3 py-1 text-[13px] font-semibold text-[#fcd34d]">
                    <PauseCircle className="h-4 w-4" aria-hidden /> Paused
                  </span>
                )}
              </div>
              <p className="mt-6 text-[15px] font-medium text-white/55">Now serving</p>
              <p className="token-number mt-1 text-[88px] text-[#5eead4] sm:text-[104px]">
                <span key={d.nowServing?.tokenLabel ?? 'none'} className="flip-in">
                  {d.nowServing?.tokenLabel.split('-')[1] ?? '—'}
                </span>
              </p>
              <p className="font-display text-[18px] font-semibold text-white/70">{d.nowServing?.tokenLabel ?? (d.paused ? 'Paused' : d.notStartedYet && d.opensAt ? `Starts ${time(d.opensAt)}` : 'Room free')}</p>
              <div className="mt-6 border-t border-white/10 pt-4">
                <p className="text-[14px] font-medium text-white/55">Next in line</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.upNext.length ? (
                    d.upNext.map((t) => (
                      <span key={t} className="tabular rounded-lg bg-white/10 px-3 py-1.5 font-display text-[20px] font-semibold">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-[16px] text-white/50">No one waiting</span>
                  )}
                </div>
                {d.waitingCount > 0 && (
                  <p className="mt-3 text-[14px] text-white/50">
                    {d.waitingCount} waiting
                    {d.paused ? '' : d.notStartedYet && d.opensAt ? `, doctor starts at ${time(d.opensAt)}` : d.approxWaitMin ? `, about ${minutes(d.approxWaitMin * 60)} for the last in line` : ''}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </main>
      <footer className="mt-10 text-[14px] text-white/45">
        Please wait for your token to appear. Order: two booked appointments, then one walk-in. If you feel unwell, tell reception immediately.
      </footer>
    </div>
  );
}

export default function QueueBoard() {
  return (
    <LiveProvider path="/public/events">
      <BoardInner />
    </LiveProvider>
  );
}
