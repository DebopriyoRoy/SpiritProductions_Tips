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
  /** Self-registered accounts arrive false and wait for an admin. */
  active?: boolean;
}): Promise<string> {
  await ensureSchema();
  const problem = passwordProblem(input.password);
  if (problem) throw new Error(problem);
  const id = uid();
  await q(
    `INSERT INTO app_user (id, email, name, password_hash, role, locations, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.email.trim().toLowerCase(), input.name.trim(),
     await hashPassword(input.password), input.role, input.locations,
     input.active ?? true],
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

/* ---------------- password reset by emailed code ---------------- */

/** Minutes a reset code stays usable. Short: it arrives by email at once. */
const RESET_MINUTES = 15;
/** Guesses allowed against one code before it is burned. */
const RESET_MAX_ATTEMPTS = 5;

/**
 * A 6-digit code. randomInt is rejection-sampled, so unlike `Math.random()`
 * or a modulo of random bytes every code is equally likely.
 */
function resetCode(): string {
  return String(randomIntInclusive(0, 999_999)).padStart(6, '0');
}

function randomIntInclusive(min: number, max: number): number {
  const range = max - min + 1;
  const bytes = 4;
  const limit = Math.floor(2 ** (8 * bytes) / range) * range;
  for (;;) {
    const n = randomBytes(bytes).readUInt32BE(0);
    if (n < limit) return min + (n % range);
  }
}

/**
 * Issues a reset code for an email address, if it belongs to an account.
 *
 * Returns the code and the address to send it to, or null when there is no
 * such account. The caller must respond identically either way: telling a
 * stranger whether an address is registered is the whole of account
 * enumeration.
 */
export async function beginPasswordReset(
  emailRaw: string,
): Promise<{ code: string; email: string; name: string } | null> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  const user = await one<UserRow>(
    'SELECT * FROM app_user WHERE email = $1', [email]);
  if (!user || !user.active) return null;

  // One live code per person: issuing a new one retires the old.
  await q('DELETE FROM password_reset WHERE user_id = $1', [user.id]);

  const code = resetCode();
  await q(
    `INSERT INTO password_reset (id, user_id, code_hash, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [uid(), user.id, sha256(code),
     new Date(Date.now() + RESET_MINUTES * 60_000)],
  );
  return { code, email: user.email, name: user.name };
}

export interface ResetResult { ok: boolean; message: string }

/**
 * Checks a code and sets the new password. The code is single-use and is
 * burned after a handful of wrong guesses, so a 6-digit code cannot be
 * walked through at leisure.
 */
export async function completePasswordReset(
  emailRaw: string, code: string, newPassword: string,
): Promise<ResetResult> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  const generic = { ok: false, message: 'That code is wrong or has expired.' };

  const user = await one<UserRow>(
    'SELECT * FROM app_user WHERE email = $1', [email]);
  if (!user) return generic;

  const row = await one<{
    id: string; code_hash: string; expires_at: string;
    attempts: number; used_at: string | null;
  }>(
    `SELECT id, code_hash, expires_at, attempts, used_at FROM password_reset
      WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [user.id]);
  if (!row) return generic;

  if (row.used_at) return generic;
  if (new Date(row.expires_at) <= new Date()) return generic;
  if (row.attempts >= RESET_MAX_ATTEMPTS) return generic;

  const given = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  const matches = given.length === want.length && timingSafeEqual(given, want);

  if (!matches) {
    await q('UPDATE password_reset SET attempts = attempts + 1 WHERE id = $1',
      [row.id]);
    return generic;
  }

  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, message: problem };

  await setUserPassword(user.id, newPassword);
  await q('UPDATE password_reset SET used_at = now() WHERE id = $1', [row.id]);
  // A reset is a good reason to end every other session, and clears any
  // lockout from the failed sign-ins that sent them here.
  await q('DELETE FROM user_session WHERE user_id = $1', [user.id]);
  await q(
    'UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
    [user.id]);
  return { ok: true, message: 'Password changed. You can sign in now.' };
}

/**
 * Looks up the sign-in address from a person's name, for "forgot user ID".
 * Returns null when nothing matches; the caller must answer identically
 * either way.
 */
export async function findSignInEmailByName(
  nameRaw: string,
): Promise<{ email: string; name: string } | null> {
  await ensureSchema();
  const name = nameRaw.trim().toLowerCase();
  if (!name) return null;
  const user = await one<UserRow>(
    'SELECT * FROM app_user WHERE lower(name) = $1 AND active = true', [name]);
  return user ? { email: user.email, name: user.name } : null;
}

/* ---------------- sign-up email verification ---------------- */

const VERIFY_MINUTES = 15;
const VERIFY_MAX_ATTEMPTS = 6;
/** Seconds before the same address may be sent another code. */
const VERIFY_RESEND_SECONDS = 60;

export interface VerifySendResult {
  ok: boolean;
  /** Present only when ok — the caller emails it. */
  code?: string;
  message: string;
  retryAfter?: number;
}

/**
 * Issues a sign-up code for an address.
 *
 * This endpoint is reachable by anyone, so it is throttled per address: it
 * puts mail in someone's inbox, and without a limit the form is a free way to
 * pester a stranger. A code is always issued whether or not the address is
 * already registered, so the reply gives nothing away.
 */
export async function beginEmailVerification(
  emailRaw: string,
): Promise<VerifySendResult> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  const recent = await one<{ created_at: string }>(
    `SELECT created_at FROM email_verification
      WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, [email]);
  if (recent) {
    const age = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (age < VERIFY_RESEND_SECONDS) {
      const wait = Math.ceil(VERIFY_RESEND_SECONDS - age);
      return {
        ok: false,
        retryAfter: wait,
        message: `A code was just sent. Try again in ${wait} second${wait === 1 ? '' : 's'}.`,
      };
    }
  }

  await q('DELETE FROM email_verification WHERE email = $1', [email]);
  const code = resetCode();
  await q(
    `INSERT INTO email_verification (id, email, code_hash, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [uid(), email, sha256(code),
     new Date(Date.now() + VERIFY_MINUTES * 60_000)],
  );
  return { ok: true, code, message: 'Code sent. Check your email.' };
}

/**
 * Checks a sign-up code and marks the address verified. Marking rather than
 * consuming, so the register form can check it again when it finally submits
 * without the person having to type the code twice.
 */
export async function confirmEmailVerification(
  emailRaw: string, code: string,
): Promise<{ ok: boolean; message: string }> {
  await ensureSchema();
  const email = emailRaw.trim().toLowerCase();
  const generic = { ok: false, message: 'That code is wrong or has expired.' };

  const row = await one<{
    id: string; code_hash: string; expires_at: string; attempts: number;
  }>(
    `SELECT id, code_hash, expires_at, attempts FROM email_verification
      WHERE email = $1 ORDER BY created_at DESC LIMIT 1`, [email]);
  if (!row) return generic;
  if (new Date(row.expires_at) <= new Date()) return generic;
  if (row.attempts >= VERIFY_MAX_ATTEMPTS) return generic;

  const given = Buffer.from(sha256(code.trim()));
  const want = Buffer.from(row.code_hash);
  if (!(given.length === want.length && timingSafeEqual(given, want))) {
    await q('UPDATE email_verification SET attempts = attempts + 1 WHERE id = $1',
      [row.id]);
    return generic;
  }

  await q('UPDATE email_verification SET verified_at = now() WHERE id = $1',
    [row.id]);
  return { ok: true, message: 'Email verified.' };
}

/** True when this address currently holds a verified, unexpired code. */
export async function isEmailVerified(emailRaw: string): Promise<boolean> {
  await ensureSchema();
  const row = await one<{ id: string }>(
    `SELECT id FROM email_verification
      WHERE email = $1 AND verified_at IS NOT NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [emailRaw.trim().toLowerCase()]);
  return Boolean(row);
}

/** Clears codes for an address once the account is made. */
export async function clearEmailVerification(emailRaw: string): Promise<void> {
  await q('DELETE FROM email_verification WHERE email = $1',
    [emailRaw.trim().toLowerCase()]);
}
