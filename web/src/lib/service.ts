import {
  q, one, tx, uid, ensureSchema, isoDate,
  EventRow, CastRow, StaffRowDb, eventForLocation,
} from './db';
import { calculate, EventInput, Result, Section, CastEntry, StaffEntry } from './tips';
import { getLocation, getShowTypeForLocation, CAST } from './config';
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
         show_name, guest_attendance, cast_share_percent, office_hours, odd_cent_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, input.locationId, show.label, show.id, input.eventDate, input.showName,
       input.guestAttendance, show.rules.castSharePercent, show.rules.officeHours,
       show.rules.oddCentTo],
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

export async function loadEvent(eventId: string, locationId: string) {
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
  return { event, cast, staff };
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
  event: EventRow, cast: CastRow[], staff: StaffRowDb[],
): EventInput {
  const show = getShowTypeForLocation(event.show_type_id, event.location_id);
  const runs = new Set<Section>(show.sections);

  return {
    gratuityCents: event.gratuity_cents,
    cashTipsCents: event.cash_cents,
    squareTipsCents: event.square_cents,
    totalOverrideCents: event.total_override_cents,
    cast: show.hasCast
      ? cast.map<CastEntry>((c) => ({
          id: c.id, name: c.name, ratio: c.ratio,
          worked: c.worked, technical: c.technical,
        }))
      : [],
    staff: staff
      .filter((s) => runs.has(s.section as Section))
      .map<StaffEntry>((s) => ({
        id: s.id, name: s.name, section: s.section as Section,
        hours: s.hours, included: s.included, note: s.note,
      })),
    rules: {
      castSharePercent: show.hasCast ? event.cast_share_percent : 0,
      officeHours: runs.has('OFFICE') ? event.office_hours : 0,
      oddCentTo: event.odd_cent_to as 'cast' | 'staff',
    },
  };
}

export async function computeEvent(
  eventId: string, locationId: string,
): Promise<Result | null> {
  const loaded = await loadEvent(eventId, locationId);
  if (!loaded) return null;
  return calculate(toEngineInput(loaded.event, loaded.cast, loaded.staff));
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
