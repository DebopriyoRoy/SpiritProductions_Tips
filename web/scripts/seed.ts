/** Seeds the verified Forever Country show so the app has something real in it. */
import { createEvent, loadEvent } from '../src/lib/service';
import { q, one, ensureSchema, pool } from '../src/lib/db';
import { toCents } from '../src/lib/money';

const WORKED = new Set([
  'Blackwood, Adam', 'Byrne, Patrick (Paddy)', 'Fiore, Marco', 'Dicks Jeremy',
  'Pretty Caitlin', 'Lasby, Dan', 'Noftle, Kara', 'Small Andrew', 'Fletcher Logan',
]);

/** name, section, hours — exactly as verified against the model workbook. */
const HOURS: [string, string, number][] = [
  ['Dickson Joleen', 'BAR', 5.73], ['Gordon Daniel', 'BAR', 5.0],
  ['Sweetapple Deborah', 'SERVICE', 4.88], ['Khrystyna Zavadetska', 'SERVICE', 3.55],
  ['Martynova Olena', 'SERVICE', 7.38], ['Polski Maksym', 'SERVICE', 4.83],
  ['Pynn Jackie', 'SERVICE', 5.35], ['Pasechniuk Yana', 'FIFTY_FIFTY', 3.97],
  ['Kachensseva Mariia (Marsh)', 'KITCHEN', 4.3], ['Lundrigan William', 'KITCHEN', 6.15],
  ["O'Reilly Colleen", 'KITCHEN', 8.0], ['Wall James (Jordon)', 'KITCHEN', 4.42],
  ['Hillier Bridget', 'OFFICE', 1.5], ['Khrystyna Zavadetska', 'OFFICE', 1.5],
  ['Pasechniuk Maryna', 'OFFICE', 1.5], ['Pasechniuk Yana', 'OFFICE', 1.5],
];

async function main() {
  await ensureSchema();

  const existing = await one<{ id: string }>(
    `SELECT id FROM event WHERE location_id='spirit' AND event_date='2026-08-28'`);
  if (existing) {
    console.log('Already seeded:', existing.id);
    return;
  }

  const id = await createEvent({
    locationId: 'spirit', showTypeId: 'public', eventDate: '2026-08-28',
    showName: 'Forever Country', guestAttendance: 86,
  });

  await q('UPDATE event SET total_override_cents=$1 WHERE id=$2',
    [toCents(1072.53), id]);

  const loaded = (await loadEvent(id, 'spirit'))!;
  for (const c of loaded.cast) {
    if (WORKED.has(c.name)) {
      await q('UPDATE cast_row SET worked=true WHERE id=$1', [c.id]);
    }
  }

  // The roster is already seeded at 0.00 by createEvent, so set hours in place
  // rather than inserting duplicate rows.
  for (const [name, section, hours] of HOURS) {
    const row = loaded.staff.find((s) => s.name === name && s.section === section);
    if (!row) {
      console.warn(`  ! no roster row for ${name} (${section}) — skipped`);
      continue;
    }
    await q('UPDATE staff_row SET hours=$1 WHERE id=$2', [hours, row.id]);
  }

  console.log('Seeded Forever Country:', id);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
