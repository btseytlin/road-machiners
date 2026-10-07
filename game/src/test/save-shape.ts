// The saved shape of a new game on the test map, which npm run save:shape writes and the save test checks.

import { PARTS } from '../data/parts';
import { startKit } from '../data/start';
import { makePart } from '../sim/factory';
import type { Contract } from '../sim/market';
import type { SalvageStock } from '../sim/types';
import { newWorld } from '../sim/world';
import { saveOf } from '../three/save';
import { shapeOf, type Shape } from '../three/save-shape';
import { TEST_MAP } from './map';

// One contract of each kind, so the shape does not depend on which kinds the shops rolled.
const CONTRACT_KINDS: Contract[] = [
  { id: 'c', shop: 's', kind: 'haul', good: 'g', units: 1, to: 't', reward: 1, deadline: 1, window: 1, rush: false, tier: 1 },
  { id: 'c', shop: 's', kind: 'fetch', defId: 'p', reward: 1, deadline: 1, window: 1, tier: 1 },
  { id: 'c', shop: 's', kind: 'bounty', template: 't', reward: 1, deadline: 1, window: 1, tier: 1 },
];

// One part with gun state and one without, so the shape does not depend on which parts the shops rolled.
const WEAPON_ID = Object.keys(PARTS).find((id) => PARTS[id].kind === 'weapon');
const PLAIN_ID = Object.keys(PARTS).find((id) => PARTS[id].kind !== 'weapon');

export function newGameShape(): Shape {
  const world = newWorld(1337, startKit('standard'), TEST_MAP);
  if (!WEAPON_ID || !PLAIN_ID) throw new Error('The part data has no weapon or no other part');
  for (const shop of Object.values(world.shops)) {
    shop.contracts = CONTRACT_KINDS;
    shop.stock = [makePart(world, WEAPON_ID, 0), makePart(world, PLAIN_ID, 0)];
  }
  // A loot table fixes which goods a stock holds, but its spare part is rolled. Each goods mix gets one stock with no
  // spare part, one with a gun and one with a plain part, so the shape does not depend on which spares rolled.
  const mixes = new Map<string, SalvageStock>(world.salvage.map((stock) => [Object.keys(stock.goods).sort().join(), stock]));
  world.salvage = [...mixes.values()].flatMap((stock) =>
    [[], [makePart(world, WEAPON_ID, 0)], [makePart(world, PLAIN_ID, 0)]].map((parts) => ({ ...stock, parts })),
  );
  return shapeOf(JSON.parse(JSON.stringify(saveOf(world).world)));
}
