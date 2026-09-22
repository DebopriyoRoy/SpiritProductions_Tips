import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LOCATIONS, getLocation, showTypesFor } from '@/lib/config';
import { requireUser, canSeeLocation, visibleLocations, isAdmin, NotAuthenticated } from '@/lib/auth';
import { eventsForLocation } from '@/lib/db';
import { computeEvent } from '@/lib/service';
import { createEventAction, loadSampleAction } from './actions';
import { LocationBar } from './LocationBar';
import { fmt } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ location?: string }> }) {
  const sp = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof NotAuthenticated) redirect('/login');
    throw err;
  }

  const allowed = visibleLocations(user);
  if (allowed.length === 0) {
    return (
      <div className="wrap">
        <h1>No venues</h1>
        <p className="sub">
          Your account has no venue access yet. Ask an administrator to grant it
          on the People page.
        </p>
      </div>
    );
  }

  const locationId = sp.location ?? allowed[0].id;
  const loc = getLocation(locationId);
  if (!loc || !canSeeLocation(user, loc.id)) redirect(`/?location=${allowed[0].id}`);

  const events = await eventsForLocation(loc.id);

  // Compute every row up front: JSX cannot await inside .map().
  const rows = await Promise.all(events.map(async (e) => {
    try {
      const r = await computeEvent(e.id, loc.id);
      return r
        ? { e, total: fmt(r.totalCents), check: fmt(r.reconciliationCents) }
        : { e, total: '—', check: null as string | null };
    } catch {
      return { e, total: '—', check: 'error' as string | null };
    }
  }));

  async function create(fd: FormData) {
    'use server';
    const id = await createEventAction(fd);
    redirect(`/events/${id}?location=${fd.get('locationId')}`);
  }

  return (
    <>
      <LocationBar active={loc.id} user={user} />
      <div className="wrap">
        <h1>{loc.name}</h1>
        <p className="sub">
          Showing only this location&rsquo;s events. Both venues share one Square
          account, so the location is applied as a filter on every query.
        </p>

        <div className="panel">
          <h2>New show</h2>
          <form action={create}>
            <input type="hidden" name="locationId" value={loc.id} />
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="eventDate">Date</label>
                <input id="eventDate" type="date" name="eventDate" required
                       defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
              <div>
                <label className="f" htmlFor="showTypeId">Show type</label>
                <select id="showTypeId" name="showTypeId">
                  {showTypesFor(loc).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="f" htmlFor="showName">Show name</label>
                <input id="showName" type="text" name="showName" placeholder="Forever Country" />
              </div>
              <div>
                <label className="f" htmlFor="guestAttendance">Guests</label>
                <input id="guestAttendance" className="num" type="number" name="guestAttendance" min="0" />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Create show</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <h2>Shows</h2>
          {events.length === 0 ? (
            <>
              <p className="muted">No shows yet for {loc.name}.</p>
              {isAdmin(user) && loc.id === 'spirit' && (
                <form action={loadSampleAction} style={{ marginTop: 10 }}>
                  <button className="btn ghost" type="submit">
                    Load the sample show
                  </button>
                  <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
                    Forever Country, 28 Aug 2026 — the night checked against the
                    workbook.
                  </span>
                </form>
              )}
            </>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Show</th><th>Type</th>
                    <th className="num">Total tips</th>
                    <th className="num">Check</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ e, total, check }) => (
                      <tr key={e.id}>
                        <td>{e.event_date}</td>
                        <td>{e.show_name || <span className="muted">untitled</span>}</td>
                        <td className="muted">{e.show_type}</td>
                        <td className="num">{total}</td>
                        <td className="num">
                          {check === '0.00'
                            ? <span className="ok">0.00</span>
                            : <span className="bad">{check}</span>}
                        </td>
                        <td className="num">
                          <Link href={`/events/${e.id}?location=${loc.id}`}>Open</Link>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
