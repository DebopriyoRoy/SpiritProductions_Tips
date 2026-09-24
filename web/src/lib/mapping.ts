import { Section } from './tips';

/**
 * Square's wage title is per-timecard (the job for that shift). Map it onto the
 * sheet's sections. Unknown titles land in SERVICE and are flagged, never
 * silently dropped.
 */
const RULES: [RegExp, Section][] = [
  [/bar(tender)?/i, 'BAR'],
  [/50\s*\/?\s*50|raffle/i, 'FIFTY_FIFTY'],
  [/kitchen|chef|cook|dish/i, 'KITCHEN'],
  [/office|reservation|admin/i, 'OFFICE'],
  [/server|service|busser|host/i, 'SERVICE'],
];

export function sectionForWageTitle(title: string): { section: Section; matched: boolean } {
  for (const [re, section] of RULES) {
    if (re.test(title)) return { section, matched: true };
  }
  return { section: 'SERVICE', matched: false };
}

/** Roles that are never tipped out of the staff pool. */
export function isNonTipped(title: string): boolean {
  return /cast|band|musician|tech(nical)?|cleaner/i.test(title);
}

export function hoursFromTimecard(
  startAt: string, endAt: string | null, breakMinutes: number,
): number {
  if (!endAt) return 0;
  const mins = Math.max(0, (Date.parse(endAt) - Date.parse(startAt)) / 60000 - breakMinutes);
  return Math.round((mins / 60) * 100) / 100;
}
