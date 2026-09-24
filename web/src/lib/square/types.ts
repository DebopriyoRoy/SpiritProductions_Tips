export interface SquareLocation {
  id: string;
  name: string;
  timezone: string;
}

export interface SquareTimecard {
  id: string;
  teamMemberId: string;
  name: string;
  /** Square's wage title — the job for THAT shift, not the person. */
  wageTitle: string;
  startAt: string;
  endAt: string | null;
  breakMinutes: number;
  declaredCashTipCents: number;
}

export interface SquareTipPayment {
  id: string;
  teamMemberId: string | null;
  tipCents: number;
  createdAt: string;
}

export interface SyncResult {
  provider: 'square' | 'demo';
  locationId: string;
  timecards: SquareTimecard[];
  payments: SquareTipPayment[];
  /** Tips Square could not attribute — team member was not on a cash drawer. */
  unattributedTipCents: number;
  openTimecards: number;
  warnings: string[];
}

export interface SquareProvider {
  readonly kind: 'square' | 'demo';
  listLocations(): Promise<SquareLocation[]>;
  sync(locationId: string, dateISO: string, timezone: string): Promise<SyncResult>;
}
