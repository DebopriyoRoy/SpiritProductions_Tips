import {
  SquareProvider, SquareLocation, SquareTimecard, SquareTipPayment, SyncResult,
} from './types';

const API = (env: string) =>
  env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

/**
 * Live Square adapter.
 *
 * Uses the Timecards endpoints, not Shifts: Square renamed Shift to Timecard in
 * API version 2025-05-21 and deprecated /v2/labor/shifts/*. The API version is
 * pinned so a later rename cannot silently change response shapes.
 */
export class SquareClient implements SquareProvider {
  readonly kind = 'square' as const;
  private base: string;

  constructor(
    private token: string,
    private version = process.env.SQUARE_API_VERSION ?? '2025-05-21',
    env = process.env.SQUARE_ENVIRONMENT ?? 'sandbox',
  ) {
    this.base = API(env);
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'Square-Version': this.version,
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Square ${path} -> ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async listLocations(): Promise<SquareLocation[]> {
    const r = await this.call<{ locations?: any[] }>('/v2/locations');
    return (r.locations ?? []).map((l) => ({
      id: l.id, name: l.name, timezone: l.timezone ?? 'UTC',
    }));
  }

  /** Midnight-to-midnight in the LOCATION's timezone, not the server's. */
  private dayWindow(dateISO: string, timezone: string) {
    const offset = tzOffset(dateISO, timezone);
    return {
      start: `${dateISO}T00:00:00${offset}`,
      end: `${dateISO}T23:59:59${offset}`,
    };
  }

  async sync(locationId: string, dateISO: string, timezone: string): Promise<SyncResult> {
    const { start, end } = this.dayWindow(dateISO, timezone);
    const warnings: string[] = [];

    const members = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const r: any = await this.call<any>('/v2/team-members/search', {
        method: 'POST',
        body: JSON.stringify({
          cursor,
          query: { filter: { location_ids: [locationId], status: 'ACTIVE' } },
        }),
      });
      for (const m of r.team_members ?? []) {
        members.set(m.id, [m.given_name, m.family_name].filter(Boolean).join(' ').trim());
      }
      cursor = r.cursor;
    } while (cursor);

    const timecards: SquareTimecard[] = [];
    cursor = undefined;
    do {
      const r: any = await this.call<any>('/v2/labor/timecards/search', {
        method: 'POST',
        body: JSON.stringify({
          cursor,
          query: {
            filter: {
              location_ids: [locationId],
              start: { start_at: start, end_at: end },
            },
          },
        }),
      });
      for (const t of r.timecards ?? []) {
        timecards.push({
          id: t.id,
          teamMemberId: t.team_member_id,
          name: members.get(t.team_member_id) ?? t.team_member_id,
          wageTitle: t.wage?.title ?? '',
          startAt: t.start_at,
          endAt: t.end_at ?? null,
          breakMinutes: (t.breaks ?? []).reduce(
            (a: number, b: any) => a + minutesBetween(b.start_at, b.end_at), 0),
          declaredCashTipCents: t.declared_cash_tip_money?.amount ?? 0,
        });
      }
      cursor = r.cursor;
    } while (cursor);

    const payments: SquareTipPayment[] = [];
    let pcursor: string | undefined;
    do {
      const qs = new URLSearchParams({
        location_id: locationId, begin_time: start, end_time: end, limit: '100',
      });
      if (pcursor) qs.set('cursor', pcursor);
      const r: any = await this.call<any>(`/v2/payments?${qs}`);
      for (const p of r.payments ?? []) {
        const tip = p.tip_money?.amount ?? 0;
        if (tip > 0) {
          payments.push({
            id: p.id,
            teamMemberId: p.team_member_id ?? null,
            tipCents: tip,
            createdAt: p.created_at,
          });
        }
      }
      pcursor = r.cursor;
    } while (pcursor);

    const openTimecards = timecards.filter((t) => !t.endAt).length;
    if (openTimecards > 0) {
      warnings.push(
        `${openTimecards} timecard(s) are still open — hours are not final.`);
    }
    const unattributedTipCents = payments
      .filter((p) => !p.teamMemberId)
      .reduce((a, b) => a + b.tipCents, 0);
    if (unattributedTipCents > 0) {
      warnings.push(
        `${(unattributedTipCents / 100).toFixed(2)} of card tips have no team member ` +
        `(nobody was logged into a cash drawer). Assign them manually.`);
    }

    return {
      provider: 'square', locationId, timecards, payments,
      unattributedTipCents, openTimecards, warnings,
    };
  }
}

function minutesBetween(a?: string, b?: string) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}

/** Offset string (e.g. "-02:30") for a date in an IANA zone. */
export function tzOffset(dateISO: string, timeZone: string): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, timeZoneName: 'longOffset',
  }).formatToParts(d);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : '+00:00';
}
