import ExcelJS from 'exceljs';
import { Result, SECTION_LABEL, Section } from './tips';
import { fmt } from './money';

const MONEY = '#,##0.00;(#,##0.00);"-"';
const HOURS = '0.00';

export interface ExportMeta {
  locationName: string;
  showType: string;
  showName: string;
  eventDate: string;
  guestAttendance: number | null;
  /** Private shows only. */
  contractService?: string;
  /** Private shows have no cast block. */
  hasCast: boolean;
  /** Only these sections, in this order. */
  sections: Section[];
  formula: string;
  /** A night with only screech-in: written as the small screech-in sheet. */
  screechOnly?: boolean;
  sageRef?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept',
  'Oct', 'Nov', 'Dec'];

/**
 * The tab name the fortnightly tips workbook uses for a night, such as
 * "Sept-08-2026", so a downloaded sheet can be dropped straight into it.
 */
export function sheetNameForDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const month = MONTHS[Number(m) - 1];
  return month && d && y ? `${month}-${d}-${y}` : 'Tips';
}

export async function buildWorkbook(r: Result, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spirit Tips';
  const ws = wb.addWorksheet(sheetNameForDate(meta.eventDate));

  ws.columns = [
    { width: 40 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 14 },
  ];

  const title = (t: string) => {
    const row = ws.addRow([t]);
    row.font = { name: 'Arial', size: 14, bold: true };
    return row;
  };
  const label = (a: string, b?: any, fmtStr?: string) => {
    const row = ws.addRow([a, b]);
    row.font = { name: 'Arial', size: 10 };
    if (fmtStr) row.getCell(2).numFmt = fmtStr;
    return row;
  };

  const header = (cols: string[]) => {
    const row = ws.addRow(cols);
    row.font = { name: 'Arial', size: 10, bold: true };
    row.alignment = { horizontal: 'center' };
    row.getCell(1).alignment = { horizontal: 'left' };
    return row;
  };

  // The workbook shades each screech-in's heading, alternating two colours.
  const SCREECH_FILLS: Partial<ExcelJS.Color>[] = [
    { theme: 2, tint: -0.249977111117893 } as Partial<ExcelJS.Color>,
    { theme: 3, tint: 0.5999938962981048 } as Partial<ExcelJS.Color>,
  ];

  const screechBlock = () => {
    // As the workbook lays it out: each screech-in's tips on its own shaded
    // line, a gap, then each host and helper with what they receive.
    for (const [n, s] of r.screech.entries()) {
      if (n > 0) ws.addRow([]);
      const head = ws.addRow([`Screech-In ${n + 1}`, '', '', '', s.tipsCents / 100]);
      head.font = { name: 'Arial', size: 10, bold: true };
      head.getCell(5).numFmt = MONEY;
      head.getCell(1).fill = {
        type: 'pattern', pattern: 'solid', fgColor: SCREECH_FILLS[n % 2],
      };
      ws.addRow([]);
      for (const h of s.hosts) {
        const row = ws.addRow([h.helper ? `${h.name} (Helper)` : h.name, '', '', '',
          h.amountCents / 100]);
        row.font = { name: 'Arial', size: 10 };
        row.getCell(5).numFmt = MONEY;
      }
      if (s.unallocatedCents > 0) {
        label('UNALLOCATED (no host)', s.unallocatedCents / 100, MONEY);
      }
    }
  };

  if (meta.screechOnly) {
    ws.getColumn(4).width = 6.33;
    ws.getColumn(5).width = 21.66;
    label('Event', 'Screech - IN').font = { name: 'Arial', size: 10, bold: true };
    label('Date', meta.eventDate);
    ws.addRow([]);
    header(['Person Name', '', '', '', 'Amount Receivable']);
    ws.addRow([]);
    screechBlock();
    ws.addRow([]);
    const t = ws.addRow(['TOTAL', '', '', '', r.screechTotalCents / 100]);
    t.font = { name: 'Arial', size: 10, bold: true };
    t.getCell(5).numFmt = MONEY;
    if (r.warnings.length) {
      ws.addRow([]);
      for (const w of r.warnings) ws.addRow([w]).font = { name: 'Arial', size: 10, italic: true };
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  title(`${meta.locationName} — ${meta.showType}`);
  label('Show', meta.showName);
  label('Date', meta.eventDate);
  if (meta.contractService) {
    label('Service requested as per contract', meta.contractService);
  }
  if (meta.guestAttendance != null) label('Guest attendance', meta.guestAttendance);
  if (meta.sageRef) label('Sage ref', meta.sageRef);
  label('Total Tips Collected', r.totalCents / 100, MONEY);
  if (r.lateSplitCents > 0) {
    label('  of which late tips, re-split', r.lateSplitCents / 100, MONEY);
  }
  ws.addRow([]);

  label('Logic for calculation of Tips', meta.formula);
  ws.addRow([]);

  if (meta.hasCast) {
    label('Cast & Musicians pool', r.castPoolCents / 100, MONEY);
    label('Cast shares worked', r.castWorkedRatioTotal, HOURS);
    label('Cast rate per share', r.castRatePerShare, '#,##0.000000');
  }
  label('Staff pool', r.staffPoolCents / 100, MONEY);
  label('Staff total tipping hours', r.staffHoursTotal, HOURS);
  label('Staff rate per hour', r.staffRatePerHour, '#,##0.000000');
  ws.addRow([]);


  // ---- Cast (public shows only) ----
  if (meta.hasCast) {
  title('Cast & Musicians');
  header(['Name', 'Hand-set', 'Ratio', 'Worked', 'Amount']);
  for (const c of r.cast) {
    const row = ws.addRow([
      c.technical ? `${c.name} (Technical)` : c.name,
      // A hand-set payout is a decision someone made, so it travels with the
      // sheet along with the figure it replaced.
      c.pinned ? `set by hand (pool: ${fmt(c.calculatedCents)})` : '',
      c.ratio, c.worked ? 1 : 0, c.amountCents / 100,
    ]);
    row.font = { name: 'Arial', size: 10 };
    row.getCell(5).numFmt = MONEY;
  }
  const castTotal = ws.addRow(['Cast & Musicians Total', '', '', '', r.castPoolCents / 100]);
  castTotal.font = { name: 'Arial', size: 10, bold: true };
  castTotal.getCell(5).numFmt = MONEY;
  ws.addRow([]);
  }

  // ---- Staff by section ----
  for (const section of meta.sections) {
    const rows = r.staff.filter((s) => s.section === section);
    if (rows.length === 0) continue;
    title(SECTION_LABEL[section]);
    header(['Name', 'Hours', 'Hand-set', '', 'Amount']);
    for (const s of rows) {
      const row = ws.addRow([
        s.name, s.hours,
        s.pinned ? `set by hand (pool: ${fmt(s.calculatedCents)})` : '',
        '', s.amountCents / 100,
      ]);
      row.font = { name: 'Arial', size: 10 };
      row.getCell(2).numFmt = HOURS;
      row.getCell(5).numFmt = MONEY;
    }
    const t = r.sectionTotals.find((x) => x.section === section)!;
    const tr = ws.addRow([`${SECTION_LABEL[section]} Total`, t.hours, '', '', t.amountCents / 100]);
    tr.font = { name: 'Arial', size: 10, bold: true };
    tr.getCell(2).numFmt = HOURS;
    tr.getCell(5).numFmt = MONEY;
    ws.addRow([]);
  }

  // ---- Reconciliation ----
  title('Reconciliation');
  if (meta.hasCast) {
    label('Cast & Musicians total', r.castPoolCents / 100, MONEY);
  }
  label('Staff total', r.staffPoolCents / 100, MONEY);
  if (r.unallocatedCents > 0) {
    label('UNALLOCATED (not paid out)', r.unallocatedCents / 100, MONEY);
  }
  label('Total tips collected', r.totalCents / 100, MONEY);
  const chk = label('CHECK (must be 0.00)', r.reconciliationCents / 100, '0.00');
  chk.font = { name: 'Arial', size: 10, bold: true };
  ws.addRow([]);

  // ---- Per person across sections ----
  title('Payout per person (aggregated across sections)');
  header(['Name', 'Hours', '', 'Sections', 'Amount']);
  for (const p of r.perPerson) {
    const row = ws.addRow([p.name, p.hours || '', '', p.parts.join(' + '), p.amountCents / 100]);
    row.font = { name: 'Arial', size: 10 };
    row.getCell(2).numFmt = HOURS;
    row.getCell(5).numFmt = MONEY;
  }
  const grand = ws.addRow([
    'TOTAL',
    // Cast carry no hours, so this is the staff hours the pool was split by.
    // Rounded, or the float sum stores as 60.309999999999995 behind the format.
    Math.round(r.perPerson.reduce((a, b) => a + b.hours, 0) * 100) / 100,
    '', '',
    r.perPerson.reduce((a, b) => a + b.amountCents, 0) / 100,
  ]);
  grand.font = { name: 'Arial', size: 10, bold: true };
  grand.getCell(2).numFmt = HOURS;
  grand.getCell(5).numFmt = MONEY;

  // ---- Late tips, then screech-in, then each person's whole night ----
  if (r.lateSplitCents > 0 || r.latePersonal.length) {
    ws.addRow([]);
    title('Late tips');
    if (r.lateSplitCents > 0) {
      label('Re-split with the show (included above)', r.lateSplitCents / 100, MONEY);
    }
    for (const t of r.latePersonal) {
      const row = ws.addRow([t.name, '', t.sageRef ? `Sage ${t.sageRef}` : '',
        t.description, t.amountCents / 100]);
      row.font = { name: 'Arial', size: 10 };
      row.getCell(5).numFmt = MONEY;
    }
  }
  if (r.screech.length) {
    ws.addRow([]);
    title('Screech - IN');
    screechBlock();
  }
  const extra = r.personTotals.filter((p) => p.screechCents || p.lateCents);
  if (extra.length) {
    ws.addRow([]);
    for (const p of extra) {
      const row = ws.addRow([`Total for ${p.name}`, '', '', '', p.totalCents / 100]);
      row.font = { name: 'Arial', size: 10, bold: true };
      row.getCell(5).numFmt = MONEY;
    }
    ws.addRow([]);
    const g = label('Paid out tonight (show + screech-in + late tips)',
      r.grandTotalCents / 100, MONEY);
    g.font = { name: 'Arial', size: 10, bold: true };
  }

  if (r.warnings.length) {
    ws.addRow([]);
    title('Warnings');
    for (const w of r.warnings) {
      ws.addRow([w]).font = { name: 'Arial', size: 10, italic: true };
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { fmt };
