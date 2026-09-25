import { redirect } from 'next/navigation';
import { currentUser, beginPasswordReset, findSignInEmailByName } from '@/lib/auth';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';
import { sendMail } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

/**
 * Two recovery routes, one page.
 *
 *   ?mode=id   — "I forgot which address I sign in with": look the account up
 *                by name and email the address to itself.
 *   default    — "I forgot my password": email a 6-digit code.
 *
 * Both always answer the same way whether or not the account exists, so this
 * page cannot be used to discover who has an account.
 */
export default async function ForgotPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; sent?: string; mode?: string }> }) {
  const sp = await searchParams;
  const mode = sp.mode === 'id' ? 'id' : 'password';

  try {
    if (await currentUser()) redirect('/');
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
    throw err;
  }

  async function submitPassword(fd: FormData) {
    'use server';
    const email = String(fd.get('email') ?? '').trim().toLowerCase();
    if (!email) redirect('/forgot?error=' + encodeURIComponent('Enter your email address.'));

    const issued = await beginPasswordReset(email);
    if (issued) {
      await sendMail({
        to: issued.email,
        subject: 'Your Spirit Tips sign-in code',
        text:
          `Hello${issued.name ? ' ' + issued.name : ''},\n\n` +
          `Your code for resetting the Spirit Tips password is:\n\n` +
          `    ${issued.code}\n\n` +
          `It expires in 15 minutes and can be used once.\n\n` +
          `If you did not ask for this, ignore this message — nothing has ` +
          `changed and your password still works.\n`,
      });
    }
    // Same destination either way.
    redirect(`/reset?email=${encodeURIComponent(email)}`);
  }

  async function submitUserId(fd: FormData) {
    'use server';
    const name = String(fd.get('name') ?? '').trim();
    if (!name) redirect('/forgot?mode=id&error=' + encodeURIComponent('Enter your full name.'));

    const found = await findSignInEmailByName(name);
    if (found) {
      await sendMail({
        to: found.email,
        subject: 'Your Spirit Tips sign-in address',
        text:
          `Hello${found.name ? ' ' + found.name : ''},\n\n` +
          `You sign in to Spirit Tips with this address:\n\n` +
          `    ${found.email}\n\n` +
          `If you also need a new password, use "Forgot password" on the ` +
          `sign-in page.\n`,
      });
    }
    redirect('/forgot?mode=id&sent=1');
  }

  if (sp.sent) {
    return (
      <div className="authwrap">
        <div className="authcard">
          <p className="mark">Spirit Productions</p>
          <h1>Check your email</h1>
          <p className="sub">
            If an account matches that name, its sign-in address has been sent
            to that address. Nothing has been sent if no account matched.
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
        <h1>{mode === 'id' ? 'Forgot user ID' : 'Forgot password'}</h1>
        <p className="sub">
          {mode === 'id'
            ? 'Enter your full name and we will email your sign-in address to the account it belongs to.'
            : 'Enter your email address and we will send you a 6-digit code to set a new password.'}
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        {mode === 'id' ? (
          <form action={submitUserId}>
            <label className="f" htmlFor="name">Full name</label>
            <input id="name" name="name" type="text" autoComplete="name"
                   required autoFocus />
            <button className="btn" type="submit">Email my sign-in address</button>
          </form>
        ) : (
          <form action={submitPassword}>
            <label className="f" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="username"
                   required autoFocus />
            <button className="btn" type="submit">Send me a code</button>
          </form>
        )}

        <p className="authalt">
          {mode === 'id'
            ? <>Forgotten your password instead? <a href="/forgot">Reset it</a></>
            : <>Not sure which address you use? <a href="/forgot?mode=id">Forgot user ID</a></>}
          <br />
          <a href="/login">Back to sign in</a>
        </p>
      </div>
    </div>
  );
}
