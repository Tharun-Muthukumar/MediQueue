import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import type { Actor, Role, SafeUser } from '../domain/types';
import { AppError, errors } from '../shared/errors';
import { randomToken } from '../shared/util';
import type { AuthService } from '../services/auth.service';

export const SESSION_COOKIE = 'mq_session';
export const CSRF_COOKIE = 'mq_csrf';
export const CSRF_HEADER = 'x-csrf-token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      actor?: Actor;
      user?: SafeUser;
    }
  }
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.cookieSecure,
    signed: true,
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** Issues the double-submit CSRF cookie (readable by the SPA, not HttpOnly). */
export function issueCsrf(res: Response): string {
  const token = randomToken(24);
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'lax', secure: config.cookieSecure, path: '/' });
  return token;
}

export function loadSession(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
    const resolved = token ? await auth.resolve(token) : null;
    if (resolved) {
      req.actor = resolved.actor;
      req.user = resolved.user;
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.actor) return next(errors.unauthenticated());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(errors.unauthenticated());
    if (!roles.includes(req.actor.role)) return next(errors.forbidden());
    next();
  };
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * CSRF protection for cookie-authenticated, state-changing requests: the X-CSRF-Token header
 * must equal the mq_csrf cookie (double submit), and any Origin header must be allow-listed.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    const sameHost = host && (origin === `http://${host}` || origin === `https://${host}`);
    if (!sameHost && !config.frontendOrigins.includes(origin)) {
      return next(new AppError(403, 'CSRF_FAILED', 'Request origin is not allowed.'));
    }
  }
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Security token missing or expired. Refresh the page and try again.'));
  }
  next();
}
