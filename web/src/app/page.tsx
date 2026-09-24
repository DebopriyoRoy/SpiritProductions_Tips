import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocation, showTypesFor } from '@/lib/config';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';
import {
  requireUser, canSeeLocation, visibleLocations, isAdmin, NotAuthenticated,
} from '@/lib/auth';
import { eventsForLocation } from '@/lib/db';
import { computeEvent } from '@/lib/service';
import { createEventAction, loadSampleAction, deleteEventAction } from './actions';
import { ConfirmButton } from '@/app/ConfirmButton';
import { LocationBar } from './LocationBar';
import { fmt } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** "Fri 28 Aug 2026" reads faster down a column than an ISO date. */
function humanDate(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export default async function Home({
  searchParams,
}: { searchParams: Promise<{ location?: string; error?: string }> }) {
  const sp = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof DatabaseUnavailable) return <DbSetupNeeded error={err} />;
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
        ? {
            e,
            totalCents: r.totalCents,
            total: fmt(r.totalCents),
            check: fmt(r.reconciliationCents),
            balanced: r.reconciliationCents === 0,
            people: r.perPerson.length,
            unallocated: r.unallocatedCents,
          }
        : null;
    } catch {
      return {
        e, totalCents: 0, total: '—', check: 'error', balanced: false,
        people: 0, unallocated: 0,
      };
    }
  }));
  const shows = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[];
  const grandTotal = shows.reduce((a, s) => a + s.totalCents, 0);

  async function create(fd: FormData) {
    'use server';
    const locId = String(fd.get('locationId'));
    let id: string;
    try {
      id = await createEventAction(fd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /duplicate key|already exists/i.test(msg)
        ? 'A show with that name already exists on that date. Give it a name, ' +
          'or pick a different date.'
        : msg;
      redirect(`/?location=${locId}&error=${encodeURIComponent(friendly)}`);
    }
    redirect(`/events/${id}?location=${locId}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <LocationBar active={loc.id} user={user} />
      <div className="wrap">
        <h1>{loc.name}</h1>
        <p className="sub">
          {shows.length === 0
            ? 'No show nights recorded yet.'
            : `${shows.length} show night${shows.length === 1 ? '' : 's'} · ` +
              `${fmt(grandTotal)} in tips distributed`}
          {' · '}
          <span className="muted">
            this venue only — both share one Square account, so location filters
            every query
          </span>
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}

        {shows.length === 0 ? (
          <div className="empty">
            <p>
              Nothing here yet. Add your first show night below.
            </p>
            {isAdmin(user) && loc.id === 'spirit' && (
              <form action={loadSampleAction}>
                <button className="btn ghost" type="submit">
                  Load the sample show
                </button>
                <p style={{ margin: '10px 0 0', fontSize: 13 }}>
                  Forever Country, 28 Aug 2026 &mdash; the night checked against
                  the workbook.
                </p>
              </form>
            )}
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Show</th>
                  <th className="num">People</th>
                  <th className="num">Total tips</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shows.map((s) => (
                  <tr key={s.e.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {humanDate(s.e.event_date)}
                    </td>
                    <td>
                      <Link href={`/events/${s.e.id}?location=${loc.id}`}
                            style={{ fontWeight: 600, textDecoration: 'none' }}>
                        {s.e.show_name || 'Untitled show'}
                      </Link>
                      <div className="roles">{s.e.show_type}</div>
                    </td>
                    <td className="num">{s.people || '—'}</td>
                    <td className="num">{s.total}</td>
                    <td>
                      {s.check === 'error' ? (
                        <span className="alert">needs attention</span>
                      ) : s.totalCents === 0 ? (
                        <span className="muted">no tips entered</span>
                      ) : s.unallocated > 0 ? (
                        <span className="muted">
                          {fmt(s.unallocated)} unallocated
                        </span>
                      ) : s.balanced ? (
                        <span className="ok">balanced</span>
                      ) : (
                        <span className="alert">off by {s.check}</span>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <div className="row-actions" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <Link className="btn ghost small"
                              href={`/events/${s.e.id}?location=${loc.id}`}>
                          Edit
                        </Link>
                        <form action={deleteEventAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="eventId" value={s.e.id} />
                          <input type="hidden" name="locationId" value={loc.id} />
                          <ConfirmButton message={
                            `Delete "${s.e.show_name || 'Untitled show'}" on ` +
                            `${humanDate(s.e.event_date)}?\n\nThis removes the ` +
                            `night and everything recorded against it. It cannot be undone.`
                          }>
                            Delete
                          </ConfirmButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="panel">
          <h2>Add a show night</h2>
          <form action={create}>
            <input type="hidden" name="locationId" value={loc.id} />
            <div className="grid g3">
              <div>
                <label className="f" htmlFor="eventDate">Date</label>
                <input id="eventDate" type="date" name="eventDate" required
                       defaultValue={today} />
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
                <input id="showName" type="text" name="showName"
                       placeholder="Forever Country" />
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn" type="submit">Create show</button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
