// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';

// mass in kilograms per unit. value is the base money value of one unit; shop prices derive from it. Names live in
// src/text/.
export type GoodDef = { id: string; mass: number; value: number; tier: Tier };

export const GOODS: Record<string, GoodDef> = {
  scrap: { id: 'scrap', mass: 100, value: 19, tier: 1 },
  salt: { id: 'salt', mass: 75, value: 26, tier: 1 },
  meds: { id: 'meds', mass: 50, value: 70, tier: 2 },
  grain: { id: 'grain', mass: 90, value: 21, tier: 1 },
  textiles: { id: 'textiles', mass: 25, value: 35, tier: 1 },
  tools: { id: 'tools', mass: 160, value: 110, tier: 3 },
  batteries: { id: 'batteries', mass: 120, value: 76, tier: 2 },
  electronics: { id: 'electronics', mass: 15, value: 155, tier: 3 },
  parts: { id: 'parts', mass: 20, value: 20, tier: 1 }, // spent by field repair
  // Supply convoys load these free at the Pump Station and the oases. Both are heavier than grain and
  // salt per unit, so a load pays by volume, not margin. Fuel is worth more than salt, since only one
  // pump fills it. Water is worth less than grain, since two oases give it away.
  fuelDrums: { id: 'fuelDrums', mass: 140, value: 28, tier: 1 },
  water: { id: 'water', mass: 110, value: 18, tier: 1 },
};

export const GOOD_IDS = Object.keys(GOODS);


export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Social skill
  // Added to the spread when trading with a truck on the road. A driver out in the waste has no market to answer
  // to, so at Trade 0 it sells at 1.5 times a good's value and buys at half of it.
  roadSpread: 0.3,
  supplyPrice: { fuel: 3, supplies: 5 } as Record<'fuel' | 'supplies', number>,
  scrapPerKg: 0.19, // sell floor for a part, near GOODS.scrap.value / GOODS.scrap.mass
  // Share of a part's value spent per HP share restored, before Mechanics. Kept above the sale price's
  // (1 - spread) share of value at Trade 0, 0.8, so repairing a part and then selling it always loses
  // money: a repair is for driving on, not for flipping.
  repairShare: 0.85,
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
