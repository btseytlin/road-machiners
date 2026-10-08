// New game setup for the player. CONFIG.startKit picks the kit.

import { CHASSIS } from './chassis';
import { RULES } from './rules';

export type StartKit = {
  name: string;
  chassis: string;
  parts: string[];
  storage: string[];
  money: number;
  fuel: number;
  supplies: number;
  cargo: Record<string, number>;
  costBasis: Record<string, number>;
};

export const START_KITS: Record<string, StartKit> = {
  standard: {
    name: 'Your truck',
    chassis: 'scout',
    parts: ['panniers', 'mg', 'stockEngine', 'cage'],
    storage: [],
    money: 1000,
    fuel: CHASSIS.scout.fuelCap,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2, parts: 2 },
    costBasis: { scrap: 10 },
  },
  combat: {
    name: 'Your truck',
    chassis: 'hauler',
    parts: ['cannon', 'mg', 'stockEngine', 'ram', 'plates', 'plates', 'rack'],
    storage: ['plates', 'cage', 'mg'],
    money: 1500,
    fuel: 60,
    supplies: RULES.baseSupplies,
    cargo: { scrap: 2 },
    costBasis: { scrap: 10 },
  },
};

export function startKit(id: string): StartKit {
  const kit = START_KITS[id];
  if (!kit) throw new Error(`Unknown start kit "${id}". Known: ${Object.keys(START_KITS).join(', ')}`);
  return kit;
}
