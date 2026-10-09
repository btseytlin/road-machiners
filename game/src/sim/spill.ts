// Broken cargo parts drop what lies on their rows. The sweep runs after each turn step that can break a part,
// so every way a cargo part breaks spills the same way. A robber in the fight claims the spill.

import { gridOf, mountedParts, onDeadRow } from './grid';
import { claimSpill } from './parley';
import { spillOnPile } from './salvage';
import { modeRules } from './settings';
import type { GridItem, Vehicle, World } from './types';

export function spillDeadRows(world: World): void {
  for (const v of world.vehicles) spillVehicle(world, v);
}

function spillVehicle(world: World, v: Vehicle): void {
  const g = gridOf(v);
  if (g.deadFrom === g.h) return;
  const items = v.items.filter((it) => onDeadRow(g, it));
  if (items.length === 0) return;
  const broken = mountedParts(v, 'cargo').find((p) => p.hp === 0);
  if (!broken) throw new Error(`${v.id} has dead rows but no broken cargo part`);
  if (modeRules(world).salvage) spillOnGround(world, v, broken.id, items);
  else loseCargo(world, v, broken.id, items);
}

function spillOnGround(world: World, v: Vehicle, part: string, items: GridItem[]): void {
  const stock = spillOnPile(world, v, items);
  world.events.push({ t: 'cargoSpilled', vehicle: v.id, part, pile: stock.id, units: items.length });
  claimSpill(world, v, stock);
}

function loseCargo(world: World, v: Vehicle, part: string, items: GridItem[]): void {
  const lost = new Set(items.map((it) => it.id));
  v.items = v.items.filter((it) => !lost.has(it.id));
  world.events.push({ t: 'cargoSpilled', vehicle: v.id, part, pile: null, units: items.length });
}
