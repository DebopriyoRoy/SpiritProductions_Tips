import { redirect, notFound } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import {
  countUsers, createUser, createSession, currentUser, MIN_PASSWORD,
} from '@/lib/auth';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';

export const dynamic = 'force-dynamic';

/** Constant-time compare that tolerates differing lengths. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still spend the comparison so length is not a timing oracle.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export default async function SetupPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  try {
    if (await currentUser()) redirect('/');
    // Once an account exists this page does not exist either.
    if ((await countUsers()) > 0) notFound();
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
    throw err;
  }

  const secret = process.env.SETUP_SECRET ?? '';

  async function submit(fd: FormData) {
    'use server';
    const expected = process.env.SETUP_SECRET ?? '';
    if (!expected) notFound();
    if ((await countUsers()) > 0) notFound();

    if (!secretMatches(String(fd.get('secret') ?? ''), expected)) {
      redirect('/setup?error=' + encodeURIComponent('That setup key is not correct.'));
    }
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    try {
      const id = await createUser({
        email, name: String(fd.get('name') ?? ''), password,
        role: 'admin', locations: [],
      });
      await createSession(id);
    } catch (e) {
      redirect('/setup?error=' + encodeURIComponent(
        e instanceof Error ? e.message : 'Could not create that account'));
    }
    redirect('/');
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <h1>Set up Spirit Tips</h1>
        <p className="sub">Create the first administrator account.</p>

        {!secret ? (
          <div className="note">
            <strong>Setup is closed.</strong> Add an environment variable named{' '}
            <code>SETUP_SECRET</code> with a long random value, redeploy, then
            reload this page and enter that value below.
          </div>
        ) : (
          <div className="note">
            Enter the <code>SETUP_SECRET</code> you set in your hosting
            dashboard. This page stops working as soon as one account exists.
          </div>
        )}

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        <form action={submit}>
          <label className="f" htmlFor="secret">Setup key</label>
          <input id="secret" name="secret" type="password" required
                 autoComplete="off" disabled={!secret} />

          <label className="f" htmlFor="name">Your name</label>
          <input id="name" name="name" type="text" disabled={!secret} />

          <label className="f" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required
                 autoComplete="username" disabled={!secret} />

          <label className="f" htmlFor="password">
            Password ({MIN_PASSWORD}+ characters)
          </label>
          <input id="password" name="password" type="password" required
                 minLength={MIN_PASSWORD} autoComplete="new-password"
                 disabled={!secret} />

          <button className="btn" type="submit" disabled={!secret}>
            Create administrator
          </button>
        </form>
      </div>
    </div>
  );
}
