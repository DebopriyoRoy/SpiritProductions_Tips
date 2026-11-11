import { q, one, tx, uid, ensureSchema } from './db';
import { SEED_ROSTER } from './config';
import { Section, CAST_SECTION } from './tips';
import { nameKey } from './timecardImport';

/**
 * The team, kept in the database.
 *
 * Every new show is seeded from here, section by section, so whoever is on
 * this list is already on the sheet when a night is started. People are
 * added from the Team page or straight from a night's "Add someone" form,
 * and removed from the Team page when they leave. A removal only stops them
 * being seeded onto new shows: nights already entered keep them.
 */

export type RosterSection = Section | typeof CAST_SECTION;

export interface RosterMember {
  id: string;
  name: string;
  section: RosterSection;
  venue: string;
  technical: boolean;
  active: boolean;
  source: string;
  removed_at: Date | null;
}

/** Sections a person can be on the team list for. Extra Help is never one. */
export const ROSTER_SECTIONS: RosterSection[] =
  [CAST_SECTION, 'BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];

let seeded: Promise<void> | null = null;

/**
 * Fills an empty roster table from the lists in config.ts, once. A table with
 * any row at all, removed ones included, is left alone: from then on the
 * database is the record, and an empty active list is a real answer.
 */
export function ensureRosterSeeded(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      await ensureSchema();
      const any = await one<{ id: string }>('SELECT id FROM roster_member LIMIT 1');
      if (any) return;
      await tx(async (c) => {
        for (const [i, m] of SEED_ROSTER.entries()) {
          await c.q(
            `INSERT INTO roster_member (id,name,section,venue,technical,sort,source)
             VALUES ($1,$2,$3,$4,$5,$6,'seed')
             ON CONFLICT DO NOTHING`,
            [uid(), m.name, m.section, m.venue, m.technical, i]);
        }
      });
    })().catch((err) => { seeded = null; throw err; });
  }
  return seeded;
}

export async function listRoster(): Promise<RosterMember[]> {
  await ensureRosterSeeded();
  return q<RosterMember>(
    `SELECT id,name,section,venue,technical,active,source,removed_at
       FROM roster_member ORDER BY sort, lower(name)`);
}

/** Who a venue seeds onto a new show: the active team, in list order. */
export async function rosterFor(locationId: string): Promise<{
  cast: { name: string; technical: boolean }[];
  sections: Partial<Record<Section, string[]>>;
}> {
  const rows = (await listRoster())
    .filter((m) => m.active && (m.venue === '' || m.venue === locationId));
  const sections: Partial<Record<Section, string[]>> = {};
  const cast: { name: string; technical: boolean }[] = [];
  for (const m of rows) {
    if (m.section === CAST_SECTION) {
      cast.push({ name: m.name, technical: m.technical });
    } else {
      (sections[m.section] ??= []).push(m.name);
    }
  }
  return { cast, sections };
}

/** Everyone active on any list, for picking a screech-in host. */
export async function everyoneActive(): Promise<string[]> {
  const out = new Set<string>();
  for (const m of await listRoster()) if (m.active) out.add(m.name);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Puts someone on the team list for a section. The same person under another
 * spelling or word order ("Lasby, Dan" and "Dan Lasby") is the same entry, so
 * an existing row is reused, and brought back if it had been removed.
 */
export async function addToRoster(input: {
  name: string; section: RosterSection; venue?: string; technical?: boolean;
  source: string;
}): Promise<'added' | 'restored' | 'exists'> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || !nameKey(name)) throw new Error('A name is needed');
  if (!ROSTER_SECTIONS.includes(input.section)) {
    throw new Error(`Not a team section: ${input.section}`);
  }
  const venue = input.venue ?? '';
  await ensureRosterSeeded();

  const same = (await q<RosterMember>(
    `SELECT id,name,section,venue,technical,active,source,removed_at
       FROM roster_member WHERE section=$1 AND venue=$2`,
    [input.section, venue])).find((m) => nameKey(m.name) === nameKey(name));
  if (same) {
    if (same.active) return 'exists';
    await q(
      'UPDATE roster_member SET active=true, removed_at=NULL WHERE id=$1', [same.id]);
    return 'restored';
  }

  // New people go to the end of the list, where the workbook adds them.
  const last = await one<{ max: number | null }>(
    'SELECT max(sort) AS max FROM roster_member');
  await q(
    `INSERT INTO roster_member (id,name,section,venue,technical,sort,source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid(), name, input.section, venue, !!input.technical,
     (last?.max ?? 0) + 1, input.source]);
  return 'added';
}

export async function setRosterActive(id: string, active: boolean): Promise<void> {
  await ensureRosterSeeded();
  await q(
    `UPDATE roster_member SET active=$2,
       removed_at = CASE WHEN $2 THEN NULL ELSE now() END
     WHERE id=$1`,
    [id, active]);
}
