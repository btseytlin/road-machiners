// The uncatalogued id check: every id the game can show has its words in every language. Ids of a closed union,
// like goal reasons, notes and refusals, are checked by tsc where src/text/names.ts builds their keys. This test
// covers the ids that live in data records.
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { LINE_IDS } from '../data/dialogue';
import { GOODS } from '../data/goods';
import { FEMALE_NAMES, FIRST_NAMES, NPCS, SURNAMES, TRAITS } from '../data/npcs';
import { PARTS } from '../data/parts';
import { DIRECTIONS, RADIO_VARIANTS } from '../data/radio';
import { REGION } from '../data/region';
import { PERK_IDS, SKILL_IDS } from '../data/skills';
import { TERRAIN_TYPES } from '../data/terrain';
import { EN } from './en';
import { RU } from './ru';

const ids = <T>(record: Record<string, T>): string[] => Object.keys(record);

const REQUIRED: [string, string[]][] = [
  ['part', ids(PARTS).map((id) => `part.${id}`)],
  ['chassis', ids(CHASSIS).map((id) => `chassis.${id}`)],
  ['good', ids(GOODS).flatMap((id) => [`good.${id}`, `good.${id}.lower`, `good.${id}.subject`, `good.${id}.short`])],
  ['NPC template', ids(NPCS).flatMap((id) => [`npc.${id}`, `npc.${id}.profession`])],
  ['site', [...REGION.towns, ...REGION.locations].map((s) => `site.${s.id}`)],
  ['terrain', ids(TERRAIN_TYPES).map((id) => `terrain.${id}`)],
  ['driver name', [...FIRST_NAMES.map((n) => `driver.first.${n}`), ...SURNAMES.flatMap((n) => [`driver.last.${n}`, `driver.last.${n}.f`])]],
  ['trait', ids(TRAITS).map((id) => `trait.${id}`)],
  ['skill', SKILL_IDS.flatMap((id) => [`skill.${id}`, `skill.${id}.grows`])],
  ['perk', PERK_IDS.flatMap((id) => [`perk.${id}`, `perk.${id}.rule`])],
  ['radio line', LINE_IDS.map((id) => `line.${id}`)],
  ['broadcast', Object.entries(RADIO_VARIANTS).flatMap(([topic, n]) => Array.from({ length: n }, (_, i) => `radio.${topic}.${i}`))],
  ['direction', DIRECTIONS.flatMap((d) => [`radio.basin.${d}`, `radio.heading.${d}`])],
];

describe('every runtime id', () => {
  it.each(REQUIRED)('of each %s has English and Russian words', (_kind, keys) => {
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in EN))).toEqual([]);
    expect(keys.filter((key) => !(key in RU))).toEqual([]);
  });

  it('marks only listed first names as female', () => {
    expect([...FEMALE_NAMES].filter((n) => !FIRST_NAMES.includes(n))).toEqual([]);
  });

  it('has no broadcast variant beyond the counts in the data', () => {
    const counted = new Set(REQUIRED.find(([kind]) => kind === 'broadcast')![1]);
    const listed = Object.keys(EN).filter((key) => /^radio\.\w+\.\d+$/.test(key));
    expect(listed.filter((key) => !counted.has(key))).toEqual([]);
  });
});
