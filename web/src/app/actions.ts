'use server';

import { revalidatePath } from 'next/cache';
import { q, one, tx, uid, ensureSchema } from '@/lib/db';
import { createEvent, syncFromSquare } from '@/lib/service';
import { toCents } from '@/lib/money';
import { getLocation } from '@/lib/config';
import { requireLocation, requireUser, destroySession, isAdmin } from '@/lib/auth';
import { seedForeverCountry } from '@/lib/demo';
import { parseTimecard, nameKey, HOURS_CAP } from '@/lib/timecardImport';
import { loadEvent } from '@/lib/service';
import { isoDate } from '@/lib/db';
import { redirect } from 'next/navigation';

const num = (v: FormDataEntryValue | null, d = 0) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : d;
};

export async function signOutAction() {
  await destroySession();
  redirect('/login');
}

/** Loads the verified sample night. Admins only; idempotent. */
export async function loadSampleAction() {
  const user = await requireUser();
  if (!isAdmin(user)) throw new Error('Admins only');
  const { id } = await seedForeverCountry();
  revalidatePath('/?location=spirit');
  redirect(`/events/${id}?location=spirit`);
}

export async function createEventAction(fd: FormData) {
  const locationId = String(fd.get('locationId'));
  await requireLocation(locationId);
  const id = await createEvent({
    locationId,
    showTypeId: String(fd.get('showTypeId')),
    eventDate: String(fd.get('eventDate')),
    showName: String(fd.get('showName') ?? ''),
    guestAttendance: fd.get('guestAttendance') ? num(fd.get('guestAttendance')) : null,
  });
  revalidatePath(`/?location=${locationId}`);
  return id;
}

/**
 * Every mutation re-checks two things: that the signed-in user may see this
 * venue, and that the row actually belongs to it.
 */
async function assertScope(eventId: string, locationId: string) {
  await requireLocation(locationId);
  await ensureSchema();
  const row = await one<{ id: string }>(
    'SELECT id FROM event WHERE id = $1 AND location_id = $2', [eventId, locationId]);
  if (!row) throw new Error('Event does not belong to the selected location');
}

export async function saveEventAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);

  const override = String(fd.get('totalOverride') ?? '').trim();

  await tx(async (c) => {
    await c.q(
      `UPDATE event SET show_name=$1, guest_attendance=$2, gratuity_cents=$3,
         cash_cents=$4, square_cents=$5, total_override_cents=$6,
         cast_share_percent=$7, office_hours=$8, odd_cent_to=$9,
         contract_service=$10
       WHERE id=$11`,
      [
        String(fd.get('showName') ?? ''),
        fd.get('guestAttendance') ? num(fd.get('guestAttendance')) : null,
        toCents(num(fd.get('gratuity'))),
        toCents(num(fd.get('cash'))),
        toCents(num(fd.get('square'))),
        override === '' ? null : toCents(Number(override)),
        num(fd.get('castSharePercent'), 50),
        num(fd.get('officeHours'), 6),
        String(fd.get('oddCentTo') ?? 'staff'),
        String(fd.get('contractService') ?? ''),
        eventId,
      ],
    );

    for (const [key, value] of fd.entries()) {
      let m = key.match(/^cast_ratio_(.+)$/);
      if (m) {
        await c.q('UPDATE cast_row SET ratio=$1 WHERE id=$2 AND event_id=$3',
          [num(value, 1), m[1], eventId]);
        continue;
      }
      m = key.match(/^staff_hours_(.+)$/);
      if (m) {
        const id = m[1];
        const prev = (await c.q<{ hours: number; source: string }>(
          'SELECT hours, source FROM staff_row WHERE id=$1 AND event_id=$2',
          [id, eventId]))[0];
        const next = num(value);
        const edited = prev && Math.abs(prev.hours - next) > 0.001
          && prev.source === 'square';
        await c.q(
          `UPDATE staff_row SET hours=$1${edited ? ', overridden=true' : ''}
             WHERE id=$2 AND event_id=$3`,
          [next, id, eventId]);
        continue;
      }
      m = key.match(/^staff_note_(.+)$/);
      if (m) {
        await c.q('UPDATE staff_row SET note=$1 WHERE id=$2 AND event_id=$3',
          [String(value), m[1], eventId]);
      }
    }

    // Unchecked boxes are absent from FormData, so set every flag explicitly
    // from whether its key is present.
    const castIds = await c.q<{ id: string }>(
      'SELECT id FROM cast_row WHERE event_id=$1', [eventId]);
    for (const { id } of castIds) {
      await c.q('UPDATE cast_row SET worked=$1 WHERE id=$2',
        [fd.has(`cast_worked_${id}`), id]);
    }
    const staffIds = await c.q<{ id: string }>(
      'SELECT id FROM staff_row WHERE event_id=$1', [eventId]);
    for (const { id } of staffIds) {
      await c.q('UPDATE staff_row SET included=$1 WHERE id=$2',
        [fd.has(`staff_incl_${id}`), id]);
    }
  });

  revalidatePath(`/events/${eventId}`);
}

export async function addStaffAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return;
  await q(
    `INSERT INTO staff_row (id,event_id,name,section,hours,included,sort)
     VALUES ($1,$2,$3,$4,$5,true,500)`,
    [uid(), eventId, name, String(fd.get('section')), Number(fd.get('hours') ?? 0)]);
  revalidatePath(`/events/${eventId}`);
}

/**
 * The row id is BOUND, not sent as a form field: React uses a submit button's
 * `name` to encode which action to invoke, so a name/value pair on a button
 * with formAction is silently overridden and never reaches the action.
 */
export async function deleteStaffAction(rowId: string, fd: FormData) {
  const eventId = String(fd.get('eventId'));
  await assertScope(eventId, String(fd.get('locationId')));
  if (!rowId) throw new Error('No staff row given to remove');
  await q('DELETE FROM staff_row WHERE id=$1 AND event_id=$2', [rowId, eventId]);
  revalidatePath(`/events/${eventId}`);
}

export async function syncAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);
  if (!getLocation(locationId)) throw new Error('Unknown location');
  const res = await syncFromSquare(eventId, locationId);
  revalidatePath(`/events/${eventId}`);
  return res;
}


/** Deletes a show and everything recorded against it. */
export async function deleteEventAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);
  await q('DELETE FROM event WHERE id=$1 AND location_id=$2', [eventId, locationId]);
  revalidatePath(`/?location=${locationId}`);
  redirect(`/?location=${locationId}`);
}

/**
 * Puts the night back to an empty sheet: nobody ticked, no hours. The roster
 * itself is left alone, and the tips collected are left alone.
 */
export async function clearSelectionsAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);
  await tx(async (c) => {
    await c.q('UPDATE cast_row SET worked=false WHERE event_id=$1', [eventId]);
    await c.q(
      `UPDATE staff_row SET hours=0, included=false, note='', source='manual',
         overridden=false WHERE event_id=$1`,
      [eventId]);
  });
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}?location=${locationId}&cleared=1`);
}

/**
 * Reads a Square timecard export and fills the sheet from it: staff get their
 * hours, cast are ticked as having worked, and anything over the cap is
 * trimmed. Names that match nobody on the roster are reported, not invented.
 */
export async function importTimecardAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  await assertScope(eventId, locationId);

  const file = fd.get('timecard');
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/events/${eventId}?location=${locationId}&import=` +
      encodeURIComponent(JSON.stringify({ error: 'Choose a file first.' })));
  }

  const loaded = await loadEvent(eventId, locationId);
  if (!loaded) throw new Error('Event not found for this location');
  const eventDate = isoDate(loaded.event.event_date);

  let parsed;
  try {
    parsed = await parseTimecard(
      await (file as File).arrayBuffer(), eventDate, (file as File).name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not read that file.';
    redirect(`/events/${eventId}?location=${locationId}&import=` +
      encodeURIComponent(JSON.stringify({ error: msg })));
  }

  const staffBy = new Map(loaded.staff.map((r) => [nameKey(r.name), r]));
  const castBy  = new Map(loaded.cast.map((r) => [nameKey(r.name), r]));

  let staffSet = 0, castTicked = 0, capped = 0;
  const unmatched: string[] = [];

  await tx(async (c) => {
    for (const row of parsed.rows) {
      const key = nameKey(row.name);

      const staff = staffBy.get(key);
      if (staff) {
        // Only count a trim that was actually applied to somebody.
        if (row.capped) capped++;
        await c.q(
          `UPDATE staff_row SET hours=$1, included=true, source='square',
             overridden=false WHERE id=$2`,
          [row.hours, staff.id]);
        staffSet++;
        continue;
      }
      const cast = castBy.get(key);
      if (cast) {
        await c.q('UPDATE cast_row SET worked=true WHERE id=$1', [cast.id]);
        castTicked++;
        continue;
      }
      unmatched.push(row.name);
    }
    await c.q(
      'INSERT INTO sync_run (id,event_id,location_id,status,detail) VALUES ($1,$2,$3,$4,$5)',
      [uid(), eventId, locationId, 'import',
       JSON.stringify({ staffSet, castTicked, capped, unmatched: unmatched.length })]);
  });

  const report = {
    rows: parsed.rows.length,
    staffSet, castTicked, capped, cap: HOURS_CAP,
    unmatched: unmatched.slice(0, 12),
    unmatchedTotal: unmatched.length,
    skippedOtherDate: parsed.skippedOtherDate,
    columns: parsed.columns,
    format: parsed.format,
    warnings: parsed.warnings,
    file: (file as File).name,
  };
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}?location=${locationId}&import=` +
    encodeURIComponent(JSON.stringify(report)));
}
