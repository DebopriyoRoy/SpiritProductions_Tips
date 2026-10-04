import ExcelJS from 'exceljs';
import { Result, Section, SECTION_LABEL } from './tips';

const MONEY = '#,##0.00;(#,##0.00);"-"';
const OTHER = 'OTHER';
type Block = 'CAST' | Section | typeof OTHER;

/** One night's column on a "TOTAL PAYOUT" sheet. */
export interface PayoutColumn {
  /** The column heading: the night's tab name, such as "Sept-08-2026". */
  label: string;
  result: Result;
}

/** Who the venue lists, block by block, in the workbook's order. */
export interface PayoutRoster {
  cast: { name: string; technical: boolean }[];
  sections: { section: Section; names: string[] }[];
}

/**
 * Works out the "TOTAL PAYOUT" grid: one row per person, one column per night.
 *
 * Show pay sits in the block it was earned in, so someone who worked two
 * sections over the fortnight has a row in each, as the workbook has. Screech-in
 * and late-tip money has no section of its own; it joins the person's first
 * block (where they were paid, else where the roster lists them) and only
 * falls to "Other / Screech-In" for someone on no roster at all.
 */
export function payoutGrid(columns: PayoutColumn[], roster: PayoutRoster) {
  const blocks: { block: Block; title: string }[] = [
    ...(roster.cast.length ? [{ block: 'CAST' as Block, title: 'Cast & Musicians' }] : []),
    ...roster.sections.map((s) => ({ block: s.section as Block, title: SECTION_LABEL[s.section] })),
    { block: OTHER, title: 'Other / Screech-In' },
  ];
  const order = blocks.map((b) => b.block);

  // amounts[block][name][column] in cents
  const amounts = new Map<Block, Map<string, number[]>>(order.map((b) => [b, new Map()]));
  const add = (block: Block, name: string, col: number, cents: number) => {
    if (!cents) return;
    const byName = amounts.get(block)!;
    if (!byName.has(name)) byName.set(name, columns.map(() => 0));
    byName.get(name)![col] += cents;
  };
  const extras = new Map<string, number[]>();
  const technical = new Set(roster.cast.filter((c) => c.technical).map((c) => c.name));

  columns.forEach(({ result: r }, col) => {
    for (const c of r.cast) {
      add('CAST', c.name, col, c.amountCents);
      if (c.technical) technical.add(c.name);
    }
    for (const s of r.staff) {
      add(amounts.has(s.section) ? s.section : OTHER, s.name, col, s.amountCents);
    }
    const extra = (name: string, cents: number) => {
      if (!cents) return;
      if (!extras.has(name)) extras.set(name, columns.map(() => 0));
      extras.get(name)![col] += cents;
    };
    for (const s of r.screech) for (const h of s.hosts) extra(h.name, h.amountCents);
    for (const t of r.latePersonal) extra(t.name, t.amountCents);
  });

  const listed = new Map<Block, string[]>([
    ['CAST', roster.cast.map((c) => c.name)],
    ...roster.sections.map((s) => [s.section as Block, s.names] as [Block, string[]]),
  ]);
  const homeOf = (name: string): Block =>
    order.find((b) => amounts.get(b)!.has(name))
      ?? order.find((b) => listed.get(b)?.includes(name))
      ?? OTHER;
  for (const [name, cents] of extras) {
    const home = homeOf(name);
    cents.forEach((c, col) => add(home, name, col, c));
  }

  return blocks.map(({ block, title }) => {
    const byName = amounts.get(block)!;
    const names = [...(listed.get(block) ?? [])];
    for (const n of byName.keys()) if (!names.includes(n)) names.push(n);
    return {
      title,
      rows: names.map((name) => ({
        name: block === 'CAST' && technical.has(name) ? `${name} (Technical)` : name,
        cents: byName.get(name) ?? columns.map(() => 0),
      })),
    };
  }).filter((b) => b.rows.length);
}

const colLetter = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
};

/**
 * Adds a "TOTAL PAYOUT" sheet: every person down the side, every night across
 * the top, a TOTAL for each person and a GRAND TOTAL for each night.
 */
export function addPayoutSheet(
  wb: ExcelJS.Workbook, sheetName: string,
  columns: PayoutColumn[], roster: PayoutRoster,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName);
  const first = 3;                          // nights start in column C
  const last = first + columns.length - 1;
  const totalCol = last + 2;                // one blank column, then TOTAL
  ws.getColumn(1).width = 32.7;
  for (let c = first; c <= totalCol; c++) ws.getColumn(c).width = 12.5;

  const bold = { name: 'Arial', size: 10, bold: true };
  const plain = { name: 'Arial', size: 10 };
  const sumRow = (row: number) =>
    `SUM(${colLetter(first)}${row}:${colLetter(last)}${row})`;

  ws.addRow([]);
  const head = ws.getRow(2);
  head.getCell(1).value = 'DATE';
  columns.forEach((c, i) => { head.getCell(first + i).value = c.label; });
  head.getCell(totalCol).value = 'TOTAL';
  head.font = plain;
  head.getCell(1).font = bold;
  head.getCell(totalCol).font = bold;

  let firstPerson = 0, lastPerson = 0;
  const colTotals = columns.map(() => 0);
  for (const block of payoutGrid(columns, roster)) {
    ws.addRow([]);
    ws.addRow([block.title]).font = bold;
    ws.addRow(['Name']).font = bold;
    for (const p of block.rows) {
      const row = ws.addRow([p.name]);
      row.font = plain;
      if (!firstPerson) firstPerson = row.number;
      lastPerson = row.number;
      p.cents.forEach((c, i) => {
        colTotals[i] += c;
        if (!c) return;
        const cell = row.getCell(first + i);
        cell.value = c / 100;
        cell.numFmt = MONEY;
      });
      const total = row.getCell(totalCol);
      total.value = {
        formula: sumRow(row.number),
        result: p.cents.reduce((a, b) => a + b, 0) / 100,
      };
      total.numFmt = MONEY;
      total.font = bold;
    }
    ws.addRow([]);
  }

  ws.addRow([]);
  const grand = ws.addRow(['GRAND TOTAL']);
  grand.font = bold;
  const columnSum = (c: number) =>
    `SUM(${colLetter(c)}${firstPerson}:${colLetter(c)}${lastPerson})`;
  columns.forEach((_, i) => {
    const cell = grand.getCell(first + i);
    cell.value = { formula: columnSum(first + i), result: colTotals[i] / 100 };
    cell.numFmt = MONEY;
  });
  const g = grand.getCell(totalCol);
  g.value = {
    formula: columnSum(totalCol),
    result: colTotals.reduce((a, b) => a + b, 0) / 100,
  };
  g.numFmt = MONEY;

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  return ws;
}
