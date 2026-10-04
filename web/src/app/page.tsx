import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocation, showTypesFor } from '@/lib/config';
import { DatabaseUnavailable } from '@/lib/db';
import { DbSetupNeeded } from '@/app/DbSetupNeeded';
import {
  requireUser, canSeeLocation, visibleLocations, isAdmin, NotAuthenticated,
} from '@/lib/auth';
import { eventsForLocation } from '@/lib/db';
import {
  computeEvent, adoptStrayScreech, screechSeparate, SCREECH_TYPE_ID,
} from '@/lib/service';
import {
  createEventAction, loadSampleAction, deleteEventAction, addScreechNightAction,
} from './actions';
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

  await adoptStrayScreech(loc.id);
  const separate = screechSeparate(loc.id);
  const all = await eventsForLocation(loc.id);
  // Screech-in nights get their own list; the shows list is shows only.
  const events = separate
    ? all.filter((e) => e.show_type_id !== SCREECH_TYPE_ID) : all;
  const nights = separate
    ? all.filter((e) => e.show_type_id === SCREECH_TYPE_ID) : [];

  // The show a date's screech-ins merge into: the first one entered, the
  // same rule showForDate applies.
  const firstShowOn = new Map<string, (typeof events)[number]>();
  const key = (e: (typeof events)[number]) =>
    [new Date(e.created_at).getTime(), e.id] as const;
  for (const e of events) {
    const at = firstShowOn.get(e.event_date);
    const [t, id] = key(e);
    if (!at || t < key(at)[0] || (t === key(at)[0] && id < at.id)) {
      firstShowOn.set(e.event_date, e);
    }
  }
  const screechRows = await Promise.all(nights.map(async (e) => {
    try {
      const r = await computeEvent(e.id, loc.id);
      return {
        e,
        sessions: r?.screech.length ?? 0,
        hosts: [...new Set(r?.screech.flatMap((s) => s.hosts.map((h) => h.name)) ?? [])],
        totalCents: r?.screechTotalCents ?? 0,
        show: firstShowOn.get(e.event_date),
        error: false,
      };
    } catch {
      return { e, sessions: 0, hosts: [], totalCents: 0,
               show: firstShowOn.get(e.event_date), error: true };
    }
  }));

  // Compute every row up front: JSX cannot await inside .map().
  const rows = await Promise.all(events.map(async (e) => {
    try {
      const r = await computeEvent(e.id, loc.id);
      // Screech-in and late tips paid to a person sit outside the show's
      // pool, so the list counts the whole night, or a screech-in-only night
      // would read as "no tips entered".
      return r
        ? {
            e,
            totalCents: r.grandTotalCents,
            total: fmt(r.grandTotalCents),
            check: fmt(r.reconciliationCents),
            balanced: r.reconciliationCents === 0,
            people: r.personTotals.length,
            unallocated: r.unallocatedCents + r.lateUnassignedCents +
              r.screech.reduce((a, x) => a + x.unallocatedCents, 0),
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
  // A pay period is a fortnight: today and the thirteen days before it.
  const periodStart = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);

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

        {separate && (
          <div className="panel">
            <h2>Screech-In</h2>
            <p className="sub">
              Screech-ins are kept apart from the shows. When a show ran on the
              same date, its Excel includes that date&rsquo;s screech-ins;
              otherwise the screech-in gets an Excel of its own.
            </p>
            {screechRows.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Hosts</th>
                      <th className="num">Screech-ins</th>
                      <th className="num">Tips</th>
                      <th>Excel</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {screechRows.map((s) => (
                      <tr key={s.e.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Link href={`/events/${s.e.id}?location=${loc.id}`}
                                style={{ fontWeight: 600, textDecoration: 'none' }}>
                            {humanDate(s.e.event_date)}
                          </Link>
                        </td>
                        <td>
                          {s.hosts.length
                            ? s.hosts.join(', ')
                            : <span className="muted">no hosts yet</span>}
                        </td>
                        <td className="num">{s.sessions || '—'}</td>
                        <td className="num">
                          {s.error ? <span className="alert">needs attention</span>
                                   : fmt(s.totalCents)}
                        </td>
                        <td>
                          {s.show ? (
                            <span>
                              merged into{' '}
                              <Link href={`/events/${s.show.id}?location=${loc.id}`}>
                                {s.show.show_name || 'Untitled show'}
                              </Link>
                            </span>
                          ) : (
                            <span className="muted">own sheet, no show that date</span>
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
                                `Delete the screech-in on ${humanDate(s.e.event_date)}?` +
                                `\n\nThis removes every screech-in and host recorded ` +
                                `for that date. It cannot be undone.`
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
            <form action={addScreechNightAction} style={{ marginTop: 14 }}>
              <input type="hidden" name="locationId" value={loc.id} />
              <div className="row-actions" style={{ alignItems: 'flex-end', gap: 10 }}>
                <div>
                  <label className="f" htmlFor="screechDate">Date</label>
                  <input id="screechDate" type="date" name="eventDate" required
                         defaultValue={today} />
                </div>
                <button className="btn" type="submit">Add a screech-in</button>
              </div>
            </form>
          </div>
        )}

        <div className="panel">
          <h2>Tips workbook</h2>
          <p className="sub">
            One Excel file for a pay period: a sheet for every night with tips
            (named by date, with that date&rsquo;s screech-ins included), then a
            Total Payout sheet per venue with each person&rsquo;s pay night by night.
          </p>
          <form action="/api/workbook" method="get">
            <div className="grid g3">
              <div>
                <label className="f" htmlFor="wbFrom">From</label>
                <input id="wbFrom" type="date" name="from" required defaultValue={periodStart} />
              </div>
              <div>
                <label className="f" htmlFor="wbTo">To</label>
                <input id="wbTo" type="date" name="to" required defaultValue={today} />
              </div>
              <div>
                <label className="f" htmlFor="wbScope">Venues</label>
                <select id="wbScope" name="scope" defaultValue={allowed.length > 1 ? 'all' : loc.id}>
                  {allowed.length > 1 && <option value="all">All venues</option>}
                  {allowed.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} only</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn" type="submit">Download workbook</button>
            </div>
          </form>
        </div>

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
                  {showTypesFor(loc)
                    .filter((s) => !separate || s.id !== SCREECH_TYPE_ID)
                    .map((s) => (
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
