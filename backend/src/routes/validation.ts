import { z, type ZodTypeAny } from 'zod';
import { errors } from '../shared/errors';
import { isValidDateString } from '../shared/time';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', message: i.message }));
    throw errors.validation(issues.map((i) => (i.field === '(body)' ? i.message : `${i.field}: ${i.message}`)).join('; '), issues);
  }
  return r.data;
}

export const dateStr = z.string().refine(isValidDateString, 'Use a valid date in YYYY-MM-DD format');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24-hour)');
export const id = z.string().min(1).max(64);
const name = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(80, 'Name must be at most 80 characters');
const reason = z.string().trim().min(3, 'Give a short reason (3+ characters)').max(300);
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password needs a letter')
  .regex(/\d/, 'Password needs a number');
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(120);
const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{6,18}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal('').transform(() => undefined));

const avatar = z
  .string()
  .max(200_000, 'Photo is too large (max ~150 KB after resizing)')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a PNG, JPEG or WebP image')
  .nullable();

export const schemas = {
  updateProfile: z
    .object({ name: name.optional(), phone: phone.nullable(), avatarUrl: avatar.optional() })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Nothing to update'),
  changePassword: z.object({ currentPassword: z.string().min(1, 'Enter your current password').max(128), newPassword: password }).strict(),
  register: z.object({ name, email, password, phone }).strict(),
  login: z.object({ email, password: z.string().min(1, 'Enter your password').max(128) }).strict(),
  dateQuery: z.object({ date: dateStr.optional() }),
  slotsQuery: z.object({ date: dateStr }),
  doctorsQuery: z.object({ department: z.string().max(60).optional() }),
  book: z.object({ slotId: id }).strict(),
  idempotencyKey: z.string().min(8, 'Idempotency-Key must be 8–100 characters').max(100).regex(/^[A-Za-z0-9_-]+$/, 'Idempotency-Key may contain letters, digits, - and _'),
  cancel: z.object({ reason: reason.optional() }).strict(),
  checkIn: z.object({ overrideReason: reason.optional() }).strict(),
  noShow: z.object({ reason: reason.optional() }).strict(),
  walkIn: z
    .object({
      doctorId: id,
      patientId: id.optional(),
      newPatient: z.object({ name, phone }).strict().optional(),
    })
    .strict()
    .refine((v) => !!v.patientId !== !!v.newPatient, 'Provide either patientId or newPatient'),
  reasonRequired: z.object({ reason }).strict(),
  pause: z.object({ reason }).strict(),
  patientSearch: z.object({ q: z.string().max(60).optional() }),
  auditQuery: z.object({
    action: z.string().max(40).optional(),
    entityType: z.string().max(40).optional(),
    actorId: id.optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(5).max(100).default(25),
  }),
  createDoctor: z
    .object({
      name,
      email,
      password,
      department: z.string().trim().min(2).max(60),
      room: z.string().trim().min(1).max(30),
      avgMinutes: z.coerce.number().int().min(3).max(90),
      bio: z.string().trim().max(240).optional().nullable(),
    })
    .strict(),
  updateDoctor: z
    .object({
      name: name.optional(),
      department: z.string().trim().min(2).max(60).optional(),
      room: z.string().trim().min(1).max(30).optional(),
      avgMinutes: z.coerce.number().int().min(3).max(90).optional(),
      bio: z.string().trim().max(240).optional().nullable(),
      status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    })
    .strict(),
  createStaff: z.object({ name, email, password, role: z.enum(['RECEPTIONIST', 'ADMIN']) }).strict(),
  setActive: z.object({ isActive: z.boolean() }).strict(),
  slotRange: z.object({ from: dateStr, to: dateStr }),
  generateSlots: z
    .object({
      doctorId: id,
      fromDate: dateStr,
      toDate: dateStr,
      startTime: timeStr,
      endTime: timeStr,
      slotMinutes: z.coerce.number().int().min(5).max(120),
      capacity: z.coerce.number().int().min(1).max(5).default(1),
      weekdays: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one weekday'),
    })
    .strict(),
  settings: z
    .object({
      name: z.string().trim().min(2).max(80).optional(),
      walkInRatio: z.coerce.number().int().min(1).max(5).optional(),
      graceMinutes: z.coerce.number().int().min(0).max(120).optional(),
      lateAfterMinutes: z.coerce.number().int().min(0).max(120).optional(),
      autoNoShow: z.boolean().optional(),
      defaultConsultMinutes: z.coerce.number().int().min(3).max(90).optional(),
      bookingHorizonDays: z.coerce.number().int().min(1).max(60).optional(),
    })
    .strict(),
};
