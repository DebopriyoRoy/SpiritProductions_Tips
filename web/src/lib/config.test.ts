import { describe, it, expect } from 'vitest';
import {
  SHOW_TYPES, NAME_ALIASES, CAST, getShowTypeForLocation,
} from './config';
import { nameKey } from './timecardImport';

describe('the rosters', () => {
  const sectionsOf = (id: string) => Object.entries(SHOW_TYPES[id].roster);

  it('never lists the same person twice in one section', () => {
    for (const [id, show] of Object.entries(SHOW_TYPES)) {
      for (const [section, names] of Object.entries(show.roster)) {
        const keys = (names ?? []).map(nameKey);
        const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
        expect(dupes, `${id} / ${section} lists ${dupes.join(', ')} twice`)
          .toEqual([]);
      }
    }
  });

  it('keeps Mariia Zavadetska and Khrystyna Zavadetska apart', () => {
    expect(nameKey('Zavadetska Mariia')).not.toBe(nameKey('Khrystyna Zavadetska'));
  });

  it('lists nobody in the cast twice', () => {
    const keys = CAST.map((c) => nameKey(c.split('|')[0]));
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  /**
   * Which shows carry a cast decides who the pool is split with, so pin it
   * rather than leave it to be changed by accident.
   */
  it('gives a cast to the public and Gower shows, but not ACC', () => {
    expect(SHOW_TYPES.public.hasCast).toBe(true);
    expect(SHOW_TYPES['private-gower'].hasCast).toBe(true);
    expect(SHOW_TYPES['private-acc'].hasCast).toBe(false);
  });

  it('never gives a cast share to a show with no cast', () => {
    for (const [id, show] of Object.entries(SHOW_TYPES)) {
      if (!show.hasCast) {
        expect(show.rules.castSharePercent, `${id} pays a cast it does not have`)
          .toBe(0);
      } else {
        expect(show.rules.castSharePercent, `${id} has a cast but pays it nothing`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('has a section for every roster a show declares', () => {
    for (const [id, show] of Object.entries(SHOW_TYPES)) {
      for (const [section] of sectionsOf(id)) {
        expect(show.sections, `${id} rosters ${section} but never shows it`)
          .toContain(section);
      }
    }
  });
});

describe('name aliases', () => {
  const everyRosterName = () => {
    const out = new Set<string>();
    for (const show of Object.values(SHOW_TYPES)) {
      for (const names of Object.values(show.roster)) {
        for (const n of names ?? []) out.add(n);
      }
    }
    return out;
  };

  it('only aliases people who are actually on a roster', () => {
    for (const canonical of Object.keys(NAME_ALIASES)) {
      expect(everyRosterName(), `${canonical} is aliased but on no roster`)
        .toContain(canonical);
    }
  });

  it('never points an alias at a different real person', () => {
    const rosterKeys = new Set([...everyRosterName()].map(nameKey));
    for (const [canonical, others] of Object.entries(NAME_ALIASES)) {
      for (const other of others) {
        if (nameKey(other) === nameKey(canonical)) continue;
        expect(rosterKeys, `${other} is both an alias and a roster name`)
          .not.toContain(nameKey(other));
      }
    }
  });

  it('keeps the two Mariias apart — they are different people', () => {
    const kash = 'Kashentseva Mariia (Marsh)';
    const zav  = 'Zavadetska Mariia';
    expect(nameKey(kash)).not.toBe(nameKey(zav));

    // Neither one's aliases may reach the other, or a night's hours would be
    // paid to the wrong Mariia.
    for (const alias of NAME_ALIASES[kash] ?? []) {
      expect(nameKey(alias)).not.toBe(nameKey(zav));
    }
    for (const alias of NAME_ALIASES[zav] ?? []) {
      expect(nameKey(alias)).not.toBe(nameKey(kash));
    }
  });

  it("matches Square's spelling of Kashentseva straight off the roster", () => {
    expect(nameKey('Mariia Kashentseva')).toBe(nameKey('Kashentseva Mariia (Marsh)'));
  });

  /**
   * These four spellings all appeared in one 26 Aug 2026 export and matched
   * nobody, which imported the whole 50/50 section as zero. An alias is only
   * consulted by key, so assert the key the file actually produces.
   */
  it("resolves the spellings Square used on 26 Aug 2026", () => {
    const resolves = (squareName: string, rosterName: string) => {
      const aliases = NAME_ALIASES[rosterName] ?? [];
      const hit = aliases.some((a) => nameKey(a) === nameKey(squareName));
      expect(hit || nameKey(squareName) === nameKey(rosterName),
        `Square's "${squareName}" does not reach roster "${rosterName}"`).toBe(true);
    };
    resolves('Griffin, Kate', 'Griffan Katie');
    resolves('Penney, Linda', 'Penny Linda');
    resolves('Wall, Jordan', 'Wall James (Jordon)');
    resolves('Zavadetska, Marila', 'Zavadetska Mariia');
  });
});

/**
 * A show type says how the pool is split; the venue says who worked the room.
 * A public show at ACC used to seed the Spirit bartenders, so an ACC-only
 * bartender matched nobody on import and stayed at zero hours for the night.
 */
describe('a venue that staffs a section from its own team', () => {
  const barAt = (showType: string, location: string) =>
    getShowTypeForLocation(showType, location).roster.BAR ?? [];

  it('gives a public show at ACC the ACC bartenders', () => {
    expect(barAt('public', 'acc')).toContain('Pynn Montana');
    expect(barAt('public', 'acc')).toContain('Harris John');
  });

  it('does not leave the Spirit-only bartenders on an ACC sheet', () => {
    expect(barAt('public', 'acc')).not.toContain('Dickson Joleen');
    expect(barAt('public', 'acc')).not.toContain('Gordon Daniel');
  });

  it('runs the ACC bar from one team whatever the show type', () => {
    expect(barAt('private-acc', 'acc')).toEqual(barAt('public', 'acc'));
  });

  it('leaves the same show type at Spirit untouched', () => {
    expect(barAt('public', 'spirit')).toEqual(SHOW_TYPES.public.roster.BAR);
    expect(barAt('public', 'spirit')).not.toContain('Pynn Montana');
  });

  it('still takes the sections it does not override from the show type', () => {
    const acc = getShowTypeForLocation('public', 'acc');
    expect(acc.roster.SERVICE).toEqual(SHOW_TYPES.public.roster.SERVICE);
    expect(acc.roster.KITCHEN).toEqual(SHOW_TYPES.public.roster.KITCHEN);
  });

  /**
   * The ACC private show already names the ACC bartenders, so the venue
   * override changes nothing there and must not rewrite what it describes.
   */
  it('leaves a show type the venue agrees with completely alone', () => {
    expect(getShowTypeForLocation('private-acc', 'acc'))
      .toEqual(SHOW_TYPES['private-acc']);
  });

  /** Narrowing still has to hold: ACC runs no 50/50, no office and no cast. */
  it('keeps the venue narrowing it already did', () => {
    const acc = getShowTypeForLocation('public', 'acc');
    expect(acc.sections).toEqual(['BAR', 'SERVICE', 'KITCHEN']);
    expect(acc.hasCast).toBe(false);
    expect(acc.roster.FIFTY_FIFTY).toBeUndefined();
    expect(acc.roster.OFFICE).toBeUndefined();
  });
});

/**
 * The 12 Sep 2026 ACC export put three bartenders on the night and only one
 * of them reached the sheet: Square spells her surname Al-Lahut against the
 * roster's AL-Lahout, and Pynn Montana was not on the roster a public show
 * seeded at all. Both left real hours unpaid, so pin the whole file.
 */
describe("the 12 Sep 2026 ACC timecard", () => {
  const SQUARE_NAMES = ['Al-Deir, Butros', 'Pynn, Montana', 'Al-Lahut, Svitlana'];

  /** Resolves a name the way importTimecardAction does: roster, then aliases. */
  const rosterIndex = (names: string[]) => {
    const byKey = new Map(names.map((n) => [nameKey(n), n]));
    for (const [canonical, others] of Object.entries(NAME_ALIASES)) {
      if (!byKey.has(nameKey(canonical))) continue;
      for (const other of others) {
        if (!byKey.has(nameKey(other))) byKey.set(nameKey(other), canonical);
      }
    }
    return byKey;
  };

  it('lands every bartender on the sheet', () => {
    const bar = rosterIndex(getShowTypeForLocation('public', 'acc').roster.BAR ?? []);
    const unmatched = SQUARE_NAMES.filter((n) => !bar.has(nameKey(n)));
    expect(unmatched, `${unmatched.join(', ')} would import as zero hours`)
      .toEqual([]);
  });

  it('reaches Svitlana through the alias, not a guess', () => {
    expect(nameKey('Al-Lahut, Svitlana')).not.toBe(nameKey('AL-Lahout Svitlana'));
    const aliases = NAME_ALIASES['AL-Lahout Svitlana'] ?? [];
    expect(aliases.map(nameKey)).toContain(nameKey('Al-Lahut, Svitlana'));
  });
});
