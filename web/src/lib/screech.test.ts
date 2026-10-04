import { describe, it, expect } from 'vitest';
import {
  calculate, DEFAULT_RULES, CastEntry, StaffEntry, Section, ScreechSession, LateTip,
} from './tips';
import { toCents } from './money';

/**
 * Figures from Tips_09-08to09-19_.xlsx and the Sage "Accounts Payable Tips"
 * report for the same fortnight. See docs/SCREECH_IN_PROPOSAL.md.
 */

const session = (
  id: string, cash: number, hosts: [string, boolean?][], square = 0,
): ScreechSession => ({
  id, cashCents: toCents(cash), squareCents: toCents(square), guests: null, sageRef: '',
  hosts: hosts.map(([name, helper], i) => ({ id: `${id}h${i}`, name, helper: !!helper })),
});

const empty = (over = {}) => calculate({
  gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
  cast: [], staff: [],
  rules: { castSharePercent: 0, officeHours: 0, oddCentTo: 'staff' },
  ...over,
});

/** Dwight's Wedding, 10 Sep 2026: $2,428.13, and Natalie's $12.55 screech-in. */
const SEP10_CAST = [
  'Blackwood, Adam', 'Borden, Christa', 'Brennan, Bill', 'Collins, Ron',
  'Dawe Amanda', 'Dunne, Julia', 'Parsons, Dana', 'Power, Keith', 'Simms, Jeff',
  'Stamp, Paul (Boomer)',
];
const SEP10_STAFF: [string, Section, number][] = [
  ['Dickson Joleen', 'BAR', 5.78], ['Gordon Daniel', 'BAR', 5.3],
  ['Sweetapple Deborah', 'SERVICE', 8], ['Bobbitt Neil', 'SERVICE', 5],
  ['Khrystyna Zavadetska', 'SERVICE', 4.43], ['Martynova Olena', 'SERVICE', 7.47],
  ['Pasechniuk Yana', 'SERVICE', 7.05], ['Pynn Jackie', 'SERVICE', 8],
  ['Griffan Katie', 'FIFTY_FIFTY', 3.95],
  ['Lundrigan Ash', 'KITCHEN', 3.98], ["O'Reilly Colleen", 'KITCHEN', 6.95],
  ['Wall James (Jordon)', 'KITCHEN', 3.52], ['Zavadetska Mariia', 'KITCHEN', 6.15],
  ['Hillier Bridget', 'OFFICE', 2], ['Pasechniuk Maryna', 'OFFICE', 2],
  ['Noseworthy, Natalie', 'OFFICE', 2],
];
const sep10 = (over = {}) => calculate({
  gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
  totalOverrideCents: toCents(2428.13),
  cast: SEP10_CAST.map<CastEntry>((name, i) => ({
    id: `c${i}`, name, ratio: 1, worked: true, technical: i === 0,
  })),
  staff: SEP10_STAFF.map<StaffEntry>(([name, section, hours], i) => ({
    id: `s${i}`, name, section, hours, included: true,
  })),
  rules: DEFAULT_RULES,
  ...over,
});

describe('screech-in on a show night (Sep 10)', () => {
  const r = sep10({ screech: [session('a', 12.55, [['Natalie Noseworthy']])] });

  it('leaves the show itself untouched', () => {
    expect(r.totalCents).toBe(toCents(2428.13));
    expect(r.reconciliationCents).toBe(0);
    expect(r.staffHoursTotal).toBe(81.58);
  });

  it('pays the host the whole screech-in and adds it to her show pay', () => {
    expect(r.screechTotalCents).toBe(1255);
    const natalie = r.personTotals.find((p) => p.name.includes('Natalie'))!;
    expect(natalie.showCents).toBe(toCents(29.76));
    expect(natalie.screechCents).toBe(1255);
    expect(natalie.totalCents).toBe(toCents(42.31)); // "Total for Natalie"
  });

  it('counts screech-in in the grand total, not the show total', () => {
    expect(r.grandTotalCents).toBe(toCents(2428.13) + 1255);
  });
});

describe('screech-in sessions', () => {
  it('splits equally between host and helper (Sep 8, J6924)', () => {
    const r = empty({ screech: [session('b', 10.16, [['Power, Keith'], ['Blackwood, Adam', true]])] });
    expect(r.screech[0].hosts.map((h) => h.amountCents)).toEqual([508, 508]);
  });

  it('keeps two sessions on one night apart (Sep 8)', () => {
    const r = empty({ screech: [
      session('a', 11.94, [['Hillier Bridget']]),
      session('b', 10.16, [['Power, Keith'], ['Blackwood, Adam', true]]),
    ] });
    expect(r.screechTotalCents).toBe(2210);
    expect(r.personTotals.find((p) => p.name === 'Hillier Bridget')!.totalCents).toBe(1194);
    expect(r.personTotals.find((p) => p.name === 'Power, Keith')!.totalCents).toBe(508);
  });

  it('collected 75.82 between two pays 37.91 each (Sep 11, J7031)', () => {
    const r = empty({ screech: [session('a', 75.82, [['Natalie Noseworthy'], ['Dickson Joleen', true]])] });
    expect(r.screech[0].hosts.map((h) => h.amountCents)).toEqual([3791, 3791]);
  });

  it('adds cash and Square together', () => {
    const r = empty({ screech: [session('a', 10, [['Lasby, Dan']], 6.23)] });
    expect(r.screech[0].tipsCents).toBe(1623);
  });

  it('places the odd cent so the session still adds up', () => {
    const r = empty({ screech: [session('a', 10.15, [['A'], ['B']])] });
    const amounts = r.screech[0].hosts.map((h) => h.amountCents);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(1015);
    expect(Math.abs(amounts[0] - amounts[1])).toBe(1);
  });

  it('holds the money when nobody hosted, and says so', () => {
    const r = empty({ screech: [session('a', 16.23, [])] });
    expect(r.screech[0].unallocatedCents).toBe(1623);
    expect(r.warnings.some((w) => w.includes('no host'))).toBe(true);
  });
});

describe('late tips (Lori Pynn, Sage J7113)', () => {
  const late = (mode: 'split' | 'person', payee = ''): LateTip => ({
    id: 'l1', amountCents: 174, mode, payee,
    description: 'payment from Lori Pynn for the show on Sept. 11', sageRef: 'J7113',
  });

  it('re-split: joins the show total and the night still reconciles', () => {
    const r = sep10({ lateTips: [late('split')] });
    expect(r.nightTipsCents).toBe(toCents(2428.13));
    expect(r.totalCents).toBe(toCents(2428.13) + 174);
    expect(r.castPoolCents + r.staffPoolCents).toBe(r.totalCents);
    expect(r.reconciliationCents).toBe(0);
    expect(r.latePersonal).toEqual([]);
  });

  it('to one person: paid to them, the show split untouched', () => {
    const r = sep10({ lateTips: [late('person', 'Lori Pynn')] });
    expect(r.totalCents).toBe(toCents(2428.13));
    expect(r.latePersonalCents).toBe(174);
    const lori = r.personTotals.find((p) => p.name === 'Lori Pynn')!;
    expect(lori).toMatchObject({ showCents: 0, lateCents: 174, totalCents: 174 });
    expect(r.grandTotalCents).toBe(toCents(2428.13) + 174);
  });

  it('to one person with nobody named: held and flagged', () => {
    const r = sep10({ lateTips: [late('person')] });
    expect(r.lateUnassignedCents).toBe(174);
    expect(r.grandTotalCents).toBe(toCents(2428.13));
    expect(r.warnings.some((w) => w.includes('nobody is named'))).toBe(true);
  });
});
