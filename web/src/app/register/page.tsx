import { redirect } from 'next/navigation';
import {
  currentUser, createUser, countUsers, passwordProblem, MIN_PASSWORD,
  isEmailVerified, clearEmailVerification,
} from '@/lib/auth';
import { DatabaseUnavailable, one } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';
import { PasswordField } from '@/app/PasswordField';
import { EmailVerify } from './EmailVerify';

export const dynamic = 'force-dynamic';

/**
 * Self-registration.
 *
 * A new account is created INACTIVE and cannot sign in until an administrator
 * turns it on from the People page. This page is public, so anything it
 * created active would hand a stranger the payroll for both venues.
 * signIn() already refuses an inactive user, so the gate is enforced in one
 * place rather than trusted here.
 */
export default async function RegisterPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const sp = await searchParams;
  try {
    if (await currentUser()) redirect('/');
    // Before the first administrator exists, /setup is the right door: it is
    // the only one that can produce an account able to approve anybody.
    if ((await countUsers()) === 0) redirect('/setup');
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
    throw err;
  }

  async function submit(fd: FormData) {
    'use server';
    const email = String(fd.get('email') ?? '').trim().toLowerCase();
    const name = String(fd.get('name') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const confirm = String(fd.get('confirm') ?? '');
    const back = (m: string) => redirect(`/register?error=${encodeURIComponent(m)}`);

    if (!email || !name) back('Enter your name and email address.');
    if (password !== confirm) back('The two passwords do not match.');

    // The form marks the address verified in a hidden field, but a client can
    // send whatever it likes, so the code is re-checked here against the
    // address actually being registered.
    if (!(await isEmailVerified(email))) {
      back('Verify your email address first: send yourself a code and enter it.');
    }
    const problem = passwordProblem(password);
    if (problem) back(problem);

    const taken = await one<{ id: string }>(
      'SELECT id FROM app_user WHERE email = $1', [email]);
    if (taken) {
      // Same wording as success, so this page cannot be used to discover which
      // addresses already have accounts.
      redirect('/register?done=1');
    }

    await createUser({
      email, name, password, role: 'manager', locations: [], active: false,
    });
    await clearEmailVerification(email);
    redirect('/register?done=1');
  }

  if (sp.done) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <p className="mark">Spirit Productions</p>
          <h1>Request sent</h1>
          <p className="sub">
            If that address was free, the account has been created and is
            waiting for an administrator to approve it. You will not be able to
            sign in until they do.
          </p>
          <p className="authalt"><a href="/login">Back to sign in</a></p>
        </div>
      </div>
    );
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <p className="mark">Spirit Productions</p>
        <h1>Register</h1>
        <p className="sub">
          Create an account for the tip sheets. An administrator has to approve
          it before you can sign in.
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        <form action={submit}>
          <label className="f" htmlFor="name">Full name</label>
          <input id="name" name="name" type="text" autoComplete="name"
                 required autoFocus />
          <EmailVerify />
          <PasswordField
            name="password" label="Password" autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`} />
          <PasswordField
            name="confirm" label="Confirm password" autoComplete="new-password" />
          <button className="btn" type="submit">Register</button>
        </form>

        <p className="authalt">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </div>
    </div>
  );
}
