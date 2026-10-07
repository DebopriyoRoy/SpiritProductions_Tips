import {
  q, one, tx, uid, ensureSchema, isoDate,
  EventRow, CastRow, StaffRowDb, eventForLocation,
  ScreechSessionRow, ScreechHostRow, LateTipRow,
} from './db';
import {
  calculate, EventInput, Result, Section, CastEntry, StaffEntry, LateTipMode,
} from './tips';
import {
  getLocation, getShowTypeForLocation, CAST, showTypesFor, SECTIONS,
  withAdminFee,
} from './config';
import { ExportMeta, sheetNameFor } from './xlsxExport';
import type { PayoutRoster } from './payoutSheet';
import { getProvider } from './square';
import { sectionForWageTitle, isNonTipped, hoursFromTimecard } from './mapping';

export async function createEvent(input: {
  locationId: string; showTypeId: string; eventDate: string; showName: string;
  guestAttendance: number | null;
}): Promise<string> {
  const loc = getLocation(input.locationId);
  if (!loc) throw new Error(`Unknown location: ${input.locationId}`);
  if (!loc.showTypeIds.includes(input.showTypeId)) {
    throw new Error(`${loc.name} does not run "${input.showTypeId}" shows`);
  }
  // Narrowed by the venue: ACC runs a Public Show without the 50/50, the
  // office or a cast, so none of those get seeded there.
  const show = getShowTypeForLocation(input.showTypeId, input.locationId);
  const id = uid();
  await ensureSchema();

  await tx(async (c) => {
    await c.q(
      `INSERT INTO event (id, location_id, show_type, show_type_id, event_date,
         show_name, guest_attendance, cast_share_percent, office_hours, odd_cent_to,
         admin_fee_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.locationId, show.label, show.id, input.eventDate, input.showName,
       input.guestAttendance, show.rules.castSharePercent, show.rules.officeHours,
       show.rules.oddCentTo, show.rules.adminFeePercent ?? 0],
    );

    // Private shows have no cast block at all.
    if (show.hasCast) {
      for (const [i, raw] of CAST.entries()) {
        const [name, tech] = raw.split('|');
        await c.q(
          `INSERT INTO cast_row (id,event_id,name,ratio,worked,technical,sort)
           VALUES ($1,$2,$3,1,false,$4,$5)`,
          [uid(), id, name, !!tech, i],
        );
      }
    }

    // Seed the whole roster at 0.00 hours, as the workbook lists it. Office
    // included: the app must not invent who worked.
    for (const section of show.sections) {
      const names = show.roster[section] ?? [];
      for (const [i, name] of names.entries()) {
        await c.q(
          `INSERT INTO staff_row (id,event_id,name,section,hours,included,sort)
           VALUES ($1,$2,$3,$4,0,true,$5)`,
          [uid(), id, name, section, i],
        );
      }
    }
  });

  return id;
}

/**
 * Seeds the cast onto a show whose type has a cast but which carries none.
 *
 * Cast rows are written once, when the show is created, and only if the type
 * had a cast at that moment. A type that gains one later — as the Gower
 * private show did — would otherwise leave every show created before the
 * change with an empty cast panel, and no amount of pressing Calculate would
 * fill it. Doing it on load keeps the app consistent with its own config
 * without an out-of-band migration step.
 *
 * ON CONFLICT is what makes this safe to run from a read path: two
 * simultaneous loads cannot seed the same night twice.
 */
async function ensureCastRows(
  eventId: string, showTypeId: string, locationId: string,
): Promise<boolean> {
  const show = getShowTypeForLocation(showTypeId, locationId);
  if (!show.hasCast) return false;

  await tx(async (c) => {
    for (const [i, raw] of CAST.entries()) {
      const [name, tech] = raw.split('|');
      await c.q(
        `INSERT INTO cast_row (id,event_id,name,ratio,worked,technical,sort)
         VALUES ($1,$2,$3,1,false,$4,$5)
         ON CONFLICT (event_id, name) DO NOTHING`,
        [uid(), eventId, name, !!tech, i],
      );
    }
  });
  return true;
}

/** The show type a venue records its screech-in nights under. */
export const SCREECH_TYPE_ID = 'screech-in';

/**
 * Whether this venue keeps screech-ins as nights of their own, listed beside
 * the shows, rather than on each show's page.
 */
export function screechSeparate(locationId: string): boolean {
  return !!getLocation(locationId)?.showTypeIds.includes(SCREECH_TYPE_ID);
}

/**
 * The show a date's screech-ins are merged into: the first show entered for
 * that date. Only one, so a screech-in is never paid on two sheets.
 */
export async function showForDate(
  locationId: string, eventDate: string,
): Promise<EventRow | undefined> {
  const row = await one<EventRow>(
    `SELECT * FROM event WHERE location_id = $1 AND event_date = $2
        AND show_type_id <> $3
      ORDER BY created_at, id LIMIT 1`,
    [locationId, eventDate, SCREECH_TYPE_ID]);
  return row ? { ...row, event_date: isoDate(row.event_date) } : undefined;
}

/**
 * The screech-in night for a date, created if there is none yet. A night
 * holds every screech-in of that date as its sessions.
 */
export async function screechNightFor(
  locationId: string, eventDate: string,
): Promise<{ id: string; created: boolean }> {
  const find = () => one<{ id: string }>(
    `SELECT id FROM event WHERE location_id = $1 AND event_date = $2
        AND show_type_id = $3 ORDER BY created_at, id LIMIT 1`,
    [locationId, eventDate, SCREECH_TYPE_ID]);
  await ensureSchema();
  const found = await find();
  if (found) return { id: found.id, created: false };
  try {
    const id = await createEvent({
      locationId, showTypeId: SCREECH_TYPE_ID, eventDate,
      showName: 'Screech-In', guestAttendance: null,
    });
    return { id, created: true };
  } catch (err) {
    // Two people adding the same date at once: the other insert won.
    const again = await find();
    if (again) return { id: again.id, created: false };
    throw err;
  }
}

const adopted = new Set<string>();

/**
 * Screech-ins entered on a show's own page, before they had a list of their
 * own, are moved onto that date's screech-in night. Nothing about them
 * changes, and the show still gets them back through the merge.
 */
export async function adoptStrayScreech(locationId: string): Promise<void> {
  if (adopted.has(locationId) || !screechSeparate(locationId)) return;
  await ensureSchema();
  const strays = await q<{ id: string; event_date: string }>(
    `SELECT DISTINCT e.id, e.event_date FROM screech_session s
       JOIN event e ON e.id = s.event_id
      WHERE e.location_id = $1 AND e.show_type_id <> $2`,
    [locationId, SCREECH_TYPE_ID]);
  for (const e of strays) {
    const night = await screechNightFor(locationId, isoDate(e.event_date));
    await q(
      `UPDATE screech_session
          SET event_id = $1,
              sort = sort + (SELECT COUNT(*) FROM screech_session WHERE event_id = $1)
        WHERE event_id = $2`,
      [night.id, e.id]);
  }
  adopted.add(locationId);
}

async function screechFor(eventIds: string[]) {
  if (!eventIds.length) return { sessions: [], hosts: [] };
  const sessions = await q<ScreechSessionRow>(
    `SELECT s.* FROM screech_session s JOIN event e ON e.id = s.event_id
      WHERE s.event_id = ANY($1) ORDER BY e.created_at, s.sort, s.id`, [eventIds]);
  const hosts = await q<ScreechHostRow>(
    `SELECT h.* FROM screech_host h JOIN screech_session s ON s.id = h.session_id
      WHERE s.event_id = ANY($1) ORDER BY h.sort, h.id`, [eventIds]);
  return { sessions, hosts };
}

export async function loadEvent(eventId: string, locationId: string) {
  await adoptStrayScreech(locationId);
  const event = await eventForLocation(eventId, locationId);
  if (!event) return null;
  let cast = await q<CastRow>(
    'SELECT * FROM cast_row WHERE event_id = $1 ORDER BY sort', [eventId]);
  if (!cast.length
      && await ensureCastRows(eventId, event.show_type_id, locationId)) {
    cast = await q<CastRow>(
      'SELECT * FROM cast_row WHERE event_id = $1 ORDER BY sort', [eventId]);
  }
  const staff = await q<StaffRowDb>(
    'SELECT * FROM staff_row WHERE event_id = $1 ORDER BY section, sort', [eventId]);

  // Where screech-ins are nights of their own, a show carries the screech-ins
  // of its date (if it is the show they merge into), and a screech-in night
  // knows which show it merges into.
  let screechEventIds = [eventId];
  let mergedInto: EventRow | undefined;
  let mergedFrom: string[] = [];
  if (screechSeparate(locationId)) {
    const target = await showForDate(locationId, event.event_date);
    if (event.show_type_id === SCREECH_TYPE_ID) {
      mergedInto = target;
    } else {
      mergedFrom = target?.id === eventId
        ? (await q<{ id: string }>(
            `SELECT id FROM event WHERE location_id = $1 AND event_date = $2
                AND show_type_id = $3 ORDER BY created_at, id`,
            [locationId, event.event_date, SCREECH_TYPE_ID])).map((r) => r.id)
        : [];
      screechEventIds = mergedFrom;
    }
  }
  const { sessions, hosts } = await screechFor(screechEventIds);
  const lateTips = await q<LateTipRow>(
    'SELECT * FROM late_tip WHERE event_id = $1 ORDER BY sort, id', [eventId]);
  return {
    event, cast, staff, extras: { sessions, hosts, lateTips },
    /** Screech-in night only: the show whose Excel it is merged into. */
    mergedInto,
    /** Show only: the screech-in nights merged into it. */
    mergedFrom,
  };
}

export interface EventExtras {
  sessions: ScreechSessionRow[];
  hosts: ScreechHostRow[];
  lateTips: LateTipRow[];
}

/**
 * Narrowed by the venue, not just the show type.
 *
 * The engine pays whatever rows it is handed, so a section the venue does not
 * run has to be filtered out here — hiding it in the page alone would leave
 * it silently taking a share. The stored cast share and office hours are
 * overridden for the same reason: a show created before the venue was
 * narrowed still carries the wider numbers on its row.
 */
export function toEngineInput(
  event: EventRow, cast: CastRow[], staff: StaffRowDb[], extras?: EventExtras,
): EventInput {
  const show = getShowTypeForLocation(event.show_type_id, event.location_id);
  const runs = new Set<Section>(show.sections);

  return {
    screech: (extras?.sessions ?? []).map((s) => ({
      id: s.id, cashCents: s.cash_cents, squareCents: s.square_cents,
      totalOverrideCents: s.total_override_cents,
      guests: s.guests, sageRef: s.sage_ref,
      hosts: extras!.hosts.filter((h) => h.session_id === s.id)
        .map((h) => ({ id: h.id, name: h.name, helper: h.helper })),
    })),
    // A screech-in-only night has no show to re-split a late tip into.
    lateTips: show.screechOnly ? [] : (extras?.lateTips ?? []).map((t) => ({
      id: t.id, amountCents: t.amount_cents,
      mode: (t.mode === 'person' ? 'person' : 'split') as LateTipMode,
      payee: t.payee, description: t.description, sageRef: t.sage_ref,
    })),
    gratuityCents: event.gratuity_cents,
    cashTipsCents: event.cash_cents,
    squareTipsCents: event.square_cents,
    totalOverrideCents: event.total_override_cents,
    cast: show.hasCast
      ? cast.map<CastEntry>((c) => ({
          id: c.id, name: c.name, ratio: c.ratio,
          worked: c.worked, technical: c.technical,
          pinnedCents: c.pinned_cents,
        }))
      : [],
    staff: staff
      .filter((s) => runs.has(s.section as Section))
      .map<StaffEntry>((s) => ({
        id: s.id, name: s.name, section: s.section as Section,
        hours: s.hours, included: s.included, note: s.note,
        pinnedCents: s.pinned_cents,
      })),
    rules: {
      castSharePercent: show.hasCast ? event.cast_share_percent : 0,
      officeHours: runs.has('OFFICE') ? event.office_hours : 0,
      oddCentTo: event.odd_cent_to as 'cast' | 'staff',
      adminFeePercent: event.admin_fee_percent,
    },
  };
}

export async function computeEvent(
  eventId: string, locationId: string,
): Promise<Result | null> {
  const loaded = await loadEvent(eventId, locationId);
  if (!loaded) return null;
  return calculate(
    toEngineInput(loaded.event, loaded.cast, loaded.staff, loaded.extras));
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

/** How a loaded night is described on its sheet. */
export function exportMetaFor(loaded: Loaded, locationId: string): ExportMeta {
  const loc = getLocation(locationId)!;
  const e = loaded.event;
  const show = getShowTypeForLocation(e.show_type_id, e.location_id);
  return {
    locationName: loc.name,
    showType: e.show_type,
    showName: e.show_name,
    eventDate: e.event_date,
    guestAttendance: e.guest_attendance,
    contractService: e.contract_service,
    hasCast: show.hasCast,
    sections: show.sections,
    formula: withAdminFee(show.formula, e.admin_fee_percent),
    screechOnly: show.screechOnly,
    sageRef: e.sage_ref,
    sheetName: sheetNameFor(locationId, e.event_date),
  };
}

/**
 * Every night between two dates, ready for the workbook: one entry per sheet.
 * A screech-in merged into a show is part of that show's sheet, and a night
 * with nothing paid out is left out. Two shows on one date get "(2)".
 */
export async function nightsBetween(locationId: string, from: string, to: string) {
  await adoptStrayScreech(locationId);
  await ensureSchema();
  const events = await q<{ id: string }>(
    `SELECT id FROM event WHERE location_id = $1 AND event_date BETWEEN $2 AND $3
      ORDER BY event_date, created_at, id`, [locationId, from, to]);
  const nights: { result: Result; meta: ExportMeta }[] = [];
  const used = new Map<string, number>();
  for (const { id } of events) {
    const loaded = await loadEvent(id, locationId);
    if (!loaded || loaded.mergedInto) continue;
    const result = calculate(
      toEngineInput(loaded.event, loaded.cast, loaded.staff, loaded.extras));
    if (!result.grandTotalCents) continue;
    const meta = exportMetaFor(loaded, locationId);
    const n = (used.get(meta.sheetName!) ?? 0) + 1;
    used.set(meta.sheetName!, n);
    if (n > 1) meta.sheetName = `${meta.sheetName} (${n})`;
    nights.push({ result, meta });
  }
  return nights;
}

/** Everyone a venue's rosters list, block by block, for its payout sheet. */
export function payoutRosterFor(locationId: string): PayoutRoster {
  const loc = getLocation(locationId)!;
  const types = showTypesFor(loc).map((t) => getShowTypeForLocation(t.id, loc.id));
  const hasCast = types.some((t) => t.hasCast);
  return {
    cast: hasCast
      ? CAST.map((raw) => {
          const [name, tech] = raw.split('|');
          return { name, technical: !!tech };
        })
      : [],
    sections: SECTIONS
      .filter((section) => types.some((t) => t.sections.includes(section)))
      .map((section) => {
        const names: string[] = [];
        for (const t of types) {
          for (const n of t.roster[section] ?? []) if (!names.includes(n)) names.push(n);
        }
        return { section, names };
      }),
  };
}

/**
 * Pull timecards from Square for this event's date and location, and upsert
 * them as staff rows. Rows a human has edited keep their values.
 */
export async function syncFromSquare(eventId: string, locationId: string) {
  const loaded = await loadEvent(eventId, locationId);
  if (!loaded) throw new Error('Event not found for this location');
  const loc = getLocation(locationId)!;
  const show = getShowTypeForLocation(loaded.event.show_type_id, locationId);
  const provider = getProvider();
  const squareLocation = loc.squareLocationId || `demo-${locationId}`;

  const result = await provider.sync(
    squareLocation, isoDate(loaded.event.event_date), loc.timezone);
  const warnings = [...result.warnings];
  let added = 0, updated = 0, skipped = 0, nonTipped = 0;

  await tx(async (c) => {
    for (const tc of result.timecards) {
      if (isNonTipped(tc.wageTitle)) { nonTipped++; continue; }
      const hours = hoursFromTimecard(tc.startAt, tc.endAt, tc.breakMinutes);
      let { section, matched } = sectionForWageTitle(tc.wageTitle);

      // This show type may not run that section (ACC private has no 50/50 or
      // office), so fold those hours into Service rather than dropping them.
      if (!show.sections.includes(section)) {
        warnings.push(
          `${tc.name}: "${tc.wageTitle}" maps to ${section}, which ` +
          `${show.label} does not use — filed under Servers.`);
        section = 'SERVICE';
        matched = true;
      }
      if (!matched && tc.wageTitle) {
        warnings.push(
          `Unrecognised job title "${tc.wageTitle}" for ${tc.name} — filed under Servers.`);
      }

      const existing = (await c.q<StaffRowDb>(
        'SELECT * FROM staff_row WHERE event_id = $1 AND square_timecard_id = $2',
        [eventId, tc.id]))[0];

      if (!existing) {
        await c.q(
          `INSERT INTO staff_row
             (id,event_id,name,section,hours,included,note,square_timecard_id,source,sort)
           VALUES ($1,$2,$3,$4,$5,true,'',$6,'square',$7)`,
          [uid(), eventId, tc.name, section, hours, tc.id, 100 + added],
        );
        added++;
      } else if (existing.overridden) {
        skipped++;
        if (Math.abs(existing.hours - hours) > 0.001) {
          warnings.push(
            `${tc.name}: kept the edited ${existing.hours.toFixed(2)}h; ` +
            `Square now reports ${hours.toFixed(2)}h.`);
        }
      } else {
        await c.q('UPDATE staff_row SET name=$1, section=$2, hours=$3 WHERE id=$4',
          [tc.name, section, hours, existing.id]);
        updated++;
      }
    }

    await c.q(
      'INSERT INTO sync_run (id,event_id,location_id,status,detail) VALUES ($1,$2,$3,$4,$5)',
      [uid(), eventId, locationId, 'success',
       JSON.stringify({ added, updated, skipped, nonTipped })],
    );
  });

  return {
    provider: result.provider, added, updated, skipped, nonTipped,
    openTimecards: result.openTimecards,
    unattributedTipCents: result.unattributedTipCents,
    warnings,
  };
}

export { one, q };
