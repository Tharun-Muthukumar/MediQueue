/**
 * MediQueue deterministic demo seed (blueprint §9.4, Appendix B).
 *  - One clinic (DemoCare OPD), 3 doctors, 1 admin, 1 receptionist, 12 fictional patients
 *  - 7 working days of simulated history run through the real queue policy + ETA engine
 *  - Today: the Appendix B.2 token scenario for D01 plus bookings waiting for reception
 *  - Two weeks of future slots with some bookings
 * Fixed PRNG seed → same shape every run. Dates are relative to "now" (override with SEED_NOW).
 * WARNING: wipes the database it points at. Demo credentials are for local use only.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { rng, simulateSession } from '../src/domain/simulation';
import { addDays, isoWeekday, localDateLabel, localTime, serviceDateOf, zonedTimeToUtc } from '../src/shared/time';

const prisma = new PrismaClient();
const TZ = process.env.CLINIC_TIMEZONE ?? 'Asia/Kolkata';
const NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date();
const random = rng(2026);
const min = (n: number) => n * 60_000;
const ago = (m: number) => new Date(NOW.getTime() - min(m));
const pad3 = (n: number) => String(n).padStart(3, '0');

const DOCTORS = [
  { code: 'D01', name: 'Dr. Maya Iyer', email: 'doctor1@gmail.com', department: 'General Medicine', room: 'Room 101', avg: 12, start: '09:00', end: '13:00', slot: 15, median: 12, bio: 'Family physician focused on everyday outpatient care.' },
  { code: 'D02', name: 'Dr. Arjun Rao', email: 'doctor2@gmail.com', department: 'Dermatology', room: 'Room 204', avg: 10, start: '10:00', end: '14:00', slot: 15, median: 10, bio: 'Skin, hair and nail consultations.' },
  { code: 'D03', name: 'Dr. Neha Shah', email: 'doctor3@gmail.com', department: 'Orthopedics', room: 'Room 310', avg: 15, start: '14:00', end: '18:00', slot: 20, median: 15, bio: 'Joint, bone and sports-injury outpatient care.' },
];

const PATIENTS = [
  ['Aarav Menon', '+91 98400 10001'],
  ['Diya Krishnan', '+91 98400 10002'],
  ['Kabir Sethi', '+91 98400 10003'],
  ['Ananya Pillai', '+91 98400 10004'],
  ['Rohan Desai', '+91 98400 10005'],
  ['Ishita Bose', '+91 98400 10006'],
  ['Vihaan Nair', '+91 98400 10007'],
  ['Meera Joshi', '+91 98400 10008'],
  ['Farhan Qureshi', '+91 98400 10009'],
  ['Lakshmi Iyengar', '+91 98400 10010'],
  ['Tanvi Shetty', '+91 98400 10011'],
  ['Dev Malhotra', '+91 98400 10012'],
] as const;

function slotTimes(date: string, start: string, end: string, slotMin: number) {
  const out: { startAt: Date; endAt: Date }[] = [];
  let s = zonedTimeToUtc(date, start, TZ);
  const e = zonedTimeToUtc(date, end, TZ);
  while (s.getTime() + min(slotMin) <= e.getTime()) {
    out.push({ startAt: s, endAt: new Date(s.getTime() + min(slotMin)) });
    s = new Date(s.getTime() + min(slotMin));
  }
  return out;
}

async function wipe() {
  // Child tables first.
  await prisma.consultation.deleteMany();
  await prisma.queueTicket.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.queueCounter.deleteMany();
  await prisma.doctorQueueState.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.session.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.clinic.deleteMany();
}

async function main() {
  console.log(`Seeding MediQueue demo data (now = ${NOW.toISOString()}, clinic timezone ${TZ})…`);
  await wipe();
  const today = serviceDateOf(NOW, TZ);

  const clinic = await prisma.clinic.create({
    data: { name: 'DemoCare OPD', timezone: TZ, walkInRatio: 2, graceMinutes: 15, lateAfterMinutes: 15, autoNoShow: false, defaultConsultMinutes: 12, bookingHorizonDays: 14 },
  });

  const [hAdmin, hRecep, hDoc, hPat] = await Promise.all(
    ['admin123', 'reception123', 'doctor123', 'patient123'].map((p) => bcrypt.hash(p, 10)),
  );

  const admin = await prisma.user.create({ data: { email: 'admin@gmail.com', passwordHash: hAdmin, name: 'Asha Verma', role: 'ADMIN', clinicId: clinic.id, phone: '+91 98400 20001' } });
  const reception = await prisma.user.create({ data: { email: 'reception@gmail.com', passwordHash: hRecep, name: 'Ravi Kumar', role: 'RECEPTIONIST', clinicId: clinic.id, phone: '+91 98400 20002' } });

  const doctors: Array<(typeof DOCTORS)[number] & { id: string; userId: string }> = [];
  for (const d of DOCTORS) {
    const u = await prisma.user.create({ data: { email: d.email, passwordHash: hDoc, name: d.name, role: 'DOCTOR', clinicId: clinic.id } });
    const doc = await prisma.doctor.create({ data: { userId: u.id, clinicId: clinic.id, code: d.code, department: d.department, room: d.room, avgMinutes: d.avg, bio: d.bio } });
    doctors.push({ ...d, id: doc.id, userId: u.id });
  }

  const patients: Array<{ id: string; name: string }> = [];
  for (let i = 0; i < PATIENTS.length; i++) {
    const [name, phone] = PATIENTS[i];
    patients.push(
      await prisma.user.create({
        data: { email: `patient${i + 1}@gmail.com`, passwordHash: hPat, name, phone, role: 'PATIENT', clinicId: clinic.id, createdAt: ago(60 * 24 * 30) },
      }),
    );
  }
  const P = (n: number) => patients[n - 1]; // 1-based like the demo emails

  // ── History: previous 7 working days (Mon–Sat), simulated ───────────────────
  const historyDays: string[] = [];
  for (let back = 1; historyDays.length < 7 && back < 14; back++) {
    const d = addDays(today, -back);
    if (isoWeekday(d) !== 7) historyDays.unshift(d);
  }
  const learned = new Map<string, number[]>(doctors.map((d) => [d.id, []]));
  let patientCursor = 0;
  const nextPatient = () => patients[1 + (patientCursor++ % (patients.length - 1))]; // patient1 kept for curated history
  let etaSamples = 0;

  for (const day of historyDays) {
    for (const d of doctors) {
      const times = slotTimes(day, d.start, d.end, d.slot);
      const booked = times.map(() => random() < 0.62);
      const cancelledIdx = booked.findIndex((b, i) => !b && i > 2);
      const slotRows = times.map((t, i) => ({ id: randomUUID(), doctorId: d.id, serviceDate: day, startAt: t.startAt, endAt: t.endAt, capacity: 1, reservedCount: booked[i] ? 1 : 0 }));
      await prisma.slot.createMany({ data: slotRows });

      const sim = simulateSession({
        slots: times.map((t, i) => ({ startAt: t.startAt, booked: booked[i] })),
        walkIns: 2 + Math.floor(random() * 2),
        sessionStart: times[0].startAt,
        sessionEnd: times[times.length - 1].endAt,
        medianConsultMin: d.median,
        defaultMin: 12,
        ratio: 2,
        noShowRate: 0.08,
        history: learned.get(d.id)!,
        random,
      });
      learned.set(d.id, sim.history.slice(0, 30));

      let maxToken = 0;
      for (const v of sim.visits) {
        const patient = day === historyDays[historyDays.length - 2] && v.slotIndex === 1 && d.code === 'D01' ? P(1) : nextPatient();
        let appointmentId: string | null = null;
        if (v.source === 'SCHEDULED') {
          const slot = slotRows[v.slotIndex!];
          const a = await prisma.appointment.create({
            data: {
              patientId: patient.id, doctorId: d.id, slotId: slot.id, serviceDate: day,
              status: v.noShow ? 'NO_SHOW' : 'COMPLETED',
              bookedAt: new Date(slot.startAt.getTime() - min(60 * 24 * (1 + Math.floor(random() * 5)))),
              checkedInAt: v.checkedInAt, completedAt: v.completedAt, noShowAt: v.noShow ? new Date(slot.startAt.getTime() + min(16)) : null,
            },
          });
          appointmentId = a.id;
        }
        if (v.checkedInAt) {
          maxToken = Math.max(maxToken, v.tokenNumber!);
          const t = await prisma.queueTicket.create({
            data: {
              doctorId: d.id, serviceDate: day, tokenNumber: v.tokenNumber!, tokenLabel: `${d.code}-${pad3(v.tokenNumber!)}`,
              patientId: patient.id, appointmentId, source: v.source, status: 'COMPLETED',
              scheduledAt: v.slotIndex !== null ? slotRows[v.slotIndex].startAt : null,
              checkedInAt: v.checkedInAt, calledAt: v.calledAt, startedAt: v.startedAt, completedAt: v.completedAt,
              isLate: v.slotIndex !== null && v.checkedInAt.getTime() > slotRows[v.slotIndex].startAt.getTime() + min(15),
              predictedWaitSec: v.predictedWaitSec, baselineWaitSec: v.baselineWaitSec,
            },
          });
          etaSamples++;
          await prisma.consultation.create({ data: { queueTicketId: t.id, doctorId: d.id, startedAt: v.startedAt!, endedAt: v.completedAt, durationSec: v.durationSec } });
        }
      }
      if (cancelledIdx >= 0) {
        await prisma.appointment.create({
          data: {
            patientId: nextPatient().id, doctorId: d.id, slotId: slotRows[cancelledIdx].id, serviceDate: day, status: 'CANCELLED',
            bookedAt: new Date(slotRows[cancelledIdx].startAt.getTime() - min(60 * 30)), cancelledAt: new Date(slotRows[cancelledIdx].startAt.getTime() - min(60 * 5)),
            cancelReason: 'Cancelled by patient',
          },
        });
      }
      await prisma.queueCounter.create({ data: { doctorId: d.id, serviceDate: day, lastNumber: maxToken } });
      await prisma.doctorQueueState.create({ data: { doctorId: d.id, serviceDate: day, appointmentStreak: sim.streak } });
    }
  }

  // Two historical doctor pauses for the audit trail (blueprint §9.4).
  const pauseDays = historyDays.slice(-3, -1);
  const pauses = [
    { doc: doctors[1], day: pauseDays[0], at: '11:10', back: '11:30', reason: 'Called to assist a colleague' },
    { doc: doctors[2], day: pauseDays[1], at: '16:00', back: '16:15', reason: 'Equipment check in procedure room' },
  ];
  for (const p of pauses) {
    const actorRole = 'DOCTOR';
    await prisma.auditEvent.create({ data: { actorId: p.doc.userId, actorRole, action: 'QUEUE_PAUSED', entityType: 'Doctor', entityId: p.doc.id, reason: p.reason, beforeJson: '{"paused":false}', afterJson: '{"paused":true}', at: zonedTimeToUtc(p.day, p.at, TZ) } });
    await prisma.auditEvent.create({ data: { actorId: p.doc.userId, actorRole, action: 'QUEUE_RESUMED', entityType: 'Doctor', entityId: p.doc.id, beforeJson: '{"paused":true}', afterJson: '{"paused":false}', at: zonedTimeToUtc(p.day, p.back, TZ) } });
  }

  // ── Today and the next 14 days: slots (Mon–Sat, plus today whatever the weekday) ──
  const futureDays: string[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = addDays(today, i);
    if (i === 0 || isoWeekday(d) !== 7) futureDays.push(d);
  }
  const slotIndex = new Map<string, { id: string; startAt: Date; endAt: Date }[]>();
  for (const d of doctors) {
    for (const day of futureDays) {
      const rows = slotTimes(day, d.start, d.end, d.slot).map((t) => ({ id: randomUUID(), doctorId: d.id, serviceDate: day, startAt: t.startAt, endAt: t.endAt, capacity: 1, reservedCount: 0 }));
      await prisma.slot.createMany({ data: rows });
      slotIndex.set(`${d.id}|${day}`, rows);
    }
  }
  const slotsOf = (doc: (typeof doctors)[number], day: string) => slotIndex.get(`${doc.id}|${day}`)!;

  async function book(patientId: string, doc: (typeof doctors)[number], day: string, i: number, status = 'BOOKED', extra: Record<string, unknown> = {}) {
    const slot = slotsOf(doc, day)[i];
    if (status !== 'CANCELLED') await prisma.slot.update({ where: { id: slot.id }, data: { reservedCount: { increment: 1 } } });
    return prisma.appointment.create({ data: { patientId, doctorId: doc.id, slotId: slot.id, serviceDate: day, status, bookedAt: ago(60 * 24 * 2), ...extra } });
  }

  // ── Today, D01: the Appendix B.2 scenario (001 completed, 002 in consultation, 003/005 walk-ins) ──
  const [D01, D02, D03] = doctors;
  const a1 = await book(P(2).id, D01, today, 0, 'COMPLETED', { checkedInAt: ago(55), completedAt: ago(38) });
  const a2 = await book(P(3).id, D01, today, 1, 'CHECKED_IN', { checkedInAt: ago(46) });
  const a4 = await book(P(1).id, D01, today, 2, 'CHECKED_IN', { checkedInAt: ago(30) });
  const t1 = await prisma.queueTicket.create({ data: { doctorId: D01.id, serviceDate: today, tokenNumber: 1, tokenLabel: 'D01-001', patientId: P(2).id, appointmentId: a1.id, source: 'SCHEDULED', status: 'COMPLETED', scheduledAt: slotsOf(D01, today)[0].startAt, checkedInAt: ago(55), calledAt: ago(50), startedAt: ago(49), completedAt: ago(38), predictedWaitSec: 360, baselineWaitSec: 720 } });
  await prisma.consultation.create({ data: { queueTicketId: t1.id, doctorId: D01.id, startedAt: ago(49), endedAt: ago(38), durationSec: 11 * 60 } });
  const t2 = await prisma.queueTicket.create({ data: { doctorId: D01.id, serviceDate: today, tokenNumber: 2, tokenLabel: 'D01-002', patientId: P(3).id, appointmentId: a2.id, source: 'SCHEDULED', status: 'IN_CONSULTATION', scheduledAt: slotsOf(D01, today)[1].startAt, checkedInAt: ago(46), calledAt: ago(7), startedAt: ago(6), predictedWaitSec: 1500, baselineWaitSec: 1440 } });
  await prisma.consultation.create({ data: { queueTicketId: t2.id, doctorId: D01.id, startedAt: ago(6) } });
  const t3 = await prisma.queueTicket.create({ data: { doctorId: D01.id, serviceDate: today, tokenNumber: 3, tokenLabel: 'D01-003', patientId: P(4).id, source: 'WALK_IN', status: 'WAITING', checkedInAt: ago(40), predictedWaitSec: 1800, baselineWaitSec: 1440 } });
  await prisma.queueTicket.create({ data: { doctorId: D01.id, serviceDate: today, tokenNumber: 4, tokenLabel: 'D01-004', patientId: P(1).id, appointmentId: a4.id, source: 'SCHEDULED', status: 'WAITING', scheduledAt: slotsOf(D01, today)[2].startAt, checkedInAt: ago(30), predictedWaitSec: 1680, baselineWaitSec: 2160 } });
  const t5 = await prisma.queueTicket.create({ data: { doctorId: D01.id, serviceDate: today, tokenNumber: 5, tokenLabel: 'D01-005', patientId: P(5).id, source: 'WALK_IN', status: 'WAITING', checkedInAt: ago(20), predictedWaitSec: 2400, baselineWaitSec: 2880 } });
  await prisma.queueCounter.create({ data: { doctorId: D01.id, serviceDate: today, lastNumber: 5 } });
  await prisma.doctorQueueState.create({ data: { doctorId: D01.id, serviceDate: today, appointmentStreak: 2, activeTicketId: t2.id } });

  // ── Today, D02 and D03: bookings waiting for reception (+ one already checked in) ──
  const a9 = await book(P(9).id, D02, today, 0, 'CHECKED_IN', { checkedInAt: ago(10) });
  await prisma.queueTicket.create({ data: { doctorId: D02.id, serviceDate: today, tokenNumber: 1, tokenLabel: 'D02-001', patientId: P(9).id, appointmentId: a9.id, source: 'SCHEDULED', status: 'WAITING', scheduledAt: slotsOf(D02, today)[0].startAt, checkedInAt: ago(10), predictedWaitSec: 600, baselineWaitSec: 720 } });
  await prisma.queueCounter.create({ data: { doctorId: D02.id, serviceDate: today, lastNumber: 1 } });
  for (const [p, i] of [[6, 1], [7, 3], [8, 5], [2, 8]] as const) await book(P(p).id, D02, today, i);
  for (const [p, i] of [[10, 0], [11, 2], [12, 4], [6, 6]] as const) await book(P(p).id, D03, today, i);
  await book(P(7).id, D01, today, 5);
  await book(P(8).id, D01, today, 7);

  // ── Future bookings: patient1 has an upcoming visit; ~30% of slots taken by others ──
  const nextWorkDay = futureDays[2] ?? futureDays[1];
  await book(P(1).id, D02, nextWorkDay, 2);
  await book(P(1).id, D03, futureDays[4] ?? nextWorkDay, 1, 'CANCELLED', { cancelledAt: ago(60 * 20), cancelReason: 'Cancelled by patient', cancelledById: P(1).id });
  for (const day of futureDays.slice(1)) {
    for (const d of doctors) {
      const rows = slotsOf(d, day);
      for (let i = 0; i < rows.length; i++) {
        if (d === D02 && day === nextWorkDay && i === 2) continue;
        if (random() < 0.3) {
          const p = patients[1 + Math.floor(random() * (patients.length - 1))];
          const dup = await prisma.appointment.findFirst({ where: { patientId: p.id, doctorId: d.id, serviceDate: day, status: 'BOOKED' } });
          if (!dup) await book(p.id, d, day, i);
        }
      }
    }
  }

  // ── Notifications & audit trail for the demo accounts ──
  await prisma.notification.createMany({
    data: [
      { userId: P(1).id, kind: 'WELCOME', title: 'Welcome to MediQueue', message: 'Book a visit at DemoCare OPD and follow your token live on arrival day.', createdAt: ago(60 * 24 * 30), readAt: ago(60 * 24 * 29) },
      { userId: P(1).id, kind: 'BOOKING_CONFIRMED', title: 'Appointment confirmed', message: `Dr. Maya Iyer on ${localDateLabel(slotsOf(D01, today)[2].startAt, TZ)} at ${localTime(slotsOf(D01, today)[2].startAt, TZ)}. Check in at reception when you arrive.`, createdAt: ago(60 * 24 * 2), readAt: ago(60 * 24) },
      { userId: P(1).id, kind: 'BOOKING_CONFIRMED', title: 'Appointment confirmed', message: `Dr. Arjun Rao on ${localDateLabel(slotsOf(D02, nextWorkDay)[2].startAt, TZ)} at ${localTime(slotsOf(D02, nextWorkDay)[2].startAt, TZ)}. Check in at reception when you arrive.`, createdAt: ago(60 * 20) },
      { userId: P(1).id, kind: 'CHECKED_IN', title: "You're checked in: token D01-004", message: 'Please wait for Dr. Maya Iyer (Room 101). Estimated wait about 28 min.', createdAt: ago(30) },
      { userId: P(3).id, kind: 'CALLED', title: "Token D01-002: it's your turn", message: 'Please go to Room 101 to see Dr. Maya Iyer.', createdAt: ago(7) },
    ],
  });
  const audits: Array<{ actorId: string; actorRole: string; action: string; entityType: string; entityId: string; reason?: string; afterJson?: string; at: Date }> = [
    { actorId: admin.id, actorRole: 'ADMIN', action: 'DEMO_SEEDED', entityType: 'Clinic', entityId: clinic.id, afterJson: JSON.stringify({ doctors: 3, patients: 12, historyDays: historyDays.length }), at: ago(90) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'CHECKED_IN', entityType: 'Appointment', entityId: a1.id, afterJson: '{"token":"D01-001"}', at: ago(55) },
    { actorId: D01.userId, actorRole: 'DOCTOR', action: 'QUEUE_CALLED', entityType: 'QueueTicket', entityId: t1.id, at: ago(50) },
    { actorId: D01.userId, actorRole: 'DOCTOR', action: 'CONSULT_COMPLETED', entityType: 'QueueTicket', entityId: t1.id, afterJson: '{"durationSec":660}', at: ago(38) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'CHECKED_IN', entityType: 'Appointment', entityId: a2.id, afterJson: '{"token":"D01-002"}', at: ago(46) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'WALKIN_REGISTERED', entityType: 'QueueTicket', entityId: t3.id, afterJson: '{"token":"D01-003"}', at: ago(40) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'CHECKED_IN', entityType: 'Appointment', entityId: a4.id, afterJson: '{"token":"D01-004"}', at: ago(30) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'WALKIN_REGISTERED', entityType: 'QueueTicket', entityId: t5.id, afterJson: '{"token":"D01-005"}', at: ago(20) },
    { actorId: reception.id, actorRole: 'RECEPTIONIST', action: 'CHECKED_IN', entityType: 'Appointment', entityId: a9.id, afterJson: '{"token":"D02-001"}', at: ago(10) },
    { actorId: D01.userId, actorRole: 'DOCTOR', action: 'QUEUE_CALLED', entityType: 'QueueTicket', entityId: t2.id, at: ago(7) },
    { actorId: D01.userId, actorRole: 'DOCTOR', action: 'CONSULT_STARTED', entityType: 'QueueTicket', entityId: t2.id, at: ago(6) },
  ];
  await prisma.auditEvent.createMany({ data: audits });

  const counts = {
    users: await prisma.user.count(),
    slots: await prisma.slot.count(),
    appointments: await prisma.appointment.count(),
    tickets: await prisma.queueTicket.count(),
    consultations: await prisma.consultation.count(),
  };
  console.log(`Done. Clinic day ${today}. ${JSON.stringify(counts)}; ${etaSamples} historical ETA samples.`);
  console.log('\nDemo sign-ins (local only):');
  console.log('  admin@gmail.com       admin123');
  console.log('  reception@gmail.com   reception123');
  console.log('  doctor1@gmail.com     doctor123     (also doctor2, doctor3)');
  console.log('  patient1@gmail.com    patient123    (also patient2 … patient12)\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
