import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { calculate, ScreechSession, Section } from './tips';
import { toCents } from './money';
import { payoutGrid, addPayoutSheet, PayoutRoster, samePerson } from './payoutSheet';

/** Shapes from Tips_09-08to09-19_.xlsx, the "TOTAL PAYOUT SPIRIT" sheet. */
const roster: PayoutRoster = {
  cast: [{ name: 'Blackwood, Adam', technical: true }, { name: 'Lasby, Dan', technical: false },
         { name: 'Power, Keith', technical: false }],
  sections: [
    { section: 'BAR', names: ['Dickson Joleen'] },
    { section: 'OFFICE', names: ['Hillier Bridget', 'Noseworthy, Natalie'] },
  ],
};

const screech = (id: string, cash: number, hosts: [string, boolean?][]): ScreechSession => ({
  id, cashCents: toCents(cash), squareCents: 0, guests: null, sageRef: '',
  hosts: hosts.map(([name, helper], i) => ({ id: `${id}${i}`, name, helper: !!helper })),
});
const night = (over: object = {}) => calculate({
  gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0, cast: [], staff: [],
  rules: { castSharePercent: 0, officeHours: 0, oddCentTo: 'staff' }, ...over,
});

const sep08 = night({ screech: [
  screech('a', 11.94, [['Hillier Bridget']]),
  screech('b', 10.16, [['Power, Keith'], ['Blackwood, Adam', true]]),
] });
const sep10 = night({
  cashTipsCents: toCents(100),
  rules: { castSharePercent: 50, officeHours: 5, oddCentTo: 'staff' },
  cast: [{ id: 'c1', name: 'Power, Keith', ratio: 1, worked: true, technical: false }],
  staff: [
    { id: 's1', name: 'Dickson Joleen', section: 'BAR' as Section, hours: 5, included: true, note: '' },
    { id: 's2', name: 'Noseworthy, Natalie', section: 'OFFICE' as Section, hours: 5, included: true, note: '' },
  ],
  screech: [screech('c', 12.55, [['Noseworthy, Natalie']])],
});
const sep13 = night({ screech: [screech('d', 16.23, [['Lasby, Dan']])] });
const sep15 = night({ screech: [screech('e', 55.77, [['Halley, Peter']])] });
const columns = [
  { label: 'Sept-08-2026', result: sep08 }, { label: 'Sept-10-2026', result: sep10 },
  { label: 'Sept-13-2026', result: sep13 }, { label: 'Sept-15-2026', result: sep15 },
];

const row = (grid: ReturnType<typeof payoutGrid>, title: string, name: string) =>
  grid.find((b) => b.title === title)?.rows.find((r) => r.name === name)?.cents;

describe('payoutGrid', () => {
  const grid = payoutGrid(columns, roster);

  it('puts screech-in money on the row where the person is paid', () => {
    expect(row(grid, 'Office / reservations', 'Hillier Bridget')).toEqual([1194, 0, 0, 0]);
    expect(row(grid, 'Cast & Musicians', 'Power, Keith')).toEqual([508, 5000, 0, 0]);
    expect(row(grid, 'Cast & Musicians', 'Blackwood, Adam (Technical)')).toEqual([508, 0, 0, 0]);
    // Show pay and screech-in on one night, one cell: 25.00 office + 12.55.
    expect(row(grid, 'Office / reservations', 'Noseworthy, Natalie')).toEqual([0, 3755, 0, 0]);
  });

  it('falls back to the roster, then to Other / Screech-In', () => {
    expect(row(grid, 'Cast & Musicians', 'Lasby, Dan')).toEqual([0, 0, 1623, 0]);
    expect(row(grid, 'Other / Screech-In', 'Halley, Peter')).toEqual([0, 0, 0, 5577]);
  });

  it('pays out every cent of every night exactly once', () => {
    const sum = (col: number) => grid.flatMap((b) => b.rows).reduce((a, r) => a + r.cents[col], 0);
    columns.forEach((c, i) => expect(sum(i)).toBe(c.result.grandTotalCents));
  });
});

describe('addPayoutSheet', () => {
  it('writes the dates across, a TOTAL per person and a GRAND TOTAL', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = addPayoutSheet(wb, 'TOTAL PAYOUT SPIRIT', columns, roster);
    expect(ws.getRow(2).getCell(1).value).toBe('DATE');
    expect(ws.getRow(2).getCell(3).value).toBe('Sept-08-2026');
    expect(ws.getRow(2).getCell(8).value).toBe('TOTAL');
    let grand: ExcelJS.Row | undefined;
    ws.eachRow((r) => { if (r.getCell(1).value === 'GRAND TOTAL') grand = r; });
    expect((grand!.getCell(8).value as { result: number }).result)
      .toBeCloseTo((sep08.grandTotalCents + sep10.grandTotalCents
        + sep13.grandTotalCents + sep15.grandTotalCents) / 100, 2);
  });
});

describe('samePerson', () => {
  // Every merge in Updated_Tips_09-21_26to10-04_26.xlsx's TOTAL PAYOUT sheets.
  it.each([
    ['Noseworthy, Natalie', 'Natalie Noseworthy'],
    ['Wilson, Amy', 'Willson,Amy'],
    ['Leslie Stuckless', 'Stuckless Leslie'],
    ['Stacey Taylor', 'Stacey,TAylor'],
    ['Al-Lahout Svitlana', 'AL-Lahout Svitlana'],
    ['Bobbit Neil', 'Bobbitt Neil'],
    ['Blackwood, Adam (Technical)', 'Blackwood Adam'],
  ])('%s is %s', (a, b) => expect(samePerson(a, b)).toBe(true));

  it.each([
    ['Pasechniuk Yana', 'Pasechniuk Maryna'],
    ['Zavadetska Mariia', 'Khrystyna Zavadetska'],
    ['Lundrigan Ash', 'Amy Lundrigan'],
    ['Pynn Jackie', 'Pynn Morgan'],
    ['Wilson, Amy', 'Amy Lundrigan'],
    ['Etienne', 'Etienne Fiore'],
  ])('%s is not %s', (a, b) => expect(samePerson(a, b)).toBe(false));
});

describe('merging one person\'s rows', () => {
  const fee = (over: object = {}) => night({
    cashTipsCents: toCents(200), rules: {
      castSharePercent: 50, officeHours: 2, oddCentTo: 'staff', adminFeePercent: 5,
    }, ...over,
  });
  const a = fee({
    cast: [{ id: 'c1', name: 'Noseworthy, Natalie', ratio: 1, worked: true, technical: false }],
    staff: [{ id: 's1', name: 'Hillier Bridget', section: 'OFFICE' as Section, hours: 2,
              included: true, note: '' }],
  });
  const b = fee({
    rules: { castSharePercent: 0, officeHours: 2, oddCentTo: 'staff', adminFeePercent: 5 },
    staff: [{ id: 's2', name: 'Natalie Noseworthy', section: 'OFFICE' as Section, hours: 2,
              included: true, note: '' }],
  });
  const cols = [
    { label: 'Oct-03-2026', result: a, adminFeeRefs: ["'Oct-03-2026'!B5"] },
    { label: 'Oct-03-2026 (2)', result: b, adminFeeRefs: ["'Riley''s Tours Oct-03-2026'!B5"] },
  ];
  const r: PayoutRoster = {
    cast: [{ name: 'Noseworthy, Natalie', technical: false }],
    sections: [{ section: 'OFFICE', names: ['Hillier Bridget'] }],
  };

  it('folds the second spelling into the first row and says so', () => {
    const grid = payoutGrid(cols, r);
    const nat = grid[0].rows.find((x) => x.name === 'Noseworthy, Natalie')!;
    expect(nat.cents).toEqual([a.cast[0].amountCents, b.staff[0].amountCents]);
    expect(nat.mergeNote).toBe('Merged: Noseworthy, Natalie [Cast & Musicians]'
      + ' + Natalie Noseworthy [Office / reservations]');
    expect(grid[1].rows.map((x) => x.name)).toEqual(['Hillier Bridget']);
  });

  it('writes the MERGE NOTE and an ADMIN FEE row pointing at each night', () => {
    const ws = addPayoutSheet(new ExcelJS.Workbook(), 'TOTAL PAYOUT SPIRIT', cols, r);
    expect(ws.getRow(2).getCell(6).value).toBe('TOTAL');
    expect(ws.getRow(2).getCell(8).value).toBe('MERGE NOTE');
    const rows: ExcelJS.Row[] = [];
    ws.eachRow((x) => rows.push(x));
    const nat = rows.find((x) => x.getCell(1).value === 'Noseworthy, Natalie')!;
    expect(String(nat.getCell(8).value)).toMatch(/^Merged: /);
    expect((nat.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFFF00');
    const adm = rows.find((x) => x.getCell(1).value === 'ADMIN FEE (5%)')!;
    expect(adm.getCell(3).value).toEqual({ formula: "'Oct-03-2026'!B5", result: 10 });
    expect(adm.getCell(4).value)
      .toEqual({ formula: "'Riley''s Tours Oct-03-2026'!B5", result: 10 });
    expect((adm.getCell(6).value as { result: number }).result).toBe(20);
    const grand = rows.find((x) => x.getCell(1).value === 'GRAND TOTAL')!;
    expect(adm.number).toBe(grand.number + 2);
  });
});
