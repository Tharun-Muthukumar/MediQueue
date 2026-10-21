import bcrypt from 'bcryptjs';
import { config } from '../config';
import type { Actor, Role, SafeUser, User } from '../domain/types';
import { AppError, errors } from '../shared/errors';
import { randomToken, sha256 } from '../shared/util';
import { UniqueViolation } from '../repositories/types';
import { audit, type Deps } from './context';

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export function toSafeUser(u: User): SafeUser {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export class AuthService {
  constructor(private d: Deps) {}

  async register(input: { name: string; email: string; password: string; phone?: string | null }) {
    const { store } = this.d;
    const clinic = await store.clinics.getDefault();
    if (!clinic) throw new AppError(500, 'INTERNAL_ERROR', 'Clinic is not configured. Run the seed script.');
    const passwordHash = await bcrypt.hash(input.password, this.d.bcryptRounds);
    try {
      const user = await store.transaction(async (tx) => {
        const u = await tx.users.create({
          email: input.email,
          passwordHash,
          name: input.name,
          phone: input.phone ?? null,
          role: 'PATIENT', // self-registration can never create staff accounts
          clinicId: clinic.id,
        });
        await audit(tx, { id: u.id, role: 'PATIENT', clinicId: clinic.id, name: u.name }, 'USER_REGISTERED', 'User', u.id, {
          after: { email: u.email, role: u.role },
        });
        await tx.notifications.createMany([
          { userId: u.id, kind: 'WELCOME', title: 'Welcome to MediQueue', message: `Book a visit at ${clinic.name} and follow your token live on arrival day.` },
        ]);
        return u;
      });
      return toSafeUser(user);
    } catch (e) {
      if (e instanceof UniqueViolation) throw errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      throw e;
    }
  }

  async login(email: string, password: string) {
    const { store, clock } = this.d;
    const user = await store.users.findByEmail(email);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated. Contact the clinic administrator.');
    const token = randomToken();
    const expiresAt = new Date(clock.now().getTime() + config.sessionTtlHours * 3600_000);
    await store.sessions.create({ id: sha256(token), userId: user.id, expiresAt });
    await store.audit.create({
      actorId: user.id,
      actorRole: user.role,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      reason: null,
      beforeJson: null,
      afterJson: null,
    });
    return { token, expiresAt, user: toSafeUser(user) };
  }

  async logout(token: string | undefined) {
    if (token) await this.d.store.sessions.delete(sha256(token));
  }

  /** Self-service profile: name, phone and photo. Email and role can only be changed by an administrator. */
  async updateProfile(actor: Actor, patch: { name?: string; phone?: string | null; avatarUrl?: string | null }) {
    const { store } = this.d;
    const user = await store.transaction(async (tx) => {
      const before = await tx.users.findById(actor.id);
      if (!before) throw errors.notFound('User');
      const u = await tx.users.update(actor.id, patch);
      await audit(tx, actor, 'PROFILE_UPDATED', 'User', actor.id, {
        before: { name: before.name, phone: before.phone, photo: before.avatarUrl ? 'set' : 'none' },
        after: {
          name: u.name,
          phone: u.phone,
          photo: u.avatarUrl ? 'set' : 'none', // never copy image data into the audit log
        },
      });
      return u;
    });
    return toSafeUser(user);
  }

  /** Changes the password after verifying the current one; signs out every other session. */
  async changePassword(actor: Actor, sessionToken: string | undefined, current: string, next: string) {
    const { store } = this.d;
    const user = await store.users.findById(actor.id);
    if (!user) throw errors.notFound('User');
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Your current password is not correct.');
    }
    if (current === next) throw new AppError(400, 'VALIDATION_ERROR', 'Choose a password different from the current one.');
    const passwordHash = await bcrypt.hash(next, this.d.bcryptRounds);
    const signedOut = await store.transaction(async (tx) => {
      await tx.users.update(actor.id, { passwordHash });
      const n = sessionToken ? await tx.sessions.deleteForUserExcept(actor.id, sha256(sessionToken)) : 0;
      await audit(tx, actor, 'PASSWORD_CHANGED', 'User', actor.id, { after: { otherSessionsSignedOut: n } });
      return n;
    });
    return { changed: true, otherSessionsSignedOut: signedOut };
  }

  /** Resolves the session cookie into an Actor. Role and identity always come from the database. */
  async resolve(token: string | undefined): Promise<{ actor: Actor; user: SafeUser } | null> {
    if (!token) return null;
    const { store, clock } = this.d;
    const s = await store.sessions.findWithUser(sha256(token));
    if (!s) return null;
    if (s.expiresAt.getTime() <= clock.now().getTime() || !s.user.isActive) {
      await store.sessions.delete(s.id);
      return null;
    }
    const u = s.user;
    let doctorId: string | null = null;
    if (u.role === 'DOCTOR') doctorId = (await store.doctors.findByUserId(u.id))?.id ?? null;
    return {
      actor: { id: u.id, role: u.role as Role, clinicId: u.clinicId, name: u.name, doctorId },
      user: toSafeUser(u),
    };
  }
}
