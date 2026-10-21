import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { csrfProtection, loadSession } from './auth/middleware';
import { EventBus } from './events/eventBus';
import type { Store } from './repositories/types';
import { adminRoutes } from './routes/admin.routes';
import { authRoutes } from './routes/auth.routes';
import { clinicRoutes } from './routes/clinic.routes';
import { eventRoutes } from './routes/events.routes';
import { buildServices, type Services } from './routes/services';
import { AppError } from './shared/errors';
import { randomToken, systemClock, type Clock } from './shared/util';

export interface AppOptions {
  store: Store;
  clock?: Clock;
  events?: EventBus;
  bcryptRounds?: number;
  /** Serve the built frontend (frontend/dist) from the API process — used by `npm start`. */
  serveFrontend?: string | null;
  apiRateLimitPerMinute?: number;
}

export function createApp(opts: AppOptions): { app: express.Express; services: Services } {
  const services = buildServices({
    store: opts.store,
    clock: opts.clock ?? systemClock,
    events: opts.events ?? new EventBus(),
    bcryptRounds: opts.bcryptRounds ?? (config.isTest ? 4 : 10),
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    req.id = `req_${randomToken(6)}`;
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors({ origin: config.frontendOrigins, credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] }));
  app.use(express.json({ limit: '256kb' })); // room for a small profile photo
  app.use(cookieParser(config.sessionSecret));

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: opts.apiRateLimitPerMinute ?? (config.isTest ? 100_000 : 1200),
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Slow down and try again shortly.', requestId: req.id } });
      },
    }),
  );

  api.get('/health', async (_req, res) => {
    const db = await opts.store.ping();
    res.status(db ? 200 : 503).json({ data: { status: db ? 'ok' : 'degraded', database: db ? 'ready' : 'unavailable', time: new Date().toISOString() } });
  });

  api.use(loadSession(services.auth));
  api.use(csrfProtection);
  api.use('/auth', authRoutes(services));
  api.use('/admin', adminRoutes(services));
  api.use(eventRoutes(services));
  api.use(clinicRoutes(services));
  api.use((req, _res, next) => next(new AppError(404, 'NOT_FOUND', `No endpoint ${req.method} ${req.path}`)));

  app.use('/api/v1', api);

  if (opts.serveFrontend && fs.existsSync(path.join(opts.serveFrontend, 'index.html'))) {
    const dist = opts.serveFrontend;
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Consistent error envelope: { error: { code, message, requestId } }. Stack traces stay in server logs.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, requestId: req.id, ...(err.details ? { details: err.details } : {}) } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.', requestId: req.id } });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.', requestId: req.id } });
      return;
    }
    if (!config.isTest) console.error(`[${req.id}]`, err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Try again in a moment.', requestId: req.id } });
  });

  return { app, services };
}
