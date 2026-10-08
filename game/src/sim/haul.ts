// What a deal hands over. The haul is the loose cargo, and for a surrender a few mounted parts, that a winning NPC can
// stow now. A demand asks for it, the loser drops exactly it, and the winner picks it all up. It is a query and never changes the world.

import { GOODS } from '../data/goods';
import { RULES } from '../data/rules';
import { partSellPrice } from './economy';
import { findSpot, gridOf, isMounted } from './grid';
import { cargoRoom, stowPlace } from './inventory';
import { looseCargo, takeError } from './salvage';
import type { CallVar, GridItem, Vehicle, World } from './types';

type PartItem = Extract<GridItem, { kind: 'part' }>;
type GoodItem = Extract<GridItem, { kind: 'good' }>;

export function removableParts(victim: Vehicle): PartItem[] {
  return victim.items
    .filter((item): item is PartItem => item.kind === 'part' && isMounted(victim.chassisId, item) && takeError(victim, item) === null)
    .sort((a, b) => partSellPrice(b.part) - partSellPrice(a.part));
}

function value(item: GridItem): number {
  return item.kind === 'part' ? partSellPrice(item.part) : GOODS[item.good].value;
}

function byValue(items: GridItem[]): GridItem[] {
  return items.map((item, i) => ({ item, i })).sort((a, b) => value(b.item) - value(a.item) || a.i - b.i).map((e) => e.item);
}

function inPickupOrder(items: GridItem[]): GridItem[] {
  const parts = items.filter((item) => item.kind === 'part');
  const goods = items.filter((item): item is GoodItem => item.kind === 'good');
  const kinds = [...new Set(goods.map((item) => item.good))];
  return [...parts, ...kinds.flatMap((kind) => goods.filter((item) => item.good === kind))];
}

function fitsAll(winner: Vehicle, items: GridItem[]): boolean {
  const probe: Vehicle = { ...winner, items: [...winner.items] };
  for (const item of inPickupOrder(items)) {
    if (item.kind === 'part') {
      const spot = stowPlace(probe, item);
      if (!spot) return false;
      probe.items.push({ ...item, ...spot });
      continue;
    }
    if (cargoRoom(probe, item.good) < 1) return false;
    const spot = findSpot(gridOf(probe), probe.items, item, null, null);
    if (!spot) return false;
    probe.items.push({ ...item, ...spot });
  }
  return true;
}

function choose(winner: Vehicle, candidates: GridItem[], chosen: GridItem[], limit: number): GridItem[] {
  const picked = [...chosen];
  for (const item of candidates) {
    if (picked.length - chosen.length >= limit) break;
    if (fitsAll(winner, [...picked, item])) picked.push(item);
  }
  return picked;
}

export function cargoHaul(_world: World, winner: Vehicle, loser: Vehicle): GridItem[] {
  return inPickupOrder(choose(winner, byValue(looseCargo(loser)), [], Infinity));
}

export function surrenderHaul(world: World, winner: Vehicle, loser: Vehicle): GridItem[] {
  const cargo = cargoHaul(world, winner, loser);
  return inPickupOrder(choose(winner, removableParts(loser), cargo, RULES.surrenderParts));
}

export function haulVar(items: GridItem[]): Extract<CallVar, { kind: 'haul' }> {
  const goods: Record<string, number> = {};
  const parts: string[] = [];
  for (const item of items) {
    if (item.kind === 'good') goods[item.good] = (goods[item.good] ?? 0) + 1;
    else parts.push(item.part.defId);
  }
  return { kind: 'haul', goods, parts };
}

export function showsHaul(shown: CallVar | undefined, items: GridItem[]): boolean {
  if (shown?.kind !== 'haul') return false;
  const key = (v: Extract<CallVar, { kind: 'haul' }>) => JSON.stringify([Object.entries(v.goods).sort(), [...v.parts].sort()]);
  return key(shown) === key(haulVar(items));
}
