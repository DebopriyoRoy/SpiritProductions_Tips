/**
 * Brings the team list in line with a file of who is on the team now.
 *
 *   npx tsx scripts/roster-sync.ts team.json           # shows what would change
 *   npx tsx scripts/roster-sync.ts team.json --apply   # makes the change
 *
 * team.json is a list of { name, section, venue?, technical? }, where section
 * is CAST, BAR, SERVICE, FIFTY_FIFTY, KITCHEN or OFFICE and venue is '' (every
 * venue, the default) or a location id such as "acc".
 *
 * For every section the file mentions, anyone listed is added (or put back if
 * they had been removed) and anyone active who is not listed is taken off.
 * Sections the file does not mention are left alone. Names are matched the
 * way the timecard import matches them, so "Lasby, Dan" and "Dan Lasby" are
 * one person, and the aliases in config.ts count as the same person too.
 * Nobody is deleted and no show already entered is touched.
 */
import './env';
import { readFileSync } from 'node:fs';
import { q, getPool } from '../src/lib/db';
import { NAME_ALIASES } from '../src/lib/config';
import {
  listRoster, addToRoster, setRosterActive, ROSTER_SECTIONS, RosterSection,
} from '../src/lib/roster';
import { nameKey } from '../src/lib/timecardImport';
import { reportAndExit } from './report';

interface Wanted { name: string; section: RosterSection; venue?: string; technical?: boolean }

/** One key per person: an alias resolves to the name it belongs to. */
const aliasOf = new Map<string, string>();
for (const [canonical, others] of Object.entries(NAME_ALIASES)) {
  for (const o of others) aliasOf.set(nameKey(o), nameKey(canonical));
}
const personKey = (n: string) => aliasOf.get(nameKey(n)) ?? nameKey(n);

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('Usage: roster-sync.ts team.json [--apply]');
  const apply = flag === '--apply';
  const wanted: Wanted[] = JSON.parse(readFileSync(file, 'utf8'));
  for (const w of wanted) {
    if (!ROSTER_SECTIONS.includes(w.section)) throw new Error(`Bad section for ${w.name}: ${w.section}`);
  }

  const current = await listRoster();
  const slot = (section: string, venue: string, name: string) =>
    `${section}|${venue}|${personKey(name)}`;
  const want = new Map(wanted.map((w) => [slot(w.section, w.venue ?? '', w.name), w]));
  const have = new Map(current.map((m) => [slot(m.section, m.venue, m.name), m]));
  const sections = new Set(wanted.map((w) => `${w.section}|${w.venue ?? ''}`));

  const adds: Wanted[] = [];
  const restores: typeof current = [];
  for (const [k, w] of want) {
    const m = have.get(k);
    if (!m) adds.push(w);
    else if (!m.active) restores.push(m);
  }
  const removes = current.filter((m) => m.active
    && sections.has(`${m.section}|${m.venue}`)
    && !want.has(slot(m.section, m.venue, m.name)));

  const show = (title: string, rows: { name: string; section: string; venue?: string }[]) => {
    console.log(`\n${title} (${rows.length})`);
    for (const r of rows) console.log(`  ${r.section.padEnd(12)} ${r.venue ? `[${r.venue}] ` : ''}${r.name}`);
  };
  show('Add', adds);
  show('Put back', restores);
  show('Take off', removes);

  if (!apply) {
    console.log('\nNothing changed. Run again with --apply to make these changes.');
    return;
  }
  for (const w of adds) {
    await addToRoster({ ...w, source: 'sync' });
  }
  for (const m of restores) await setRosterActive(m.id, true);
  for (const m of removes) await setRosterActive(m.id, false);
  const [{ n }] = await q<{ n: string }>(
    'SELECT count(*) AS n FROM roster_member WHERE active');
  console.log(`\nDone. ${n} active on the team list.`);
}

main().catch(reportAndExit).finally(() => getPool().end());
