import ExcelJS from 'exceljs';
import { Result, Section, SECTION_LABEL } from './tips';

const MONEY = '#,##0.00;(#,##0.00);"-"';
const OTHER = 'OTHER';
/** The yellow the office marks a merged row with. */
const MERGED = { argb: 'FFFFFF00' };
type Block = 'CAST' | Section | typeof OTHER;

/** One night's column on a "TOTAL PAYOUT" sheet. */
export interface PayoutColumn {
  /** The column heading: the night's tab name, such as "Sept-08-2026". */
  label: string;
  result: Result;
  /** The cells on the night's own sheet that hold its admin fee, such as
   * "'Sept-08-2026'!B5", so the ADMIN FEE row points back at them. */
  adminFeeRefs?: string[];
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

  const grid = blocks.map(({ block, title }) => {
    const byName = amounts.get(block)!;
    const names = [...(listed.get(block) ?? [])];
    for (const n of byName.keys()) if (!names.includes(n)) names.push(n);
    return {
      title,
      rows: names.map((name): PayoutRow => ({
        name: block === 'CAST' && technical.has(name) ? `${name} (Technical)` : name,
        cents: byName.get(name) ?? columns.map(() => 0),
      })),
    };
  });

  // One row per person, as the office's sheet has: the same person under two
  // spellings or in two blocks is folded into their first row, which is
  // marked and says what was merged so nothing is folded silently.
  const kept: { row: PayoutRow; title: string; parts: string[] }[] = [];
  for (const b of grid) {
    b.rows = b.rows.filter((r) => {
      const into = kept.find((k) => samePerson(k.row.name, r.name));
      if (!into) {
        kept.push({ row: r, title: b.title, parts: [`${r.name} [${b.title}]`] });
        return true;
      }
      r.cents.forEach((c, i) => { into.row.cents[i] += c; });
      into.parts.push(`${r.name} [${b.title}]`);
      return false;
    });
  }
  for (const k of kept) {
    if (k.parts.length > 1) k.row.mergeNote = `Merged: ${k.parts.join(' + ')}`;
  }
  return grid.filter((b) => b.rows.length);
}

export interface PayoutRow {
  name: string;
  cents: number[];
  /** Set when other rows were folded into this one. */
  mergeNote?: string;
}

/** A name's words, lower-cased, without nicknames in brackets or punctuation. */
const words = (name: string) =>
  name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/).filter(Boolean);

/** True when two words differ by at most one letter added, dropped or changed. */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Whether two roster or timecard names are the same person: the same words in
 * any order ("Stuckless Leslie", "Leslie Stuckless", "Stacey,TAylor"), allowing
 * one typo in one longer word ("Willson,Amy", "Bobbit Neil").
 */
export function samePerson(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.length || x.length !== y.length) return false;
  const left = [...y];
  let typos = 0;
  for (const w of x) {
    let k = left.indexOf(w);
    if (k < 0) {
      k = left.findIndex((v) => v.length >= 5 && w.length >= 5 && nearly(v, w));
      if (k < 0 || ++typos > 1) return false;
    }
    left.splice(k, 1);
  }
  return true;
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
  const noteCol = totalCol + 2;             // another blank, then MERGE NOTE
  ws.getColumn(1).width = 32.67;
  for (let c = first; c <= totalCol; c++) ws.getColumn(c).width = 12.5;
  ws.getColumn(noteCol).width = 70;

  const bold = { name: 'Arial', size: 10, bold: true };
  const plain = { name: 'Arial', size: 10 };
  const sumRow = (row: number) =>
    `SUM(${colLetter(first)}${row}:${colLetter(last)}${row})`;

  ws.addRow([]);
  const head = ws.getRow(2);
  head.getCell(1).value = 'DATE';
  columns.forEach((c, i) => { head.getCell(first + i).value = c.label; });
  head.getCell(totalCol).value = 'TOTAL';
  head.getCell(noteCol).value = 'MERGE NOTE';
  head.font = plain;
  head.getCell(1).font = bold;
  head.getCell(totalCol).font = bold;
  head.getCell(noteCol).font = bold;

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
      if (p.mergeNote) {
        row.getCell(noteCol).value = p.mergeNote;
        const marked = [1, totalCol,
          ...p.cents.flatMap((c, i) => (c ? [first + i] : []))];
        for (const c of marked) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: MERGED };
        }
      }
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

  // What the venue kept, pointing back at each night's own admin fee cells,
  // so GRAND TOTAL + ADMIN FEE is every tip collected in the period.
  const fees = columns.map((c) => c.result.adminFeeCents + c.result.screechAdminFeeCents);
  if (fees.some(Boolean)) {
    const percent = columns.find((c) => c.result.adminFeePercent)?.result.adminFeePercent ?? 0;
    ws.addRow([]);
    const fee = ws.addRow([`ADMIN FEE (${percent}%)`]);
    fee.font = bold;
    columns.forEach((c, i) => {
      const cell = fee.getCell(first + i);
      cell.value = c.adminFeeRefs?.length
        ? { formula: c.adminFeeRefs.join('+'), result: fees[i] / 100 }
        : fees[i] / 100;
      cell.numFmt = MONEY;
      cell.font = bold;
    });
    const t = fee.getCell(totalCol);
    t.value = {
      formula: sumRow(fee.number),
      result: fees.reduce((a, b) => a + b, 0) / 100,
    };
    t.numFmt = MONEY;
    t.font = bold;
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  return ws;
}
