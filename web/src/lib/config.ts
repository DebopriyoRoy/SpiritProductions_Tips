import { RuleSet, Section } from './tips';

export interface LocationConfig {
  id: string;
  name: string;
  /** Square location id. Empty until the Square account is connected. */
  squareLocationId: string;
  timezone: string;
  showTypes: ShowType[];
  rules: RuleSet;
}

export interface ShowType {
  id: string;
  label: string;
}

/** Both venues sit under ONE Square merchant account — location is a filter. */
export const LOCATIONS: LocationConfig[] = [
  {
    id: 'spirit',
    name: 'Spirit Theater',
    squareLocationId: process.env.SQUARE_LOCATION_SPIRIT ?? '',
    timezone: 'America/St_Johns',
    showTypes: [
      { id: 'public', label: 'Public Show' },
      { id: 'private-gower', label: 'Private Show at Gower (off-site)' },
    ],
    rules: { castSharePercent: 50, officeHours: 6, oddCentTo: 'staff' },
  },
  {
    id: 'acc',
    name: 'ACC Arts and Culture Center',
    squareLocationId: process.env.SQUARE_LOCATION_ACC ?? '',
    timezone: 'America/St_Johns',
    showTypes: [
      { id: 'public', label: 'Public Show' },
      { id: 'private-acc', label: 'Private Show at ACC' },
    ],
    // UNCONFIRMED: ACC may not use the same split or office hours as Spirit.
    rules: { castSharePercent: 50, officeHours: 6, oddCentTo: 'staff' },
  },
];

export const getLocation = (id: string) =>
  LOCATIONS.find((l) => l.id === id);

export const SECTIONS: Section[] =
  ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];
