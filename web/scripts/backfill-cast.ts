/**
 * Seeds cast rows onto shows that predate their show type gaining a cast.
 *
 *   npm run backfill-cast              # seed the missing cast rows
 *   npm run backfill-cast -- --set-share   # also set cast share % where it is 0
 *
 * Cast rows are written once, when the show is created, and only when the show
 * type has a cast. Turning hasCast on for a type therefore leaves every show
 * made before that change with an empty cast panel. This fills them in.
 *
 * The cast share is a separate, opt-in step because it moves money: raising it
 * from 0 takes that share out of the staff pool. Seeding rows alone changes
 * nobody's pay, since an untitled cast member is not ticked as having worked.
 *
 * Safe to run repeatedly: shows that already have cast rows are left alone.
 */
import './env';
import { reportAndExit } from './report';
import { pool, q, uid, tx } from '../src/lib/db';
import { SHOW_TYPES, CAST } from '../src/lib/config';

interface Row {
  id: string;
  show_type_id: string;
  show_name: string;
  event_date: string;
  cast_share_percent: number;
  cast_rows: number;
}

async function main() {
  const setShare = process.argv.includes('--set-share');

  const events = await q<Row>(
    `SELECT e.id, e.show_type_id, e.show_name, e.event_date,
            e.cast_share_percent,
            (SELECT count(*) FROM cast_row c WHERE c.event_id = e.id)::int
              AS cast_rows
       FROM event e
      ORDER BY e.event_date`);

  const needsCast = events.filter(
    (e) => SHOW_TYPES[e.show_type_id]?.hasCast && e.cast_rows === 0);

  if (!needsCast.length) {
    console.log('Every show that should have a cast already has one.');
  }

  for (const e of needsCast) {
    await tx(async (c) => {
      for (const [i, raw] of CAST.entries()) {
        const [name, tech] = raw.split('|');
        await c.q(
          `INSERT INTO cast_row (id,event_id,name,ratio,worked,technical,sort)
           VALUES ($1,$2,$3,1,false,$4,$5)`,
          [uid(), e.id, name, !!tech, i],
        );
      }
    });
    console.log(
      `  seeded ${CAST.length} cast rows on ${e.id} ` +
      `(${e.show_type_id}, ${String(e.event_date).slice(0, 10)}, ` +
      `"${e.show_name || 'unnamed'}")`);
  }

  // Shows whose type now has a cast but whose stored share is still zero.
  const zeroShare = events.filter((e) => {
    const show = SHOW_TYPES[e.show_type_id];
    return show?.hasCast && e.cast_share_percent === 0
      && show.rules.castSharePercent > 0;
  });

  if (!zeroShare.length) return;

  if (!setShare) {
    console.log(
      `\n${zeroShare.length} show(s) have a cast panel but a cast share of 0%, ` +
      'so the cast would be paid nothing:');
    for (const e of zeroShare) {
      console.log(`  ${String(e.event_date).slice(0, 10)}  ${e.show_name || e.id}` +
                  `  (${e.show_type_id})`);
    }
    console.log(
      '\nThis moves money, so it is not done by default. Either set the ' +
      'Cast share % on each sheet by hand, or re-run with:\n' +
      '  npm run backfill-cast -- --set-share');
    return;
  }

  for (const e of zeroShare) {
    const want = SHOW_TYPES[e.show_type_id].rules.castSharePercent;
    await q('UPDATE event SET cast_share_percent = $1 WHERE id = $2', [want, e.id]);
    console.log(
      `  cast share ${e.cast_share_percent}% -> ${want}% on ` +
      `${String(e.event_date).slice(0, 10)} "${e.show_name || e.id}"`);
  }
  console.log(
    '\nRe-open each of those sheets and press Calculate tips to re-run the ' +
    'split with the new share.');
}

main()
  .catch(reportAndExit)
  .finally(() => pool.end());
