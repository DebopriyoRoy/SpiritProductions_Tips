/** Seeds the verified Forever Country show. Also available in the app itself. */
import './env';
import { seedForeverCountry } from '../src/lib/demo';
import { pool } from '../src/lib/db';

seedForeverCountry()
  .then((r) => console.log(
    r.created ? `Seeded Forever Country: ${r.id}` : `Already seeded: ${r.id}`))
  .catch((err) => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => pool.end());
