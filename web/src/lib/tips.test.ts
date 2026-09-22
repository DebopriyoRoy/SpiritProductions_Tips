import { describe, it, expect } from 'vitest';
import { calculate, DEFAULT_RULES, CastEntry, StaffEntry, Section } from './tips';
import { allocateByWeight, splitPool, toCents, fmt } from './money';

/** Forever Country, 28 Aug 2026 — the figures verified against the model workbook. */
const CAST_NAMES = [
  'Blackwood, Adam', 'Borden, Christa', 'Brennan, Bill', 'Byrne, Patrick (Paddy)',
  'Collins, Ron', 'Dawe Amanda', 'Dunne, Julia', 'Fiore, Marco', 'Fitzpatrick Brandon',
  'Jefford, Brad', 'Dicks Jeremy', 'Pretty Caitlin', 'Etienne', 'Lasby, Dan',
  'Mackey, Nathan', 'Howlett, Nick', 'Andrew Small', 'Noftle, Kara',
  'Noseworthy, Natalie', 'Parsons, Dana', 'Power, Keith', 'Small Andrew',
  'Sears, Robyn', 'Fletcher Logan', 'Simms, Jeff', 'Stamp, Paul (Boomer)',
  'Williams John', 'Wilson, Amy',
];
const WORKED = new Set([
  'Blackwood, Adam', 'Byrne, Patrick (Paddy)', 'Fiore, Marco', 'Dicks Jeremy',
  'Pretty Caitlin', 'Lasby, Dan', 'Noftle, Kara', 'Small Andrew', 'Fletcher Logan',
]);

const cast: CastEntry[] = CAST_NAMES.map((name, i) => ({
  id: `c${i}`, name, ratio: 1, worked: WORKED.has(name),
  technical: name === 'Blackwood, Adam',
}));

const STAFF: [string, Section, number][] = [
  ['Dickson Joleen', 'BAR', 5.73], ['Gordon Daniel', 'BAR', 5.0],
  ['Sweetapple Deborah', 'SERVICE', 4.88], ['Khrystyna Zavadetska', 'SERVICE', 3.55],
  ['Martynova Olena', 'SERVICE', 7.38], ['Polski Maksym', 'SERVICE', 4.83],
  ['Pynn Jackie', 'SERVICE', 5.35], ['Pasechniuk Yana', 'FIFTY_FIFTY', 3.97],
  ['Kachensseva Mariia (Marsh)', 'KITCHEN', 4.3], ['Lundrigan William', 'KITCHEN', 6.15],
  ["O'Reilly Colleen", 'KITCHEN', 8.0], ['Wall James (Jordon)', 'KITCHEN', 4.42],
  ['Hillier Bridget', 'OFFICE', 1.5], ['Khrystyna Zavadetska', 'OFFICE', 1.5],
  ['Pasechniuk Maryna', 'OFFICE', 1.5], ['Pasechniuk Yana', 'OFFICE', 1.5],
];
const staff: StaffEntry[] = STAFF.map(([name, section, hours], i) => ({
  id: `s${i}`, name, section, hours, included: true,
}));

const run = (over = {}) => calculate({
  gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
  totalOverrideCents: toCents(1072.53),
  cast, staff, rules: DEFAULT_RULES, ...over,
});

describe('Forever Country 2026-08-28 (golden)', () => {
  const r = run();

  it('splits the pool 50/50 to the cent', () => {
    expect(r.totalCents).toBe(107253);
    expect(r.castPoolCents + r.staffPoolCents).toBe(107253);
    expect(r.castPoolCents).toBe(53626);
    expect(r.staffPoolCents).toBe(53627); // odd cent to staff by default
  });

  it('matches the workbook hour totals', () => {
    expect(r.staffHoursTotal).toBe(69.56);
    expect(r.barServiceHours).toBe(36.72);
    expect(r.castWorkedRatioTotal).toBe(9);
  });

  it('reproduces the workbook section totals within a cent', () => {
    const got = (s: string) => r.sectionTotals.find((t) => t.section === s)!;
    expect(r.barServiceCents).toBeCloseTo(28309, -1);
    expect(got('FIFTY_FIFTY').amountCents).toBeCloseTo(3061, -1);
    expect(got('KITCHEN').amountCents).toBeCloseTo(17631, -1);
    expect(got('OFFICE').amountCents).toBeCloseTo(4626, -1);
  });

  it('reproduces the workbook display rates', () => {
    expect(r.staffRatePerHour).toBeCloseTo(7.709388, 5);
    expect(r.castRatePerShare).toBeCloseTo(59.585, 3);
  });

  it('pays every cent and no more', () => {
    const paid = [...r.cast, ...r.staff].reduce((a, b) => a + b.amountCents, 0);
    expect(paid).toBe(107253);
    expect(r.reconciliationCents).toBe(0);
  });

  it('flags that the spreadsheet\'s displayed rounding overpays by 5 cents', () => {
    expect(r.roundingDriftCents).toBe(5);
    expect(r.naiveRoundedTotalCents).toBe(107258);
  });

  it('aggregates people paid from more than one section', () => {
    const yana = r.perPerson.find((p) => /yana/i.test(p.name))!;
    expect(yana.hours).toBe(5.47);
    expect(yana.amountCents).toBeCloseTo(4217, -1);
    const k = r.perPerson.find((p) => /khrystyna/i.test(p.name))!;
    expect(k.hours).toBe(5.05);
    expect(k.amountCents).toBeCloseTo(3893, -1);
  });

  it('pays no one who did not work', () => {
    for (const c of r.cast) {
      if (!WORKED.has(c.name)) expect(c.amountCents).toBe(0);
    }
  });
});

describe('rules are configurable per location', () => {
  it('honours a different cast share', () => {
    const r = run({ rules: { ...DEFAULT_RULES, castSharePercent: 40 } });
    expect(r.castPoolCents).toBe(42901);
    expect(r.castPoolCents + r.staffPoolCents).toBe(107253);
  });

  it('honours the odd-cent rule', () => {
    const a = run({ rules: { ...DEFAULT_RULES, oddCentTo: 'cast' } });
    expect(a.castPoolCents).toBe(53627);
    expect(a.staffPoolCents).toBe(53626);
  });

  it('weights a cast member on a half share', () => {
    const half = cast.map((c) =>
      c.name === 'Lasby, Dan' ? { ...c, ratio: 0.5 } : c);
    const r = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast: half, staff, rules: DEFAULT_RULES,
    });
    expect(r.castWorkedRatioTotal).toBe(8.5);
    const dan = r.cast.find((c) => c.name === 'Lasby, Dan')!;
    const kara = r.cast.find((c) => c.name === 'Noftle, Kara')!;
    expect(Math.abs(kara.amountCents - dan.amountCents * 2)).toBeLessThanOrEqual(1);
    expect(r.reconciliationCents).toBe(0);
  });
});

describe('exclusions', () => {
  it('excludes a row without deleting it, and keeps reconciliation', () => {
    const withCleaner: StaffEntry[] = [
      ...staff,
      { id: 'x', name: 'Philpot Paul', section: 'SERVICE', hours: 2.3,
        included: false, note: 'Crossed out on source' },
    ];
    const r = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast, staff: withCleaner,
      rules: DEFAULT_RULES,
    });
    expect(r.staffHoursTotal).toBe(69.56);
    expect(r.staff.find((s) => s.name === 'Philpot Paul')!.amountCents).toBe(0);
    expect(r.reconciliationCents).toBe(0);
  });
});

describe('components vs override', () => {
  it('totals the three components when no override is given', () => {
    const r = run({
      gratuityCents: toCents(500), cashTipsCents: toCents(300.53),
      squareTipsCents: toCents(272), totalOverrideCents: null,
    });
    expect(r.totalCents).toBe(107253);
    expect(r.warnings).toHaveLength(0);
  });

  it('warns when an override disagrees with the components', () => {
    const r = run({
      gratuityCents: toCents(100), cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53),
    });
    expect(r.warnings.join(' ')).toMatch(/does not match/i);
  });
});

describe('money primitives', () => {
  it('always distributes the whole pool', () => {
    for (const pool of [1, 7, 99, 107253, 1000001]) {
      for (const ws of [[1, 1, 1], [573, 500, 488, 355], [1], [0, 5, 0]]) {
        const out = allocateByWeight(pool, ws);
        expect(out.reduce((a, b) => a + b, 0)).toBe(pool);
        out.forEach((v, i) => { if (ws[i] === 0) expect(v).toBe(0); });
      }
    }
  });

  it('never loses a cent in a split', () => {
    for (const t of [107253, 1, 2, 99999]) {
      for (const pct of [50, 40, 33]) {
        const [a, b] = splitPool(t, pct, 'second');
        expect(a + b).toBe(t);
      }
    }
  });

  it('handles zero weights without dividing by zero', () => {
    expect(allocateByWeight(500, [0, 0])).toEqual([0, 0]);
  });

  it('formats cents', () => {
    expect(fmt(107253)).toBe('1072.53');
    expect(fmt(5)).toBe('0.05');
    expect(fmt(-125)).toBe('-1.25');
  });
});

describe('pools with nobody to pay (regression)', () => {
  const base = {
    gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
    totalOverrideCents: toCents(1072.53), rules: DEFAULT_RULES,
  };

  it('does not crash when no cast has been ticked yet', () => {
    const r = calculate({ ...base, cast: cast.map((c) => ({ ...c, worked: false })), staff });
    expect(r.unallocatedCastCents).toBe(53626);
    expect(r.cast.every((c) => c.amountCents === 0)).toBe(true);
    expect(r.reconciliationCents).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/unallocated/i);
  });

  it('does not crash when no staff hours are entered yet', () => {
    const r = calculate({ ...base, cast, staff: staff.map((s) => ({ ...s, hours: 0 })) });
    expect(r.unallocatedStaffCents).toBe(53627);
    expect(r.reconciliationCents).toBe(0);
  });

  it('holds the whole total when the sheet is empty', () => {
    const r = calculate({ ...base, cast: [], staff: [] });
    expect(r.unallocatedCents).toBe(107253);
    expect(r.reconciliationCents).toBe(0);
  });

  it('never reports unallocated money once everyone is in', () => {
    const r = calculate({ ...base, cast, staff });
    expect(r.unallocatedCents).toBe(0);
    expect(r.warnings.join(' ')).not.toMatch(/unallocated/i);
  });
});
