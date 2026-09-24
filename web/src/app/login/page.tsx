import { redirect } from 'next/navigation';
import { signIn, currentUser, countUsers } from '@/lib/auth';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  let noUsers: boolean;
  try {
    if (await currentUser()) redirect('/');
    noUsers = (await countUsers()) === 0;
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
    throw err;
  }

  async function submit(fd: FormData) {
    'use server';
    const res = await signIn(String(fd.get('email') ?? ''), String(fd.get('password') ?? ''));
    if (!res.ok) redirect(`/login?error=${encodeURIComponent(res.message)}`);
    redirect('/');
  }

  return (
    <div className="authwrap">
      <div className="authcard">
        <p className="mark">Spirit Productions</p>
        <h1>Tip sheets</h1>
        <p className="sub">
          Show-night tips for Spirit Theater and the Arts and Culture Centre.
        </p>

        {noUsers ? (
          <div className="note">
            <strong>No accounts exist yet</strong>, so nobody can sign in —
            including anyone who finds this URL. Create the first administrator
            on the <a href="/setup">setup page</a>, or by running{' '}
            <code>npm run create-admin</code>.
          </div>
        ) : null}

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        <form action={submit}>
          <label className="f" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username"
                 required autoFocus />
          <label className="f" htmlFor="password">Password</label>
          <input id="password" name="password" type="password"
                 autoComplete="current-password" required />
          <button className="btn" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}
