import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { q, one, uid, ensureSchema, UserRow } from './db';
import { LOCATIONS } from './config';

const scrypt = promisify(_scrypt) as (
  pw: string | Buffer, salt: string | Buffer, len: number,
) => Promise<Buffer>;

const COOKIE = 'spirit_session';
const SESSION_DAYS = 30;
const KEYLEN = 64;
export const MIN_PASSWORD = 12;
/** Failed sign-ins before the account is briefly locked. */
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/* ---------------- passwords ---------------- */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  // Lengths must match before timingSafeEqual, which throws otherwise.
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}

/* ---------------- sessions ---------------- */

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface SessionUser {
  id: string; email: string; name: string; role: string; locations: string[];
}

const toSessionUser = (u: UserRow): SessionUser => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  locations: u.locations ?? [],
});

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await q(
    'INSERT INTO user_session (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
    [sha256(token), userId, expires],
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await q('DELETE FROM user_session WHERE token_hash = $1', [sha256(token)]);
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Never throws — use requireUser to enforce. */
export async function currentUser(): Promise<SessionUser | null> {
  await ensureSchema();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = await one<UserRow>(
    `SELECT u.* FROM user_session s
       JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  return row ? toSessionUser(row) : null;
}

/* ---------------- sign in ---------------- */

export type LoginResult =
  | { ok: true; user: SessionUser }
  | { ok: false; message: string };

export async function signIn(emailRaw: string, password: string): Promise<LoginResult> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  const user = await one<UserRow>('SELECT * FROM app_user WHERE email = $1', [email]);

  // Same message whichever half is wrong, so the form cannot be used to
  // discover which addresses have accounts.
  const generic = 'Email or password is incorrect.';

  if (!user || !user.active) {
    // Spend comparable time so a missing account is not obviously faster.
    await hashPassword(password);
    return { ok: false, message: generic };
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil(
      (new Date(user.locked_until).getTime() - Date.now()) / 60_000);
    return {
      ok: false,
      message: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    };
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
    await q(
      'UPDATE app_user SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
      [lock ? 0 : attempts, lock, user.id],
    );
    return {
      ok: false,
      message: lock
        ? `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`
        : generic,
    };
  }

  await q(
    'UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
    [user.id]);
  await createSession(user.id);
  return { ok: true, user: toSessionUser(user) };
}

/* ---------------- authorisation ---------------- */

export class NotAuthenticated extends Error {}
export class NotAuthorised extends Error {}

/** Throws NotAuthenticated when nobody is signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new NotAuthenticated('Sign in required');
  return user;
}

export const isAdmin = (u: SessionUser) => u.role === 'admin';

/** An empty locations list means every location. */
export function canSeeLocation(u: SessionUser, locationId: string): boolean {
  return u.locations.length === 0 || u.locations.includes(locationId);
}

export function visibleLocations(u: SessionUser) {
  return LOCATIONS.filter((l) => canSeeLocation(u, l.id));
}

/**
 * The gate for every page, route and action that touches a venue's data:
 * signed in AND permitted to see that venue.
 */
export async function requireLocation(locationId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!canSeeLocation(user, locationId)) {
    throw new NotAuthorised(`No access to ${locationId}`);
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdmin(user)) throw new NotAuthorised('Admins only');
  return user;
}

/* ---------------- user administration ---------------- */

export async function createUser(input: {
  email: string; name: string; password: string; role: string; locations: string[];
}): Promise<string> {
  await ensureSchema();
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const id = uid();
  await q(
    `INSERT INTO app_user (id, email, name, password_hash, role, locations)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.email.trim().toLowerCase(), input.name.trim(),
     await hashPassword(input.password), input.role, input.locations],
  );
  return id;
}

export async function listUsers(): Promise<UserRow[]> {
  await ensureSchema();
  return q<UserRow>('SELECT * FROM app_user ORDER BY email');
}

export async function countUsers(): Promise<number> {
  await ensureSchema();
  const row = await one<{ n: string }>('SELECT count(*)::text n FROM app_user');
  return Number(row?.n ?? 0);
}

export async function setUserPassword(userId: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await q('UPDATE app_user SET password_hash = $1 WHERE id = $2',
    [await hashPassword(password), userId]);
  // Force a fresh sign-in everywhere after a password change.
  await q('DELETE FROM user_session WHERE user_id = $1', [userId]);
}

export async function setUserAccess(
  userId: string, role: string, locations: string[], active: boolean,
) {
  await q(
    'UPDATE app_user SET role = $1, locations = $2, active = $3 WHERE id = $4',
    [role, locations, active, userId]);
  if (!active) await q('DELETE FROM user_session WHERE user_id = $1', [userId]);
}
