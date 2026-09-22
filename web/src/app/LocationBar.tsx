import Link from 'next/link';
import { SessionUser, isAdmin, visibleLocations } from '@/lib/auth';
import { signOutAction } from '@/app/actions';

export function LocationBar({ active, user }: { active: string; user: SessionUser }) {
  const locations = visibleLocations(user);
  return (
    <header className="bar">
      <div className="inner">
        <span className="brand">Spirit Tips</span>
        <nav className="locpick">
          {locations.map((l) => (
            <Link key={l.id} href={`/?location=${l.id}`}
                  className={l.id === active ? 'on' : ''}>
              {l.name}
            </Link>
          ))}
        </nav>
        <div className="who-bar">
          <span className="pill">
            {process.env.SQUARE_ACCESS_TOKEN ? 'Square connected' : 'Demo data'}
          </span>
          {isAdmin(user) && <Link href="/admin" className="pill link">People</Link>}
          <span className="muted" title={user.email}>{user.name || user.email}</span>
          <form action={signOutAction}>
            <button className="btn ghost small" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
