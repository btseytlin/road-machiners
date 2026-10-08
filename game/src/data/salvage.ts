// Loot tables, search speed and daily renewal for scavenging. Rolls draw through rng.ts.

import type { Weighted } from './npcs';
import type { Vec } from '../sim/vec';

export type LootRange = [number, number];

export type LootTable = {
  goods: Record<string, LootRange>;
  parts: LootRange;
  sparePartChance: number;
  spareParts: string[];
  fuel: LootRange;
  supplies: LootRange;
};

export const FIELD_SPARE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 },
  { value: 1, weight: 3 },
  { value: 2, weight: 4 },
  { value: 3, weight: 3 },
  { value: 4, weight: 2 },
];

export const SALVAGE = {
  unitsPerTurn: 2,
  pileTurns: 400,
  claimTurns: 60,
  pileSearchTurns: 1,
  coreValueShare: 0.03,
  restockShare: 0.08,
  wreckClearDays: 3,
  landmark: {
    goods: { scrap: [1, 2], salt: [0, 1], meds: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.2,
    spareParts: ['stockEngine', 'plates', 'cage', 'mg', 'emitter', 'emitter', 'scrapersKnife', 'scrapersKnife'],
    fuel: [0, 8],
    supplies: [0, 3],
  } as LootTable,
  roadWreck: {
    goods: { scrap: [1, 1] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'rack', 'flatFour', 'caltrops', 'caltrops'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  hullScrap: {
    goods: { scrap: [1, 2] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'plates', 'flatFour', 'oilSpiller', 'oilSpiller'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  farmStores: {
    goods: { grain: [0, 1], textiles: [0, 1], scrap: [0, 1] },
    parts: [0, 1],
    sparePartChance: 0.05,
    spareParts: ['flatFour', 'rack'],
    fuel: [0, 4],
    supplies: [0, 2],
  } as LootTable,
  armyStores: {
    goods: { scrap: [0, 1], meds: [0, 1] },
    parts: [0, 1],
    sparePartChance: 0.15,
    spareParts: ['mg', 'plates', 'cage', 'sprout', 'sprout', 'flareCannon', 'flareCannon', 'smokeMortar', 'smokeMortar', 'harpoon', 'harpoon'],
    fuel: [0, 2],
    supplies: [0, 2],
  } as LootTable,
  engineScrap: {
    goods: { scrap: [1, 2], batteries: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.2,
    spareParts: ['stockEngine', 'flatFour', 'plates', 'cage'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  cityStores: {
    goods: { textiles: [0, 1], water: [0, 1], meds: [0, 1], scrap: [0, 1] },
    parts: [0, 1],
    sparePartChance: 0.05,
    spareParts: ['rack', 'flatFour'],
    fuel: [0, 2],
    supplies: [0, 2],
  } as LootTable,
  convoy: {
    goods: { scrap: [1, 3], meds: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.3,
    spareParts: ['tunedEngine', 'cannon', 'ram', 'trailerBox', 'patcherCrane', 'patcherCrane'],
    fuel: [4, 12],
    supplies: [2, 6],
  } as LootTable,
};

export const STRIP = {
  yieldShare: 0.5,
  turns: 3,
};

// A wreck placed by hand, the end of a story the locals tell (src/data/locals.ts). Its place and loot are fixed, so
// the clues match it on every seed, and its id starts with `story-`. It never refills and is never cleared, and
// anyone may loot it first. part is a spare at a fixed id and wear step, so it takes no id from the world counter.
export type StoryWreck = {
  id: string;
  pos: Vec;
  r: number; // tiles, the chassis radius times RULES.wreckRadiusScale, as for a kill wreck
  chassisId: string;
  yaw: number;
  goods: Record<string, number>;
  fuel: number;
  supplies: number;
  part: { id: string; defId: string; wear: number };
};

// The id of wagon Seven, the wreck the locals' clue chain leads to.
export const WAGON_SEVEN = 'story-wagon-seven';

export const STORY_WRECKS: StoryWreck[] = [
  // Wagon Seven, a Nose Army gunwagon raiders ran off the Pump Station track on its way to Bowl. It lies in a shallow
  // hollow south of an old farm with a water tower, about 49 tiles off the Bowl north road and 68 off the Pump Station
  // track, so neither road shows it. Its load is about one good convoy roll: the convoy table's highs in scrap,
  // meds and fuel, a parts unit, a crew's supplies, and the spare cannon an Army wagon carries, worn halfway.
  {
    id: WAGON_SEVEN,
    pos: { x: 171, y: 381 },
    r: 0.8,
    chassisId: 'wagon',
    yaw: 2.2,
    goods: { scrap: 3, meds: 1, parts: 1 },
    fuel: 10,
    supplies: 4,
    part: { id: 'story-wagon-seven-cannon', defId: 'cannon', wear: 2 },
  },
];
