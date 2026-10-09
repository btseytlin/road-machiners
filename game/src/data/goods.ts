// Trade goods and shared economy numbers. One cargo cell of any good is one crate of CRATE_MASS kg, and a good's value is per crate.
// Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';
import { MASS_SCALE } from './mass-scale';

export type GoodDef = { id: string; name: string; value: number; tier: Tier; plural?: true };

export const CRATE_MASS = 50 * MASS_SCALE.cargo;

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', value: 633, tier: 1 },
  salt: { id: 'salt', name: 'Salt', value: 867, tier: 1 },
  meds: { id: 'meds', name: 'Meds', value: 2333, tier: 2, plural: true },
  grain: { id: 'grain', name: 'Grain', value: 700, tier: 1 },
  textiles: { id: 'textiles', name: 'Textiles', value: 1167, tier: 1, plural: true },
  tools: { id: 'tools', name: 'Machine tools', value: 3667, tier: 3, plural: true },
  batteries: { id: 'batteries', name: 'Batteries', value: 2533, tier: 2, plural: true },
  electronics: { id: 'electronics', name: 'Electronics', value: 5167, tier: 3, plural: true },
  parts: { id: 'parts', name: 'Parts', value: 667, tier: 1, plural: true },
  fuelDrums: { id: 'fuelDrums', name: 'Fuel drums', value: 933, tier: 1, plural: true },
  water: { id: 'water', name: 'Water', value: 600, tier: 1 },
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
