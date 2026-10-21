import { Router } from 'express';
import { requireRole } from '../auth/middleware';
import type { Services } from './services';
import { id, parse, schemas } from './validation';

export function adminRoutes(s: Services) {
  const r = Router();
  r.use(requireRole('ADMIN'));

  r.get('/metrics', async (req, res) => {
    const q = parse(schemas.dateQuery, req.query);
    res.json({ data: await s.admin.metrics(req.actor!, q.date) });
  });

  r.get('/audit', async (req, res) => {
    const q = parse(schemas.auditQuery, req.query);
    res.json({ data: await s.admin.auditLog(req.actor!, q) });
  });

  r.get('/reports/daily.csv', async (req, res) => {
    const q = parse(schemas.dateQuery, req.query);
    const { filename, csv } = await s.admin.dailyCsv(req.actor!, q.date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  r.get('/doctors', async (req, res) => {
    res.json({ data: await s.admin.listDoctors(req.actor!) });
  });

  r.post('/doctors', async (req, res) => {
    const body = parse(schemas.createDoctor, req.body);
    res.status(201).json({ data: await s.admin.createDoctor(req.actor!, body) });
  });

  r.patch('/doctors/:id', async (req, res) => {
    const body = parse(schemas.updateDoctor, req.body);
    res.json({ data: await s.admin.updateDoctor(req.actor!, parse(id, req.params.id), body) });
  });

  r.get('/doctors/:id/slots', async (req, res) => {
    const q = parse(schemas.slotRange, req.query);
    res.json({ data: await s.admin.doctorSlots(req.actor!, parse(id, req.params.id), q.from, q.to) });
  });

  r.post('/slots/generate', async (req, res) => {
    const body = parse(schemas.generateSlots, req.body);
    res.status(201).json({ data: await s.admin.generateSlots(req.actor!, body) });
  });

  r.delete('/slots/:id', async (req, res) => {
    res.json({ data: await s.admin.deleteSlot(req.actor!, parse(id, req.params.id)) });
  });

  r.get('/staff', async (req, res) => {
    res.json({ data: await s.admin.listStaff(req.actor!) });
  });

  r.post('/staff', async (req, res) => {
    const body = parse(schemas.createStaff, req.body);
    res.status(201).json({ data: await s.admin.createStaff(req.actor!, body) });
  });

  r.patch('/users/:id/active', async (req, res) => {
    const body = parse(schemas.setActive, req.body);
    res.json({ data: await s.admin.setUserActive(req.actor!, parse(id, req.params.id), body.isActive) });
  });

  r.get('/settings', async (req, res) => {
    res.json({ data: await s.admin.settings(req.actor!) });
  });

  r.patch('/settings', async (req, res) => {
    const body = parse(schemas.settings, req.body);
    res.json({ data: await s.admin.updateSettings(req.actor!, body) });
  });

  return r;
}
