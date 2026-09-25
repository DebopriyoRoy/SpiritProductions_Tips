import { RuleSet, Section } from './tips';

/**
 * Rosters as listed in TIPS_MODEL_FILE.xlsx. Everyone is seeded onto a new
 * show at 0.00 hours, the way the workbook lists the whole team and zeroes
 * those who did not work.
 */
const SPIRIT_BARTENDERS = [
  'AL-Lahout Svitlana', 'Butros Al-Deir', 'Dickson Joleen', 'Gordon Daniel',
  'James Brittany',
];

/** The ACC bar has its own team — not the Spirit list. */
const ACC_BARTENDERS = [
  'Al-Deir Butros', 'Al-Lahout Svitlana', 'Bobbit Neil', 'Halley Patrice',
  'Harris John', 'King Randy', 'Pynn Montana',
];

const SERVERS = [
  'Sweetapple Deborah', 'AL-Lahout Svitlana', 'Bobbitt Neil', 'Collier Melanie',
  'James Lukas', 'Khrystyna Zavadetska', 'Martynova Olena', 'Pasechniuk Yana',
  'Polski Maksym', 'Pynn Jackie', 'Penny Linda', 'Pynn Morgan',
  'Rittwage Molly', 'Talbot Emily',
];

const FIFTY_FIFTY = ['Griffan Katie', 'Pasechniuk Yana', 'Stacey Taylor'];

const KITCHEN = [
  'Barron Charlie', 'Kashentseva Mariia (Marsh)', 'Lundrigan Ash',
  'Lundrigan William', "O'Reilly Colleen", 'Samson Zachary', 'Stuckless Leslie',
  'Wall James (Jordon)', 'Zavadetska Mariia',
];

/**
 * Other spellings the same person appears under in Square's exports. The
 * workbook and Square do not always agree, and a timecard row that matches
 * nobody leaves that person unpaid.
 *
 * Two different people here are both Mariia — Kashentseva and Zavadetska —
 * so these aliases exist to keep each one's own spellings together, never to
 * bridge the two.
 *
 * The key is the roster name, exactly as written above. Only add a spelling
 * you have confirmed is the same person: an alias pays whoever it names.
 */
export const NAME_ALIASES: Record<string, string[]> = {
  // The workbook's spelling of her surname, kept so older sheets still match.
  // Square spells it Kashentseva, which is what the roster now uses.
  'Kashentseva Mariia (Marsh)': ['Kachensseva Mariia'],
  // Square renders her given name inconsistently. An alias on someone's own
  // record costs nothing if unused and cannot redirect anybody else.
  'Zavadetska Mariia': ['Marila Zavadetska'],
};

const OFFICE = [
  'Debopriyo Roy', 'Hillier Bridget', 'Khrystyna Zavadetska',
  'Pasechniuk Maryna', 'Pasechniuk Yana',
];

export const CAST = [
  'Blackwood, Adam|technical', 'Borden, Christa', 'Brennan, Bill',
  'Byrne, Patrick (Paddy)', 'Collins, Ron', 'Dawe Amanda', 'Dunne, Julia',
  'Fiore, Marco', 'Fitzpatrick Brandon', 'Jefford, Brad', 'Dicks Jeremy',
  'Pretty Caitlin', 'Etienne', 'Lasby, Dan', 'Mackey, Nathan', 'Howlett, Nick',
  'Noftle, Kara', 'Noseworthy, Natalie', 'Parsons, Dana', 'Power, Keith',
  'Small Andrew', 'Sears, Robyn', 'Fletcher Logan', 'Simms, Jeff',
  'Stamp, Paul (Boomer)', 'Williams John', 'Wilson, Amy',
];

export interface ShowType {
  id: string;
  label: string;
  /** The formula as written on the workbook sheet, shown in the UI. */
  formula: string;
  rules: RuleSet;
  /** Private shows have no Cast & Musicians block at all. */
  hasCast: boolean;
  /** Only these sections appear, in this order. */
  sections: Section[];
  /** "SERVICE REQUESTED AS PER CONTRACT" — private shows only. */
  hasContractService: boolean;
  roster: Partial<Record<Section, string[]>>;
}

/**
 * The three show types differ in more than cosmetics: the public show splits
 * the pool 50/50 with the cast, while BOTH private shows pay 100% to staff and
 * have no cast at all. ACC's private show also drops the 50/50 and Office
 * sections entirely, narrowing the denominator.
 */
export const SHOW_TYPES: Record<string, ShowType> = {
  public: {
    id: 'public',
    label: 'Public Show',
    formula:
      'Cast & Musicians = 50% of total tips / ratio of cast who worked. ' +
      'Service, Kitchen, Bar and Office = 50% of total tips / ' +
      '(Bar & Service + 50/50 + Kitchen + 6 office hours).',
    rules: { castSharePercent: 50, officeHours: 6, oddCentTo: 'staff' },
    hasCast: true,
    sections: ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'],
    hasContractService: false,
    roster: {
      BAR: SPIRIT_BARTENDERS, SERVICE: SERVERS,
      FIFTY_FIFTY: FIFTY_FIFTY, KITCHEN: KITCHEN, OFFICE: OFFICE,
    },
  },

  'private-gower': {
    id: 'private-gower',
    label: 'Private Show at Gower (off-site)',
    formula:
      'Service, Kitchen, Bar and Office = total tips collected / ' +
      '(Bar & Service + 50/50 + Kitchen + 6 office hours). No cast share.',
    rules: { castSharePercent: 0, officeHours: 6, oddCentTo: 'staff' },
    hasCast: false,
    sections: ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'],
    hasContractService: true,
    roster: {
      BAR: SPIRIT_BARTENDERS, SERVICE: SERVERS,
      FIFTY_FIFTY: FIFTY_FIFTY, KITCHEN: KITCHEN,
      // The workbook sheet lists no Office people, yet its formula still adds
      // 6 office hours. Seeded from the public roster so the hours have
      // someone to land on — see docs/TIP_LOGIC.md open questions.
      OFFICE: OFFICE,
    },
  },

  'private-acc': {
    id: 'private-acc',
    label: 'Private Show at ACC',
    formula:
      'Total tips collected / (Bar & Service + Kitchen). ' +
      'No cast share, no 50/50, no office hours.',
    rules: { castSharePercent: 0, officeHours: 0, oddCentTo: 'staff' },
    hasCast: false,
    sections: ['BAR', 'SERVICE', 'KITCHEN'],
    hasContractService: true,
    roster: { BAR: ACC_BARTENDERS, SERVICE: SERVERS, KITCHEN: KITCHEN },
  },
};

export interface LocationConfig {
  id: string;
  name: string;
  squareLocationId: string;
  timezone: string;
  showTypeIds: string[];
}

/** Both venues sit under ONE Square merchant account — location is a filter. */
export const LOCATIONS: LocationConfig[] = [
  {
    id: 'spirit',
    name: 'Spirit Theater',
    squareLocationId: process.env.SQUARE_LOCATION_SPIRIT ?? '',
    timezone: 'America/St_Johns',
    showTypeIds: ['public', 'private-gower'],
  },
  {
    id: 'acc',
    name: 'ACC Arts and Culture Center',
    squareLocationId: process.env.SQUARE_LOCATION_ACC ?? '',
    timezone: 'America/St_Johns',
    showTypeIds: ['public', 'private-acc'],
  },
];

export const getLocation = (id: string) => LOCATIONS.find((l) => l.id === id);

export const getShowType = (id: string): ShowType =>
  SHOW_TYPES[id] ?? SHOW_TYPES.public;

export const showTypesFor = (loc: LocationConfig) =>
  loc.showTypeIds.map(getShowType);

export const SECTIONS: Section[] =
  ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];
