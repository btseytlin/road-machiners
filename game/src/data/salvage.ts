// Loot tables, search speed and daily renewal for scavenging. Rolls draw through rng.ts.

import type { Weighted } from './npcs';

export type LootRange = [number, number];

export type LootTable = {
  goods: Record<string, LootRange>; // units rolled per good
  parts: LootRange; // units of the parts good
  sparePartChance: number; // odds the site also holds one mountable spare part
  spareParts: string[]; // part def ids the spare part is drawn from
  fuel: LootRange; // fuel units left in tanks and cans
  supplies: LootRange; // supply units left in crates
};

// Wear steps a spare part found in the field rolls, from the market stream. Parts left out in the
// waste have mostly broken and been rebuilt, so a pristine find is the rare prize.
export const FIELD_SPARE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 },
  { value: 1, weight: 3 },
  { value: 2, weight: 4 },
  { value: 3, weight: 3 },
  { value: 4, weight: 2 },
];

// Old-world places off today's roads that may hold one loot spot. See src/sim/old-places.ts.
export type OldPlaceType = 'homestead' | 'hamlet' | 'lookout' | 'hulks';
export const OLD_PLACE_TYPES: readonly OldPlaceType[] = ['homestead', 'hamlet', 'lookout', 'hulks'];

export const OLD_PLACES = {
  seedOffset: 7351, // hash key that keeps spot picks apart from other map draws
  buildingGap: 12, // tiles between buildings of one place; a settlement's houses stand within 10 tiles, settlements 45 apart
  tankGap: 10, // tiles between hulks of one group; a group's hulks lie within 8 tiles of each other
  roadGap: 5, // tiles between a spot's reach and a road edge, so a spot is a trip off the road, not a roadside stop
  // Chance a place holds a spot, by type. Most old places are picked clean, so a spot stays a find.
  chance: { homestead: 0.5, hamlet: 0.35, lookout: 0.4, hulks: 0.25 } as Record<OldPlaceType, number>,
  npcShare: 0.3, // share of scavenge trips that head for an old spot near the driver instead of a site
  npcRange: 120, // tiles, the farthest old spot a scavenger heads for
};

export const SALVAGE = {
  unitsPerTurn: 2, // stock units, goods or parts, a search gets through per turn
  pileTurns: 400, // two days a dropped pile lies on the ground, time for a road crossing and back
  claimTurns: 60, // the claimant's time to reach and search a handed-over pile, the same span as a handover truce
  pileSearchTurns: 1, // loot lying loose takes one look, whatever its size
  // Share of a wrecked chassis's value that its destroyed built-in parts leave as the parts good, scaled by
  // their remaining HP share. Keeps a wreck's loot well under the truck's own value, so a kill is not a windfall.
  coreValueShare: 0.03,
  // Each day a site regains this share of a fresh roll from its loot table, up to the table's highs. An emptied
  // site takes about two weeks to fill back up: a slow trickle, not a reset.
  restockShare: 0.08,
  // Goods and parts ranges sit at about a third of what the map once held. The whole map's loot used to sell
  // for far more than the upgrade ladder costs. Fuel and supplies stay, since they are spent, not resold.
  // Days a looted road wreck lies empty before it goes. It goes only beyond the player's gray vision, and a new
  // road wreck appears elsewhere, also beyond it, so the road wreck count stays constant.
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
    // Scrap never rolls to 0, so a road wreck always has something to search for.
    goods: { scrap: [1, 1] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'rack', 'flatFour'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  // Outer loot spots of a territory: a road wreck's size, with a little more to find.
  hullScrap: {
    goods: { scrap: [1, 2] },
    parts: [0, 1],
    sparePartChance: 0.1,
    spareParts: ['mg', 'cage', 'plates', 'flatFour'],
    fuel: [0, 4],
    supplies: [0, 1],
  } as LootTable,
  // Barns of a farm territory: food and cloth left in the lofts, a little scrap and fuel from the machinery.
  farmStores: {
    goods: { grain: [0, 1], textiles: [0, 1], scrap: [0, 1] },
    parts: [0, 1],
    sparePartChance: 0.05,
    spareParts: ['flatFour', 'rack'],
    fuel: [0, 4],
    supplies: [0, 2],
  } as LootTable,
  // Army caches and bunkers: parts, meds and scrap at road-wreck scale, with the best chance at a weapon or armor.
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

// Stripping a spare part in the field for units of the parts good. See src/sim/jobs.ts.
export const STRIP = {
  yieldShare: 0.5, // share of the part's value paid out in parts-good units
  turns: 3, // turns the job takes, flat regardless of the part
};
