import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  requireAdmin, listUsers, createUser, setUserPassword, setUserAccess,
  NotAuthenticated, NotAuthorised, MIN_PASSWORD,
} from '@/lib/auth';
import { LOCATIONS } from '@/lib/config';
import { LocationBar } from '@/app/LocationBar';

export const dynamic = 'force-dynamic';

export default async function AdminPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  let me;
  try {
    me = await requireAdmin();
  } catch (err) {
    if (err instanceof NotAuthenticated) redirect('/login');
    if (err instanceof NotAuthorised) redirect('/');
    throw err;
  }
  const users = await listUsers();

  async function add(fd: FormData) {
    'use server';
    await requireAdmin();
    try {
      await createUser({
        email: String(fd.get('email') ?? ''),
        name: String(fd.get('name') ?? ''),
        password: String(fd.get('password') ?? ''),
        role: String(fd.get('role') ?? 'manager'),
        locations: fd.getAll('locations').map(String),
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Could not add that person';
      redirect(`/admin?error=${encodeURIComponent(
        /duplicate key/.test(m) ? 'That email already has an account.' : m)}`);
    }
    redirect('/admin?ok=added');
  }

  async function update(fd: FormData) {
    'use server';
    const admin = await requireAdmin();
    const id = String(fd.get('userId'));
    const active = fd.has('active');
    if (id === admin.id && !active) {
      redirect('/admin?error=' + encodeURIComponent(
        'You cannot deactivate your own account.'));
    }
    await setUserAccess(id, String(fd.get('role')),
      fd.getAll('locations').map(String), active);
    redirect('/admin?ok=saved');
  }

  async function resetPassword(fd: FormData) {
    'use server';
    await requireAdmin();
    try {
      await setUserPassword(String(fd.get('userId')), String(fd.get('password') ?? ''));
    } catch (e) {
      redirect(`/admin?error=${encodeURIComponent(
        e instanceof Error ? e.message : 'Could not set that password')}`);
    }
    redirect('/admin?ok=password');
  }

  const OK: Record<string, string> = {
    added: 'Account created.', saved: 'Access updated.',
    password: 'Password changed — that person is now signed out everywhere.',
  };

  return (
    <>
      <LocationBar active="" user={me} />
      <div className="wrap">
        <h1>People</h1>
        <p className="sub">
          Who can sign in, and which venues they see. Leave every venue unticked
          to grant access to all of them. <Link href="/">Back to shows</Link>
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}
        {sp.ok ? <div className="note ok-note">{OK[sp.ok] ?? 'Done.'}</div> : null}

        <div className="panel">
          <h2>Add someone</h2>
          <form action={add}>
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="new-name">Name</label>
                <input id="new-name" name="name" type="text" />
              </div>
              <div>
                <label className="f" htmlFor="new-email">Email</label>
                <input id="new-email" name="email" type="email" required />
              </div>
              <div>
                <label className="f" htmlFor="new-password">
                  Password ({MIN_PASSWORD}+ characters)
                </label>
                <input id="new-password" name="password" type="password"
                       minLength={MIN_PASSWORD} required />
              </div>
              <div>
                <label className="f" htmlFor="new-role">Role</label>
                <select id="new-role" name="role">
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <span className="f">Venues</span>
              <div className="row-actions">
                {LOCATIONS.map((l) => (
                  <label key={l.id} className="chk">
                    <input type="checkbox" name="locations" value={l.id} /> {l.name}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Add person</button>
            </div>
          </form>
        </div>

        {users.map((u) => (
          <div className="panel" key={u.id}>
            <h2>{u.name || u.email}</h2>
            <p className="sub">
              {u.email}
              {u.id === me.id && <span className="pill" style={{ marginLeft: 8 }}>you</span>}
              {!u.active && <span className="pill" style={{ marginLeft: 8 }}>inactive</span>}
            </p>
            <form action={update}>
              <input type="hidden" name="userId" value={u.id} />
              <div className="grid g4">
                <div>
                  <label className="f" htmlFor={`role-${u.id}`}>Role</label>
                  <select id={`role-${u.id}`} name="role" defaultValue={u.role}>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <span className="f">Venues (none ticked = all)</span>
                  <div className="row-actions">
                    {LOCATIONS.map((l) => (
                      <label key={l.id} className="chk">
                        <input type="checkbox" name="locations" value={l.id}
                               defaultChecked={(u.locations ?? []).includes(l.id)} />
                        {' '}{l.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="f">Status</span>
                  <label className="chk">
                    <input type="checkbox" name="active" defaultChecked={u.active} />
                    {' '}Can sign in
                  </label>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btn ghost" type="submit">Save access</button>
              </div>
            </form>

            <form action={resetPassword} style={{ marginTop: 14 }}>
              <input type="hidden" name="userId" value={u.id} />
              <label className="f" htmlFor={`pw-${u.id}`}>Set a new password</label>
              <div className="row-actions">
                <input id={`pw-${u.id}`} name="password" type="password"
                       minLength={MIN_PASSWORD} required
                       style={{ maxWidth: 280 }}
                       placeholder={`${MIN_PASSWORD}+ characters`} />
                <button className="btn ghost" type="submit">Change password</button>
              </div>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
