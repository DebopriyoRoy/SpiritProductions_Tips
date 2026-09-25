import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres connection.
 *
 * On a serverless host every invocation may be a fresh process, so keep the
 * pool tiny and point DATABASE_URL at a POOLED connection string (Neon's
 * "-pooler" host, Supabase's port 6543). A direct connection will exhaust the
 * server's connection limit under load.
 */
/**
 * The pool is created on first use, not at import. A missing DATABASE_URL then
 * surfaces as a clear runtime error instead of crashing the build — and pure
 * helpers that merely import this module stay usable without a database.
 */
let _pool: Pool | null = null;

/** Thrown when the database is not configured or cannot be reached. */
export class DatabaseUnavailable extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = 'DatabaseUnavailable';
  }
}

const PLACEHOLDER_HOSTS = new Set([
  'host', 'hostname', 'your-host', 'your_host', 'dbhost', 'example.com',
]);

/** Catches a copied .env.example before it turns into a confusing DNS error. */
function rejectPlaceholder(url: URL, raw: string): void {
  const looksUnedited =
    PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase()) ||
    /[<>]/.test(raw) ||
    (url.username === 'user' && url.password === 'password');

  if (looksUnedited) {
    throw new DatabaseUnavailable(
      'DATABASE_URL is still the example value, so there is no database to ' +
      'connect to.',
      `Edit web/.env.local and set DATABASE_URL to a real Postgres database.\n` +
      `  Local:  postgresql://postgres@127.0.0.1:5432/spirit_tips\n` +
      `  Neon:   copy the "Pooled connection" string from your Neon project\n` +
      `Current value points at host "${url.hostname}", which does not exist.`,
    );
  }
}

export function getPool(): Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new DatabaseUnavailable(
      'DATABASE_URL is not set.',
      'Copy web/.env.example to web/.env.local and set DATABASE_URL to your ' +
      'Postgres database.',
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseUnavailable(
      'DATABASE_URL is not a valid connection string.',
      'It should look like postgresql://user:password@host:5432/database',
    );
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new DatabaseUnavailable(
      `DATABASE_URL must start with postgresql://, not "${url.protocol}//".`,
    );
  }
  rejectPlaceholder(url, connectionString);

  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

  // Strip libpq-only parameters that node-postgres cannot honour:
  //  - sslmode: TLS is configured below, and leaving it in makes pg warn that
  //    its meaning is changing.
  //  - channel_binding: pg does not implement SCRAM channel binding at all, so
  //    "require" would be silently ignored — a guarantee the driver cannot keep.
  // Both appear in the connection string Neon hands out.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');

  _pool = new Pool({
    connectionString: url.toString(),
    max: Number(process.env.PGPOOL_MAX ?? (isLocal ? 5 : 2)),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres requires TLS and presents a publicly trusted
    // certificate, so verify it. Set PGSSL_NO_VERIFY=1 only for a server with
    // a self-signed certificate. A local server offers no TLS at all.
    ssl: isLocal
      ? undefined
      : { rejectUnauthorized: process.env.PGSSL_NO_VERIFY !== '1' },
  });
  return _pool;
}

/** Turns a driver error into something a person can act on. */
export function asFriendlyDbError(err: unknown): Error {
  if (err instanceof DatabaseUnavailable) return err;
  const e = err as NodeJS.ErrnoException & { code?: string; address?: string };
  const host = process.env.DATABASE_URL
    ? (() => { try { return new URL(process.env.DATABASE_URL!).host; }
               catch { return 'the configured host'; } })()
    : 'the configured host';

  switch (e?.code) {
    case 'ENOTFOUND':
      return new DatabaseUnavailable(
        `Cannot find the database host "${host}".`,
        'Check DATABASE_URL in web/.env.local. If it still contains the ' +
        'example value, replace it with a real connection string.');
    case 'ECONNREFUSED':
      return new DatabaseUnavailable(
        `Nothing is listening at ${host}.`,
        'Start your Postgres server, or point DATABASE_URL at a running one.');
    case 'ETIMEDOUT':
      return new DatabaseUnavailable(
        `Timed out connecting to ${host}.`,
        'Check the host and port, and that the database allows connections ' +
        'from this machine.');
    case '28P01':
      return new DatabaseUnavailable(
        'Postgres rejected the username or password in DATABASE_URL.');
    case '3D000':
      return new DatabaseUnavailable(
        'That database does not exist on the server.',
        'Create it (createdb spirit_tips) or correct the name in DATABASE_URL.');
    default:
      return err instanceof Error ? err : new Error(String(err));
  }
}

/** Closes the pool. For scripts; the server keeps it for the process lifetime. */
export const pool = {
  query: ((text: string, params?: unknown[]) =>
    getPool().query(text, params as never)) as Pool['query'],
  connect: (() => getPool().connect()) as Pool['connect'],
  end: async () => { if (_pool) { await _pool.end(); _pool = null; } },
};

export async function q<T extends QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  try {
    const res = await getPool().query<T>(text, params);
    return res.rows;
  } catch (err) {
    throw asFriendlyDbError(err);
  }
}

export async function one<T extends QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

/** Run several statements atomically. */
export async function tx<T>(fn: (c: {
  q: <R extends QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>;
}) => Promise<T>): Promise<T> {
  let client;
  try {
    client = await getPool().connect();
  } catch (err) {
    throw asFriendlyDbError(err);
  }
  try {
    await client.query('BEGIN');
    const out = await fn({
      q: async <R extends QueryResultRow>(text: string, params: unknown[] = []) =>
        (await client.query<R>(text, params)).rows,
    });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_user (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'manager',
  -- Location ids this user may see. Empty means every location (admins).
  locations      TEXT[] NOT NULL DEFAULT '{}',
  active         BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_session (
  -- sha256 of the cookie value: a database leak does not hand over sessions.
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user ON user_session(user_id);

CREATE TABLE IF NOT EXISTS event (
  id                   TEXT PRIMARY KEY,
  location_id          TEXT NOT NULL,
  show_type            TEXT NOT NULL,
  show_type_id         TEXT NOT NULL DEFAULT 'public',
  contract_service     TEXT NOT NULL DEFAULT '',
  event_date           DATE NOT NULL,
  show_name            TEXT NOT NULL DEFAULT '',
  guest_attendance     INTEGER,
  gratuity_cents       INTEGER NOT NULL DEFAULT 0,
  cash_cents           INTEGER NOT NULL DEFAULT 0,
  square_cents         INTEGER NOT NULL DEFAULT 0,
  total_override_cents INTEGER,
  cast_share_percent   REAL NOT NULL DEFAULT 50,
  office_hours         REAL NOT NULL DEFAULT 6,
  odd_cent_to          TEXT NOT NULL DEFAULT 'staff',
  status               TEXT NOT NULL DEFAULT 'draft',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, event_date, show_name)
);

CREATE TABLE IF NOT EXISTS cast_row (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  ratio     REAL NOT NULL DEFAULT 1,
  worked    BOOLEAN NOT NULL DEFAULT false,
  technical BOOLEAN NOT NULL DEFAULT false,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_row (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  section            TEXT NOT NULL,
  hours              REAL NOT NULL DEFAULT 0,
  included           BOOLEAN NOT NULL DEFAULT true,
  note               TEXT NOT NULL DEFAULT '',
  square_timecard_id TEXT,
  source             TEXT NOT NULL DEFAULT 'manual',
  overridden         BOOLEAN NOT NULL DEFAULT false,
  sort               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_run (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS password_reset (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- sha256 of the emailed code, for the same reason sessions are hashed.
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset(user_id);

-- Sign-up email verification. Keyed by address, not user_id: at this point
-- the person has no account yet, which is the whole point of verifying.
CREATE TABLE IF NOT EXISTS email_verification (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verify_email ON email_verification(email);

CREATE INDEX IF NOT EXISTS idx_event_loc  ON event(location_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cast_event ON cast_row(event_id);
CREATE INDEX IF NOT EXISTS idx_staff_event ON staff_row(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_timecard
  ON staff_row(event_id, square_timecard_id) WHERE square_timecard_id IS NOT NULL;

/* ------------------------------------------------------------------ *
 * Converge existing databases
 *
 * CREATE TABLE IF NOT EXISTS does nothing once the table is there, so a
 * column added to the block above never reaches a database created by an
 * earlier release: migrate prints "Schema ready", exits 0, and the app then
 * fails on the first query with 'column ... does not exist'. Every column
 * that is not part of the original table is therefore re-stated here, where
 * ADD COLUMN IF NOT EXISTS makes the schema converge instead of drift.
 *
 * Adding a column here as well as above is the point, not duplication. A new
 * column MUST be added in both places, and must carry a default so it can be
 * added to a table that already holds rows.
 * ------------------------------------------------------------------ */

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS name            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS role            TEXT NOT NULL DEFAULT 'manager',
  ADD COLUMN IF NOT EXISTS locations       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- A session row that predates this column is treated as already expired,
-- which costs one sign-in and never grants access it should not.
ALTER TABLE user_session
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE event
  ADD COLUMN IF NOT EXISTS show_type_id         TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS contract_service     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS show_name            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_attendance     INTEGER,
  ADD COLUMN IF NOT EXISTS gratuity_cents       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_cents           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS square_cents         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_override_cents INTEGER,
  ADD COLUMN IF NOT EXISTS cast_share_percent   REAL NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS office_hours         REAL NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS odd_cent_to          TEXT NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE cast_row
  ADD COLUMN IF NOT EXISTS ratio     REAL NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS worked    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS technical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE staff_row
  ADD COLUMN IF NOT EXISTS hours              REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS note               TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS square_timecard_id TEXT,
  ADD COLUMN IF NOT EXISTS source             TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS overridden         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort               INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sync_run
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS detail     TEXT NOT NULL DEFAULT '';

ALTER TABLE password_reset
  ADD COLUMN IF NOT EXISTS attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS used_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE email_verification
  ADD COLUMN IF NOT EXISTS attempts    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- The one-show-per-name-per-night rule. An older database may have the table
-- without the constraint, and CREATE TABLE IF NOT EXISTS would not add it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'event'::regclass AND contype = 'u'
  ) THEN
    ALTER TABLE event
      ADD CONSTRAINT event_location_id_event_date_show_name_key
      UNIQUE (location_id, event_date, show_name);
  END IF;
END $$;
`;

/**
 * Create the schema if it is missing. Memoised per process and guarded by a
 * transaction-scoped advisory lock, so concurrent serverless instances cannot
 * race each other even through a transaction pooler.
 */
/** Arbitrary but fixed: every instance must use the same advisory lock id. */
const SCHEMA_LOCK_ID = 528_1975;

let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      let client;
      try {
        client = await getPool().connect();
      } catch (err) {
        throw asFriendlyDbError(err);
      }
      try {
        // One transaction, for two reasons.
        //
        // The deploy guide mandates a transaction pooler (Neon's pooled
        // string, Supabase port 6543). There a session-level
        // pg_advisory_lock would be taken, used and released on up to three
        // different backends: it would guard nothing, and would strand the
        // lock on a pooled connection. pg_advisory_xact_lock is held for the
        // transaction and released by COMMIT or ROLLBACK, which cannot leak.
        //
        // It also makes the DDL all-or-nothing, so a failure halfway cannot
        // leave the schema half-converged.
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_ID]);
        await client.query(SCHEMA);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Dates come back as JS Date; the app works in plain YYYY-MM-DD strings. */
export const isoDate = (d: Date | string) =>
  typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

export interface UserRow {
  id: string; email: string; name: string; password_hash: string;
  role: string; locations: string[]; active: boolean;
  failed_attempts: number; locked_until: string | null; created_at: string;
}

export interface EventRow {
  id: string; location_id: string; show_type: string; show_type_id: string;
  contract_service: string; event_date: string; show_name: string;
  guest_attendance: number | null;
  gratuity_cents: number; cash_cents: number; square_cents: number;
  total_override_cents: number | null;
  cast_share_percent: number; office_hours: number; odd_cent_to: string;
  status: string; created_at: string;
}
export interface CastRow {
  id: string; event_id: string; name: string; ratio: number;
  worked: boolean; technical: boolean; sort: number;
}
export interface StaffRowDb {
  id: string; event_id: string; name: string; section: string; hours: number;
  included: boolean; note: string; square_timecard_id: string | null;
  source: string; overridden: boolean; sort: number;
}

/**
 * Every operational read is scoped by location. Nothing queries these tables
 * without going through here — see docs/PLAN.md §5.
 */
export async function eventForLocation(eventId: string, locationId: string) {
  await ensureSchema();
  const row = await one<EventRow>(
    'SELECT * FROM event WHERE id = $1 AND location_id = $2', [eventId, locationId]);
  return row ? { ...row, event_date: isoDate(row.event_date) } : undefined;
}

export async function eventsForLocation(locationId: string) {
  await ensureSchema();
  const rows = await q<EventRow>(
    'SELECT * FROM event WHERE location_id = $1 ORDER BY event_date DESC, show_name',
    [locationId]);
  return rows.map((r) => ({ ...r, event_date: isoDate(r.event_date) }));
}
