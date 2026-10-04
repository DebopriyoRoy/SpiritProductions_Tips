import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { calculate, ScreechSession, Section } from './tips';
import { toCents } from './money';
import { payoutGrid, addPayoutSheet, PayoutRoster } from './payoutSheet';

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
