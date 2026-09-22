'use server';

import { revalidatePath } from 'next/cache';
import { db, uid } from '@/lib/db';
import { createEvent, syncFromSquare } from '@/lib/service';
import { toCents } from '@/lib/money';
import { getLocation } from '@/lib/config';

const num = (v: FormDataEntryValue | null, d = 0) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : d;
};

export async function createEventAction(fd: FormData) {
  const locationId = String(fd.get('locationId'));
  const id = createEvent({
    locationId,
    showType: String(fd.get('showType')),
    eventDate: String(fd.get('eventDate')),
    showName: String(fd.get('showName') ?? ''),
    guestAttendance: fd.get('guestAttendance') ? num(fd.get('guestAttendance')) : null,
  });
  revalidatePath(`/?location=${locationId}`);
  return id;
}

/** Every mutation re-checks that the row belongs to the active location. */
function assertScope(eventId: string, locationId: string) {
  const row = db.prepare('SELECT id FROM event WHERE id = ? AND location_id = ?')
    .get(eventId, locationId);
  if (!row) throw new Error('Event does not belong to the selected location');
}

export async function saveEventAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  assertScope(eventId, locationId);

  const override = String(fd.get('totalOverride') ?? '').trim();

  db.transaction(() => {
    db.prepare(`UPDATE event SET show_name=?, guest_attendance=?,
      gratuity_cents=?, cash_cents=?, square_cents=?, total_override_cents=?,
      cast_share_percent=?, office_hours=?, odd_cent_to=? WHERE id=?`).run(
      String(fd.get('showName') ?? ''),
      fd.get('guestAttendance') ? num(fd.get('guestAttendance')) : null,
      toCents(num(fd.get('gratuity'))),
      toCents(num(fd.get('cash'))),
      toCents(num(fd.get('square'))),
      override === '' ? null : toCents(Number(override)),
      num(fd.get('castSharePercent'), 50),
      num(fd.get('officeHours'), 6),
      String(fd.get('oddCentTo') ?? 'staff'),
      eventId,
    );

    for (const [key, value] of fd.entries()) {
      let m = key.match(/^cast_worked_(.+)$/);
      if (m) {
        db.prepare('UPDATE cast_row SET worked=? WHERE id=? AND event_id=?')
          .run(value === 'on' ? 1 : 0, m[1], eventId);
        continue;
      }
      m = key.match(/^cast_ratio_(.+)$/);
      if (m) {
        db.prepare('UPDATE cast_row SET ratio=? WHERE id=? AND event_id=?')
          .run(num(value, 1), m[1], eventId);
        continue;
      }
      m = key.match(/^staff_hours_(.+)$/);
      if (m) {
        const id = m[1];
        const prev = db.prepare('SELECT hours, source FROM staff_row WHERE id=? AND event_id=?')
          .get(id, eventId) as { hours: number; source: string } | undefined;
        const next = num(value);
        if (prev && Math.abs(prev.hours - next) > 0.001 && prev.source === 'square') {
          db.prepare('UPDATE staff_row SET hours=?, overridden=1 WHERE id=? AND event_id=?')
            .run(next, id, eventId);
        } else {
          db.prepare('UPDATE staff_row SET hours=? WHERE id=? AND event_id=?')
            .run(next, id, eventId);
        }
        continue;
      }
      m = key.match(/^staff_note_(.+)$/);
      if (m) {
        db.prepare('UPDATE staff_row SET note=? WHERE id=? AND event_id=?')
          .run(String(value), m[1], eventId);
      }
    }

    // Unchecked checkboxes are absent from FormData, so reset then apply.
    const castIds = (db.prepare('SELECT id FROM cast_row WHERE event_id=?')
      .all(eventId) as { id: string }[]).map((r) => r.id);
    for (const id of castIds) {
      if (!fd.has(`cast_worked_${id}`)) {
        db.prepare('UPDATE cast_row SET worked=0 WHERE id=?').run(id);
      }
    }
    const staffIds = (db.prepare('SELECT id FROM staff_row WHERE event_id=?')
      .all(eventId) as { id: string }[]).map((r) => r.id);
    for (const id of staffIds) {
      db.prepare('UPDATE staff_row SET included=? WHERE id=?')
        .run(fd.has(`staff_incl_${id}`) ? 1 : 0, id);
    }
  })();

  revalidatePath(`/events/${eventId}`);
}

export async function addStaffAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  assertScope(eventId, locationId);
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return;
  db.prepare(`INSERT INTO staff_row (id,event_id,name,section,hours,included,sort)
    VALUES (?,?,?,?,?,1,?)`).run(
    uid(), eventId, name, String(fd.get('section')), Number(fd.get('hours') ?? 0), 500);
  revalidatePath(`/events/${eventId}`);
}

export async function deleteStaffAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  assertScope(eventId, String(fd.get('locationId')));
  db.prepare('DELETE FROM staff_row WHERE id=? AND event_id=?')
    .run(String(fd.get('rowId')), eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function syncAction(fd: FormData) {
  const eventId = String(fd.get('eventId'));
  const locationId = String(fd.get('locationId'));
  assertScope(eventId, locationId);
  if (!getLocation(locationId)) throw new Error('Unknown location');
  const res = await syncFromSquare(eventId, locationId);
  revalidatePath(`/events/${eventId}`);
  return res;
}
