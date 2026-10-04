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
  // Square spells the surname Griffin and uses the short given name. Without
  // this the 50/50 row never matched, so the whole section imported as zero.
  'Griffan Katie': ['Griffin Kate'],
  // Penny on the roster, Penney in Square — one e apart, one person.
  'Penny Linda': ['Penney Linda'],
  // The roster carries his nickname in brackets, which the match strips;
  // Square files him under it as his given name, spelled Jordan.
  'Wall James (Jordon)': ['Wall Jordan'],
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
  /**
   * A night with no show, only screech-in: no show pool, no cast, no staff
   * sections. The sheet is just the screech-in sessions.
   */
  screechOnly?: boolean;
  roster: Partial<Record<Section, string[]>>;
}

/**
 * The three show types differ in more than cosmetics. The public show and the
 * Gower private show both split the pool with the cast; the ACC private show
 * pays 100% to staff and has no cast at all, and also drops the 50/50 and
 * Office sections entirely, narrowing the denominator.
 *
 * castSharePercent is only the starting value. It is copied onto the event
 * when the show is created and edited per night on the sheet, so a contract
 * that splits differently is a field change, not a code change.
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
      'Cast & Musicians = 50% of total tips / ratio of cast who worked. ' +
      'Service, Kitchen, Bar and Office = 50% of total tips / ' +
      '(Bar & Service + 50/50 + Kitchen + 6 office hours).',
    rules: { castSharePercent: 50, officeHours: 6, oddCentTo: 'staff' },
    hasCast: true,
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

  'screech-in': {
    id: 'screech-in',
    label: 'Screech-In only',
    formula:
      'Screech-In tips are split equally between the host and any helpers. ' +
      'They are not part of any show pool.',
    rules: { castSharePercent: 0, officeHours: 0, oddCentTo: 'staff' },
    hasCast: false,
    sections: [],
    hasContractService: false,
    screechOnly: true,
    roster: {},
  },
};

/**
 * Everyone on any roster, for picking a screech-in host. Hosts come from
 * anywhere — office, cast, bar — so the list is the whole company, and names
 * are spelled as the rosters spell them so their show pay and screech-in meet
 * on the "Total for" line.
 */
export function everyone(): string[] {
  const out = new Set<string>();
  for (const show of Object.values(SHOW_TYPES)) {
    for (const names of Object.values(show.roster)) for (const n of names ?? []) out.add(n);
  }
  for (const c of CAST) out.add(c.split('|')[0]);
  return [...out].sort((a, b) => a.localeCompare(b));
}

export interface LocationConfig {
  id: string;
  name: string;
  squareLocationId: string;
  timezone: string;
  showTypeIds: string[];
  /**
   * Sections this venue runs, whatever the show type says. Omitted means the
   * show type decides. A venue can only narrow a show type, never widen it.
   */
  sections?: Section[];
  /** Set false where the venue never pays a cast, whatever the show type. */
  hasCast?: boolean;
}

/** Both venues sit under ONE Square merchant account — location is a filter. */
export const LOCATIONS: LocationConfig[] = [
  {
    id: 'spirit',
    name: 'Spirit Theater',
    squareLocationId: process.env.SQUARE_LOCATION_SPIRIT ?? '',
    timezone: 'America/St_Johns',
    showTypeIds: ['public', 'private-gower', 'screech-in'],
  },
  {
    id: 'acc',
    name: 'ACC Arts and Culture Center',
    squareLocationId: process.env.SQUARE_LOCATION_ACC ?? '',
    timezone: 'America/St_Johns',
    showTypeIds: ['public', 'private-acc'],
    // ACC runs no 50/50 float, keeps no reservations office, and pays no
    // cast — so a Public Show here is a narrower sheet than the same show
    // type at Spirit, which is unaffected by this.
    sections: ['BAR', 'SERVICE', 'KITCHEN'],
    hasCast: false,
  },
];

export const getLocation = (id: string) => LOCATIONS.find((l) => l.id === id);

export const getShowType = (id: string): ShowType =>
  SHOW_TYPES[id] ?? SHOW_TYPES.public;

export const showTypesFor = (loc: LocationConfig) =>
  loc.showTypeIds.map(getShowType);

/**
 * The show type as a given venue runs it.
 *
 * A show type describes the formula; a venue may narrow it. ACC has no 50/50
 * float, no reservations office and no cast, so a Public Show there is a
 * different sheet from a Public Show at Spirit despite sharing a name.
 *
 * Dropping a section must also drop what it contributes to the divisor, or
 * the pool is divided by hours nobody can be paid for: losing OFFICE zeroes
 * the fixed office hours, and losing the cast zeroes the cast share, which
 * would otherwise hold back a share for people the sheet never shows.
 */
/**
 * Rebuilds the sentence under "Rules for this show" from what the venue
 * actually runs. The hand-written formula on a show type describes it
 * unnarrowed, so leaving it alone would tell ACC staff their pool is divided
 * by a 50/50 float and six office hours that this venue does not have.
 */
function describeFormula(
  sections: Section[], hasCast: boolean, rules: RuleSet,
): string {
  const divisor: string[] = [];
  if (sections.includes('BAR') || sections.includes('SERVICE')) {
    divisor.push('Bar & Service');
  }
  if (sections.includes('FIFTY_FIFTY')) divisor.push('50/50');
  if (sections.includes('KITCHEN')) divisor.push('Kitchen');
  if (sections.includes('OFFICE') && rules.officeHours > 0) {
    divisor.push(`${rules.officeHours} office hours`);
  }

  const names: string[] = [];
  if (sections.includes('SERVICE')) names.push('Service');
  if (sections.includes('KITCHEN')) names.push('Kitchen');
  if (sections.includes('BAR')) names.push('Bar');
  if (sections.includes('OFFICE')) names.push('Office');
  const who = names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : (names[0] ?? 'Staff');

  const cast = hasCast
    ? `Cast & Musicians = ${rules.castSharePercent}% of total tips / ` +
      'ratio of cast who worked. '
    : '';
  const staffShare = hasCast
    ? `${100 - rules.castSharePercent}% of total tips`
    : 'total tips collected';

  return `${cast}${who} = ${staffShare} / (${divisor.join(' + ')}).`;
}

export function getShowTypeForLocation(
  showTypeId: string, locationId: string,
): ShowType {
  const show = getShowType(showTypeId);
  const loc = getLocation(locationId);
  if (!loc) return show;

  const sections = loc.sections
    ? show.sections.filter((s) => loc.sections!.includes(s))
    : show.sections;
  const hasCast = loc.hasCast === false ? false : show.hasCast;

  if (sections.length === show.sections.length && hasCast === show.hasCast) {
    return show;
  }

  const roster: Partial<Record<Section, string[]>> = {};
  for (const s of sections) roster[s] = show.roster[s];

  const rules: RuleSet = {
    ...show.rules,
    castSharePercent: hasCast ? show.rules.castSharePercent : 0,
    officeHours: sections.includes('OFFICE') ? show.rules.officeHours : 0,
  };

  return {
    ...show,
    sections,
    hasCast,
    roster,
    rules,
    formula: describeFormula(sections, hasCast, rules),
  };
}

export const SECTIONS: Section[] =
  ['BAR', 'SERVICE', 'FIFTY_FIFTY', 'KITCHEN', 'OFFICE'];
