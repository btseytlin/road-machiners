// Loot tables, search speed and daily renewal for scavenging. Rolls draw through rng.ts.

import type { Weighted } from './npcs';
import type { Vec } from '../sim/vec';

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

export const STORY_WRECKS: StoryWreck[] = [
  // Wagon Seven, a Nose Army gunwagon raiders ran off the Pump Station track on its way to Bowl. It lies in a shallow
  // hollow south of an old farm with a water tower, about 49 tiles off the Bowl north road and 68 off the Pump Station
  // track, so neither road shows it. Its load is about one good convoy roll: the convoy table's highs in scrap,
  // meds and fuel, a parts unit, a crew's supplies, and the spare cannon an Army wagon carries, worn halfway.
  {
    id: 'story-wagon-seven',
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
