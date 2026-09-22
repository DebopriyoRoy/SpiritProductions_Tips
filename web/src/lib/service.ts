import { db, uid, EventRow, CastRow, StaffRowDb, eventForLocation } from './db';
import { calculate, EventInput, Result, Section, CastEntry, StaffEntry } from './tips';
import { getLocation, getShowType, CAST } from './config';
import { getProvider } from './square';
import { sectionForWageTitle, isNonTipped, hoursFromTimecard } from './mapping';

export function createEvent(input: {
  locationId: string; showTypeId: string; eventDate: string; showName: string;
  guestAttendance: number | null;
}): string {
  const loc = getLocation(input.locationId);
  if (!loc) throw new Error(`Unknown location: ${input.locationId}`);
  if (!loc.showTypeIds.includes(input.showTypeId)) {
    throw new Error(
      `${loc.name} does not run "${input.showTypeId}" shows`);
  }
  const show = getShowType(input.showTypeId);
  const id = uid();

  db.transaction(() => {
    db.prepare(`
      INSERT INTO event (id, location_id, show_type, show_type_id, event_date,
        show_name, guest_attendance, cast_share_percent, office_hours, odd_cent_to)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.locationId, show.label, show.id, input.eventDate, input.showName,
      input.guestAttendance, show.rules.castSharePercent, show.rules.officeHours,
      show.rules.oddCentTo,
    );

    // Private shows have no cast block at all.
    if (show.hasCast) {
      const ins = db.prepare(
        'INSERT INTO cast_row (id,event_id,name,ratio,worked,technical,sort) VALUES (?,?,?,?,?,?,?)');
      CAST.forEach((raw, i) => {
        const [name, tech] = raw.split('|');
        ins.run(uid(), id, name, 1, 0, tech ? 1 : 0, i);
      });
    }

    // Seed the whole roster at 0.00 hours, as the workbook lists it.
    const sins = db.prepare(
      'INSERT INTO staff_row (id,event_id,name,section,hours,included,sort) VALUES (?,?,?,?,?,1,?)');
    for (const section of show.sections) {
      const names = show.roster[section] ?? [];
      // Everyone starts at 0.00 hours, Office included: the app must not
      // invent who worked. The engine warns while the Office total does not
      // match the show type's fixed office hours.
      names.forEach((name, i) => sins.run(uid(), id, name, section, 0, i));
    }
  })();

  return id;
}

export function loadEvent(eventId: string, locationId: string) {
  const event = eventForLocation(eventId, locationId);
  if (!event) return null;
  const cast = db.prepare('SELECT * FROM cast_row WHERE event_id = ? ORDER BY sort')
    .all(eventId) as CastRow[];
  const staff = db.prepare('SELECT * FROM staff_row WHERE event_id = ? ORDER BY section, sort')
    .all(eventId) as StaffRowDb[];
  return { event, cast, staff };
}

export function toEngineInput(
  event: EventRow, cast: CastRow[], staff: StaffRowDb[],
): EventInput {
  return {
    gratuityCents: event.gratuity_cents,
    cashTipsCents: event.cash_cents,
    squareTipsCents: event.square_cents,
    totalOverrideCents: event.total_override_cents,
    cast: cast.map<CastEntry>((c) => ({
      id: c.id, name: c.name, ratio: c.ratio,
      worked: !!c.worked, technical: !!c.technical,
    })),
    staff: staff.map<StaffEntry>((s) => ({
      id: s.id, name: s.name, section: s.section as Section,
      hours: s.hours, included: !!s.included, note: s.note,
    })),
    rules: {
      castSharePercent: event.cast_share_percent,
      officeHours: event.office_hours,
      oddCentTo: event.odd_cent_to as 'cast' | 'staff',
    },
  };
}

export function computeEvent(eventId: string, locationId: string): Result | null {
  const loaded = loadEvent(eventId, locationId);
  if (!loaded) return null;
  return calculate(toEngineInput(loaded.event, loaded.cast, loaded.staff));
}

/**
 * Pull timecards from Square for this event's date and location, and upsert
 * them as staff rows. Rows a human has edited keep their values.
 */
export async function syncFromSquare(eventId: string, locationId: string) {
  const loaded = loadEvent(eventId, locationId);
  if (!loaded) throw new Error('Event not found for this location');
  const loc = getLocation(locationId)!;
  const provider = getProvider();
  const squareLocation = loc.squareLocationId || `demo-${locationId}`;

  const result = await provider.sync(squareLocation, loaded.event.event_date, loc.timezone);
  const warnings = [...result.warnings];
  let added = 0, updated = 0, skipped = 0, nonTipped = 0;

  db.transaction(() => {
    for (const tc of result.timecards) {
      if (isNonTipped(tc.wageTitle)) { nonTipped++; continue; }
      const hours = hoursFromTimecard(tc.startAt, tc.endAt, tc.breakMinutes);
      const { section, matched } = sectionForWageTitle(tc.wageTitle);
      if (!matched && tc.wageTitle) {
        warnings.push(`Unrecognised job title "${tc.wageTitle}" for ${tc.name} — filed under Servers.`);
      }

      const existing = db.prepare(
        'SELECT * FROM staff_row WHERE event_id = ? AND square_timecard_id = ?')
        .get(eventId, tc.id) as StaffRowDb | undefined;

      if (!existing) {
        db.prepare(`INSERT INTO staff_row
          (id,event_id,name,section,hours,included,note,square_timecard_id,source,sort)
          VALUES (?,?,?,?,?,1,'',?, 'square', ?)`).run(
          uid(), eventId, tc.name, section, hours, tc.id, 100 + added);
        added++;
      } else if (existing.overridden) {
        skipped++;
        if (Math.abs(existing.hours - hours) > 0.001) {
          warnings.push(
            `${tc.name}: kept the edited ${existing.hours.toFixed(2)}h; ` +
            `Square now reports ${hours.toFixed(2)}h.`);
        }
      } else {
        db.prepare('UPDATE staff_row SET name=?, section=?, hours=? WHERE id=?')
          .run(tc.name, section, hours, existing.id);
        updated++;
      }
    }

    db.prepare('INSERT INTO sync_run (id,event_id,location_id,status,detail) VALUES (?,?,?,?,?)')
      .run(uid(), eventId, locationId, 'success',
        JSON.stringify({ added, updated, skipped, nonTipped }));
  })();

  return {
    provider: result.provider, added, updated, skipped, nonTipped,
    openTimecards: result.openTimecards,
    unattributedTipCents: result.unattributedTipCents,
    warnings,
  };
}
