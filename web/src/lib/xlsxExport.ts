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
}

export async function buildWorkbook(r: Result, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spirit Tips';
  const ws = wb.addWorksheet(meta.showType.slice(0, 30) || 'Tips');

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

  title(`${meta.locationName} — ${meta.showType}`);
  label('Show', meta.showName);
  label('Date', meta.eventDate);
  if (meta.guestAttendance != null) label('Guest attendance', meta.guestAttendance);
  label('Total Tips Collected', r.totalCents / 100, MONEY);
  ws.addRow([]);

  label('Cast & Musicians pool', r.castPoolCents / 100, MONEY);
  label('Cast shares worked', r.castWorkedRatioTotal, HOURS);
  label('Cast rate per share', r.castRatePerShare, '#,##0.000000');
  label('Staff pool', r.staffPoolCents / 100, MONEY);
  label('Staff total tipping hours', r.staffHoursTotal, HOURS);
  label('Staff rate per hour', r.staffRatePerHour, '#,##0.000000');
  ws.addRow([]);

  const header = (cols: string[]) => {
    const row = ws.addRow(cols);
    row.font = { name: 'Arial', size: 10, bold: true };
    row.alignment = { horizontal: 'center' };
    row.getCell(1).alignment = { horizontal: 'left' };
    return row;
  };

  // ---- Cast ----
  title('Cast & Musicians');
  header(['Name', '', 'Ratio', 'Worked', 'Amount']);
  for (const c of r.cast) {
    const row = ws.addRow([
      c.technical ? `${c.name} (Technical)` : c.name, '', c.ratio,
      c.worked ? 1 : 0, c.amountCents / 100,
    ]);
    row.font = { name: 'Arial', size: 10 };
    row.getCell(5).numFmt = MONEY;
  }
  const castTotal = ws.addRow(['Cast & Musicians Total', '', '', '', r.castPoolCents / 100]);
  castTotal.font = { name: 'Arial', size: 10, bold: true };
  castTotal.getCell(5).numFmt = MONEY;
  ws.addRow([]);

  // ---- Staff by section ----
  const sections: Section[] = ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];
  for (const section of sections) {
    const rows = r.staff.filter((s) => s.section === section);
    if (rows.length === 0) continue;
    title(SECTION_LABEL[section]);
    header(['Name', 'Hours', '', '', 'Amount']);
    for (const s of rows) {
      const row = ws.addRow([s.name, s.hours, '', '', s.amountCents / 100]);
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
  label('Cast & Musicians total', r.castPoolCents / 100, MONEY);
  label('Staff total', r.staffPoolCents / 100, MONEY);
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
    'TOTAL', '', '', '',
    r.perPerson.reduce((a, b) => a + b.amountCents, 0) / 100,
  ]);
  grand.font = { name: 'Arial', size: 10, bold: true };
  grand.getCell(5).numFmt = MONEY;

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
