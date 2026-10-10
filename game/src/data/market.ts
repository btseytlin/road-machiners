// Market data: shop profiles and stock, the effort model and contract terms. See src/sim/market.ts.

import { PARTS, type PartDef } from './parts';
import type { Weighted } from './npcs';
import { TIME } from './time';

// The effort model. The unit of effort is one turn of play. The wage is the net money a player
// earns per turn, after fuel, supplies and repairs, at each tier. An item's effort is its value
// divided by its tier's wage. `bands` gives the target effort range per tier and item kind, so a
// test can keep every def inside its band. A haul's travel pay is estimated turns of work times the
// tier 1 wage, whatever the good, so contracts pay like salvage.

export type Tier = 1 | 2 | 3;

export type ItemKind = 'weapon' | 'engine' | 'armor' | 'cargo' | 'scanner' | 'store' | 'utility' | 'chassis' | 'good';

export const EFFORT = {
  wage: {
    1: 12.33,
    2: 33.33,
    3: 73.33,
  } as Record<Tier, number>,

  bands: {
    1: {
      weapon: [250, 700],
      engine: [250, 700],
      armor: [250, 700],
      cargo: [250, 700],
      scanner: [250, 700],
      store: [250, 700],
      utility: [250, 700],
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
      utility: [180, 480],
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
      utility: [180, 380],
      chassis: [1900, 2800],
      good: [40, 80],
    },
  } as Record<Tier, Record<ItemKind, [number, number]>>,

  haulWages: 4,

  refSpeed: 4,

  routeFactor: 1.3,

  handlingTurns: 3,
};

export const CONTRACTS = {
  maxActive: 3,

  warnTurns: Math.round(TIME.turnsPerDay / 12),

  haul: {
    // The standard window is the estimated travel turns times this factor plus `slackTurns`, counted from
    // acceptance. Measured on every shop pair: the slower loaded truck needs up to 1.33 times the estimate,
    // and the factor gives it half again on top and keeps the window at twice the rush window.
    durationFactor: 2.5,
    // Room for one stop for fuel, a repair or a fight, so a short route is not left with no leeway.
    slackTurns: Math.round(TIME.turnsPerDay / 4),
    // A multiple of the salvage wage `EFFORT.wage[1]`, for every good. The estimate counts one way. Set so
    // the median route's standard haul of a mid load nets the middle of the hourly money that scavenging
    // and trading earn on the midgame kit, counting the empty drive back, and fuel.
    rewardFactor: 24,
    // On top of the wage, the client pays a small cut of the hauled goods' value, since carrying
    // something worth money is worth more to the client than empty road time.
    valueShare: 0.05,
    units: [3, 12] as [number, number],
    penaltyShare: 1,
    xpPerEffort: 0.003,
    rush: {
      chance: 0.25,
      // The rush window is the estimated travel turns times this factor: tight, but a truck driving straight there makes it.
      // The slower measured loaded truck needs up to 1.33 times the estimate, and the window keeps 1.1 times that.
      durationFactor: 1.5,
      premium: 1.75,
    },
  },

  fetch: {
    durationTurns: [300, 800] as [number, number],
    searchFeeTurns: 240,
    maxWear: 1,
    xpPerEffort: 0.0045,
  },

  bounty: {
    durationTurns: [400, 1000] as [number, number],
    rewardTurns: { buggy: 900, gunwagon: 1350 } as Record<string, number>,
    xpPerEffort: 0.0075,
  },
};

export type ShopKind = 'garage' | 'stall';

export const PRICE_FACTOR = { make: 0.75 };

export const DISTANCE_PREMIUM = { perTile: 0.0021 };

export const GOOD_SOURCES: Record<string, string[]> = {
  fuelDrums: ['pump-station'],
};

const GARAGE_WEAR: Weighted<number>[] = [
  { value: 0, weight: 1 },
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

const NON_CORE_PARTS = Object.values(PARTS).filter((def) => def.kind !== 'core');
const PART_SHELF_WEIGHT = { utility: 3, emitter: 0.6, other: 1 };
const GARAGE_PARTS: Weighted<string>[] = NON_CORE_PARTS.map((def) => ({ value: def.id, weight: shelfWeightOf(def) }));

function shelfWeightOf(def: PartDef): number {
  if (def.id === 'emitter') return PART_SHELF_WEIGHT.emitter;
  return def.kind === 'utility' ? PART_SHELF_WEIGHT.utility : PART_SHELF_WEIGHT.other;
}

export type PartStockTable = { parts: Weighted<string>[]; wear: Weighted<number>[] };

export const GARAGE_STOCK: PartStockTable = { parts: GARAGE_PARTS, wear: GARAGE_WEAR };

export type ShopDef = {
  id: string;
  kind: ShopKind;
  makes: string[];
  needs: string[];
  goods: string[];
  priceFactor: typeof PRICE_FACTOR;
  partStock: PartStockTable;
  stockSize: [number, number];
  restockTurns: number;
  pressurePerUnit: number;
  driftPerTurn: number;
  contractSlots: number;
  supplies: ('fuel' | 'supplies')[];
};

export const PRESSURE_MAX = 0.6;

const GARAGE_PRESSURE_PER_UNIT = 0.005;
const STALL_PRESSURE_PER_UNIT = 0.02;

export const SHOPS: Record<string, ShopDef> = {
  bowl: {
    id: 'bowl',
    kind: 'garage',
    makes: ['scrap', 'grain', 'textiles', 'meds', 'electronics', 'parts'],
    needs: ['salt', 'tools', 'batteries', 'fuelDrums', 'water'],
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
  'salvage-yard': {
    id: 'salvage-yard',
    kind: 'stall',
    makes: ['scrap', 'parts'],
    needs: ['tools'],
    goods: ['scrap', 'parts', 'tools'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: ([
        'plates', 'steelPlate', 'cage', 'scrapPanels', 'scrapSheet', 'ram', 'plowRam', 'mg', 'shotgun', 'rack', 'panniers',
        'caltrops', 'oilSpiller', 'scrapersKnife', 'patcherCrane', 'claymoreRam',
      ] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  granary: {
    id: 'granary',
    kind: 'stall',
    makes: ['grain'],
    needs: ['salt', 'textiles'],
    goods: ['grain', 'salt', 'textiles'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['rack', 'panniers', 'flatbed', 'scrapPanels', 'scrapSheet', 'cage', 'supplyLocker', 'patcherCrane'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  'pump-station': {
    id: 'pump-station',
    kind: 'stall',
    makes: ['batteries'],
    needs: ['scrap', 'parts'],
    goods: ['batteries', 'scrap', 'parts'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['stockEngine', 'flatFour', 'workhorseDiesel', 'scanner', 'plates', 'jerrycans', 'oilSpiller', 'flareCannon'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  dustwell: {
    id: 'dustwell',
    kind: 'stall',
    makes: ['water'],
    needs: ['tools', 'meds'],
    goods: ['water', 'scrap', 'tools', 'meds'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['jerrycans', 'supplyLocker', 'rack', 'panniers', 'scrapPanels', 'plates', 'mg', 'scanner'] as const).map((id) => ({ value: id, weight: 1 })),
      wear: STALL_WEAR,
    },
    stockSize: [2, 4],
    restockTurns: 300,
    pressurePerUnit: STALL_PRESSURE_PER_UNIT,
    driftPerTurn: 0.0075,
    contractSlots: 1,
    supplies: ['fuel', 'supplies'],
  },
  'green-pit': {
    id: 'green-pit',
    kind: 'stall',
    makes: ['water'],
    needs: ['salt', 'textiles'],
    goods: ['water', 'grain', 'salt', 'textiles'],
    priceFactor: PRICE_FACTOR,
    partStock: {
      parts: (['supplyLocker', 'jerrycans', 'flatbed', 'cage', 'scrapSheet', 'shotgun', 'caltrops', 'patcherCrane'] as const).map((id) => ({ value: id, weight: 1 })),
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

export const TOWN_MARKETS = Object.keys(SHOPS);
export const STALL_MARKETS = Object.values(SHOPS).filter((s) => s.kind === 'stall').map((s) => s.id);
