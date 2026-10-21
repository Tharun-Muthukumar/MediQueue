import { CornerDownLeft, LogOut, Monitor, Search, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { cx } from './ui';

export interface NavCommand {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  keywords?: string;
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
  keywords?: string;
}

/** Ctrl/⌘ + K quick switcher: jump to any page or action with the keyboard. */
export function CommandPalette({ commands, onSignOut }: { commands: NavCommand[]; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mq:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mq:open-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const all: Command[] = useMemo(
    () => [
      ...commands.map((c) => ({ ...c, run: () => nav(c.to) })),
      { id: 'board', label: 'Open waiting-room board', hint: 'New tab', icon: Monitor, run: () => window.open('/board', '_blank'), keywords: 'tv display screen' },
      { id: 'signout', label: 'Sign out', icon: LogOut, run: onSignOut, keywords: 'logout exit' },
    ],
    [commands, nav, onSignOut],
  );
  const results = all.filter((c) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  const choose = (c?: Command) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Go to" className="token-in w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-white shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-5 w-5 text-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[active]);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Go to a page or action…"
            className="h-14 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
            aria-label="Search pages and actions"
          />
          <kbd className="text-muted">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length ? (
            results.map((c, i) => (
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px]', i === active ? 'bg-teal-50 text-ink' : 'text-ink-2')}
              >
                <c.icon className={cx('h-[18px] w-[18px]', i === active ? 'text-teal' : 'text-muted')} aria-hidden />
                <span className="flex-1 font-medium">{c.label}</span>
                {c.hint && <span className="text-[12px] text-muted">{c.hint}</span>}
                {i === active && <CornerDownLeft className="h-4 w-4 text-teal" aria-hidden />}
              </li>
            ))
          ) : (
            <li className="px-3 py-8 text-center text-[14px] text-muted">Nothing matches “{q}”.</li>
          )}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-paper/60 px-4 py-2 text-[12px] text-muted">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
