import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getLocation, LOCATIONS, showTypesFor, getShowTypeForLocation,
} from '@/lib/config';
import { listRoster, ROSTER_SECTIONS, RosterSection } from '@/lib/roster';
import { SECTION_LABEL, CAST_SECTION } from '@/lib/tips';
import { requireUser, canSeeLocation, NotAuthenticated } from '@/lib/auth';
import { LocationBar } from '@/app/LocationBar';
import { ConfirmButton } from '@/app/ConfirmButton';
import { addTeamMemberAction, setTeamMemberActiveAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

const label = (s: RosterSection) =>
  s === CAST_SECTION ? 'Cast & Musicians' : SECTION_LABEL[s];

const OK: Record<string, string> = {
  added: 'added to the team.',
  restored: 'is back on the team.',
  exists: 'is already on the team.',
  removed: 'has been taken off the team. Nights already entered keep them.',
};

/**
 * The team list: who every new show at this venue starts with.
 *
 * Adding someone here puts them on the next show created; removing them
 * takes them off new shows only. Nobody is ever deleted, so a removal can be
 * undone and past nights are never touched.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; ok?: string; who?: string; error?: string }>;
}) {
  const sp = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof NotAuthenticated) redirect('/login');
    throw err;
  }
  const loc = getLocation(sp.location ?? LOCATIONS[0].id);
  if (!loc || !canSeeLocation(user, loc.id)) notFound();

  // Only the sections this venue actually runs: ACC has no cast, 50/50 or
  // office, so listing them there would invite edits that change nothing.
  const types = showTypesFor(loc).map((t) => getShowTypeForLocation(t.id, loc.id));
  const sections = ROSTER_SECTIONS.filter((s) => s === CAST_SECTION
    ? types.some((t) => t.hasCast)
    : types.some((t) => t.sections.includes(s)));

  const members = (await listRoster())
    .filter((m) => m.venue === '' || m.venue === loc.id)
    .filter((m) => sections.includes(m.section));
  const removed = members.filter((m) => !m.active)
    .sort((a, b) => a.name.localeCompare(b.name));
  const venueName = (id: string) => getLocation(id)?.name ?? id;

  return (
    <>
      <LocationBar active={loc.id} user={user} />
      <div className="wrap">
        <h1>Team</h1>
        <p className="sub">
          Everyone here is put on each new show at {loc.name}, so the sheet
          starts with the whole team. Take someone off when they leave: shows
          already entered keep them. <Link href={`/?location=${loc.id}`}>Back to shows</Link>
        </p>

        {sp.error ? <div className="note err" role="alert">{sp.error}</div> : null}
        {sp.ok && OK[sp.ok] ? (
          <div className="note ok-note">{sp.who ? `${sp.who} ` : 'Done: '}{OK[sp.ok]}</div>
        ) : null}

        <div className="panel">
          <h2>Add someone to the team</h2>
          <form action={addTeamMemberAction}>
            <input type="hidden" name="locationId" value={loc.id} />
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="team-name">Name</label>
                <input id="team-name" name="name" type="text" required />
              </div>
              <div>
                <label className="f" htmlFor="team-section">Section</label>
                <select id="team-section" name="section">
                  {sections.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </div>
              <div>
                <label className="f" htmlFor="team-venue">Works at</label>
                <select id="team-venue" name="venue" defaultValue="">
                  <option value="">Every venue</option>
                  <option value={loc.id}>{loc.name} only</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn" type="submit">Add</button>
              </div>
            </div>
            {sections.includes(CAST_SECTION) && (
              <label className="chk" style={{ marginTop: 10 }}>
                <input type="checkbox" name="technical" /> Technical crew (paid with the cast)
              </label>
            )}
          </form>
        </div>

        {sections.map((s) => {
          const list = members.filter((m) => m.section === s && m.active);
          return (
            <div className="panel" key={s}>
              <h2>{label(s)} <span className="muted">({list.length})</span></h2>
              {list.length === 0 ? <p className="sub">Nobody yet.</p> : (
                <ul className="teamlist">
                  {list.map((m) => (
                    <li key={m.id}>
                      <span className="who">
                        {m.name}
                        {m.technical && <span className="pill">Technical</span>}
                        {m.venue && <span className="pill">{venueName(m.venue)} only</span>}
                      </span>
                      <form action={setTeamMemberActiveAction.bind(null, m.id, false)}>
                        <input type="hidden" name="locationId" value={loc.id} />
                        <input type="hidden" name="who" value={m.name} />
                        <ConfirmButton message={
                          `Take ${m.name} off ${label(s)}? They won't be on new shows. ` +
                          'Shows already entered keep them, and you can put them back.'}>
                          Remove
                        </ConfirmButton>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {removed.length > 0 && (
          <details className="panel">
            <summary><strong>No longer with us ({removed.length})</strong></summary>
            <ul className="teamlist" style={{ marginTop: 10 }}>
              {removed.map((m) => (
                <li key={m.id}>
                  <span className="who">
                    {m.name} <span className="muted">· {label(m.section)}</span>
                  </span>
                  <form action={setTeamMemberActiveAction.bind(null, m.id, true)}>
                    <input type="hidden" name="locationId" value={loc.id} />
                    <input type="hidden" name="who" value={m.name} />
                    <button className="btn ghost small" type="submit">Put back</button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}
