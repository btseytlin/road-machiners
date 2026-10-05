// Market data: shop profiles and stock, the effort model and contract terms. See src/sim/market.ts.

import { PARTS } from './parts';
import type { Weighted } from './npcs';
import { TIME } from './time';

// The effort model. The unit of effort is one turn of play. The wage is the net money a player
// earns per turn, after fuel, supplies and repairs, at each tier. An item's effort is its value
// divided by its tier's wage. `bands` gives the target effort range per tier and item kind, so a
// test can keep every def inside its band. Contract rewards are estimated turns of work times the
// wage, so contracts pay like other work.

export type Tier = 1 | 2 | 3;

export type ItemKind = 'weapon' | 'engine' | 'armor' | 'cargo' | 'scanner' | 'store' | 'chassis' | 'good';

export const EFFORT = {
  // Net money per turn at each tier. Tier 1 is the salvage wage of the deleted econ harness. Tiers 2 and 3 are a
  // guessed ratio to tier 1. `npm run progression:report` over 30-day runs is the measure that replaces them.
  wage: {
    1: 0.37,
    2: 1,
    3: 2.2,
  } as Record<Tier, number>,

  // Target effort in turns per tier and item kind: value / wage[tier] should land in this range.
  // They hold chassis from 2000, 3000 and 4500 money per tier, and parts from 100, 200 and 450.
  // Goods are priced far below parts, since a haul is many units, not one purchase.
  bands: {
    1: {
      weapon: [250, 700],
      engine: [250, 700],
      armor: [250, 700],
      cargo: [250, 700],
      scanner: [250, 700],
      store: [250, 700],
      chassis: [5000, 7500],
      good: [40, 100],
    },
    2: {
      weapon: [180, 480],
      engine: [180, 480],
      armor: [180, 480],
      cargo: [180, 480],
      scanner: [180, 480],
      store: [180, 480],
      chassis: [2800, 4200],
      good: [50, 100],
    },
    3: {
      weapon: [180, 380],
      engine: [180, 380],
      armor: [180, 380],
      cargo: [180, 380],
      scanner: [180, 380],
      store: [180, 380],
      chassis: [1900, 2800],
      good: [40, 80],
    },
  } as Record<Tier, Record<ItemKind, [number, number]>>,

  // Tier wages per trip turn a full truckload of goods earns on a long haul. Goods pay above salvage,
  // since a haul risks money on the cargo.
  haulWages: 4,

  // Tiles per turn a truck cruises for effort and contract-travel estimates. Chassis top speeds
  // (src/data/chassis.ts) run 3.9 to 9.75 tiles per turn, but real travel loses time to routing,
  // slopes and stops, so this sits well under the slowest chassis' top speed.
  refSpeed: 4,

  // Road distance over straight-line distance. REGION.navigation (src/data/region.ts) shows
  // drivers still following a road up to about 60% longer than the straight line over open ground,
  // so contract travel is estimated at a road that is moderately, not maximally, longer.
  routeFactor: 1.3,

  // Turns spent parking, loading or unloading at each contract stop.
  handlingTurns: 3,
};

// Contract kinds, limits, durations and reward factors. Rewards derive from the effort model in
// EFFORT above: turns of estimated work times the tier's wage, times a per-kind factor.

export const CONTRACTS = {
  // The player holds at most this many contracts at once (Design > Contract terms).
  maxActive: 3,

  // The log warns once when a held contract has this many turns left: two game hours.
  warnTurns: Math.round(TIME.turnsPerDay / 12),

  haul: {
    // The window is the estimated travel turns times this factor, counted from acceptance, so a
    // normal detour, a stop for fuel or a fight does not expire the contract on its own.
    durationFactor: 8,
    // A tier wage is what salvage earns. The estimate counts one way, so a haul pays 2.5 wages per
    // turn of the round trip: it beats scavenging even when the truck returns empty, and pays for
    // the cargo cells and the failure risk.
    rewardFactor: 5,
    // On top of the wage, the client pays a small cut of the hauled goods' value, since carrying
    // something worth money is worth more to the client than empty road time.
    valueShare: 0.05,
    // Units of the good to haul.
    units: [3, 12] as [number, number],
    // Owed share of the hauled goods' value if the deadline passes (Design > Contract terms).
    penaltyShare: 1,
    // Social XP per money of the reward, all of which pays for the trip.
    xpPerEffort: 0.1,
    // A rush haul is a standard haul with a short window and a premium.
    rush: {
      // Share of rolled hauls that are rush jobs.
      chance: 0.25,
      // The rush window is the estimated travel turns times this factor: tight, but a truck driving straight there makes it.
      durationFactor: 1.5,
      // Multiplier on the standard reward.
      premium: 1.75,
    },
  },

  fetch: {
    // A fetch has no fixed travel: the part can come from a garage or the field. The window is a
    // flat turn range that stands in for the effort of finding one, and sets the window from acceptance.
    durationTurns: [300, 800] as [number, number],
    // The reward is the part's own pristine buy price plus this search fee: turns of effort spent
    // finding a part of a named type, in any condition, at the fetch's own tier wage.
    searchFeeTurns: 240,
    // Worst wear a hand-in part may carry. One rebuild keeps the fetch honest: the client wants a
    // part that still does its job, not a part on its last legs.
    maxWear: 1,
    // Social XP per money of the search fee. The part's own price is a purchase, not work, so it teaches nothing.
    xpPerEffort: 0.15,
  },

  bounty: {
    // Long enough that a raider's own patrol or camp turns do not expire the contract before the
    // player can reach and fight it. The window counts from acceptance and does not change the pay.
    durationTurns: [400, 1000] as [number, number],
    // Share of the target's own total worth, chassis plus every part, paid for the kill. A fifth of
    // its worth pays for the risk of the fight without outpricing the wreck's own salvage.
    valueShare: 0.2,
    // Social XP per money of the reward, all of which pays for the fight.
    xpPerEffort: 0.25,
  },
};

// Shops: where goods trade and parts sit in finite, random stock.


export type ShopKind = 'garage' | 'stall';

// A good sells near its base value times `make` where it is made. Elsewhere its price climbs with
// the straight distance to the nearest shop that makes it, through DISTANCE_PREMIUM below, so a long
// haul pays for the miles and a short one does not.
export const PRICE_FACTOR = { make: 0.75 };

// Fraction of a good's value added to its price per tile of straight distance to the nearest shop
// that makes it. Picked so a single-source good hauled the length of the Bowl-Nose road (about 520
// tiles) sells for close to double its make price, which pays a full truckload about
// EFFORT.haulWages tier wages for the trip's estimated turns.
export const DISTANCE_PREMIUM = { perTile: 0.0021 };

// Sites that give out a good with no shop that makes it. Supply convoys haul these goods from the
// sources to the towns, so a town prices them by the distance to the nearest source.
export const GOOD_SOURCES: Record<string, string[]> = {
  fuelDrums: ['pump-station'],
  water: ['dustwell', 'green-pit'],
};

// Wear weights for rolled stock, keyed by wear step (0 is pristine, CONDITION.maxWear is the last
// reasonable step; a shop never stocks junk). Garages lean lightly worn; stalls lean heavily worn,
// since they take in whatever passing traders and scavengers carry.
const GARAGE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 }, // pristine: rare
  { value: 1, weight: 4 },
  { value: 2, weight: 3 },
  { value: 3, weight: 1 },
];
const STALL_WEAR: Weighted<number>[] = [
  { value: 1, weight: 2 },
  { value: 2, weight: 4 },
  { value: 3, weight: 3 },
  { value: 4, weight: 1 },
];

// Every non-core part, equal weight, for the two general-stock garages.
const NON_CORE_PART_IDS = Object.values(PARTS)
  .filter((def) => def.kind !== 'core')
  .map((def) => def.id);
const GARAGE_PARTS: Weighted<string>[] = NON_CORE_PART_IDS.map((id) => ({ value: id, weight: 1 }));

export type PartStockTable = { parts: Weighted<string>[]; wear: Weighted<number>[] };

export type ShopDef = {
  id: string;
  kind: ShopKind;
  makes: string[]; // good ids cheap here
  needs: string[]; // good ids dear here
  goods: string[]; // good ids traded here at all
  priceFactor: typeof PRICE_FACTOR;
  partStock: PartStockTable;
  stockSize: [number, number]; // part count rolled at each restock
  restockTurns: number; // turns between restocks
  pressurePerUnit: number; // fraction of base price a single unit traded moves the price
  driftPerTurn: number; // fraction of standing pressure removed each turn
  contractSlots: number; // contracts this shop can post at once; used from PH4
  supplies: ('fuel' | 'supplies')[]; // which of fuel and food the player buys here; repairs and NPC service do not read it
};

// Fraction pressure is clamped to either side of base price. A good can never trade for more than
// double or less than a third of its resting price from local buying or selling alone.
export const PRESSURE_MAX = 0.6;

// Pressure a single traded unit adds at a garage. Set so a bare hauler's cargo cells, sold in one
// lot, move price only about halfway to PRESSURE_MAX: a garage's cargo bay of trade is meant to fit
// in its shelf, not blow through it. Stalls keep the older, steeper rate: their thin stock saturates
// on a handful of units, which fits a roadside stall rather than a town garage.
const GARAGE_PRESSURE_PER_UNIT = 0.005;
const STALL_PRESSURE_PER_UNIT = 0.02;

export const SHOPS: Record<string, ShopDef> = {
  // Bowl: cheap scrap, grain, textiles, meds, electronics and parts (all cheaper than Nose in the
  // old TOWN_PRICES); dear salt, tools and batteries (all pricier than Nose there).
  bowl: {
    id: 'bowl',
    kind: 'garage',
    makes: ['scrap', 'grain', 'textiles', 'meds', 'electronics', 'parts'],
    needs: ['salt', 'tools', 'batteries', 'fuelDrums', 'water'],
    goods: ['scrap', 'salt', 'meds', 'grain', 'textiles', 'tools', 'batteries', 'electronics', 'parts', 'fuelDrums', 'water'],
    priceFactor: PRICE_FACTOR,
    partStock: { parts: GARAGE_PARTS, wear: GARAGE_WEAR },
    stockSize: [8, 12], // a day's restock (400 turns, 2 days) keeps a garage's shelf full
    restockTurns: 400,
    pressurePerUnit: GARAGE_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075, // decays a standing pressure below 5% of itself over about 400 turns (2 days)
    contractSlots: 3,
    supplies: ['fuel', 'supplies'],
  },
  // Nose: cheap salt, tools and batteries (the mirror of Bowl); dear scrap, grain, textiles, meds,
  // electronics and parts.
  nose: {
    id: 'nose',
    kind: 'garage',
    makes: ['salt', 'tools', 'batteries'],
    needs: ['scrap', 'grain', 'textiles', 'meds', 'electronics', 'parts', 'fuelDrums', 'water'],
    goods: ['scrap', 'salt', 'meds', 'grain', 'textiles', 'tools', 'batteries', 'electronics', 'parts', 'fuelDrums', 'water'],
    priceFactor: PRICE_FACTOR,
    partStock: { parts: GARAGE_PARTS, wear: GARAGE_WEAR },
    stockSize: [8, 12],
    restockTurns: 400,
    pressurePerUnit: GARAGE_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 3,
    supplies: ['fuel', 'supplies'],
  },
  // Salvage Yard: the picked-over source of scrap and stripped parts. Sells scrap and parts cheap,
  // pays over the odds for tools to keep its own gear running.
  'salvage-yard': {
    id: 'salvage-yard',
    kind: 'stall',
    makes: ['scrap', 'parts'],
    needs: ['tools'],
    goods: ['scrap', 'parts', 'tools'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['plates', 'steelPlate', 'cage', 'scrapPanels', 'scrapSheet', 'ram', 'plowRam', 'mg', 'shotgun', 'rack', 'panniers'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  // The Granary: a farm stop. Sells its own grain cheap, and buys in salt and textiles for the
  // caravans that pass through, so those cost more here.
  granary: {
    id: 'granary',
    kind: 'stall',
    makes: ['grain'],
    needs: ['salt', 'textiles'],
    goods: ['grain', 'salt', 'textiles'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['rack', 'panniers', 'flatbed', 'scrapPanels', 'scrapSheet', 'cage', 'supplyLocker'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  // Pump Station: sells the batteries it charges cheap, and pays well for scrap and parts to keep
  // its pumps and generators running.
  'pump-station': {
    id: 'pump-station',
    kind: 'stall',
    makes: ['batteries'],
    needs: ['scrap', 'parts'],
    goods: ['batteries', 'scrap', 'parts'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['stockEngine', 'flatFour', 'workhorseDiesel', 'scanner', 'plates', 'jerrycans'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
};

export function shopDef(id: string): ShopDef {
  const def = SHOPS[id];
  if (!def) throw new Error(`Unknown shop ${id}`);
  return def;
}

// Every shop, which is the two towns and the stalls: where a driver with no camps sells.
export const TOWN_MARKETS = Object.keys(SHOPS);
// The stalls alone, where a driver with no towns sells.
export const STALL_MARKETS = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);
