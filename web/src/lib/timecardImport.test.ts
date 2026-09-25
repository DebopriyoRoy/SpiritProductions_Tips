import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseTimecard, parseDelimited, sniffFormat, toISODate, toHours,
  nameKey, sectionFromJobTitle, suggestName, HOURS_CAP,
} from './timecardImport';

const buf = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

const CSV = [
  'Team Member,Job Title,Date,Regular Hours',
  '"O\'Reilly, Colleen",Bartender,09/24/2026,12.5',
  '"Pynn, Jackie",Server,09/24/2026,7:18',
  '"Gordon, Daniel",Server,09/24/2026,5',
  '"Nobody, At All",Server,09/24/2026,4',
  '"Dickson, Joleen",Bartender,09/23/2026,6',
  'Total,,,35.8',
].join('\n');

describe('CSV timecards', () => {
  it('reads a comma-separated export', async () => {
    const r = await parseTimecard(buf(CSV), '2026-09-24', 'timecard.csv');
    expect(r.format).toBe('CSV');
    expect(r.rows.map((x) => x.name)).toEqual([
      "O'Reilly, Colleen", 'Pynn, Jackie', 'Gordon, Daniel', 'Nobody, At All',
    ]);
  });

  it('caps a long shift at the 8-hour mark and says it did', async () => {
    const r = await parseTimecard(buf(CSV), '2026-09-24');
    const colleen = r.rows[0];
    expect(colleen.hours).toBe(HOURS_CAP);
    expect(colleen.rawHours).toBe(12.5);
    expect(colleen.capped).toBe(true);
  });

  it('reads "7:18" as 7.3 hours', async () => {
    const r = await parseTimecard(buf(CSV), '2026-09-24');
    expect(r.rows[1].hours).toBe(7.3);
    expect(r.rows[1].capped).toBe(false);
  });

  it('leaves other dates alone and drops the footer total', async () => {
    const r = await parseTimecard(buf(CSV), '2026-09-24');
    expect(r.skippedOtherDate).toBe(1);
    expect(r.rows.some((x) => /^total/i.test(x.name))).toBe(false);
  });

  it('reports the columns it actually used', async () => {
    const r = await parseTimecard(buf(CSV), '2026-09-24');
    expect(r.columns).toEqual({
      name: 'team member', hours: 'regular hours', date: 'date',
    });
  });

  it('keeps a quoted comma inside one field', () => {
    const g = parseDelimited('a,"b,c",d\n', ',');
    expect(g[0]).toEqual(['a', 'b,c', 'd']);
  });

  it('understands a doubled quote inside a quoted field', () => {
    const g = parseDelimited('"say ""hi""",2\n', ',');
    expect(g[0]).toEqual(['say "hi"', '2']);
  });

  it('reads tab-separated text too', async () => {
    const tsv = 'Employee\tDate\tHours\nPynn Jackie\t2026-09-24\t6\n';
    const r = await parseTimecard(buf(tsv), '2026-09-24');
    expect(r.format).toBe('tab-separated text');
    expect(r.rows[0].hours).toBe(6);
  });

  it('finds the header under a title block', async () => {
    const csv = 'Spirit Theater\nTimecards report\n\n' +
      'Team Member,Date,Total Hours\nGordon Daniel,2026-09-24,5\n';
    const r = await parseTimecard(buf(csv), '2026-09-24');
    expect(r.rows).toHaveLength(1);
  });

  it('builds a name from separate first and last columns', async () => {
    const csv = 'Last Name,First Name,Date,Hours\nPynn,Jackie,2026-09-24,6\n';
    const r = await parseTimecard(buf(csv), '2026-09-24');
    expect(nameKey(r.rows[0].name)).toBe(nameKey('Jackie Pynn'));
  });

  it('applies every row when the export carries no date column', async () => {
    const csv = 'Team Member,Hours\nGordon Daniel,5\n';
    const r = await parseTimecard(buf(csv), '2026-09-24');
    expect(r.rows).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/no date column/i);
  });

  it('names the header it did find when there is no usable one', async () => {
    await expect(parseTimecard(buf('a,b\n1,2\n'), '2026-09-24'))
      .rejects.toThrow(/Could not find a header row/);
  });
});

describe('format sniffing', () => {
  it('spots a zip-backed xlsx by its leading bytes', () => {
    const b = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]).buffer;
    expect(sniffFormat(b)).toBe('xlsx');
  });

  it('spots an old binary .xls and explains the way out', async () => {
    const b = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer;
    expect(sniffFormat(b)).toBe('xls');
    await expect(parseTimecard(b, '2026-09-24', 'old.xls'))
      .rejects.toThrow(/Save As/i);
  });

  it('treats anything else as text', () => {
    expect(sniffFormat(buf('Team Member,Hours\n'))).toBe('text');
  });
});

describe('real .xlsx still reads', () => {
  it('parses a workbook through the same path', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Timecards');
    ws.addRow(['Team Member', 'Date', 'Regular Hours']);
    ws.addRow(['O’Reilly Colleen', new Date(Date.UTC(2026, 8, 24)), 12.5]);
    ws.addRow(['Pynn Jackie', new Date(Date.UTC(2026, 8, 24)), 7.3]);
    const out = await wb.xlsx.writeBuffer();

    const r = await parseTimecard(out as ArrayBuffer, '2026-09-24', 't.xlsx');
    expect(r.format).toBe('Excel workbook');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].hours).toBe(HOURS_CAP);
  });
});

describe('value coercion', () => {
  it('reads M/D/YYYY without shifting the day by a timezone', () => {
    expect(toISODate('09/24/2026')).toBe('2026-09-24');
    expect(toISODate('1/2/26')).toBe('2026-01-02');
  });

  it('reads an ISO timestamp down to its date', () => {
    expect(toISODate('2026-09-24 18:00:00')).toBe('2026-09-24');
  });

  it('reads an Excel serial', () => {
    expect(toISODate(46289)).toBe('2026-09-24');
  });

  it('returns null rather than guessing at nonsense', () => {
    expect(toISODate('not a date')).toBeNull();
    expect(toHours('')).toBeNull();
    expect(toHours('-')).toBeNull();
  });

  it('reads hours written several ways', () => {
    expect(toHours('7.5')).toBe(7.5);
    expect(toHours('7:30')).toBe(7.5);
    expect(toHours('7h 30m')).toBe(7.5);
    expect(toHours(6)).toBe(6);
  });
});

describe('name matching', () => {
  it('agrees across ordering, punctuation and nicknames', () => {
    const k = nameKey("O'Reilly, Colleen");
    expect(nameKey('Colleen OReilly')).toBe(k);
    expect(nameKey('O’Reilly Colleen')).toBe(k);
    expect(nameKey('Marsh (Boomer) Marsh')).toBe(nameKey('Marsh Marsh'));
  });

  it('keeps two people with a shared surname apart', () => {
    expect(nameKey('Pynn Jackie')).not.toBe(nameKey('Pynn Morgan'));
  });
});

describe('date mismatch', () => {
  const csv = 'Last Name,First Name,Clockin Date,Regular Hours\n' +
    'Pynn,Jackie,08/28/2026,6\nGordon,Daniel,08/28/2026,5\n';

  it('reports the dates the file actually carries', async () => {
    const r = await parseTimecard(buf(csv), '2026-08-26');
    expect(r.rows).toHaveLength(0);
    expect(r.skippedOtherDate).toBe(2);
    expect(r.datesSeen).toEqual(['2026-08-28']);
  });

  it('takes every row when the date filter is turned off', async () => {
    const r = await parseTimecard(buf(csv), '2026-08-26', '', { ignoreDates: true });
    expect(r.rows).toHaveLength(2);
    expect(r.dateFilterIgnored).toBe(true);
  });

  it('builds names from split columns on a real-shaped header', async () => {
    const r = await parseTimecard(buf(csv), '2026-08-28');
    expect(r.columns.name).toBe('last name + first name');
    expect(r.columns.date).toBe('clockin date');
    expect(nameKey(r.rows[0].name)).toBe(nameKey('Jackie Pynn'));
  });
});


/**
 * The column layout of a real Square timecard export, kept verbatim so a
 * change to the reader has to keep working against the actual file.
 */
const SQUARE = [
  'Employee number,First name,Last name,Job title,Location,Clockin date,' +
  'Clockin time,Clockout date,Clockout time,Regular hours,Overtime hours,' +
  'Total paid hours,Hourly wage',
  ',Bridget,Hillier,Server Manager,Spirit Theatre,8/28/26,8:30:00 AM,8/28/26,4:42:05 PM,5.78,2.42,8.2,CA$22.50',
  'Colleen,Colleen,O\'Reilly,Chef,Spirit Theatre,8/28/26,11:55:16 AM,8/28/26,8:00:00 PM,8.08,0,8.08,CA$16.25',
  ',Daniel,Gordon,Bartender,Spirit Theatre,8/28/26,5:47:53 PM,8/28/26,10:47:56 PM,5,0,5,CA$16.25',
  '"Bartender,Server",Jackie,Pynn,Service,Spirit Theatre,8/28/26,4:13:12 PM,8/28/26,9:34:56 PM,5.35,0,5.35,CA$16.25',
  ',Khrystyna,Zavadetska,Busser,Spirit Theatre,8/28/26,5:55:11 PM,8/28/26,9:28:10 PM,3.55,0,3.55,CA$16.25',
  ',Yana,Pasechniuk,50/50,Spirit Theatre,8/28/26,5:31:46 PM,8/28/26,9:29:02 PM,3.97,0,3.97,CA$0.00',
  'Total,,,,,,,,,79.85,9.3,89.15,',
].join('\n');

describe('a real Square export', () => {
  it('reads it, ignoring the odd Employee number column', async () => {
    const r = await parseTimecard(buf(SQUARE), '2026-08-28', 'square.csv');
    expect(r.columns.name).toBe('last name + first name');
    expect(r.columns.hours).toBe('regular hours');
    expect(r.columns.date).toBe('clockin date');
    expect(r.rows).toHaveLength(6);
  });

  it('reads 8/28/26 as 2026-08-28', async () => {
    const r = await parseTimecard(buf(SQUARE), '2026-08-28');
    expect(r.datesSeen).toEqual(['2026-08-28']);
  });

  it('takes Regular hours, not Total paid hours', async () => {
    const r = await parseTimecard(buf(SQUARE), '2026-08-28');
    const bridget = r.rows.find((x) => /Hillier/.test(x.name))!;
    expect(bridget.rawHours).toBe(5.78);   // not 8.2
  });

  it('keeps a quoted comma in the Employee number column from shifting rows', async () => {
    const r = await parseTimecard(buf(SQUARE), '2026-08-28');
    const jackie = r.rows.find((x) => /Pynn/.test(x.name))!;
    expect(jackie.hours).toBe(5.35);
    expect(jackie.jobTitle).toBe('Service');
  });

  it('drops the Total footer row', async () => {
    const r = await parseTimecard(buf(SQUARE), '2026-08-28');
    expect(r.rows.some((x) => /^total/i.test(x.name))).toBe(false);
  });
});

describe('job title to section', () => {
  it('puts a 50/50 shift on the 50/50 roster', () => {
    expect(sectionFromJobTitle('50/50')).toBe('FIFTY_FIFTY');
  });

  it('reads Server Manager as a server, not a manager', () => {
    expect(sectionFromJobTitle('Server Manager')).toBe('SERVICE');
  });

  it('maps the titles this export actually uses', () => {
    expect(sectionFromJobTitle('Bartender')).toBe('BAR');
    expect(sectionFromJobTitle('Chef')).toBe('KITCHEN');
    expect(sectionFromJobTitle('Kitchen')).toBe('KITCHEN');
    expect(sectionFromJobTitle('Busser')).toBe('SERVICE');
    expect(sectionFromJobTitle('Service')).toBe('SERVICE');
  });

  it('admits it does not know, rather than guessing', () => {
    expect(sectionFromJobTitle('Team Member')).toBeNull();
    expect(sectionFromJobTitle('')).toBeNull();
    expect(sectionFromJobTitle(null)).toBeNull();
  });
});

describe('suggesting a near-miss name', () => {
  const roster = ['Kachensseva Mariia (Marsh)', 'Pynn Jackie', 'Gordon Daniel'];

  it('spots a spelling drift between Square and the roster', () => {
    expect(suggestName('Kashentseva, Mariia', roster))
      .toBe('Kachensseva Mariia (Marsh)');
  });

  it('stays quiet when nobody is close', () => {
    expect(suggestName('Nobody Whatsoever', roster)).toBeNull();
  });

  it('never suggests one real person for another', () => {
    expect(suggestName('Pynn Morgan', ['Pynn Jackie'])).toBeNull();
  });
});
