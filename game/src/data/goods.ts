// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';

export type GoodDef = { id: string; name: string; mass: number; value: number; tier: Tier };

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', name: 'Scrap metal', mass: 100, value: 19, tier: 1 },
  salt: { id: 'salt', name: 'Salt', mass: 75, value: 26, tier: 1 },
  meds: { id: 'meds', name: 'Meds', mass: 50, value: 70, tier: 2 },
  grain: { id: 'grain', name: 'Grain', mass: 90, value: 21, tier: 1 },
  textiles: { id: 'textiles', name: 'Textiles', mass: 25, value: 35, tier: 1 },
  tools: { id: 'tools', name: 'Machine tools', mass: 160, value: 110, tier: 3 },
  batteries: { id: 'batteries', name: 'Batteries', mass: 120, value: 76, tier: 2 },
  electronics: { id: 'electronics', name: 'Electronics', mass: 15, value: 155, tier: 3 },
  parts: { id: 'parts', name: 'Parts', mass: 20, value: 20, tier: 1 },
  fuelDrums: { id: 'fuelDrums', name: 'Fuel drums', mass: 140, value: 28, tier: 1 },
  water: { id: 'water', name: 'Water', mass: 110, value: 18, tier: 1 },
};

export const GOOD_IDS = Object.keys(GOODS);


export const ECONOMY = {
  spread: 0.2,
  roadSpread: 0.3,
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  scrapPerKg: 0.19,
  repairShare: 0.85,
  useRange: 1.5,
  interactionScale: 1.5,
};
