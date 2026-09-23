/**
 * Creates the first administrator, or adds another one.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run create-admin
 *
 * Run it against the same DATABASE_URL the app uses. Until an account exists
 * nobody can sign in, which is the safe default for a fresh deployment.
 */
import './env';
import { createUser, countUsers, MIN_PASSWORD } from '../src/lib/auth';
import { pool, one } from '../src/lib/db';
import { UserRow } from '../src/lib/db';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = process.env.ADMIN_NAME ?? '';

  if (!email || !password) {
    console.error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD.\n\n' +
      "  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' \\\n" +
      '    npm run create-admin\n');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_PASSWORD) {
    console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters.`);
    process.exitCode = 1;
    return;
  }

  const existing = await one<UserRow>(
    'SELECT * FROM app_user WHERE email = $1', [email]);
  if (existing) {
    console.error(`${email} already has an account. Reset the password from the People page.`);
    process.exitCode = 1;
    return;
  }

  // Empty locations = every venue.
  await createUser({ email, name, password, role: 'admin', locations: [] });
  console.log(`Created admin ${email}. Total accounts: ${await countUsers()}`);
}

main()
  .catch((err) => { console.error(err.message ?? err); process.exitCode = 1; })
  .finally(() => pool.end());
