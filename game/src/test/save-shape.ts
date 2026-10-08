// The saved shape of a new game on the test map, which npm run save:shape writes and the save test checks.

import { PARTS } from '../data/parts';
import { startKit } from '../data/start';
import { makePart } from '../sim/factory';
import type { Contract } from '../sim/market';
import { newWorld } from '../sim/world';
import { saveOf } from '../three/save';
import { shapeOf, type Shape } from '../three/save-shape';
import { TEST_MAP } from './map';

const CONTRACT_KINDS: Contract[] = [
  { id: 'c', shop: 's', kind: 'haul', good: 'g', units: 1, to: 't', reward: 1, deadline: 1, window: 1, rush: false, tier: 1 },
  { id: 'c', shop: 's', kind: 'fetch', defId: 'p', reward: 1, deadline: 1, window: 1, tier: 1 },
  { id: 'c', shop: 's', kind: 'bounty', template: 't', targetName: 'n', reward: 1, deadline: 1, window: 1, tier: 1 },
];

const WEAPON_ID = Object.keys(PARTS).find((id) => PARTS[id].kind === 'weapon');
const PLAIN_ID = Object.keys(PARTS).find((id) => PARTS[id].kind !== 'weapon');

export function newGameShape(): Shape {
  const world = newWorld(1337, startKit('standard'), TEST_MAP);
  if (!WEAPON_ID || !PLAIN_ID) throw new Error('The part data has no weapon or no other part');
  for (const shop of Object.values(world.shops)) {
    shop.contracts = CONTRACT_KINDS;
    shop.stock = [makePart(world, WEAPON_ID, 0), makePart(world, PLAIN_ID, 0)];
  }
  return shapeOf(JSON.parse(JSON.stringify(saveOf(world).world)));
}
