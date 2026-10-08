// New game setup for the player. CONFIG.startKit picks the kit.

import { CHASSIS } from './chassis';
import { RULES } from './rules';

export type StartKit = {
  name: string;
  chassis: string;
  parts: string[]; // mounted in order on the first free fitting mount
  storage: string[]; // spare parts in the town garage
  wear: number; // wear step of every part the kit starts with, built-in parts and storage included
  money: number;
  fuel: number;
  supplies: number;
  cargo: Record<string, number>;
  costBasis: Record<string, number>;
  autoRepair: boolean; // the Auto patch switch at the start
  opening: Opening | null; // how a new game begins, or null for a plain start
};

// A new game that opens stranded beside a wreck. `condition` sets the starting HP share of mounted parts by def id.
// The wreck's stock is fixed, with every spare part unworn. See src/sim/opening.ts.
export type Opening = {
  log: string;
  condition: Record<string, number>;
  stock: { goods: Record<string, number>; parts: string[] };
};

export const START_KITS: Record<string, StartKit> = {
  // The normal start: a light scout with one gun and some scrap to trade, every part rebuilt twice like most trucks on
  // the road, stranded with a nearly dead engine and a worn cab beside a wreck that holds the parts to patch it and a
  // Rebar cage to mount. Auto patch starts off, so the player patches by hand once.
  standard: {
    name: 'Your truck',
    chassis: 'scout',
    parts: ['panniers', 'mg', 'stockEngine'],
    storage: [],
    wear: 2,
    money: 33300,
    fuel: CHASSIS.scout.fuelCap,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2, parts: 2 },
    costBasis: { scrap: 333 },
    autoRepair: false,
    opening: {
      log: 'You find yourself stranded in an unfamiliar land. Not your finest moment.',
      // 9 of 50 engine HP: drawn nearly broken, and one patch with the 5 parts held after the loot reaches the field cap.
      // The cab at 36 of 120 HP draws the body and bumpers at the last worn look before broken.
      condition: { stockEngine: 0.18, cabPickup: 0.3 },
      stock: { goods: { scrap: 0, parts: 3 }, parts: ['cage'] },
    },
  },
  // For testing combat: both weapons, a front ram and armor, with spares in the town garage.
  combat: {
    name: 'Your truck',
    chassis: 'hauler',
    parts: ['cannon', 'mg', 'stockEngine', 'ram', 'plates', 'plates', 'rack'],
    storage: ['plates', 'cage', 'mg'],
    wear: 0,
    money: 50000,
    fuel: 60,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2 },
    costBasis: { scrap: 333 },
    autoRepair: true,
    opening: null,
  },
  // A reasonably prepared mid-game player, for the income harness: a hauler with a cargo box, two guns, armor and a
  // diesel, and money for a few loads.
  midgame: {
    name: 'Your truck',
    chassis: 'hauler',
    parts: ['trailerBox', 'autocannon', 'mg', 'workhorseDiesel', 'plates', 'plates'],
    storage: [],
    wear: 0,
    money: 3000,
    fuel: CHASSIS.hauler.fuelCap,
    supplies: RULES.baseSupplies,
    cargo: { parts: 2 },
    costBasis: {},
    autoRepair: true,
    opening: null,
  },
  // The gear of a player who snowballed on raiders: a convertible with two machine guns, a slug cannon, a shotgun, a
  // ram and plates. Measures what that truck earns, not how it is earned.
  snowball: {
    name: 'Your truck',
    chassis: 'convertible',
    parts: ['mg', 'mg', 'slugCannon', 'shotgun', 'plowRam', 'workhorseDiesel', 'plates', 'plates', 'cage'],
    storage: [],
    wear: 0,
    money: 83300,
    fuel: CHASSIS.convertible.fuelCap,
    supplies: RULES.baseSupplies,
    cargo: {},
    costBasis: {},
    autoRepair: true,
    opening: null,
  },
};

export function startKit(id: string): StartKit {
  const kit = START_KITS[id];
  if (!kit) throw new Error(`Unknown start kit "${id}". Known: ${Object.keys(START_KITS).join(', ')}`);
  return kit;
}
