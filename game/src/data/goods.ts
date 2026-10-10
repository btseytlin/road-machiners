// Trade goods and shared economy numbers. One cargo cell of any good is one crate of CRATE_MASS kg, and a good's value is per crate.
// Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';
import { MASS_SCALE } from './mass-scale';

export type GoodDef = { id: string; value: number; tier: Tier };

export const CRATE_MASS = 50 * MASS_SCALE.cargo;

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', value: 633, tier: 1 },
  salt: { id: 'salt', value: 867, tier: 1 },
  meds: { id: 'meds', value: 2333, tier: 2 },
  grain: { id: 'grain', value: 700, tier: 1 },
  textiles: { id: 'textiles', value: 1167, tier: 1 },
  tools: { id: 'tools', value: 3667, tier: 3 },
  batteries: { id: 'batteries', value: 2533, tier: 2 },
  electronics: { id: 'electronics', value: 5167, tier: 3 },
  parts: { id: 'parts', value: 667, tier: 1 },
  fuelDrums: { id: 'fuelDrums', value: 933, tier: 1 },
  water: { id: 'water', value: 600, tier: 1 },
};

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
