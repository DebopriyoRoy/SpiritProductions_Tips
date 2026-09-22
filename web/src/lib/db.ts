import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DIR = process.env.DATA_DIR ?? path.join(process.cwd(), '.data');
fs.mkdirSync(DIR, { recursive: true });

export const db = new Database(path.join(DIR, 'tips.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS event (
  id              TEXT PRIMARY KEY,
  location_id     TEXT NOT NULL,
  show_type       TEXT NOT NULL,
  show_type_id    TEXT NOT NULL DEFAULT 'public',
  contract_service TEXT NOT NULL DEFAULT '',
  event_date      TEXT NOT NULL,
  show_name       TEXT NOT NULL DEFAULT '',
  guest_attendance INTEGER,
  gratuity_cents  INTEGER NOT NULL DEFAULT 0,
  cash_cents      INTEGER NOT NULL DEFAULT 0,
  square_cents    INTEGER NOT NULL DEFAULT 0,
  total_override_cents INTEGER,
  cast_share_percent   REAL NOT NULL DEFAULT 50,
  office_hours         REAL NOT NULL DEFAULT 6,
  odd_cent_to     TEXT NOT NULL DEFAULT 'staff',
  status          TEXT NOT NULL DEFAULT 'draft',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (location_id, event_date, show_name)
);

CREATE TABLE IF NOT EXISTS cast_row (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  ratio     REAL NOT NULL DEFAULT 1,
  worked    INTEGER NOT NULL DEFAULT 0,
  technical INTEGER NOT NULL DEFAULT 0,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_row (
  id        TEXT PRIMARY KEY,
  event_id  TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  section   TEXT NOT NULL,
  hours     REAL NOT NULL DEFAULT 0,
  included  INTEGER NOT NULL DEFAULT 1,
  note      TEXT NOT NULL DEFAULT '',
  square_timecard_id TEXT,
  source    TEXT NOT NULL DEFAULT 'manual',
  overridden INTEGER NOT NULL DEFAULT 0,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_run (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_event_loc ON event(location_id, event_date);
CREATE INDEX IF NOT EXISTS idx_cast_event ON cast_row(event_id);
CREATE INDEX IF NOT EXISTS idx_staff_event ON staff_row(event_id);
`);

/** Additive migrations for databases created before a column existed. */
for (const [col, decl] of [
  ['show_type_id', "TEXT NOT NULL DEFAULT 'public'"],
  ['contract_service', "TEXT NOT NULL DEFAULT ''"],
] as const) {
  const cols = db.prepare('PRAGMA table_info(event)').all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE event ADD COLUMN ${col} ${decl}`);
  }
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Every operational read is scoped by location. Nothing queries these tables
 * without going through here — see docs/PLAN.md §5.
 */
export function eventForLocation(eventId: string, locationId: string) {
  return db
    .prepare('SELECT * FROM event WHERE id = ? AND location_id = ?')
    .get(eventId, locationId) as EventRow | undefined;
}

export function eventsForLocation(locationId: string) {
  return db
    .prepare('SELECT * FROM event WHERE location_id = ? ORDER BY event_date DESC, show_name')
    .all(locationId) as EventRow[];
}

export interface EventRow {
  id: string; location_id: string; show_type: string; show_type_id: string;
  contract_service: string; event_date: string;
  show_name: string; guest_attendance: number | null;
  gratuity_cents: number; cash_cents: number; square_cents: number;
  total_override_cents: number | null;
  cast_share_percent: number; office_hours: number; odd_cent_to: string;
  status: string; created_at: string;
}
export interface CastRow {
  id: string; event_id: string; name: string; ratio: number;
  worked: number; technical: number; sort: number;
}
export interface StaffRowDb {
  id: string; event_id: string; name: string; section: string; hours: number;
  included: number; note: string; square_timecard_id: string | null;
  source: string; overridden: number; sort: number;
}
