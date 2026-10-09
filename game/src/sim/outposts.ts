import { FURY_ROAD } from '../data/fury-road';
import { ECONOMY, GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { playerVehicle } from './damage';
import { basicParts, basicsRepairCost, garageParts, garageRepair, partTradePrice, pay, repairCost, supplyRoom, type Supply } from './economy';
import { outpostFactsAt, reachedOutpostAt, type Outpost } from './fury-road';
import { addGoods, canStowPart, cargoRoom, stowPart } from './inventory';
import type { PartInstance, Vehicle, World } from './types';
import { playerCommand } from './world';

const REPAIR_GOOD = 'parts';

export function requireOutpost(world: World): Outpost {
  const post = reachedOutpostAt(world);
  if (!post) throw new Error('Not parked at a reached outpost');
  return post;
}

export function outpostRepairAll(world: World): World {
  return playerCommand(world, (w) => {
    requireOutpost(w);
    repairFor(w, repairCost(w), garageParts(w, playerVehicle(w)));
  });
}

export function outpostRepairBasics(world: World): World {
  return playerCommand(world, (w) => {
    requireOutpost(w);
    repairFor(w, basicsRepairCost(w), basicParts(w, playerVehicle(w)));
  });
}

function repairFor(world: World, cost: number, parts: PartInstance[]): void {
  pay(world, cost, 'repairs');
  for (const part of parts) garageRepair(part);
}

export function outpostBuySupply(world: World, kind: Supply, n: number): World {
  return playerCommand(world, (w) => {
    requireOutpost(w);
    if (!Number.isInteger(n) || n <= 0 || n > supplyRoom(w, kind)) throw new Error(`Cannot buy ${n} ${kind}`);
    pay(w, ECONOMY.supplyPrice[kind] * n, kind);
    w.player[kind] += n;
  });
}

export function outpostPartPrice(world: World, part: PartInstance): number {
  return partTradePrice(world, playerVehicle(world), part, 'buy');
}

export function outpostBuyPart(world: World, partId: string): World {
  return playerCommand(world, (w) => {
    const post = requireOutpost(w);
    const part = post.stock.find((p) => p.id === partId);
    if (!part) throw new Error(`${post.name} has no part ${partId}`);
    const me = playerVehicle(w);
    if (!canStowPart(me, part)) throw new Error(`No room on the truck for ${partDef(part.defId).name}`);
    pay(w, outpostPartPrice(w, part), partDef(part.defId).name);
    const facts = outpostFactsAt(w, post.milestone);
    facts.stock = facts.stock.filter((p) => p.id !== partId);
    stowPart(w, me, part);
  });
}

export function outpostGoodPrice(): number {
  return Math.ceil(GOODS[REPAIR_GOOD].value * FURY_ROAD.goodsMarkup);
}

export function outpostGoodRoom(v: Vehicle): number {
  return cargoRoom(v, REPAIR_GOOD);
}

export function outpostBuyGood(world: World, n: number): World {
  return playerCommand(world, (w) => {
    requireOutpost(w);
    const me = playerVehicle(w);
    if (!Number.isInteger(n) || n <= 0 || n > outpostGoodRoom(me)) throw new Error(`Cannot carry ${n} more ${GOODS[REPAIR_GOOD].name}`);
    pay(w, outpostGoodPrice() * n, GOODS[REPAIR_GOOD].name);
    addGoods(w, me, REPAIR_GOOD, n);
  });
}
