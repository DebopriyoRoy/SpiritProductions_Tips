/** Creates the schema. Safe to run repeatedly. */
import { ensureSchema, pool, q } from '../src/lib/db';

async function main() {
  await ensureSchema();
  const tables = await q<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' ORDER BY table_name`);
  console.log('Schema ready. Tables:', tables.map((t) => t.table_name).join(', '));
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
