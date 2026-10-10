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
import { defaultSetup } from '../sim/settings';

const CONTRACT_KINDS: Contract[] = [
  { id: 'c', shop: 's', kind: 'haul', good: 'g', units: 1, to: 't', reward: 1, deadline: 1, window: 1, rush: false, tier: 1 },
  { id: 'c', shop: 's', kind: 'fetch', defId: 'p', reward: 1, deadline: 1, window: 1, tier: 1 },
  { id: 'c', shop: 's', kind: 'bounty', template: 't', reward: 1, deadline: 1, window: 1, tier: 1, fulfilled: false },
];

const WEAPON_ID = Object.keys(PARTS).find((id) => PARTS[id].kind === 'weapon');
const PLAIN_ID = Object.keys(PARTS).find((id) => PARTS[id].kind !== 'weapon');

export function newGameShape(): Shape {
  const world = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
  if (!WEAPON_ID || !PLAIN_ID) throw new Error('The part data has no weapon or no other part');
  for (const shop of Object.values(world.shops)) {
    shop.contracts = CONTRACT_KINDS;
    shop.stock = [makePart(world, WEAPON_ID, 0), makePart(world, PLAIN_ID, 0)];
  }
  const mixes = new Map<string, SalvageStock>(world.salvage.map((stock) => [Object.keys(lootGoods(stock)).sort().join(), stock]));
  world.salvage = [...mixes.values()].flatMap((stock) =>
    [[], [makePart(world, WEAPON_ID, 0)], [makePart(world, PLAIN_ID, 0)]].map((parts) => {
      const goods = lootGoods(stock);
      return { ...stock, goods, parts, hidden: { ...stock.hidden, goods: { ...goods }, parts } };
    }),
  );
  for (const v of world.vehicles.filter((truck) => truck.brain)) {
    v.items = [
      { id: 'i-goods', x: 0, y: 0, rot: 0, kind: 'good', good: 'g' },
      { id: 'i-gun', x: 0, y: 0, rot: 0, kind: 'part', part: makePart(world, WEAPON_ID, 0) },
      { id: 'i-plain', x: 0, y: 0, rot: 0, kind: 'part', part: makePart(world, PLAIN_ID, 0) },
    ];
  }
  return shapeOf(JSON.parse(JSON.stringify(saveOf(world).world)));
}

function lootGoods(stock: SalvageStock): Record<string, number> {
  return { ...stock.hidden.goods, ...stock.goods };
}
