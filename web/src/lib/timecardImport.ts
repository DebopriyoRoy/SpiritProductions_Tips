import ExcelJS from 'exceljs';

export interface ImportedRow {
  name: string;
  hours: number;
  /** Hours as the sheet gave them, before the 8-hour cap. */
  rawHours: number;
  capped: boolean;
  date: string | null;
  jobTitle: string | null;
}

export interface ImportResult {
  rows: ImportedRow[];
  /** Header text of the columns actually used, for the report. */
  columns: { name: string; hours: string; date: string | null };
  skippedNoName: number;
  skippedOtherDate: number;
  warnings: string[];
}

/** A shift longer than this is treated as a mis-punch and trimmed. */
export const HOURS_CAP = 8;

const norm = (v: unknown) =>
  String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Square names its export columns differently across reports, so match loosely. */
const NAME_KEYS  = ['team member', 'employee', 'name', 'worker', 'staff'];
const FIRST_KEYS = ['first name', 'given name', 'first'];
const LAST_KEYS  = ['last name', 'family name', 'surname', 'last'];
const HOUR_KEYS  = ['regular hours', 'total hours', 'hours worked', 'hours', 'reg hrs', 'paid hours'];
const DATE_KEYS  = ['date', 'shift date', 'business date', 'clock-in', 'clock in', 'start date', 'start'];
const JOB_KEYS   = ['job title', 'job', 'role', 'wage title', 'position'];

const findCol = (headers: string[], keys: string[]) => {
  for (const k of keys) {
    const i = headers.findIndex((h) => h === k);
    if (i >= 0) return i;
  }
  for (const k of keys) {
    const i = headers.findIndex((h) => h.includes(k));
    if (i >= 0) return i;
  }
  return -1;
};

/** Accepts a Date, an Excel serial, or most written forms. */
function toISODate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.valueOf())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel serial: days since 1899-12-30
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  return isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

/** "7:30" and "7h 30m" appear in some exports alongside plain decimals. */
function toHours(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const hm = s.match(/^(\d+)\s*[:h]\s*(\d{1,2})/i);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads a Square timecard export. The column layout is not fixed, so headers
 * are matched loosely and the ones used are reported back rather than assumed.
 */
export async function parseTimecardWorkbook(
  buffer: ArrayBuffer, eventDate: string,
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('That file has no sheets in it.');

  // The header is not always row 1 — some exports carry a title block first.
  let headerRow = -1;
  let headers: string[] = [];
  for (let r = 1; r <= Math.min(ws.rowCount, 25); r++) {
    const cells = (ws.getRow(r).values as unknown[]).slice(1).map(norm);
    if (cells.some((c) => HOUR_KEYS.some((k) => c.includes(k)))
        && cells.some((c) => [...NAME_KEYS, ...LAST_KEYS, ...FIRST_KEYS].some((k) => c.includes(k)))) {
      headerRow = r; headers = cells; break;
    }
  }
  if (headerRow < 0) {
    throw new Error(
      'Could not find a header row with a name column and an hours column. ' +
      'Export the timecard report from Square with column headings included.');
  }

  const cName  = findCol(headers, NAME_KEYS);
  const cFirst = findCol(headers, FIRST_KEYS);
  const cLast  = findCol(headers, LAST_KEYS);
  const cHours = findCol(headers, HOUR_KEYS);
  const cDate  = findCol(headers, DATE_KEYS);
  const cJob   = findCol(headers, JOB_KEYS);

  if (cHours < 0) throw new Error('No hours column found in that file.');
  if (cName < 0 && cLast < 0) throw new Error('No name column found in that file.');

  const warnings: string[] = [];
  if (cDate < 0) {
    warnings.push(
      'That file has no date column, so every row in it was applied to this show.');
  }

  const rows: ImportedRow[] = [];
  let skippedNoName = 0, skippedOtherDate = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const v = (ws.getRow(r).values as unknown[]).slice(1);
    if (v.every((c) => c == null || String(c).trim() === '')) continue;

    let name = cName >= 0 ? String(v[cName] ?? '').trim() : '';
    if (!name && (cLast >= 0 || cFirst >= 0)) {
      name = [v[cLast], v[cFirst]].filter(Boolean).map(String).join(', ').trim();
    }
    if (!name) { skippedNoName++; continue; }
    if (/^total/i.test(name)) continue;   // export footers

    const date = cDate >= 0 ? toISODate(v[cDate]) : null;
    if (cDate >= 0 && date && date !== eventDate) { skippedOtherDate++; continue; }

    const raw = toHours(v[cHours]);
    if (raw == null) continue;

    const hours = Math.min(Math.round(raw * 100) / 100, HOURS_CAP);
    rows.push({
      name,
      hours,
      rawHours: Math.round(raw * 100) / 100,
      capped: raw > HOURS_CAP,
      date,
      jobTitle: cJob >= 0 ? String(v[cJob] ?? '').trim() || null : null,
    });
  }

  return {
    rows,
    columns: {
      name: cName >= 0 ? headers[cName] : `${headers[cLast]} + ${headers[cFirst]}`,
      hours: headers[cHours],
      date: cDate >= 0 ? headers[cDate] : null,
    },
    skippedNoName,
    skippedOtherDate,
    warnings,
  };
}

/** Loose match so "Pynn Jackie", "Jackie Pynn" and "pynn, jackie" all agree. */
export function nameKey(s: string): string {
  return s.toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // drop "(Marsh)", "(Boomer)" and the like
    .replace(/['\u2019]/g, '')        // O'Reilly and OReilly are one person
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}
