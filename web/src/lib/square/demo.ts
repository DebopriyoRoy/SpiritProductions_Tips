import { SquareProvider, SquareLocation, SyncResult } from './types';

/**
 * Demo provider so the app runs with no Square credentials.
 *
 * Spirit / 2026-08-28 returns the real Forever Country timecards, so a sync
 * reproduces the verified figures end to end. Other dates return a small
 * plausible roster. This exists for development and review only.
 */
const FOREVER_COUNTRY: [string, string, number][] = [
  ['Dickson Joleen', 'Bartender', 5.73],
  ['Gordon Daniel', 'Bartender', 5.0],
  ['Sweetapple Deborah', 'Server Manager', 4.88],
  ['Khrystyna Zavadetska', 'Service', 3.55],
  ['Martynova Olena', 'Service', 7.38],
  ['Polski Maksym', 'Busser', 4.83],
  ['Pynn Jackie', 'Service', 5.35],
  ['Pasechniuk Yana', '50/50', 3.97],
  ['Kashentseva Mariia (Marsh)', 'Kitchen', 4.3],
  ['Lundrigan William', 'Kitchen', 6.15],
  ["O'Reilly Colleen", 'Chef', 8.0],
  ['Wall James (Jordon)', 'Kitchen', 4.42],
];

export class DemoProvider implements SquareProvider {
  readonly kind = 'demo' as const;

  async listLocations(): Promise<SquareLocation[]> {
    return [
      { id: 'demo-spirit', name: 'Spirit Theater', timezone: 'America/St_Johns' },
      { id: 'demo-acc', name: 'ACC Arts and Culture Center', timezone: 'America/St_Johns' },
    ];
  }

  async sync(locationId: string, dateISO: string): Promise<SyncResult> {
    const rows = dateISO === '2026-08-28'
      ? FOREVER_COUNTRY
      : FOREVER_COUNTRY.slice(0, 6).map(([n, t, h]) =>
          [n, t, Math.round((h * 0.8 + 0.4) * 100) / 100] as [string, string, number]);

    const start = `${dateISO}T18:00:00Z`;
    return {
      provider: 'demo',
      locationId,
      timecards: rows.map(([name, wageTitle, hours], i) => ({
        id: `demo-tc-${dateISO}-${i}`,
        teamMemberId: `demo-tm-${i}`,
        name,
        wageTitle,
        startAt: start,
        endAt: new Date(Date.parse(start) + hours * 3600_000).toISOString(),
        breakMinutes: 0,
        declaredCashTipCents: 0,
      })),
      payments: [],
      unattributedTipCents: 0,
      openTimecards: 0,
      warnings: [
        'Demo provider: no Square credentials configured, so these timecards are ' +
        'sample data. Set SQUARE_ACCESS_TOKEN to sync the real account.',
      ],
    };
  }
}
