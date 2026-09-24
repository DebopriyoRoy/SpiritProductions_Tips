import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocation, LOCATIONS, SECTIONS, getShowType } from '@/lib/config';
import { loadEvent, toEngineInput } from '@/lib/service';
import { calculate, SECTION_LABEL, Section } from '@/lib/tips';
import { fmt } from '@/lib/money';
import { LocationBar } from '@/app/LocationBar';
import { requireUser, canSeeLocation, NotAuthenticated } from '@/lib/auth';
import { saveEventAction, syncAction, addStaffAction, deleteStaffAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function EventPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string; synced?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (err instanceof NotAuthenticated) redirect('/login');
    throw err;
  }
  const locationId = sp.location ?? LOCATIONS[0].id;
  const loc = getLocation(locationId);
  // An unpermitted venue is indistinguishable from one that does not exist.
  if (!loc || !canSeeLocation(user, loc.id)) notFound();

  const loaded = await loadEvent(id, loc.id);
  if (!loaded) notFound();
  const { event, cast, staff } = loaded;
  const show = getShowType(event.show_type_id);
  const r = calculate(toEngineInput(event, cast, staff));

  const money = (c: number) => fmt(c);
  const staffBySection = (s: Section) => r.staff.filter((x) => x.section === s);

  async function sync(fd: FormData) {
    'use server';
    const res = await syncAction(fd);
    redirect(`/events/${fd.get('eventId')}?location=${fd.get('locationId')}` +
      `&synced=${encodeURIComponent(JSON.stringify({
        p: res.provider, a: res.added, u: res.updated, s: res.skipped, n: res.nonTipped,
      }))}`);
  }

  const synced = sp.synced ? JSON.parse(sp.synced) : null;

  return (
    <>
      <LocationBar active={loc.id} user={user} />
      <div className="wrap">
        <h1>{event.show_name || 'Untitled show'}</h1>
        <p className="sub">
          {loc.name} · {event.show_type} · {event.event_date}
          {event.guest_attendance != null && ` · ${event.guest_attendance} guests`}
          {' · '}<Link href={`/?location=${loc.id}`}>All shows</Link>
        </p>

        {synced && (
          <div className="note">
            Synced from <strong>{synced.p === 'demo' ? 'demo data' : 'Square'}</strong>:
            {' '}{synced.a} added, {synced.u} updated, {synced.s} kept as edited,
            {' '}{synced.n} non-tipped role(s) skipped.
          </div>
        )}
        {r.warnings.map((w, i) => <div className="note" key={i}>{w}</div>)}

        <div className="figures stick">
          <div className="fig">
            <div className="k">Total tips</div>
            <div className="v">{money(r.totalCents)}</div>
            <div className="s">{show.label}</div>
          </div>
          {show.hasCast ? (
            <div className="fig">
              <div className="k">Cast pool ({event.cast_share_percent}%)</div>
              <div className="v">{money(r.castPoolCents)}</div>
              <div className="s">
                {r.castWorkedRatioTotal} share(s) &middot; {r.castRatePerShare.toFixed(4)} each
              </div>
            </div>
          ) : (
            <div className="fig is-nil">
              <div className="k">Cast pool</div>
              <div className="v">&mdash;</div>
              <div className="s">no cast share on this show type</div>
            </div>
          )}
          <div className="fig">
            <div className="k">Staff pool</div>
            <div className="v">{money(r.staffPoolCents)}</div>
            <div className="s">
              {r.staffHoursTotal.toFixed(2)} h &middot; {r.staffRatePerHour.toFixed(6)}/h
            </div>
          </div>
          <div className={`fig ${r.reconciliationCents === 0 ? 'is-ok' : 'is-alert'}`}>
            <div className="k">Check</div>
            <div className="v">{money(r.reconciliationCents)}</div>
            <div className="s">cast + staff &minus; total</div>
          </div>
        </div>

        <div className="formula">
          <b>How this show type pays</b>
          {show.formula}
        </div>

        {r.unallocatedCents > 0 && (
          <div className="note">
            <strong>{money(r.unallocatedCents)} is unallocated</strong> and has not
            been paid to anyone
            {r.unallocatedCastCents > 0 && ' — no cast is ticked as having worked'}
            {r.unallocatedStaffCents > 0 && ' — no staff hours are entered'}.
          </div>
        )}

        {r.roundingDriftCents !== 0 && (
          <div className="note">
            Paying the spreadsheet&rsquo;s <em>displayed</em> figures would total{' '}
            {money(r.naiveRoundedTotalCents)} — {money(Math.abs(r.roundingDriftCents))}{' '}
            {r.roundingDriftCents > 0 ? 'more' : 'less'} than the {money(r.totalCents)}{' '}
            collected. The amounts below are exact and sum to the pool.
          </div>
        )}

        <form action={sync} style={{ margin: '16px 0' }}>
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="locationId" value={loc.id} />
          <button className="btn" type="submit">Sync with Square</button>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            Pulls timecards for {event.event_date} at {loc.name} only.
          </span>
        </form>

        <form action={saveEventAction}>
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="locationId" value={loc.id} />

          <div className="panel">
            <h2>Tips collected</h2>
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="gratuity">Gratuity</label>
                <input id="gratuity" className="num" name="gratuity" type="number" step="0.01"
                       defaultValue={(event.gratuity_cents / 100).toFixed(2)} />
              </div>
              <div>
                <label className="f" htmlFor="cash">Cash at bar</label>
                <input id="cash" className="num" name="cash" type="number" step="0.01"
                       defaultValue={(event.cash_cents / 100).toFixed(2)} />
              </div>
              <div>
                <label className="f" htmlFor="square">Square tips</label>
                <input id="square" className="num" name="square" type="number" step="0.01"
                       defaultValue={(event.square_cents / 100).toFixed(2)} />
              </div>
              <div>
                <label className="f" htmlFor="totalOverride">Total override</label>
                <input id="totalOverride" className="num" name="totalOverride" type="number" step="0.01"
                       placeholder="blank = sum of the three"
                       defaultValue={event.total_override_cents != null
                         ? (event.total_override_cents / 100).toFixed(2) : ''} />
              </div>
            </div>

            <h3>Rules for this show</h3>
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="castSharePercent">Cast share %</label>
                <input id="castSharePercent" className="num" name="castSharePercent"
                       type="number" step="0.1" defaultValue={event.cast_share_percent} />
              </div>
              <div>
                <label className="f" htmlFor="officeHours">Office hours</label>
                <input id="officeHours" className="num" name="officeHours"
                       type="number" step="0.01" defaultValue={event.office_hours} />
              </div>
              <div>
                <label className="f" htmlFor="oddCentTo">Odd cent to</label>
                <select id="oddCentTo" name="oddCentTo" defaultValue={event.odd_cent_to}>
                  <option value="staff">Staff</option>
                  <option value="cast">Cast</option>
                </select>
              </div>
              <div>
                <label className="f" htmlFor="showName">Show name</label>
                <input id="showName" name="showName" type="text" defaultValue={event.show_name} />
              </div>
            </div>
            {show.hasContractService && (
              <>
                <h3>Service requested as per contract</h3>
                <input name="contractService" type="text"
                       defaultValue={event.contract_service}
                       placeholder="e.g. bar service, plated dinner for 80"
                       aria-label="Service requested as per contract" />
              </>
            )}
            {!show.hasContractService && (
              <input type="hidden" name="contractService"
                     value={event.contract_service} />
            )}
            <input type="hidden" name="guestAttendance" value={event.guest_attendance ?? ''} />
          </div>

          {show.hasCast && <div className="panel">
            <h2>Cast &amp; Musicians — paid per head</h2>
            <p className="sub">
              Hours are irrelevant here. Tick who worked; the pool divides by ratio.
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th className="num">Ratio</th>
                    <th className="num">Worked</th><th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cast.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.name}{' '}
                        {c.technical && <span className="pill">Technical</span>}
                      </td>
                      <td className="num" style={{ width: 90 }}>
                        <input className="num" name={`cast_ratio_${c.id}`} type="number"
                               step="0.1" min="0" defaultValue={c.ratio} />
                      </td>
                      <td className="num" style={{ width: 80 }}>
                        <input type="checkbox" name={`cast_worked_${c.id}`}
                               defaultChecked={c.worked}
                               aria-label={`${c.name} worked`} />
                      </td>
                      <td className="num">{money(c.amountCents)}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Cast &amp; Musicians total</td>
                    <td className="num">{r.castWorkedRatioTotal}</td>
                    <td></td>
                    <td className="num">{money(r.castPoolCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>}

          <div className="panel">
            <h2>Staff — paid per hour</h2>
            <p className="sub">
              One rate across every section: {r.staffRatePerHour.toFixed(6)} per hour.
              Untick to exclude a row without deleting it.
            </p>
            {show.sections.map((section) => {
              const rows = staffBySection(section);
              if (rows.length === 0) return null;
              const t = r.sectionTotals.find((x) => x.section === section)!;
              return (
                <div key={section} className="tablewrap">
                  <h3>
                    {SECTION_LABEL[section]}
                    <span className="muted" style={{
                      textTransform: 'none', letterSpacing: 0, fontWeight: 400,
                      marginLeft: 8,
                    }}>
                      {rows.filter((x) => x.hours > 0).length} of {rows.length} worked
                    </span>
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th><th className="num">Hours</th>
                        <th className="num">In</th><th>Note</th>
                        <th className="num">Amount</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => {
                        const src = staff.find((x) => x.id === s.id)!;
                        return (
                          <tr key={s.id}>
                            <td>
                              {s.name}{' '}
                              {src.source === 'square' && <span className="pill">Square</span>}
                              {!!src.overridden && <span className="pill">edited</span>}
                            </td>
                            <td className="num" style={{ width: 100 }}>
                              <input className="num" name={`staff_hours_${s.id}`} type="number"
                                     step="0.01" min="0" defaultValue={s.hours}
                                     aria-label={`${s.name} hours`} />
                            </td>
                            <td className="num" style={{ width: 60 }}>
                              <input type="checkbox" name={`staff_incl_${s.id}`}
                                     defaultChecked={!!src.included}
                                     aria-label={`${s.name} included`} />
                            </td>
                            <td style={{ minWidth: 160 }}>
                              <input name={`staff_note_${s.id}`} type="text"
                                     defaultValue={src.note}
                                     placeholder={src.included ? '' : 'reason required'}
                                     aria-label={`${s.name} note`} />
                            </td>
                            <td className="num">{money(s.amountCents)}</td>
                            <td className="num">
                              <button className="btn ghost small" type="submit"
                                      formAction={deleteStaffAction.bind(null, s.id)}
                                      aria-label={`Remove ${s.name}`}>Remove</button>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="total">
                        <td>{SECTION_LABEL[section]} total</td>
                        <td className="num">{t.hours.toFixed(2)}</td>
                        <td></td><td></td>
                        <td className="num">{money(t.amountCents)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn" type="submit">Save</button>
              <span className="muted" style={{ fontSize: 13 }}>
                Bar &amp; Service combined: {r.barServiceHours.toFixed(2)} h ·{' '}
                {money(r.barServiceCents)}
              </span>
            </div>
          </div>
        </form>

        <div className="panel">
          <h2>Add someone</h2>
          <form action={addStaffAction} className="grid g4">
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="locationId" value={loc.id} />
            <div>
              <label className="f" htmlFor="newName">Name</label>
              <input id="newName" name="name" type="text" required />
            </div>
            <div>
              <label className="f" htmlFor="newSection">Section</label>
              <select id="newSection" name="section">
                {show.sections.map((s) => (
                  <option key={s} value={s}>{SECTION_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="f" htmlFor="newHours">Hours</label>
              <input id="newHours" className="num" name="hours" type="number" step="0.01"
                     min="0" defaultValue="0" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn ghost" type="submit">Add</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <h2>Payout per person</h2>
          <p className="sub">
            Aggregated across sections — someone who worked two roles appears once.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th className="num">Hours</th>
                  <th>Sections</th><th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {r.perPerson.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className="num">{p.hours ? p.hours.toFixed(2) : '—'}</td>
                    <td className="muted">{p.parts.join(' + ')}</td>
                    <td className="num">{money(p.amountCents)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total paid</td><td></td><td></td>
                  <td className="num">
                    {money(r.perPerson.reduce((a, b) => a + b.amountCents, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14 }}>
            <a className="btn" href={`/api/events/${event.id}/export?location=${loc.id}`}>
              Download Excel
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
