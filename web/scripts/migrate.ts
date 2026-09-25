/**
 * Creates the schema, then proves it. Safe to run repeatedly.
 *
 * The check at the end is the point: `CREATE TABLE IF NOT EXISTS` silently
 * does nothing on a database that already has the table, so a migration that
 * only ran DDL could report success while leaving an older database missing
 * the columns the app queries. This exits non-zero instead, so a deploy
 * pipeline stops here rather than shipping a build that fails on first use.
 */
import './env';
import { reportAndExit } from './report';
import { ensureSchema, pool, q } from '../src/lib/db';

/** Every column the app queries by name. Keep in step with SCHEMA in db.ts. */
const EXPECTED: Record<string, string[]> = {
  app_user: [
    'id', 'email', 'name', 'password_hash', 'role', 'locations', 'active',
    'failed_attempts', 'locked_until', 'created_at',
  ],
  user_session: ['token_hash', 'user_id', 'created_at', 'expires_at'],
  event: [
    'id', 'location_id', 'show_type', 'show_type_id', 'contract_service',
    'event_date', 'show_name', 'guest_attendance', 'gratuity_cents',
    'cash_cents', 'square_cents', 'total_override_cents', 'cast_share_percent',
    'office_hours', 'odd_cent_to', 'status', 'created_at',
  ],
  cast_row: ['id', 'event_id', 'name', 'ratio', 'worked', 'technical', 'sort'],
  staff_row: [
    'id', 'event_id', 'name', 'section', 'hours', 'included', 'note',
    'square_timecard_id', 'source', 'overridden', 'sort',
  ],
  sync_run: ['id', 'event_id', 'location_id', 'started_at', 'status', 'detail'],
  password_reset: [
    'id', 'user_id', 'code_hash', 'expires_at', 'attempts', 'used_at',
    'created_at',
  ],
  email_verification: [
    'id', 'email', 'code_hash', 'expires_at', 'attempts', 'verified_at',
    'created_at',
  ],
};

async function main() {
  await ensureSchema();

  const cols = await q<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'`);

  const have = new Map<string, Set<string>>();
  for (const c of cols) {
    const s = have.get(c.table_name) ?? new Set<string>();
    s.add(c.column_name);
    have.set(c.table_name, s);
  }

  const problems: string[] = [];
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const actual = have.get(table);
    if (!actual) { problems.push(`table ${table} is missing entirely`); continue; }
    const missing = expected.filter((c) => !actual.has(c));
    if (missing.length) {
      problems.push(`${table} is missing: ${missing.join(', ')}`);
    }
  }

  if (problems.length) {
    console.error('Schema is NOT ready. The database did not converge:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nThis usually means a column was added to SCHEMA in src/lib/db.ts ' +
      'without a matching ADD COLUMN IF NOT EXISTS beside it, so existing ' +
      'databases never receive it.');
    process.exitCode = 1;
    return;
  }

  console.log(
    'Schema ready and verified. Tables:',
    [...Object.keys(EXPECTED)].sort().join(', '));
}

main()
  .catch(reportAndExit)
  .finally(() => pool.end());
