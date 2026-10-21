import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { errors } from '../shared/errors';
import type { Services } from './services';
import { id, parse, schemas } from './validation';

/** Catalog, appointments, reception, queue and notification endpoints (blueprint §11). */
export function clinicRoutes(s: Services) {
  const r = Router();
  const staff = requireRole('RECEPTIONIST', 'DOCTOR', 'ADMIN');

  // ── Discovery ─────────────────────────────────────────────
  r.get('/departments', requireAuth, async (req, res) => {
    res.json({ data: await s.catalog.departments(req.actor!) });
  });

  r.get('/doctors', requireAuth, async (req, res) => {
    const q = parse(schemas.doctorsQuery, req.query);
    res.json({ data: await s.catalog.doctors(req.actor!, q.department) });
  });

  r.get('/doctors/:id/slots', requireAuth, async (req, res) => {
    const q = parse(schemas.slotsQuery, req.query);
    res.json({ data: await s.catalog.slots(req.actor!, parse(id, req.params.id), q.date) });
  });

  // ── Appointments ──────────────────────────────────────────
  r.post('/appointments', requireRole('PATIENT'), async (req, res) => {
    const rawKey = req.get('idempotency-key');
    if (!rawKey) throw errors.validation('Idempotency-Key header is required for bookings.');
    const key = parse(schemas.idempotencyKey, rawKey);
    const body = parse(schemas.book, req.body);
    const result = await s.booking.book(req.actor!, body.slotId, key);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  r.get('/appointments/me', requireRole('PATIENT'), async (req, res) => {
    res.json({ data: await s.booking.listMine(req.actor!) });
  });

  r.patch('/appointments/:id/cancel', requireRole('PATIENT', 'RECEPTIONIST', 'ADMIN'), async (req, res) => {
    const body = parse(schemas.cancel, req.body ?? {});
    res.json({ data: await s.booking.cancel(req.actor!, parse(id, req.params.id), body.reason) });
  });

  r.post('/appointments/:id/check-in', requireRole('RECEPTIONIST'), async (req, res) => {
    const body = parse(schemas.checkIn, req.body ?? {});
    const out = await s.reception.checkIn(req.actor!, parse(id, req.params.id), body.overrideReason);
    res.status(out.alreadyCheckedIn ? 200 : 201).json({ data: out });
  });

  r.post('/appointments/:id/no-show', requireRole('RECEPTIONIST'), async (req, res) => {
    const body = parse(schemas.noShow, req.body ?? {});
    res.json({ data: await s.reception.markNoShow(req.actor!, parse(id, req.params.id), body.reason) });
  });

  // ── Reception ─────────────────────────────────────────────
  r.post('/walkins', requireRole('RECEPTIONIST'), async (req, res) => {
    const body = parse(schemas.walkIn, req.body);
    res.status(201).json({ data: await s.reception.walkIn(req.actor!, body) });
  });

  r.get('/reception/today', requireRole('RECEPTIONIST', 'ADMIN'), async (req, res) => {
    const q = parse(schemas.dateQuery, req.query);
    res.json({ data: await s.reception.today(req.actor!, q.date) });
  });

  r.get('/reception/patients', requireRole('RECEPTIONIST'), async (req, res) => {
    const q = parse(schemas.patientSearch, req.query);
    res.json({ data: await s.reception.searchPatients(req.actor!, q.q ?? '') });
  });

  // ── Queue ─────────────────────────────────────────────────
  // /queues/me must be declared before /queues/:doctorId
  r.get('/queues/me', requireRole('PATIENT'), async (req, res) => {
    res.json({ data: await s.queue.myQueue(req.actor!) });
  });

  r.get('/queues/:doctorId', staff, async (req, res) => {
    const q = parse(schemas.dateQuery, req.query);
    res.json({ data: await s.queue.doctorQueue(req.actor!, parse(id, req.params.doctorId), q.date) });
  });

  r.post('/queues/:doctorId/call-next', requireRole('DOCTOR', 'RECEPTIONIST'), async (req, res) => {
    res.json({ data: await s.queue.callNext(req.actor!, parse(id, req.params.doctorId)) });
  });

  r.post('/tickets/:id/start', requireRole('DOCTOR'), async (req, res) => {
    res.json({ data: await s.queue.start(req.actor!, parse(id, req.params.id)) });
  });

  r.post('/tickets/:id/complete', requireRole('DOCTOR'), async (req, res) => {
    res.json({ data: await s.queue.complete(req.actor!, parse(id, req.params.id)) });
  });

  r.post('/tickets/:id/requeue', requireRole('DOCTOR', 'RECEPTIONIST'), async (req, res) => {
    const { reason } = parse(schemas.reasonRequired, req.body ?? {});
    res.json({ data: await s.queue.requeue(req.actor!, parse(id, req.params.id), reason) });
  });

  r.post('/tickets/:id/skip', requireRole('DOCTOR', 'RECEPTIONIST'), async (req, res) => {
    const { reason } = parse(schemas.reasonRequired, req.body ?? {});
    res.json({ data: await s.queue.skip(req.actor!, parse(id, req.params.id), reason) });
  });

  r.post('/doctors/:id/pause', requireRole('DOCTOR', 'ADMIN'), async (req, res) => {
    const { reason } = parse(schemas.pause, req.body ?? {});
    res.json({ data: await s.queue.setPaused(req.actor!, parse(id, req.params.id), true, reason) });
  });

  r.post('/doctors/:id/resume', requireRole('DOCTOR', 'ADMIN'), async (req, res) => {
    res.json({ data: await s.queue.setPaused(req.actor!, parse(id, req.params.id), false) });
  });

  // ── Notifications ─────────────────────────────────────────
  r.get('/notifications', requireAuth, async (req, res) => {
    res.json({ data: await s.notifications.list(req.actor!) });
  });

  r.patch('/notifications/read-all', requireAuth, async (req, res) => {
    res.json({ data: await s.notifications.markAllRead(req.actor!) });
  });

  r.patch('/notifications/:id/read', requireAuth, async (req, res) => {
    res.json({ data: await s.notifications.markRead(req.actor!, parse(id, req.params.id)) });
  });

  return r;
}
