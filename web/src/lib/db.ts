import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres connection.
 *
 * On a serverless host every invocation may be a fresh process, so keep the
 * pool tiny and point DATABASE_URL at a POOLED connection string (Neon's
 * "-pooler" host, Supabase's port 6543). A direct connection will exhaust the
 * server's connection limit under load.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and point it at ' +
    'your Postgres database.',
  );
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PGPOOL_MAX ?? (isLocal ? 5 : 2)),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  // Managed Postgres requires TLS; a local dev server does not offer it.
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export async function q<T extends QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
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
  const client = await pool.connect();
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

CREATE INDEX IF NOT EXISTS idx_event_loc  ON event(location_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_cast_event ON cast_row(event_id);
CREATE INDEX IF NOT EXISTS idx_staff_event ON staff_row(event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_timecard
  ON staff_row(event_id, square_timecard_id) WHERE square_timecard_id IS NOT NULL;
`;

/**
 * Create the schema if it is missing. Memoised per process and guarded by an
 * advisory lock so concurrent serverless instances cannot race each other.
 */
/** Arbitrary but fixed: every instance must use the same advisory lock id. */
const SCHEMA_LOCK_ID = 528_1975;

let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
        await client.query(SCHEMA);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]);
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
