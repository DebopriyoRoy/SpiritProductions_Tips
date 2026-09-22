import Link from 'next/link';
import { LOCATIONS } from '@/lib/config';

export function LocationBar({ active }: { active: string }) {
  return (
    <header className="bar">
      <div className="inner">
        <span className="brand">Spirit Tips</span>
        <nav className="locpick">
          {LOCATIONS.map((l) => (
            <Link key={l.id} href={`/?location=${l.id}`}
                  className={l.id === active ? 'on' : ''}>
              {l.name}
            </Link>
          ))}
        </nav>
        <span style={{ marginLeft: 'auto' }} className="pill">
          {process.env.SQUARE_ACCESS_TOKEN ? 'Square connected' : 'Demo data'}
        </span>
      </div>
    </header>
  );
}
