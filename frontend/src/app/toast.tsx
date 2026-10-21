import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 4200);
  }, []);

  const icon = { success: CheckCircle2, error: CircleAlert, info: Info };
  const color = { success: 'text-green-ink', error: 'text-red-ink', info: 'text-teal' };

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite" role="status">
        {toasts.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} className="token-in pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border border-line bg-white p-3.5 shadow-[var(--shadow-pop)]">
              <span className={`toast-timer absolute inset-x-0 bottom-0 h-[3px] ${t.tone === 'error' ? 'bg-red-ink/60' : t.tone === 'success' ? 'bg-green-ink/50' : 'bg-teal/50'}`} style={{ animationDuration: `${t.tone === 'error' ? 7000 : 4200}ms` }} aria-hidden />
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color[t.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{t.title}</p>
                {t.body && <p className="mt-0.5 text-[13px] text-ink-soft">{t.body}</p>}
              </div>
              <button className="rounded p-0.5 text-muted hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
