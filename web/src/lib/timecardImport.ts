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
  /** "Excel workbook" or "CSV", so the report can say what was read. */
  format: string;
  skippedNoName: number;
  skippedOtherDate: number;
  warnings: string[];
}

/** A shift longer than this is treated as a mis-punch and trimmed. */
export const HOURS_CAP = 8;

/** One row of cells, as read from either format. Excel keeps Date/number. */
type Grid = unknown[][];

const norm = (v: unknown) =>
  String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Square names its export columns differently across reports, so match loosely. */
const NAME_KEYS  = ['team member', 'employee', 'name', 'worker', 'staff'];
const FIRST_KEYS = ['first name', 'given name', 'first'];
const LAST_KEYS  = ['last name', 'family name', 'surname', 'last'];
const HOUR_KEYS  = [
  'regular hours', 'total hours', 'hours worked', 'reg hrs', 'paid hours',
  'declared hours', 'hours',
];
const DATE_KEYS  = ['date', 'shift date', 'business date', 'clock-in', 'clock in', 'start date', 'start'];
const JOB_KEYS   = ['job title', 'job', 'role', 'wage title', 'position'];

const findCol = (headers: string[], keys: string[], exclude: number[] = []) => {
  const ok = (i: number) => i >= 0 && !exclude.includes(i);
  for (const k of keys) {
    const i = headers.findIndex((h, j) => h === k && !exclude.includes(j));
    if (ok(i)) return i;
  }
  for (const k of keys) {
    const i = headers.findIndex((h, j) => h.includes(k) && !exclude.includes(j));
    if (ok(i)) return i;
  }
  return -1;
};

/* ------------------------------------------------------------------ *
 * Reading the two file shapes into one grid
 * ------------------------------------------------------------------ */

/**
 * Splits delimited text. Written out rather than pulled from a library
 * because Square quotes any field holding a comma — "Pynn, Jackie" is one
 * cell, not two — and a naive split silently shifts every later column.
 */
export function parseDelimited(text: string, delimiter: string): Grid {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  return rows.map((r) => r.map((c) => c.trim()));
}

/** Square exports comma-separated; other tools hand back tabs or semicolons. */
function sniffDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = [',', '\t', ';'].map((d) => ({
    d, n: (head.match(new RegExp(`\\${d}`, 'g')) || []).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

async function gridFromWorkbook(buffer: ArrayBuffer): Promise<Grid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('That workbook has no sheets in it.');

  const grid: Grid = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const values = ws.getRow(r).values as unknown[];
    // ExcelJS indexes cells from 1 and leaves index 0 empty.
    grid.push(values.slice(1).map((c) => cellValue(c)));
  }
  return grid;
}

/** ExcelJS wraps formulas, hyperlinks and rich text; unwrap to the plain value. */
function cellValue(c: unknown): unknown {
  if (c == null) return null;
  if (c instanceof Date) return c;
  if (typeof c === 'object') {
    const o = c as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if ('text' in o) return o.text;
    if ('richText' in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((t) => t.text).join('');
    }
  }
  return c;
}

/**
 * Decides what the uploaded bytes actually are. The extension is a hint and
 * not a promise — a file named .xls from Square is usually CSV — so the
 * leading bytes decide.
 */
export function sniffFormat(buffer: ArrayBuffer): 'xlsx' | 'xls' | 'text' {
  const b = new Uint8Array(buffer.slice(0, 8));
  if (b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';                  // PK zip
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls';
  return 'text';
}

function decodeText(buffer: ArrayBuffer): string {
  const b = new Uint8Array(buffer);
  // Excel writes UTF-16LE with a BOM when you "Save as Unicode Text".
  if (b[0] === 0xff && b[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer).slice(1);
  }
  return new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '');
}

/* ------------------------------------------------------------------ *
 * Value coercion
 * ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');

/** Accepts a Date, an Excel serial, or most written forms. */
export function toISODate(v: unknown): string | null {
  if (v == null || v === '') return null;

  // ExcelJS hands back dates as UTC midnight, so read them in UTC.
  if (v instanceof Date && !isNaN(v.valueOf())) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const s = String(v).trim();

  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;

  // Square's North American exports write M/D/YYYY. Build the date from the
  // parts rather than through Date, which would shift it by the server's
  // timezone and land the row on the day before.
  const mdy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (mdy) {
    const year = +mdy[3] < 100 ? 2000 + +mdy[3] : +mdy[3];
    return `${year}-${pad(+mdy[1])}-${pad(+mdy[2])}`;
  }

  const d = new Date(s);
  if (isNaN(d.valueOf())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "7:30" and "7h 30m" appear in some exports alongside plain decimals. */
export function toHours(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const s = String(v).trim();
  if (s === '' || s === '-' || s === '--') return null;

  const hm = s.match(/^(\d+)\s*[:h]\s*(\d{1,2})/i);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;

  const n = Number(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && s.match(/\d/) ? n : null;
}

/* ------------------------------------------------------------------ *
 * The parse
 * ------------------------------------------------------------------ */

/**
 * Reads a Square timecard export, in either Excel or CSV form. The column
 * layout is not fixed across Square's reports, so headers are matched
 * loosely and the ones used are reported back rather than assumed.
 */
export async function parseTimecard(
  buffer: ArrayBuffer, eventDate: string, filename = '',
): Promise<ImportResult> {
  const kind = sniffFormat(buffer);

  if (kind === 'xls') {
    throw new Error(
      'That is an old-style .xls file, which cannot be read directly. ' +
      'Open it and use File → Save As to save it as .xlsx or .csv, ' +
      'then upload that.');
  }

  let grid: Grid;
  let format: string;

  if (kind === 'xlsx') {
    grid = await gridFromWorkbook(buffer);
    format = 'Excel workbook';
  } else {
    const text = decodeText(buffer);
    if (text.trim() === '') throw new Error('That file is empty.');
    // A mislabelled file lands here too; say so plainly rather than
    // producing nonsense rows out of binary.
    if (/\u0000/.test(text.slice(0, 4096))) {
      throw new Error(
        `Could not read ${filename || 'that file'}: it is neither a .xlsx ` +
        'workbook nor text. Re-export it from Square as CSV or Excel.');
    }
    const delimiter = sniffDelimiter(text);
    grid = parseDelimited(text, delimiter);
    format = delimiter === '\t' ? 'tab-separated text' : 'CSV';
  }

  // The header is not always the first row — some exports carry a title block.
  let headerRow = -1;
  let headers: string[] = [];
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const cells = grid[r].map(norm);
    const hasHours = cells.some((c) => HOUR_KEYS.some((k) => c.includes(k)));
    const hasName  = cells.some((c) =>
      [...NAME_KEYS, ...LAST_KEYS, ...FIRST_KEYS].some((k) => c.includes(k)));
    if (hasHours && hasName) { headerRow = r; headers = cells; break; }
  }
  if (headerRow < 0) {
    const seen = grid.slice(0, 3)
      .map((r) => r.filter((c) => String(c ?? '').trim() !== '').join(' | '))
      .filter(Boolean)[0];
    throw new Error(
      'Could not find a header row with a name column and an hours column. ' +
      'Export the timecard report from Square with column headings included.' +
      (seen ? ` The first row read was: ${seen.slice(0, 160)}` : ''));
  }

  // Find the split columns first: "last name" contains "name", so a search
  // for a combined column would otherwise match the surname and quietly
  // drop everyone's first name.
  const cFirst = findCol(headers, FIRST_KEYS);
  const cLast  = findCol(headers, LAST_KEYS);
  const cName  = cFirst >= 0 && cLast >= 0
    ? -1
    : findCol(headers, NAME_KEYS, [cFirst, cLast].filter((i) => i >= 0));
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

  for (let r = headerRow + 1; r < grid.length; r++) {
    const v = grid[r];
    if (v.every((c) => c == null || String(c).trim() === '')) continue;

    let name = cName >= 0 ? String(v[cName] ?? '').trim() : '';
    if (!name && (cLast >= 0 || cFirst >= 0)) {
      name = [v[cLast], v[cFirst]].filter(Boolean).map(String).join(', ').trim();
    }
    if (!name) { skippedNoName++; continue; }
    if (/^totals?\b/i.test(name)) continue;   // export footers

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
      name: cName >= 0 ? headers[cName]
                       : `${headers[cLast] ?? ''} + ${headers[cFirst] ?? ''}`,
      hours: headers[cHours],
      date: cDate >= 0 ? headers[cDate] : null,
    },
    format,
    skippedNoName,
    skippedOtherDate,
    warnings,
  };
}

/** Kept so existing callers and tests that name the workbook path still work. */
export const parseTimecardWorkbook = parseTimecard;

/** Loose match so "Pynn Jackie", "Jackie Pynn" and "pynn, jackie" all agree. */
export function nameKey(s: string): string {
  return s.toLowerCase()
    .replace(/\(.*?\)/g, ' ')        // drop "(Marsh)", "(Boomer)" and the like
    .replace(/['’]/g, '')        // O'Reilly and OReilly are one person
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}
