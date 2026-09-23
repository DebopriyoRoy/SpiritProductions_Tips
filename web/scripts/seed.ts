/** Seeds the verified Forever Country show. Also available in the app itself. */
import './env';
import { reportAndExit } from './report';
import { seedForeverCountry } from '../src/lib/demo';
import { pool } from '../src/lib/db';

seedForeverCountry()
  .then((r) => console.log(
    r.created ? `Seeded Forever Country: ${r.id}` : `Already seeded: ${r.id}`))
  .catch(reportAndExit)
  .finally(() => pool.end());
