import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getLocation, LOCATIONS, SECTIONS, getShowTypeForLocation, CAST, everyone,
  withAdminFee,
} from '@/lib/config';
import { loadEvent, toEngineInput, screechSeparate } from '@/lib/service';
import { calculate, SECTION_LABEL, Section } from '@/lib/tips';
import { fmt } from '@/lib/money';
import { AddPerson } from './AddPerson';
import { nameKey } from '@/lib/timecardImport';
import { LocationBar } from '@/app/LocationBar';
import { SaveBar } from '@/app/SaveBar';
import { requireUser, canSeeLocation, NotAuthenticated } from '@/lib/auth';
import {
  saveEventAction, addStaffAction, deleteStaffAction, deleteCastAction,
  clearSelectionsAction, importTimecardAction,
  addScreechSessionAction, deleteScreechSessionAction, deleteScreechHostAction,
  addLateTipAction, deleteLateTipAction,
} from '@/app/actions';
import { TipsTotal } from '@/app/TipsTotal';
import { ConfirmButton } from '@/app/ConfirmButton';
import { HOURS_CAP } from '@/lib/timecardImport';

export const dynamic = 'force-dynamic';

/**
 * The payout cell: editable, and honest about having been edited.
 *
 * Typing a figure pins it; the rest of the pool is then shared among everyone
 * who is not pinned, so the night still reconciles. Clearing the box hands
 * the row back to the pool, which is the only way to undo a pin — hence the
 * amount showing as a placeholder rather than a value, so an untouched row
 * stays untouched and does not pin itself the moment the sheet is saved.
 *
 * The placeholder is what this row is being paid NOW, rebalancing included,
 * not what it would have been paid had nobody been pinned. Showing the
 * latter would quietly misreport everyone else's pay the moment one amount
 * was hand-set. The pin-free figure appears only on a pinned row, as the
 * "was" note, where it is the useful comparison.
 */
/** True for the seeded company, false for anyone added by hand. */
const onCastRoster = (name: string) =>
  CAST.some((c) => nameKey(c.split('|')[0]) === nameKey(name));

function AmountCell({
  name, row, label,
}: {
  name: string;
  row: { amountCents: number; calculatedCents: number; pinned: boolean };
  label: string;
}) {
  return (
    <>
      <input
        className="num amt-edit"
        name={name}
        type="number"
        step="0.01"
        min="0"
        defaultValue={row.pinned ? (row.amountCents / 100).toFixed(2) : ''}
        placeholder={fmt(row.amountCents)}
        aria-label={`${label} amount`}
      />
      {row.pinned && (
        <span className="wasamt" title="Hand-set. The pool would have paid this.">
          was {fmt(row.calculatedCents)}
        </span>
      )}
    </>
  );
}

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
  const { event, cast, staff, extras, mergedInto, mergedFrom } = loaded;
  // Narrowed by venue: ACC runs no 50/50, no office and no cast, even on a
  // show type that does elsewhere.
  const show = getShowTypeForLocation(event.show_type_id, loc.id);
  const r = calculate(toEngineInput(event, cast, staff, extras));
  const screechOnly = !!show.screechOnly;
  // Where screech-ins are kept as nights of their own, a show's page does not
  // edit them: it only says which are merged into its Excel.
  const editScreech = screechOnly || !screechSeparate(loc.id);
  const exportHref = mergedInto
    ? `/api/events/${mergedInto.id}/export?location=${loc.id}`
    : `/api/events/${event.id}/export?location=${loc.id}`;
  // Only people whose night is more than their show pay get a "Total for" line.
  const extraTotals = r.personTotals.filter((p) => p.screechCents || p.lateCents);

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

        {mergedInto && (
          <div className="note">
            A show ran on this date, so these screech-ins are merged into the
            Excel for{' '}
            <Link href={`/events/${mergedInto.id}?location=${loc.id}`}>
              {mergedInto.show_name || 'Untitled show'}
            </Link>.
          </div>
        )}
        {!screechOnly && mergedFrom.length > 0 && (
          <div className="note">
            The screech-in on this date ({money(r.screechTotalCents)}) is merged
            into this show&rsquo;s Excel and the totals below.{' '}
            <Link href={`/events/${mergedFrom[0]}?location=${loc.id}`}>
              Edit the screech-in
            </Link>
          </div>
        )}

        {screechOnly ? (
        <div className="figures stick">
          <div className="fig">
            <div className="k">Screech-In tips</div>
            <div className="v">{money(r.screechTotalCents)}</div>
            <div className="s">
              {r.screech.length} screech-in{r.screech.length === 1 ? '' : 's'}
            </div>
          </div>
          {r.screechAdminFeeCents > 0 && (
            <div className="fig">
              <div className="k">Admin fee ({r.adminFeePercent}%)</div>
              <div className="v">{money(r.screechAdminFeeCents)}</div>
              <div className="s">
                {money(r.screechTotalCents - r.screechAdminFeeCents)} paid to hosts
              </div>
            </div>
          )}
        </div>
        ) : (
        <div className="figures stick">
          <div className="fig">
            <div className="k">Total tips</div>
            <div className="v">{money(r.totalCents)}</div>
            <div className="s">
              {show.label}
              {r.lateSplitCents > 0 && ` · incl. ${money(r.lateSplitCents)} late`}
            </div>
          </div>
          {r.adminFeeCents > 0 && (
            <div className="fig">
              <div className="k">Admin fee ({r.adminFeePercent}%)</div>
              <div className="v">{money(r.adminFeeCents)}</div>
              <div className="s">{money(r.distributedCents)} left to split</div>
            </div>
          )}
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
            <div className="s">
              cast + staff{r.adminFeeCents > 0 && ' + fee'} &minus; total
            </div>
          </div>
          {(r.screechTotalCents > 0 || r.latePersonalCents > 0) && (
            <div className="fig">
              <div className="k">Paid out tonight</div>
              <div className="v">{money(r.grandTotalCents)}</div>
              <div className="s">
                show
                {r.screechTotalCents > 0 &&
                  ` + ${money(r.screechTotalCents - r.screechAdminFeeCents)} screech-in`}
                {r.latePersonalCents > 0 && ` + ${money(r.latePersonalCents)} late`}
              </div>
            </div>
          )}
        </div>
        )}

        <div className="formula">
          <b>How this show type pays</b>
          {withAdminFee(show.formula, r.adminFeePercent)}
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
            {r.roundingDriftCents > 0 ? 'more' : 'less'} than the {money(r.distributedCents)}{' '}
            {r.adminFeeCents > 0 ? 'left after the admin fee' : 'collected'}. The amounts below are exact and sum to the pool.
          </div>
        )}

        {!screechOnly && <div className="panel toolbar">
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
        </div>}

        <form action={saveEventAction} id="event-form">
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="locationId" value={loc.id} />

          <div className="panel">
            <h2>{screechOnly ? 'Night' : 'Tips collected'}</h2>
            {!screechOnly && <>
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
            </>}
            {screechOnly && <>
              <input type="hidden" name="castSharePercent" value={event.cast_share_percent} />
              <input type="hidden" name="officeHours" value={event.office_hours} />
              <input type="hidden" name="oddCentTo" value={event.odd_cent_to} />
            </>}
            <div className="grid g4">
              {!screechOnly && <>
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
              </>}
              <div>
                <label className="f" htmlFor="adminFeePercent">Admin fee %</label>
                <input id="adminFeePercent" className="num" name="adminFeePercent"
                       type="number" step="0.1" min="0" max="100"
                       defaultValue={event.admin_fee_percent} />
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

          {show.hasCast && !screechOnly && <div className="panel">
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
                      <th className="num">Amount</th><th></th>
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
                        <td className="num" style={{ width: 150 }}>
                          <AmountCell name={`cast_amount_${c.id}`} row={c}
                                      label={c.name} />
                        </td>
                        <td className="num">
                          {/* Only people added by hand can be removed: the
                              seeded roster is the record of the company, and
                              is excluded by unticking, never deleted. */}
                          {!onCastRoster(c.name) && (
                            <button className="btn ghost small" type="submit"
                                    formAction={deleteCastAction.bind(null, c.id)}
                                    aria-label={`Remove ${c.name}`}>Remove</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td>Cast &amp; Musicians total</td>
                      <td className="num">{r.castWorkedRatioTotal}</td>
                      <td className="num">{money(r.castPoolCents)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>}

          {!screechOnly && <div className="panel">
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
                  {section === 'OFFICE' && (
                    <p className="sub" style={{ margin: '0 0 8px' }}>
                      A fixed {event.office_hours.toFixed(2)} hours for the whole
                      section, split equally between whoever worked
                      {t.hours > 0 && rows.filter((x) => x.hours > 0).length > 0 &&
                        ` — ${(t.hours / rows.filter((x) => x.hours > 0).length).toFixed(2)} each`}.
                      Clocked hours are recorded here but do not change the share:
                      overtime included, the office is always
                      {' '}{event.office_hours.toFixed(2)} hours.
                    </p>
                  )}
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
                              {/* The row's own hours, not the payout's. For the
                                  office those differ — the payout is the fixed
                                  block's equal share — and rendering the payout
                                  would save it back over what was clocked. */}
                              <input className="num" name={`staff_hours_${s.id}`} type="number"
                                     step="0.01" min="0" defaultValue={src.hours}
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
                            <td className="num" style={{ width: 150 }}>
                              <AmountCell name={`staff_amount_${s.id}`} row={s}
                                          label={s.name} />
                            </td>
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
            <AddPerson
              formId="add-staff"
              hasCast={show.hasCast}
              sections={show.sections.map((sec) => ({
                value: sec, label: SECTION_LABEL[sec],
              }))}
            />
          </div>}

          {!screechOnly && (
            <div className="panel">
              <h2>Late tips</h2>
              <p className="sub">
                Tips for this show that came in after the night was split, such
                as a customer paying on account. For each one, choose whether it
                is re-split with the show or paid to one person.
              </p>
              {extras.lateTips.length > 0 && (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="num">Amount</th><th>Goes to</th>
                        <th>Paid to</th><th>Description</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {extras.lateTips.map((t) => (
                        <tr key={t.id}>
                          <td className="num" style={{ width: 120 }}>
                            <input className="num" name={`late_amount_${t.id}`}
                                   type="number" step="0.01" min="0"
                                   defaultValue={(t.amount_cents / 100).toFixed(2)}
                                   aria-label="Late tip amount" />
                          </td>
                          <td style={{ width: 210 }}>
                            {/* Keyed on the saved value: a select only reads
                                defaultValue when it mounts, so without this the
                                form reset after a save shows the old choice, and
                                the next save writes it back. */}
                            <select key={`${t.id}-${t.mode}`} name={`late_mode_${t.id}`}
                                    defaultValue={t.mode}
                                    aria-label="Where the late tip goes">
                              <option value="split">Re-split with the show</option>
                              <option value="person">One person</option>
                            </select>
                          </td>
                          <td style={{ minWidth: 160 }}>
                            <input name={`late_payee_${t.id}`} type="text"
                                   list="everyone" defaultValue={t.payee}
                                   placeholder={t.mode === 'person' ? 'who gets it' : 'only for one person'}
                                   aria-label="Late tip paid to" />
                          </td>
                          <td style={{ minWidth: 200 }}>
                            <input name={`late_desc_${t.id}`} type="text"
                                   defaultValue={t.description}
                                   placeholder="e.g. payment from Lori Pynn"
                                   aria-label="Late tip description" />
                          </td>
                          <td className="num">
                            <button className="btn ghost small" type="submit"
                                    formAction={deleteLateTipAction.bind(null, t.id)}
                                    aria-label="Remove late tip">Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row-actions" style={{ marginTop: 12 }}>
                <button className="btn ghost" type="submit" formAction={addLateTipAction}>
                  Add a late tip
                </button>
                {r.lateSplitCents > 0 && (
                  <span className="muted" style={{ fontSize: 13 }}>
                    {money(r.lateSplitCents)} re-split with the show, included in
                    the total above.
                  </span>
                )}
              </div>
            </div>
          )}

          {editScreech && <div className="panel">
            <h2>Screech-In</h2>
            <p className="sub">
              Each screech-in is its own pool, split equally between the host
              and any helpers. It is not part of the show&rsquo;s tips. A night
              can have more than one.
            </p>
            {r.screech.map((s, n) => {
              const row = extras.sessions.find((x) => x.id === s.id)!;
              return (
                <div key={s.id} className="tablewrap" style={{ marginBottom: 18 }}>
                  <h3>Screech-In {n + 1}</h3>
                  <div className="grid g4">
                    <div>
                      <label className="f" htmlFor={`scr_cash_${s.id}`}>Cash tips</label>
                      <input id={`scr_cash_${s.id}`} className="num" name={`scr_cash_${s.id}`}
                             type="number" step="0.01" min="0"
                             defaultValue={(row.cash_cents / 100).toFixed(2)} />
                    </div>
                    <div>
                      <label className="f" htmlFor={`scr_square_${s.id}`}>Square tips</label>
                      <input id={`scr_square_${s.id}`} className="num" name={`scr_square_${s.id}`}
                             type="number" step="0.01" min="0"
                             defaultValue={(row.square_cents / 100).toFixed(2)} />
                    </div>
                    <div>
                      <label className="f" htmlFor={`scr_guests_${s.id}`}>Guests</label>
                      <input id={`scr_guests_${s.id}`} className="num" name={`scr_guests_${s.id}`}
                             type="number" min="0" placeholder="not recorded"
                             defaultValue={row.guests ?? ''} />
                    </div>
                    <div>
                      <label className="f" htmlFor={`scr_total_${s.id}`}>
                        Total tips (cash + Square)
                      </label>
                      {/* Kept in step with cash + Square as they are typed,
                          but can be typed over when only the total is known. */}
                      <input id={`scr_total_${s.id}`} className="num" name={`scr_total_${s.id}`}
                             type="number" step="0.01" min="0"
                             placeholder="sum of the two"
                             defaultValue={(s.tipsCents / 100).toFixed(2)} />
                    </div>
                  </div>
                  <TipsTotal partIds={[`scr_cash_${s.id}`, `scr_square_${s.id}`]}
                             totalId={`scr_total_${s.id}`} />
                  <table style={{ marginTop: 10 }}>
                    <thead>
                      <tr>
                        <th>Host</th><th className="num">Helper</th>
                        <th className="num">Amount</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.hosts.map((h) => (
                        <tr key={h.id}>
                          <td>
                            <input name={`scrh_name_${h.id}`} type="text" list="everyone"
                                   defaultValue={h.name} aria-label="Host name" />
                          </td>
                          <td className="num" style={{ width: 80 }}>
                            <input type="checkbox" name={`scrh_helper_${h.id}`}
                                   defaultChecked={h.helper}
                                   aria-label={`${h.name} is a helper`} />
                          </td>
                          <td className="num" style={{ width: 120 }}>{money(h.amountCents)}</td>
                          <td className="num">
                            <button className="btn ghost small" type="submit"
                                    formAction={deleteScreechHostAction.bind(null, h.id)}
                                    aria-label={`Remove ${h.name}`}>Remove</button>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <input name={`scr_newhost_${s.id}`} type="text" list="everyone"
                                 placeholder="Add a host or helper"
                                 aria-label="New host name" />
                        </td>
                        <td className="num">
                          <input type="checkbox" name={`scr_newhelper_${s.id}`}
                                 aria-label="New host is a helper" />
                        </td>
                        <td></td>
                        <td className="num">
                          <button className="btn ghost small" type="submit">Add</button>
                        </td>
                      </tr>
                      {s.adminFeeCents > 0 && (
                        <tr>
                          <td>Admin fee ({r.adminFeePercent}%)</td><td></td>
                          <td className="num">&minus;{money(s.adminFeeCents)}</td><td></td>
                        </tr>
                      )}
                      <tr className="total">
                        <td>Tips collected</td><td></td>
                        <td className="num">{money(s.tipsCents)}</td>
                        <td className="num">
                          <button className="btn ghost small" type="submit"
                                  formAction={deleteScreechSessionAction.bind(null, s.id)}
                                  aria-label={`Remove screech-in ${n + 1}`}>
                            Remove screech-in
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
            <div className="row-actions" style={{ marginTop: 12 }}>
              <button className="btn ghost" type="submit" formAction={addScreechSessionAction}>
                Add a screech-in
              </button>
              {screechOnly && <button className="btn" type="submit">Save</button>}
            </div>
          </div>}

          <datalist id="everyone">
            {everyone().map((n) => <option key={n} value={n} />)}
          </datalist>
        </form>

        <form action={addStaffAction} id="add-staff">
          <input type="hidden" name="eventId" value={event.id} />
          <input type="hidden" name="locationId" value={loc.id} />
        </form>

        <div className="panel">
          {!screechOnly && <>
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
                  <td>Total paid</td>
                  {/* Cast are paid per head and carry no hours, so this sums
                      to the staff hours the pool was divided by. */}
                  <td className="num">
                    {r.perPerson.reduce((a, b) => a + b.hours, 0).toFixed(2)}
                  </td>
                  <td></td>
                  <td className="num">
                    {money(r.perPerson.reduce((a, b) => a + b.amountCents, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          </>}
          {extraTotals.length > 0 && (
            <>
              <h2 style={{ marginTop: screechOnly ? 0 : 24 }}>
                {screechOnly ? 'Payout per person' : 'Total for each person'}
              </h2>
              {!screechOnly && (
                <p className="sub">
                  Show pay plus screech-in and late tips, for everyone who had either.
                </p>
              )}
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      {!screechOnly && <th className="num">Show</th>}
                      <th className="num">Screech-In</th>
                      {!screechOnly && <th className="num">Late tip</th>}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extraTotals.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        {!screechOnly && <td className="num">{money(p.showCents)}</td>}
                        <td className="num">{money(p.screechCents)}</td>
                        {!screechOnly && <td className="num">{money(p.lateCents)}</td>}
                        <td className="num">{money(p.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div style={{ marginTop: 14 }}>
            <a className="btn" href={exportHref}>
              {mergedInto
                ? `Download Excel (with ${mergedInto.show_name || 'the show'})`
                : 'Download Excel'}
            </a>
          </div>
        </div>

        <SaveBar formId="event-form" />
      </div>
    </>
  );
}
