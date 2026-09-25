import { describe, it, expect } from 'vitest';
import { SHOW_TYPES, NAME_ALIASES, CAST } from './config';
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

  it("carries Mariia's Square spelling", () => {
    expect(NAME_ALIASES['Zavadetska Mariia'].map(nameKey))
      .toContain(nameKey('Kashentseva, Mariia'));
  });
});
