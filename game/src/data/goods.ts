// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';
import { MASS_SCALE } from './mass-scale';

export type GoodDef = { id: string; name: string; mass: number; value: number; tier: Tier; plural?: true };

const UNSCALED_GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', mass: 100, value: 633, tier: 1 },
  salt: { id: 'salt', name: 'Salt', mass: 75, value: 867, tier: 1 },
  meds: { id: 'meds', name: 'Meds', mass: 50, value: 2333, tier: 2, plural: true },
  grain: { id: 'grain', name: 'Grain', mass: 90, value: 700, tier: 1 },
  textiles: { id: 'textiles', name: 'Textiles', mass: 25, value: 1167, tier: 1, plural: true },
  tools: { id: 'tools', name: 'Machine tools', mass: 160, value: 3667, tier: 3, plural: true },
  batteries: { id: 'batteries', name: 'Batteries', mass: 120, value: 2533, tier: 2, plural: true },
  electronics: { id: 'electronics', name: 'Electronics', mass: 15, value: 5167, tier: 3, plural: true },
  parts: { id: 'parts', name: 'Parts', mass: 20, value: 667, tier: 1, plural: true },
  fuelDrums: { id: 'fuelDrums', name: 'Fuel drums', mass: 140, value: 933, tier: 1, plural: true },
  water: { id: 'water', name: 'Water', mass: 110, value: 600, tier: 1 },
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
