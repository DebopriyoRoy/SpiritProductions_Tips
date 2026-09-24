import Link from 'next/link';
import { SessionUser, isAdmin, visibleLocations } from '@/lib/auth';
import { signOutAction } from '@/app/actions';

export function LocationBar({ active, user }: { active: string; user: SessionUser }) {
  const locations = visibleLocations(user);
  const live = !!process.env.SQUARE_ACCESS_TOKEN;
  return (
    <header className="bar">
      <div className="inner">
        <Link href="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          Spirit Tips
        </Link>
        {locations.length > 1 && (
          <nav className="locpick" aria-label="Venue">
            {locations.map((l) => (
              <Link key={l.id} href={`/?location=${l.id}`}
                    className={l.id === active ? 'on' : ''}
                    aria-current={l.id === active ? 'page' : undefined}>
                {l.name}
              </Link>
            ))}
          </nav>
        )}
        <div className="who-bar">
          <span className="pill" title={live
            ? 'Timecards come from the live Square account'
            : 'No Square credentials set — timecards are sample data'}>
            {live ? 'Square connected' : 'Demo data'}
          </span>
          {isAdmin(user) && <Link href="/admin" className="pill link">People</Link>}
          <span title={user.email}>{user.name || user.email}</span>
          <form action={signOutAction}>
            <button className="btn ghost small" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
