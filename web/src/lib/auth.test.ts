import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, passwordProblem, canSeeLocation, isAdmin,
  MIN_PASSWORD, type SessionUser,
} from './auth';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1', email: 'a@b.c', name: 'A', role: 'manager', locations: [], ...over,
});

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const h = await hashPassword('a sufficiently long passphrase');
    expect(await verifyPassword('a sufficiently long passphrase', h)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const h = await hashPassword('a sufficiently long passphrase');
    expect(await verifyPassword('a sufficiently long passphrasE', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery staple', b)).toBe(true);
  });

  it('never stores the password in the hash', async () => {
    const h = await hashPassword('hunter22hunter22');
    expect(h).not.toContain('hunter22');
    expect(h.startsWith('scrypt$')).toBe(true);
  });

  it('survives a malformed stored hash instead of throwing', async () => {
    for (const bad of ['', 'nonsense', 'scrypt$onlysalt', 'md5$a$b']) {
      expect(await verifyPassword('whatever', bad)).toBe(false);
    }
  });

  it('treats equivalent unicode forms as the same password', async () => {
    const composed = 'café passphrase!!';           // é as one code point
    const decomposed = 'café passphrase!!';   // e + combining accent
    const h = await hashPassword(composed);
    expect(await verifyPassword(decomposed, h)).toBe(true);
  });
});

describe('password policy', () => {
  it('requires a minimum length', () => {
    expect(passwordProblem('short')).toMatch(new RegExp(String(MIN_PASSWORD)));
    expect(passwordProblem('x'.repeat(MIN_PASSWORD))).toBeNull();
  });
});

describe('venue authorisation', () => {
  it('an empty list means every venue', () => {
    expect(canSeeLocation(user({ locations: [] }), 'spirit')).toBe(true);
    expect(canSeeLocation(user({ locations: [] }), 'acc')).toBe(true);
  });

  it('a scoped user sees only their venue', () => {
    const u = user({ locations: ['spirit'] });
    expect(canSeeLocation(u, 'spirit')).toBe(true);
    expect(canSeeLocation(u, 'acc')).toBe(false);
  });

  it('does not treat a manager as an admin', () => {
    expect(isAdmin(user({ role: 'manager' }))).toBe(false);
    expect(isAdmin(user({ role: 'admin' }))).toBe(true);
    expect(isAdmin(user({ role: 'Admin' }))).toBe(false);
  });
});
