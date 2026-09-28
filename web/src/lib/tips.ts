/**
 * The Spirit tip engine. See docs/TIP_LOGIC.md.
 *
 * Total tips split by percentage between Cast & Musicians and Staff.
 * Cast are paid PER HEAD (weighted by ratio). Staff are paid PER HOUR.
 * All arithmetic is in integer cents and every pool reconciles exactly.
 */
import { Cents, allocateByWeight, splitPool, toCents } from './money';

export type Section = 'BAR' | 'SERVICE' | 'FIFTY_FIFTY' | 'KITCHEN' | 'OFFICE';

export const SECTION_LABEL: Record<Section, string> = {
  BAR: 'Bartenders',
  SERVICE: 'Servers',
  FIFTY_FIFTY: '50/50',
  KITCHEN: 'Kitchen',
  OFFICE: 'Office / reservations',
};

/** Bar and Service are reported as one combined section on the sheet. */
export const BAR_SERVICE: Section[] = ['BAR', 'SERVICE'];

export interface CastEntry {
  id: string;
  name: string;
  /** Weighting lever. 1 = a full share. Currently always 1 in practice. */
  ratio: number;
  worked: boolean;
  /** Technical is paid from the cast pool but listed separately. */
  technical?: boolean;
  /** Hand-set payout. null means "work it out from the pool". */
  pinnedCents?: Cents | null;
}

export interface StaffEntry {
  id: string;
  name: string;
  section: Section;
  hours: number;
  /** Excluded rows stay visible with a reason, never deleted. */
  included: boolean;
  note?: string;
  /** Hand-set payout. null means "work it out from the hours". */
  pinnedCents?: Cents | null;
}

export interface RuleSet {
  /** Percentage of the total going to Cast & Musicians. */
  castSharePercent: number;
  /** Fixed hours credited to the Office section, split across its members. */
  officeHours: number;
  /** Who gets the extra cent when the split is not exactly representable. */
  oddCentTo: 'cast' | 'staff';
}

export const DEFAULT_RULES: RuleSet = {
  castSharePercent: 50,
  officeHours: 6,
  oddCentTo: 'staff',
};

export interface EventInput {
  gratuityCents: Cents;
  cashTipsCents: Cents;
  squareTipsCents: Cents;
  /** When the components are unknown, set the total directly. */
  totalOverrideCents?: Cents | null;
  cast: CastEntry[];
  staff: StaffEntry[];
  rules: RuleSet;
}

export interface Payout {
  id: string;
  name: string;
  amountCents: Cents;
  /**
   * What the pool would have paid this row had nobody been pinned. Kept
   * beside the paid figure so a reviewer can see what a hand-set amount
   * changed, and by how much.
   */
  calculatedCents: Cents;
  /** True when amountCents was typed in rather than worked out. */
  pinned: boolean;
}

export interface CastPayout extends Payout {
  ratio: number;
  worked: boolean;
  technical: boolean;
}

export interface StaffPayout extends Payout {
  section: Section;
  hours: number;
}

export interface Result {
  totalCents: Cents;
  castPoolCents: Cents;
  staffPoolCents: Cents;
  /** Exact, unrounded, for display only — never used to compute a payout. */
  castRatePerShare: number;
  staffRatePerHour: number;
  castWorkedRatioTotal: number;
  staffHoursTotal: number;
  cast: CastPayout[];
  staff: StaffPayout[];
  sectionTotals: { section: Section; hours: number; amountCents: Cents }[];
  barServiceHours: number;
  barServiceCents: Cents;
  /** Per-person totals aggregated ACROSS sections — see TIP_LOGIC.md §8. */
  perPerson: { name: string; hours: number; amountCents: Cents; parts: string[] }[];
  /**
   * Pool money with nobody to receive it — e.g. no cast ticked as worked yet.
   * Surfaced rather than silently dropped, and never paid out.
   */
  unallocatedCents: Cents;
  unallocatedCastCents: Cents;
  unallocatedStaffCents: Cents;
  /** cast + staff + unallocated - total - overpaid. Always 0; asserted below. */
  reconciliationCents: Cents;
  /** How far hand-set amounts exceed the pool. 0 when nothing is overspent. */
  overpaidCents: Cents;
  /** What naive per-row rounding would have paid, and the resulting error. */
  naiveRoundedTotalCents: Cents;
  roundingDriftCents: Cents;
  warnings: string[];
}

/** Hours carry two decimals; scale to integers so weights stay exact. */
const hoursToWeight = (h: number) => Math.round(h * 100);

/**
 * Shares out a pool where some rows carry a hand-set amount.
 *
 * A pinned row is paid exactly what it was given and takes no part in the
 * division; what is left over is shared among the rest by weight, so the pool
 * still lands on the cent and the sheet still reconciles.
 *
 * Pinning more than the pool holds is a real mistake — it cannot be honoured
 * and rebalanced at the same time, since there is nothing left to rebalance.
 * The pins are paid, everyone else gets nothing, and the excess is returned
 * so the sheet can say so rather than quietly paying out money that was never
 * collected.
 */
function allocateWithPins(
  pool: Cents, weights: number[], pins: (Cents | null)[],
): { amounts: Cents[]; overpaidCents: Cents; undistributedCents: Cents } {
  const pinnedTotal = pins.reduce<Cents>((a, p) => a + (p ?? 0), 0);
  const remainder = pool - pinnedTotal;
  const free = Math.max(0, remainder);
  const freeWeights = weights.map((w, i) => (pins[i] == null ? w : 0));
  const freeWeightTotal = freeWeights.reduce((a, b) => a + b, 0);

  // Everyone left is pinned, or nobody is ticked: there is money over and
  // nobody eligible to receive it. Hold it rather than forcing it onto a
  // pinned row, which would contradict the amount that was typed.
  if (freeWeightTotal === 0) {
    return {
      amounts: weights.map((_, i) => pins[i] ?? 0),
      overpaidCents: remainder < 0 ? -remainder : 0,
      undistributedCents: free,
    };
  }

  const shared = allocateByWeight(free, freeWeights);
  return {
    amounts: weights.map((_, i) => pins[i] ?? shared[i]),
    overpaidCents: remainder < 0 ? -remainder : 0,
    undistributedCents: 0,
  };
}

/** A pin only counts when the row is actually being paid. */
const pinOf = (active: boolean, pinned: Cents | null | undefined) =>
  active && pinned != null ? pinned : null;

/**
 * The office is paid as a fixed block of hours, set by the rule set and
 * divided equally between whoever is ticked as having worked it. What the
 * timecard says those people clocked — overtime included — does not change
 * it: the block is the office's share of the night, not a record of time.
 *
 * Returns hours per row index, or undefined for rows this does not govern,
 * so the rest of the engine can go on reading each row's own hours.
 */
function officeHoursByRow(
  staff: StaffEntry[], officeHours: number,
): (number | undefined)[] {
  const out: (number | undefined)[] = staff.map(() => undefined);
  const manned = staff
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.section === 'OFFICE' && s.included && s.hours > 0);

  for (const { i } of staff.map((s, i) => ({ s, i }))
    .filter(({ s }) => s.section === 'OFFICE')) {
    out[i] = 0;
  }
  if (!manned.length || officeHours <= 0) return out;

  // Split in hundredths so the block totals exactly the hours set, however
  // many people share it: 6 hours between 4 is 1.50 each, between 7 is
  // 0.86 twice over and 0.85 for the rest.
  const shares = allocateByWeight(hoursToWeight(officeHours), manned.map(() => 1));
  manned.forEach(({ i }, k) => { out[i] = shares[k] / 100; });
  return out;
}

export function calculate(input: EventInput): Result {
  const { rules } = input;
  const warnings: string[] = [];

  const componentTotal =
    input.gratuityCents + input.cashTipsCents + input.squareTipsCents;
  const totalCents =
    input.totalOverrideCents != null ? input.totalOverrideCents : componentTotal;

  if (input.totalOverrideCents != null && componentTotal > 0 &&
      componentTotal !== input.totalOverrideCents) {
    warnings.push(
      `Total override (${totalCents / 100}) does not match the sum of gratuity, ` +
      `cash and Square tips (${componentTotal / 100}).`,
    );
  }

  const [castPoolCents, staffPoolCents] = splitPool(
    totalCents,
    rules.castSharePercent,
    rules.oddCentTo === 'cast' ? 'first' : 'second',
  );

  // ---- Cast: per head, weighted by ratio, only those who worked ----
  const castWeights = input.cast.map((c) =>
    c.worked ? Math.round(c.ratio * 100) : 0,
  );
  const castWorkedRatioTotal =
    castWeights.reduce((a, b) => a + b, 0) / 100;
  const castPins = input.cast.map((c) => pinOf(c.worked, c.pinnedCents));
  // The baseline is what the pool alone would have paid, so the sheet can
  // show a hand-set amount next to the figure it replaced.
  const castBaseline = allocateByWeight(castPoolCents, castWeights);
  const castAlloc = allocateWithPins(castPoolCents, castWeights, castPins);
  const castAmounts = castAlloc.amounts;
  const cast: CastPayout[] = input.cast.map((c, i) => ({
    id: c.id,
    name: c.name,
    ratio: c.ratio,
    worked: c.worked,
    technical: !!c.technical,
    amountCents: castAmounts[i],
    calculatedCents: castBaseline[i],
    pinned: castPins[i] != null,
  }));
  if (castWorkedRatioTotal === 0 && castPoolCents > 0) {
    warnings.push('No cast marked as worked — the cast pool cannot be distributed.');
  }

  // ---- Office: a fixed block, split equally, never read from a timecard ----
  // The rule set fixes the office at 6 hours. Whatever the timecard says
  // people actually clocked, overtime included, those 6 hours are the share
  // the office gets, divided equally between whoever is ticked as working.
  const officeHours = officeHoursByRow(input.staff, rules.officeHours);

  // ---- Staff: per hour, one rate across all sections ----
  const staffWeights = input.staff.map((s, i) =>
    s.included ? hoursToWeight(officeHours[i] ?? s.hours) : 0,
  );

  // The formula divides by "+ 6 office hours" whether or not anyone in the
  // office is ticked. With nobody there, that block has no recipient, so it
  // stays in the denominator and its money is held rather than spread over
  // everyone else.
  const officeUnmanned =
    rules.officeHours > 0 &&
    !input.staff.some((s) => s.section === 'OFFICE' && s.included && s.hours > 0);
  const phantomOfficeWeight = officeUnmanned ? hoursToWeight(rules.officeHours) : 0;

  const staffHoursTotal =
    (staffWeights.reduce((a, b) => a + b, 0) + phantomOfficeWeight) / 100;
  const staffPins = input.staff.map((s) => pinOf(s.included, s.pinnedCents));
  const staffBaselineAll = allocateByWeight(
    staffPoolCents, [...staffWeights, phantomOfficeWeight]);
  const staffBaselineHeld = staffBaselineAll.pop() ?? 0;

  // The unmanned office block is pinned to itself: it is a real claim on the
  // pool that no row can receive, so it must not be rebalanced away either.
  const staffAlloc = allocateWithPins(
    staffPoolCents,
    [...staffWeights, phantomOfficeWeight],
    [...staffPins, null],
  );
  const staffAmounts = staffAlloc.amounts;
  const heldOfficeCents = staffAmounts.pop() ?? 0;

  const staff: StaffPayout[] = input.staff.map((s, i) => ({
    id: s.id,
    name: s.name,
    section: s.section,
    hours: officeHours[i] ?? s.hours,
    amountCents: staffAmounts[i],
    calculatedCents: staffBaselineAll[i],
    pinned: staffPins[i] != null,
  }));
  // A payout typed against somebody who is not ticked cannot be paid — the
  // tick is what says they were there. Ignoring it silently would leave
  // someone believing they had been paid, so name them.
  const ignoredPins = [
    ...input.cast.filter((c) => !c.worked && c.pinnedCents != null).map((c) => c.name),
    ...input.staff.filter((s) => !s.included && s.pinnedCents != null).map((s) => s.name),
  ];
  if (ignoredPins.length) {
    warnings.push(
      `A payout was typed for ${ignoredPins.join(', ')}, but ` +
      `${ignoredPins.length === 1 ? 'that row is' : 'those rows are'} not ` +
      `ticked, so it was not paid. Tick them to pay it.`,
    );
  }

  const overpaidCents = castAlloc.overpaidCents + staffAlloc.overpaidCents;
  if (overpaidCents > 0) {
    warnings.push(
      `Hand-set amounts come to ${(overpaidCents / 100).toFixed(2)} more than ` +
      `the pool holds. Everyone not hand-set has been left at 0.00, and the ` +
      `sheet no longer balances — lower the typed amounts to fix it.`,
    );
  }
  if (officeUnmanned) {
    warnings.push(
      `The office block of ${rules.officeHours.toFixed(2)} hours has nobody ` +
      `ticked, so its share is held rather than paid to the other sections.`,
    );
  }
  if (staffHoursTotal === 0 && staffPoolCents > 0) {
    warnings.push('No staff hours entered — the staff pool cannot be distributed.');
  }

  // ---- Section rollups ----
  const sections: Section[] = ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];
  const sectionTotals = sections.map((section) => {
    const rows = staff.filter((s) => s.section === section);
    return {
      section,
      hours: round2(rows.reduce((a, b) => a + b.hours, 0)),
      amountCents: rows.reduce((a, b) => a + b.amountCents, 0),
    };
  });
  const bs = sectionTotals.filter((t) => BAR_SERVICE.includes(t.section));
  const barServiceHours = round2(bs.reduce((a, b) => a + b.hours, 0));
  const barServiceCents = bs.reduce((a, b) => a + b.amountCents, 0);


  // ---- Per-person aggregation across sections ----
  const byName = new Map<string, { name: string; hours: number; amountCents: Cents; parts: string[] }>();
  for (const s of staff) {
    if (s.amountCents === 0 && s.hours === 0) continue;
    const key = normalise(s.name);
    const e = byName.get(key) ?? { name: s.name, hours: 0, amountCents: 0, parts: [] };
    e.hours = round2(e.hours + s.hours);
    e.amountCents += s.amountCents;
    e.parts.push(`${SECTION_LABEL[s.section]} ${s.hours.toFixed(2)}h`);
    byName.set(key, e);
  }
  for (const c of cast) {
    if (c.amountCents === 0) continue;
    const key = normalise(c.name);
    const e = byName.get(key) ?? { name: c.name, hours: 0, amountCents: 0, parts: [] };
    e.amountCents += c.amountCents;
    e.parts.push(c.technical ? 'Technical' : 'Cast');
    byName.set(key, e);
  }
  const perPerson = [...byName.values()].sort((a, b) => b.amountCents - a.amountCents);

  // ---- Reconciliation ----
  const castSum = cast.reduce((a, b) => a + b.amountCents, 0);
  const staffSum = staff.reduce((a, b) => a + b.amountCents, 0);

  // A pool with no eligible recipients cannot be distributed. That is a real
  // state (nobody ticked yet), not a bug — hold the money visibly instead.
  const unallocatedCastCents = castAlloc.undistributedCents;
  const unallocatedStaffCents =
    staffAlloc.undistributedCents + heldOfficeCents;

  // With recipients present, the allocator must place every cent. These
  // assertions catch a genuine allocation bug without firing on the empty
  // case above, and allow for hand-set amounts that exceed their pool: that
  // overspend is the operator's doing, not a lost cent, and it is reported
  // rather than thrown.
  if (castSum !== castPoolCents - unallocatedCastCents + castAlloc.overpaidCents) {
    throw new Error(
      `Cast allocation lost cents: ${castSum} != ${castPoolCents - unallocatedCastCents}`,
    );
  }
  if (staffSum !== staffPoolCents - unallocatedStaffCents + staffAlloc.overpaidCents) {
    throw new Error(
      `Staff allocation lost cents: ${staffSum} != ${staffPoolCents - unallocatedStaffCents}`,
    );
  }

  const unallocatedCents = unallocatedCastCents + unallocatedStaffCents;
  // Non-zero only when hand-set amounts overshoot; CHECK on the sheet shows
  // it, which is the whole point of surfacing it instead of throwing.
  const reconciliationCents =
    castSum + staffSum + unallocatedCents - totalCents - overpaidCents;
  if (reconciliationCents !== 0) {
    throw new Error(
      `Tip allocation failed to reconcile: ${castSum} + ${staffSum} + ` +
      `${unallocatedCents} != ${totalCents}`,
    );
  }
  if (unallocatedCents > 0) {
    warnings.push(
      `${(unallocatedCents / 100).toFixed(2)} is unallocated and has NOT been ` +
      `paid out. Tick who worked, or enter hours, to distribute it.`,
    );
  }

  // ---- Display rates ----
  // These come from the EXACT, unrounded pool halves, matching the spreadsheet's
  // own basis (§6). Payouts above use the integer-cent pools instead; the two
  // differ by at most half a cent per pool, which is why the drift below exists.
  const exactCastPool = (totalCents * rules.castSharePercent) / 100;
  const exactStaffPool = totalCents - exactCastPool;
  const castRatePerShare =
    castWorkedRatioTotal > 0 ? exactCastPool / 100 / castWorkedRatioTotal : 0;
  const staffRatePerHour =
    staffHoursTotal > 0 ? exactStaffPool / 100 / staffHoursTotal : 0;
  const naiveRoundedTotalCents =
    input.cast.reduce(
      (a, c) => a + (c.worked ? Math.round(c.ratio * castRatePerShare * 100) : 0),
      0,
    ) +
    input.staff.reduce(
      (a, s) => a + (s.included ? Math.round(s.hours * staffRatePerHour * 100) : 0),
      0,
    );

  return {
    totalCents,
    overpaidCents,
    castPoolCents,
    staffPoolCents,
    castRatePerShare,
    staffRatePerHour,
    castWorkedRatioTotal,
    staffHoursTotal: round2(staffHoursTotal),
    cast,
    staff,
    sectionTotals,
    barServiceHours,
    barServiceCents,
    perPerson,
    unallocatedCents,
    unallocatedCastCents,
    unallocatedStaffCents,
    reconciliationCents,
    naiveRoundedTotalCents,
    roundingDriftCents: naiveRoundedTotalCents - totalCents,
    warnings,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const normalise = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '');

export { toCents };
