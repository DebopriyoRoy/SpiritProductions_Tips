/**
 * Money is always integer cents. Never floats — see docs/TIP_LOGIC.md §6.
 */
export type Cents = number;

export function toCents(value: number | string): Cents {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${value}`);
  return Math.round(n * 100);
}

export function fmt(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * Split a pool across integer weights so the parts sum to the pool EXACTLY.
 * Largest-remainder method: floor every share, then hand the leftover cents to
 * the largest fractional remainders (ties broken by original order).
 */
export function allocateByWeight(pool: Cents, weights: number[]): Cents[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);

  const base = weights.map((w) => Math.floor((pool * w) / total));
  const rem = weights.map((w) => (pool * w) % total);
  let leftover = pool - base.reduce((a, b) => a + b, 0);

  const order = rem
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r - a.r) || (a.i - b.i));

  const out = [...base];
  for (let k = 0; leftover > 0; k++, leftover--) out[order[k % order.length].i] += 1;
  return out;
}

/**
 * Split the total into two pools by percentage, exactly. `oddCentTo` decides
 * who receives the half-cent when the split is not representable — with a
 * 50/50 split of an odd number of cents, someone must get the extra one.
 */
export function splitPool(
  total: Cents,
  percentToFirst: number,
  oddCentTo: 'first' | 'second',
): [Cents, Cents] {
  const exact = (total * percentToFirst) / 100;
  let first = Math.floor(exact);
  if (oddCentTo === 'first' && first < exact) first += 1;
  return [first, total - first];
}
