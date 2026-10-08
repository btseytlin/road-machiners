// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';
import { MASS_SCALE } from './mass-scale';

// mass in kilograms per unit. value is the base money value of one unit; shop prices derive from it. Names live in
// src/text/.
export type GoodDef = { id: string; mass: number; value: number; tier: Tier };

const UNSCALED_GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', mass: 100, value: 633, tier: 1 },
  salt: { id: 'salt', mass: 75, value: 867, tier: 1 },
  meds: { id: 'meds', mass: 50, value: 2333, tier: 2 },
  grain: { id: 'grain', mass: 90, value: 700, tier: 1 },
  textiles: { id: 'textiles', mass: 25, value: 1167, tier: 1 },
  tools: { id: 'tools', mass: 160, value: 3667, tier: 3 },
  batteries: { id: 'batteries', mass: 120, value: 2533, tier: 2 },
  electronics: { id: 'electronics', mass: 15, value: 5167, tier: 3 },
  parts: { id: 'parts', mass: 20, value: 667, tier: 1 }, // spent by field repair
  fuelDrums: { id: 'fuelDrums', mass: 140, value: 933, tier: 1 },
  water: { id: 'water', mass: 110, value: 600, tier: 1 },
};

export const GOODS: Record<string, GoodDef> = Object.fromEntries(
  Object.entries(UNSCALED_GOODS).map(([id, def]) => [id, { ...def, mass: def.mass * MASS_SCALE.cargo }]),
);

export const GOOD_IDS = Object.keys(GOODS);


export const ECONOMY = {
  spread: 0.2,
  roadSpread: 0.3,
  supplyPrice: { fuel: 100, supplies: 167 } as Record<'fuel' | 'supplies', number>,
  scrapPerKg: 6.33,
  repairShare: 0.85,
  useRange: 1.5,
  interactionScale: 1.5,
};
