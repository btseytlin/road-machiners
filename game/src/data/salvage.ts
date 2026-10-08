// Loot tables, search speed and daily renewal for scavenging. Rolls draw through rng.ts.

import type { Weighted } from './npcs';

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
    spareParts: ['stockEngine', 'plates', 'cage', 'mg'],
    fuel: [0, 8],
    supplies: [0, 3],
  } as LootTable,
  roadWreck: {
    goods: { scrap: [1, 1] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'rack', 'flatFour'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  hullScrap: {
    goods: { scrap: [1, 2] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'plates', 'flatFour'],
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
    spareParts: ['mg', 'plates', 'cage'],
    fuel: [0, 2],
    supplies: [0, 2],
  } as LootTable,
  convoy: {
    goods: { scrap: [1, 3], meds: [0, 1] },
    parts: [1, 2],
    sparePartChance: 0.3,
    spareParts: ['tunedEngine', 'cannon', 'ram', 'trailerBox'],
    fuel: [4, 12],
    supplies: [2, 6],
  } as LootTable,
};

export const STRIP = {
  yieldShare: 0.5,
  turns: 3,
};
