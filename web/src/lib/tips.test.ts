import { describe, it, expect } from 'vitest';
import { calculate, DEFAULT_RULES, CastEntry, StaffEntry, Section } from './tips';
import { allocateByWeight, splitPool, toCents, fmt } from './money';
import { sheetNameForDate } from './xlsxExport';

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
  ['Kashentseva Mariia (Marsh)', 'KITCHEN', 4.3], ['Lundrigan William', 'KITCHEN', 6.15],
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

describe('private shows pay 100% to staff, with no cast', () => {
  const GOWER = { castSharePercent: 0, officeHours: 6, oddCentTo: 'staff' as const };
  const ACC = { castSharePercent: 0, officeHours: 0, oddCentTo: 'staff' as const };

  it('Gower: the whole total goes to staff over Bar+Service+50/50+Kitchen+Office', () => {
    const r = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast: [], staff, rules: GOWER,
    });
    expect(r.castPoolCents).toBe(0);
    expect(r.staffPoolCents).toBe(107253);
    expect(r.staffHoursTotal).toBe(69.56);
    // 1072.53 / 69.56 — double the public show's rate, since there is no split
    expect(r.staffRatePerHour).toBeCloseTo(15.418775, 5);
    expect(r.unallocatedCents).toBe(0);
    expect(r.reconciliationCents).toBe(0);
    const paid = r.staff.reduce((a, b) => a + b.amountCents, 0);
    expect(paid).toBe(107253);
  });

  it('ACC: no 50/50 and no office, so the denominator is smaller', () => {
    const accStaff = staff.filter(
      (s) => s.section !== 'FIFTY_FIFTY' && s.section !== 'OFFICE');
    const r = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast: [], staff: accStaff, rules: ACC,
    });
    expect(r.staffPoolCents).toBe(107253);
    // 36.72 Bar & Service + 22.87 Kitchen, without 3.97 and 6.00
    expect(r.staffHoursTotal).toBe(59.59);
    expect(r.staffRatePerHour).toBeCloseTo(17.998490, 5);
    expect(r.reconciliationCents).toBe(0);
    expect(r.staff.reduce((a, b) => a + b.amountCents, 0)).toBe(107253);
    expect(r.sectionTotals.find((t) => t.section === 'FIFTY_FIFTY')!.amountCents).toBe(0);
    expect(r.sectionTotals.find((t) => t.section === 'OFFICE')!.amountCents).toBe(0);
  });

  it('ACC does not warn about office hours it does not use', () => {
    const accStaff = staff.filter(
      (s) => s.section !== 'FIFTY_FIFTY' && s.section !== 'OFFICE');
    const r = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast: [], staff: accStaff, rules: ACC,
    });
    expect(r.warnings.join(' ')).not.toMatch(/office/i);
  });

  it('a private show pays each person strictly more than the public show would', () => {
    const pub = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast, staff, rules: DEFAULT_RULES,
    });
    const gow = calculate({
      gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
      totalOverrideCents: toCents(1072.53), cast: [], staff, rules: GOWER,
    });
    for (const g of gow.staff) {
      const p = pub.staff.find((x) => x.id === g.id)!;
      if (g.hours > 0) expect(g.amountCents).toBeGreaterThan(p.amountCents);
    }
  });
});

describe('the office is a fixed block of hours', () => {
  const rules = { castSharePercent: 50, officeHours: 6, oddCentTo: 'staff' as const };
  const base = {
    gratuityCents: 0, cashTipsCents: 0, squareTipsCents: 0,
    totalOverrideCents: toCents(1072.53), cast: [], rules,
  };
  const office = (n: number, hours: number[]) =>
    hours.slice(0, n).map((h, i) => ({
      id: `o${i}`, name: `Office ${i}`, section: 'OFFICE' as const,
      hours: h, included: true,
    }));
  const bar = [{
    id: 'b1', name: 'Bar One', section: 'BAR' as const, hours: 10, included: true,
  }];

  const officeTotal = (r: ReturnType<typeof calculate>) =>
    r.sectionTotals.find((t) => t.section === 'OFFICE')!.hours;

  it('totals exactly 6 hours however long people actually clocked', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(2, [5.78, 5.27])] });
    expect(officeTotal(r)).toBe(6);
  });

  it('splits those 6 hours equally between everyone who worked', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(2, [5.78, 5.27])] });
    const rows = r.staff.filter((s) => s.section === 'OFFICE');
    expect(rows.map((s) => s.hours)).toEqual([3, 3]);
  });

  it('ignores overtime entirely — 20 hours clocked is still a 6-hour block', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(1, [20])] });
    expect(officeTotal(r)).toBe(6);
    expect(r.staff.find((s) => s.section === 'OFFICE')!.hours).toBe(6);
  });

  it('keeps the block exact when it will not divide evenly', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(4, [1, 2, 3, 4])] });
    const rows = r.staff.filter((s) => s.section === 'OFFICE');
    expect(rows.map((s) => s.hours)).toEqual([1.5, 1.5, 1.5, 1.5]);
    expect(officeTotal(r)).toBe(6);
  });

  it('splits 6 between 7 without losing or inventing a minute', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(7, Array(7).fill(4))] });
    const rows = r.staff.filter((s) => s.section === 'OFFICE');
    expect(officeTotal(r)).toBe(6);
    expect(rows.reduce((a, s) => a + s.hours, 0)).toBeCloseTo(6, 10);
  });

  it('leaves out an office person who did not work', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(3, [5, 0, 7])] });
    const rows = r.staff.filter((s) => s.section === 'OFFICE');
    expect(rows.map((s) => s.hours)).toEqual([3, 0, 3]);
  });

  it('leaves out an office person who was unticked', () => {
    const staff = [...bar, ...office(2, [5, 5])];
    staff[2].included = false;
    const r = calculate({ ...base, staff });
    expect(r.staff.filter((s) => s.section === 'OFFICE').map((s) => s.hours))
      .toEqual([6, 0]);
  });

  it('holds the block rather than sharing it out when nobody worked it', () => {
    const r = calculate({ ...base, staff: [...bar, ...office(2, [0, 0])] });
    expect(r.unallocatedStaffCents).toBeGreaterThan(0);
    expect(r.reconciliationCents).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/office block/i);
  });

  it('still divides by the 6 hours when the office is empty', () => {
    const withOffice = calculate({ ...base, staff: [...bar, ...office(2, [0, 0])] });
    const barRow = withOffice.staff.find((s) => s.section === 'BAR')!;
    // 10 bar hours + 6 office hours = 16; the bar takes 10/16 of the pool.
    expect(barRow.amountCents).toBe(Math.round((53627 * 10) / 16));
  });
});

describe('hand-set amounts', () => {
  const workedIds = cast.filter((c) => c.worked).map((c) => c.id);

  it('pays a pinned cast member exactly what was typed', () => {
    const r = run({
      cast: cast.map((c) =>
        c.id === workedIds[0] ? { ...c, pinnedCents: toCents(100) } : c),
    });
    const pinned = r.cast.find((c) => c.id === workedIds[0])!;
    expect(pinned.amountCents).toBe(10000);
    expect(pinned.pinned).toBe(true);
  });

  it('still reconciles to the cent, with the rest sharing the remainder', () => {
    const r = run({
      cast: cast.map((c) =>
        c.id === workedIds[0] ? { ...c, pinnedCents: toCents(100) } : c),
    });
    expect(r.reconciliationCents).toBe(0);
    expect(r.overpaidCents).toBe(0);
    const castSum = r.cast.reduce((a, b) => a + b.amountCents, 0);
    expect(castSum).toBe(r.castPoolCents);
    // The others split what is left, so each is above the unpinned share.
    const others = r.cast.filter((c) => c.worked && c.id !== workedIds[0]);
    expect(others.every((c) => c.amountCents > 0)).toBe(true);
  });

  it('keeps the calculated figure beside the typed one', () => {
    const base = run();
    const r = run({
      cast: cast.map((c) =>
        c.id === workedIds[0] ? { ...c, pinnedCents: toCents(100) } : c),
    });
    const before = base.cast.find((c) => c.id === workedIds[0])!.amountCents;
    const after = r.cast.find((c) => c.id === workedIds[0])!;
    expect(after.calculatedCents).toBe(before);
    expect(after.amountCents).not.toBe(after.calculatedCents);
  });

  it('pins a staff row without disturbing the hours it reports', () => {
    const target = staff[0];
    const r = run({
      staff: staff.map((s) =>
        s.id === target.id ? { ...s, pinnedCents: toCents(50) } : s),
    });
    const row = r.staff.find((s) => s.id === target.id)!;
    expect(row.amountCents).toBe(5000);
    expect(row.pinned).toBe(true);
    expect(row.hours).toBe(target.hours);
    expect(r.reconciliationCents).toBe(0);
    expect(r.staff.reduce((a, b) => a + b.amountCents, 0))
      .toBe(r.staffPoolCents);
  });

  it('ignores a pin on a row that is not being paid', () => {
    const notWorked = cast.find((c) => !c.worked)!;
    const r = run({
      cast: cast.map((c) =>
        c.id === notWorked.id ? { ...c, pinnedCents: toCents(100) } : c),
    });
    const row = r.cast.find((c) => c.id === notWorked.id)!;
    expect(row.amountCents).toBe(0);
    expect(row.pinned).toBe(false);
    expect(r.reconciliationCents).toBe(0);
  });

  /**
   * Pinning more than the pool holds cannot be honoured and rebalanced at
   * once. It must report rather than throw, or a typo takes the sheet down.
   */
  it('reports an overspend instead of throwing', () => {
    const r = run({
      cast: cast.map((c) =>
        c.worked ? { ...c, pinnedCents: toCents(1000) } : c),
    });
    expect(r.overpaidCents).toBeGreaterThan(0);
    expect(r.warnings.some((w) => /more than the pool holds/i.test(w))).toBe(true);
  });

  it('changes nothing at all when no amount is pinned', () => {
    const plain = run();
    const withNulls = run({
      cast: cast.map((c) => ({ ...c, pinnedCents: null })),
      staff: staff.map((s) => ({ ...s, pinnedCents: null })),
    });
    expect(withNulls.cast.map((c) => c.amountCents))
      .toEqual(plain.cast.map((c) => c.amountCents));
    expect(withNulls.staff.map((s) => s.amountCents))
      .toEqual(plain.staff.map((s) => s.amountCents));
  });
});

describe('a payout typed against a row that is not ticked', () => {
  it('says so rather than swallowing it', () => {
    const notWorked = cast.find((c) => !c.worked)!;
    const r = run({
      cast: cast.map((c) =>
        c.id === notWorked.id ? { ...c, pinnedCents: toCents(100) } : c),
    });
    expect(r.warnings.some((w) => w.includes(notWorked.name))).toBe(true);
    expect(r.warnings.some((w) => /not\s+ticked/i.test(w))).toBe(true);
  });
});

describe('pinning the only person who is eligible', () => {
  /**
   * Regression: pinning the sole ticked cast member left the remainder with
   * no recipient, and the allocator threw "Cast allocation lost cents"
   * rather than holding it — which took the whole sheet down.
   */
  const onlyOne = cast.map((c, i) => ({ ...c, worked: i === 0 }));

  it('holds the remainder instead of throwing', () => {
    const r = run({
      cast: onlyOne.map((c, i) =>
        i === 0 ? { ...c, pinnedCents: toCents(100) } : c),
    });
    expect(r.cast[0].amountCents).toBe(10000);
    expect(r.unallocatedCastCents).toBe(r.castPoolCents - 10000);
    expect(r.reconciliationCents).toBe(0);
  });

  it('says the held money has not been paid out', () => {
    const r = run({
      cast: onlyOne.map((c, i) =>
        i === 0 ? { ...c, pinnedCents: toCents(100) } : c),
    });
    expect(r.warnings.some((w) => /unallocated and has NOT been paid/i.test(w)))
      .toBe(true);
  });

  it('still holds the whole pool when nobody is ticked at all', () => {
    const r = run({ cast: cast.map((c) => ({ ...c, worked: false })) });
    expect(r.unallocatedCastCents).toBe(r.castPoolCents);
    expect(r.reconciliationCents).toBe(0);
  });
});

describe('sheetNameForDate', () => {
  it('names the tab as the fortnightly workbook does', () => {
    expect(sheetNameForDate('2026-09-08')).toBe('Sept-08-2026');
    expect(sheetNameForDate('2026-10-04')).toBe('Oct-04-2026');
  });
});
