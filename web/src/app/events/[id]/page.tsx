import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocation, LOCATIONS, SECTIONS, getShowType } from '@/lib/config';
import { loadEvent, toEngineInput } from '@/lib/service';
import { calculate, SECTION_LABEL, Section } from '@/lib/tips';
import { fmt } from '@/lib/money';
import { LocationBar } from '@/app/LocationBar';
import { SaveBar } from '@/app/SaveBar';
import { requireUser, canSeeLocation, NotAuthenticated } from '@/lib/auth';
import {
  saveEventAction, addStaffAction, deleteStaffAction,
  clearSelectionsAction, importTimecardAction,
} from '@/app/actions';
import { TipsTotal } from '@/app/TipsTotal';
import { ConfirmButton } from '@/app/ConfirmButton';
import { HOURS_CAP } from '@/lib/timecardImport';

export const dynamic = 'force-dynamic';

export default async function EventPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ location?: string; import?: string; cleared?: string }>;
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

  let report: Record<string, unknown> | null = null;
  try { report = sp.import ? JSON.parse(sp.import) : null; } catch { report = null; }

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

        {sp.cleared && (
          <div className="note ok-note">
            Selections cleared. Nobody is ticked and every hour is back to zero.
          </div>
        )}

        {report && (report.error ? (
          <div className="note err" role="alert">
            Could not read that timecard: {String(report.error)}
          </div>
        ) : (
          <div className={`note ${Number(report.rows) === 0 ? 'err' : 'ok-note'}`}
               role={Number(report.rows) === 0 ? 'alert' : undefined}>
            {Number(report.rows) === 0 && Number(report.skippedOtherDate) > 0 && (
              <div style={{ marginBottom: 8 }}>
                <strong>Nothing was imported: the dates do not match.</strong>{' '}
                This show is dated <code>{String(report.eventDate)}</code>, but every
                row in that file is dated{' '}
                {(report.datesSeen as string[]).map((d, i, a) => (
                  <span key={d}><code>{d}</code>{i < a.length - 1 ? ', ' : ''}</span>
                ))}
                {Number(report.datesSeenTotal) > (report.datesSeen as string[]).length
                  && ' and others'}.
                {' '}Either correct <em>Show date</em> below and save, or tick{' '}
                <em>Take every row, whatever date it carries</em> and upload again.
              </div>
            )}
            Read <strong>{String(report.file)}</strong> as{' '}
            {String(report.format ?? 'a spreadsheet')}: {String(report.rows)} row(s)
            {report.dateFilterIgnored ? ' (date ignored)' : ' for this date'}.
            {' '}{String(report.staffSet)} staff given hours,
            {' '}{String(report.castTicked)} cast ticked.
            {Number(report.capped) > 0 &&
              ` ${String(report.capped)} trimmed to the ${String(report.cap)}-hour cap.`}
            {Number(report.skippedOtherDate) > 0 &&
              ` ${String(report.skippedOtherDate)} row(s) were for other dates and ignored.`}
            {Number(report.unmatchedTotal) > 0 && (
              <> Not on this roster, so left alone:{' '}
                <em>{(report.unmatched as string[]).join(', ')}</em>
                {Number(report.unmatchedTotal) > (report.unmatched as string[]).length &&
                  ` and ${Number(report.unmatchedTotal) - (report.unmatched as string[]).length} more`}.
              </>
            )}
            {Number(report.multiShift) > 0 &&
              ` ${String(report.multiShift)} worked more than one shift; their hours were added together.`}
            {Number(report.guessedTotal) > 0 && (
              <div style={{ marginTop: 6 }}>
                On more than one roster, and the job title did not say which:{' '}
                <em>{(report.guessed as string[]).join(', ')}</em>. Check those
                rows and move the hours if they landed in the wrong section.
              </div>
            )}
            {(report.warnings as string[] | undefined)?.map((w, i) => <div key={i}>{w}</div>)}
            {report.columns != null && (
              <div className="sub" style={{ marginTop: 6 }}>
                Columns used — name:{' '}
                <code>{String((report.columns as Record<string, unknown>).name)}</code>,
                hours:{' '}
                <code>{String((report.columns as Record<string, unknown>).hours)}</code>
                {(report.columns as Record<string, unknown>).date
                  ? <>, date: <code>{String((report.columns as Record<string, unknown>).date)}</code></>
                  : ', no date column'}.
              </div>
            )}
          </div>
        ))}
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

        <div className="panel toolbar">
          <form action={importTimecardAction} className="uploader">
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="locationId" value={loc.id} />
            <div>
              <label className="f" htmlFor="timecard">
                Upload timecard from Square
              </label>
              <input id="timecard" name="timecard" type="file"
                     accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            </div>
            <button className="btn" type="submit">Upload timecard</button>
            <label className="inline">
              <input type="checkbox" name="ignoreDates" />
              Take every row, whatever date it carries
            </label>
            <p className="sub" style={{ margin: 0, flexBasis: '100%' }}>
              Excel (.xlsx) or CSV. Rows dated {event.event_date} are matched to
              this roster by name: staff get their hours, cast are ticked as
              having worked. Anything over {HOURS_CAP} hours is brought down
              to {HOURS_CAP}.
            </p>
          </form>

          <form action={clearSelectionsAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <input type="hidden" name="locationId" value={loc.id} />
            <ConfirmButton className="btn ghost" message={
              'Clear every selection on this night?\n\nEvery cast tick and every ' +
              'staff tick is removed, and all hours go back to zero. The roster ' +
              'and the tips collected are kept. This cannot be undone.'
            }>
              Refresh selections
            </ConfirmButton>
          </form>
        </div>

        <form action={saveEventAction} id="event-form">
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
                <label className="f" htmlFor="totalOverride">Total tips</label>
                <input id="totalOverride" className="num" name="totalOverride" type="number" step="0.01"
                       placeholder="sum of the three"
                       defaultValue={event.total_override_cents != null
                         ? (event.total_override_cents / 100).toFixed(2) : ''} />
              </div>
            </div>

            <TipsTotal
              partIds={['gratuity', 'cash', 'square']}
              totalId="totalOverride"
            />

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
                <input id="showName" name="showName" type="text"
                       defaultValue={event.show_name} />
              </div>
              <div>
                <label className="f" htmlFor="eventDate">Show date</label>
                <input id="eventDate" name="eventDate" type="date"
                       defaultValue={event.event_date} />
              </div>
              <div>
                <label className="f" htmlFor="guestAttendance">Guests</label>
                <input id="guestAttendance" className="num" name="guestAttendance"
                       type="number" min="0" placeholder="not recorded"
                       defaultValue={event.guest_attendance ?? ''} />
              </div>
            </div>
            <div className="calcrow">
              <button className="btn big" type="submit">Calculate tips</button>
              <p className="sub" style={{ margin: 0 }}>
                Works out every person&rsquo;s share from the hours and ticks
                below, and saves the night. Nothing is paid out until you
                press this.
              </p>
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

          </div>

          {show.hasCast && <div className="panel">
            <h2>Cast &amp; Musicians &mdash; paid per head</h2>
            <p className="sub">
              Hours are irrelevant here. Tick who worked &mdash; {r.castWorkedRatioTotal}{' '}
              of {r.cast.length} so far, {money(r.castPoolCents)} between them.
            </p>

            <div className="castgrid">
              {r.cast.map((c) => (
                <label className="castchip" key={c.id}>
                  <input type="checkbox" name={`cast_worked_${c.id}`}
                         defaultChecked={c.worked}
                         aria-label={`${c.name} worked`} />
                  <span className="nm">{c.name}</span>
                  {c.technical && <span className="tech">tech</span>}
                  <span className="amt">
                    {c.amountCents ? money(c.amountCents) : '\u2013'}
                  </span>
                </label>
              ))}
            </div>

            <details className="shares">
              <summary>Adjust individual shares</summary>
              <p className="sub" style={{ marginTop: 10 }}>
                A share of 1 is a full cut. Halve it to pay someone half, or set
                0 to leave them out of the division entirely.
              </p>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th><th className="num">Share</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.cast.map((c) => (
                      <tr key={c.id} className={c.worked ? undefined : 'off'}>
                        <td>{c.name}</td>
                        <td className="num" style={{ width: 110 }}>
                          <input className="num hrs" name={`cast_ratio_${c.id}`}
                                 type="number" step="0.1" min="0"
                                 defaultValue={c.ratio}
                                 aria-label={`${c.name} share`} />
                        </td>
                        <td className="num">{money(c.amountCents)}</td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Cast &amp; Musicians total</td>
                      <td className="num">{r.castWorkedRatioTotal}</td>
                      <td className="num">{money(r.castPoolCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
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
                                     placeholder={!src.included && src.hours > 0 ? 'reason required' : ''}
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
            <div className="row-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">Save changes</button>
              <span className="muted" style={{ fontSize: 13 }}>
                Bar &amp; Service combined: {r.barServiceHours.toFixed(2)} h ·{' '}
                {money(r.barServiceCents)}
              </span>
            </div>

            <h3>Add someone not on the roster</h3>
            <div className="grid g4">
              <div>
                <label className="f" htmlFor="newName">Name</label>
                <input id="newName" name="name" type="text" form="add-staff" required />
              </div>
              <div>
                <label className="f" htmlFor="newSection">Section</label>
                <select id="newSection" name="section" form="add-staff">
                  {show.sections.map((sec) => (
                    <option key={sec} value={sec}>{SECTION_LABEL[sec]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="f" htmlFor="newHours">Hours</label>
                <input id="newHours" className="num" name="hours" type="number"
                       step="0.01" min="0" defaultValue="0" form="add-staff" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn ghost" type="submit" form="add-staff">Add</button>
              </div>
            </div>
          </div>
        </form>

        <form action={addStaffAction} id="add-staff">
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="locationId" value={loc.id} />
        </form>

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

        <SaveBar formId="event-form" />
      </div>
    </>
  );
}
