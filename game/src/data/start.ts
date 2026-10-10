// New game setup for the player. CONFIG.startKit picks the kit.

import { CHASSIS } from './chassis';
import { RULES } from './rules';

export type StartKit = {
  chassis: string;
  parts: string[];
  storage: string[];
  wear: number;
  money: number;
  fuel: number;
  supplies: number;
  cargo: Record<string, number>;
  costBasis: Record<string, number>;
  autoRepair: boolean;
  opening: Opening | null;
};

export type Opening = {
  log: 'stranded';
  condition: Record<string, number>;
  stock: { goods: Record<string, number>; parts: string[] };
};

export const START_KITS: Record<string, StartKit> = {
  standard: {
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
      log: 'stranded',
      condition: { stockEngine: 0.18, cabPickup: 0.3 },
      stock: { goods: { scrap: 0, parts: 3 }, parts: ['cage'] },
    },
  },
  combat: {
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
  midgame: {
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
  snowball: {
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
