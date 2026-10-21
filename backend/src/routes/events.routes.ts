import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import type { DomainEvent } from '../events/eventBus';
import type { Services } from './services';

/**
 * Server-Sent Events (blueprint enhancement E05). The stream carries only "something changed"
 * hints (ids, no personal data); browsers refetch through normal authorised endpoints.
 * TanStack Query polling remains as a fallback if the stream drops.
 */
function openStream(req: Request, res: Response, filter: (e: DomainEvent) => DomainEvent | null, s: Services) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);
  res.write(`event: ready\ndata: {}\n\n`);
  const unsubscribe = s.events.subscribe((e) => {
    const out = filter(e);
    if (out) res.write(`event: change\ndata: ${JSON.stringify(out)}\n\n`);
  });
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

export function eventRoutes(s: Services) {
  const r = Router();

  r.get('/events', requireAuth, (req, res) => {
    const actor = req.actor!;
    openStream(
      req,
      res,
      (e) => {
        if (e.type === 'notification.created') return e.userId === actor.id ? e : null;
        return e;
      },
      s,
    );
  });

  /** Public board stream: queue-change hints only. */
  r.get('/public/events', (req, res) => {
    openStream(req, res, (e) => (e.type === 'queue.changed' || e.type === 'doctors.changed' ? ({ type: e.type } as unknown as DomainEvent) : null), s);
  });

  r.get('/public/board', async (_req, res) => {
    res.json({ data: await s.board.board() });
  });

  return r;
}
