// Trade goods and shared economy numbers. Shop prices come from each good's value; see src/data/market.ts.

import type { Tier } from './market';
import { MASS_SCALE } from './mass-scale';

// mass in kilograms per unit. value is the base money value of one unit, in cents (100 cents is 1 M, the price of
// 5 L of fuel); shop prices derive from it. plural marks a
// name that takes "were" in talk.
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
  parts: { id: 'parts', name: 'Parts', mass: 20, value: 667, tier: 1, plural: true }, // spent by field repair
  // Supply convoys load these free at the Pump Station and the oases. Both are heavier than grain and
  // salt per unit, so a load pays by volume, not margin. Fuel is worth more than salt, since only one
  // pump fills it. Water is worth less than grain, since two oases give it away.
  fuelDrums: { id: 'fuelDrums', name: 'Fuel drums', mass: 140, value: 933, tier: 1, plural: true },
  water: { id: 'water', name: 'Water', mass: 110, value: 600, tier: 1 },
};

// Each good's mass takes the cargo MASS_SCALE.
export const GOODS: Record<string, GoodDef> = Object.fromEntries(
  Object.entries(UNSCALED_GOODS).map(([id, def]) => [id, { ...def, mass: def.mass * MASS_SCALE.cargo }]),
);

export const GOOD_IDS = Object.keys(GOODS);


// Money amounts below are in cents: 100 cents is 1 M, and one fuel unit (5 L) costs exactly 1 M at a town.
export const ECONOMY = {
  spread: 0.2, // fraction added to buy and cut from sell prices, before Social skill
  // Added to the spread when trading with a truck on the road. A driver out in the waste has no market to answer
  // to, so at Trade 0 it sells at 1.5 times a good's value and buys at half of it.
  roadSpread: 0.3,
  supplyPrice: { fuel: 100, supplies: 167 } as Record<'fuel' | 'supplies', number>,
  scrapPerKg: 6.33, // sell floor for a part, near GOODS.scrap.value / GOODS.scrap.mass
  // Share of a part's value spent per HP share restored, before Mechanics. Kept above the sale price's
  // (1 - spread) share of value at Trade 0, 0.8, so repairing a part and then selling it always loses
  // money: a repair is for driving on, not for flipping.
  repairShare: 0.85,
  useRange: 1.5, // extra tiles past a site radius where its services work
  interactionScale: 1.5, // multiplier for the total interaction radius
};
