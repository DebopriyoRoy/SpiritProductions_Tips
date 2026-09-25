import { redirect } from 'next/navigation';
import { currentUser, completePasswordReset, MIN_PASSWORD } from '@/lib/auth';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';
import { PasswordField } from '@/app/PasswordField';

export const dynamic = 'force-dynamic';

/** Enter the emailed code and choose a new password. */
export default async function ResetPage({
  searchParams,
}: { searchParams: Promise<{ email?: string; error?: string; done?: string }> }) {
  const sp = await searchParams;
  const email = (sp.email ?? '').trim();

  try {
    if (await currentUser()) redirect('/');
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
    throw err;
  }

  async function submit(fd: FormData) {
    'use server';
    const addr = String(fd.get('email') ?? '').trim().toLowerCase();
    const code = String(fd.get('code') ?? '');
    const password = String(fd.get('password') ?? '');
    const confirm = String(fd.get('confirm') ?? '');
    const back = (m: string) =>
      redirect(`/reset?email=${encodeURIComponent(addr)}&error=${encodeURIComponent(m)}`);

    if (password !== confirm) back('The two passwords do not match.');

    const res = await completePasswordReset(addr, code, password);
    if (!res.ok) back(res.message);
    redirect('/reset?done=1');
  }

  if (sp.done) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <p className="mark">Spirit Productions</p>
          <h1>Password changed</h1>
          <p className="sub">
            Your password has been changed and every other session was signed
            out. You can sign in with it now.
          </p>
          <p className="authalt"><a href="/login">Go to sign in</a></p>
        </div>
      </div>
    );
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <p className="mark">Spirit Productions</p>
        <h1>Enter your code</h1>
        <p className="sub">
          If that address has an account, a 6-digit code is on its way. It
          expires in 15 minutes.
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        <form action={submit}>
          <label className="f" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username"
                 defaultValue={email} required />
          <label className="f" htmlFor="code">6-digit code</label>
          <input id="code" name="code" type="text" inputMode="numeric"
                 autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
                 className="otp" required autoFocus={Boolean(email)} />
          <PasswordField
            name="password" label="New password" autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`} />
          <PasswordField
            name="confirm" label="Confirm new password"
            autoComplete="new-password" />
          <button className="btn" type="submit">Change my password</button>
        </form>

        <p className="authalt">
          Code expired? <a href="/forgot">Send a new one</a>
          <br />
          <a href="/login">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
