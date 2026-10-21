import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { CSRF_COOKIE, issueCsrf, requireAuth, SESSION_COOKIE, sessionCookieOptions } from '../auth/middleware';
import type { Services } from './services';
import { parse, schemas } from './validation';

export function authRoutes(s: Services) {
  const r = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.isTest ? 1000 : 20,
    // Only failed attempts count: this stops password guessing without locking out a busy shared front-desk PC.
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in attempts. Wait a few minutes and try again.', requestId: req.id } });
    },
  });

  /** Returns a fresh CSRF token (also set as a cookie). The SPA calls this before its first write. */
  r.get('/csrf', (req, res) => {
    const existing = req.cookies?.[CSRF_COOKIE] as string | undefined;
    res.json({ data: { csrfToken: existing ?? issueCsrf(res) } });
  });

  r.post('/register', loginLimiter, async (req, res) => {
    const body = parse(schemas.register, req.body);
    const user = await s.auth.register(body);
    res.status(201).json({ data: { user } });
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(schemas.login, req.body);
    const { token, expiresAt, user } = await s.auth.login(email, password);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    const csrfToken = issueCsrf(res); // rotate on privilege change
    res.json({ data: { user, csrfToken, expiresAt } });
  });

  r.post('/logout', async (req, res) => {
    await s.auth.logout(req.signedCookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ data: { signedOut: true } });
  });

  /** Like /me but answers 200 with null when signed out, so the SPA can probe without a 401. */
  r.get('/session', async (req, res) => {
    if (!req.actor) {
      res.json({ data: null });
      return;
    }
    const doctor = req.actor.doctorId ? await s.store.doctors.findById(req.actor.doctorId) : null;
    const clinic = await s.store.clinics.get(req.actor.clinicId);
    res.json({
      data: {
        user: req.user,
        doctor: doctor ? { id: doctor.id, code: doctor.code, department: doctor.department, room: doctor.room } : null,
        clinic: clinic ? { id: clinic.id, name: clinic.name, timezone: clinic.timezone } : null,
      },
    });
  });

  r.patch('/me', requireAuth, async (req, res) => {
    const body = parse(schemas.updateProfile, req.body);
    const user = await s.auth.updateProfile(req.actor!, { ...body, phone: body.phone === undefined ? undefined : body.phone ?? null });
    res.json({ data: { user } });
  });

  r.post('/password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = parse(schemas.changePassword, req.body);
    res.json({ data: await s.auth.changePassword(req.actor!, req.signedCookies?.[SESSION_COOKIE], currentPassword, newPassword) });
  });

  r.get('/me', requireAuth, async (req, res) => {
    const doctor = req.actor!.doctorId ? await s.store.doctors.findById(req.actor!.doctorId) : null;
    const clinic = await s.store.clinics.get(req.actor!.clinicId);
    res.json({
      data: {
        user: req.user,
        doctor: doctor ? { id: doctor.id, code: doctor.code, department: doctor.department, room: doctor.room } : null,
        clinic: clinic ? { id: clinic.id, name: clinic.name, timezone: clinic.timezone } : null,
      },
    });
  });

  return r;
}
