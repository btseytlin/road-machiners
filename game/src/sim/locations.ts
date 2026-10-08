// Discovery, the oasis and scavenging.

import { SALVAGE } from '../data/salvage';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { isKnockedOut } from './defeat';
import { inTowReach } from './tow';
import { canLootTruck, canReachSalvage, collectSalvage, hasSalvage, lootBlocker, pourStores, requireLootFree, salvageInRange, takeBasis } from './salvage';
import { takeClaimed } from './parley';
import { newId } from './factory';
import { goodsCount, isMounted, type Spot } from './grid';
import { getLayoutError, lootRefitTurns, requireIdleRefit } from './inventory';
import { inCombat } from './combat';
import { startJob } from './jobs';
import { beginSearch } from './search';
import { practice } from './progress';
import { locationAt, townAt } from './sites';
import type { GridItem, PartInstance, SalvageStock, Vehicle, World } from './types';
import { tileCenter } from './vision';
import { dist, type Vec } from './vec';
import { playerCommand } from './world';
import { suppliesCap } from './stats';

export function discoverSites(world: World): void {
  for (const s of [...REGION.towns, ...REGION.locations]) {
    if (
      world.player.discovered.includes(s.id) ||
      !seesArea(world, s.pos, s.radius)
    )
      continue;
    discoverSite(world, s);
  }
}

export function discoverSite(world: World, s: { id: string; name: string }): void {
  if (world.player.discovered.includes(s.id)) throw new Error(`${s.id} is already discovered`);
  world.player.discovered.push(s.id);
  world.events.push({ t: "discover", location: s.id });
  practice(world, 'discover', 1, null, s.id);
}

export function applySiteAction(world: World): World | null {
  if (canUseOasis(world)) return useOasis(world);
  if (canScavenge(world)) return scavenge(world);
  return null;
}

export function canUseOasis(world: World): boolean {
  return locationAt(world)?.kind === 'oasis' && playerVehicle(world).speed <= RULES.parkedSpeed;
}

export function useOasis(world: World): World {
  return playerCommand(world, (w) => {
    const loc = locationAt(w);
    if (loc?.kind !== 'oasis') throw new Error('Not at an oasis');
    if (!canUseOasis(w)) throw new Error('Stop the truck first');
    w.player.supplies = suppliesCap(playerVehicle(w));
    w.events.push({ t: "info", text: `Filled supplies at ${loc.name}` });
  });
}

function seesArea(world: World, center: Vec, radius: number): boolean {
  return world.player.visible.some(
    (idx) => dist(tileCenter(world, idx), center) <= radius,
  );
}

export function salvageHere(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => hasSalvage(stock) && canReachSalvage(me, stock)) ?? null;
}

export function salvageNear(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => hasSalvage(stock) && salvageInRange(me, stock)) ?? null;
}

export function downedNear(world: World): Vehicle | null {
  const me = playerVehicle(world);
  return world.vehicles.find((v) => v.id !== me.id && isKnockedOut(v) && inTowReach(me, v)) ?? null;
}

export function downedHere(world: World): Vehicle | null {
  const me = playerVehicle(world);
  return world.vehicles.find((v) => canLootTruck(me, v)) ?? null;
}

export function emptySalvageNear(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => !stock.pile && !hasSalvage(stock) && salvageInRange(me, stock)) ?? null;
}

export function lootBlockerHere(world: World): Vehicle | null {
  const target = salvageHere(world) ?? downedHere(world);
  return target && lootBlocker(world, playerVehicle(world), target.id);
}

export function canScavenge(world: World): boolean {
  const me = playerVehicle(world);
  const stock = salvageHere(world);
  return stock !== null && !world.player.scavenged.includes(stock.id) && !inCombat(world, me) && !lootBlocker(world, me, stock.id);
}

export function canLoot(world: World): boolean {
  const stock = salvageHere(world);
  return stock !== null && world.player.scavenged.includes(stock.id);
}

export function scavenge(world: World): World {
  return playerCommand(world, (w) => {
    const stock = salvageHere(w);
    if (stock) requireLootFree(w, playerVehicle(w), stock.id);
    if (!stock || !canScavenge(w)) throw new Error('Nothing unsearched in reach');
    beginSearch(w, playerVehicle(w), stock.id);
  });
}

export type LootPick = { kind: 'part'; partId: string } | { kind: 'good'; good: string };

export function takeLoot(world: World, stockId: string, pick: LootPick, to: Spot): World {
  return playerCommand(world, (w) => {
    const stock = requireLootable(w, stockId);
    const me = playerVehicle(w);
    requireIdleRefit(me);
    const item: GridItem = pick.kind === 'part'
      ? { id: newId(w, 'i'), kind: 'part', part: requireStockPart(stock, pick.partId), ...to }
      : { id: newId(w, 'i'), kind: 'good', good: pick.good, ...to };
    if (pick.kind === 'good' && (stock.goods[pick.good] ?? 0) <= 0) throw new Error(`No ${pick.good} left here`);
    const err = getLayoutError(me, [...me.items, item]);
    if (err) throw new Error(err);
    transferLoot(w, stock, item, to);
  });
}

function transferLoot(world: World, stock: SalvageStock, item: GridItem, to: Spot): void {
  const me = playerVehicle(world);
  if (item.kind === 'part' && isMounted(me.chassisId, item) && !townAt(world)) {
    const work = lootRefitTurns(world, me, RULES.refitTurnsPerPart);
    startJob(world, me, {
      kind: 'refit', moves: [],
      pickup: { from: 'stock', stockId: stock.id, partId: item.part.id, itemId: item.id, to },
      turnsLeft: work, total: work,
    });
    return;
  }
  placeLoot(world, stock, item);
}

function placeLoot(world: World, stock: SalvageStock, item: GridItem): void {
  const me = playerVehicle(world);
  if (item.kind === 'good') {
    takeBasis(world, stock, item.good, goodsCount(me)[item.good] ?? 0, 1);
    me.items.push(item);
    stock.goods[item.good] -= 1;
    return;
  }
  me.items.push(item);
  stock.parts = stock.parts.filter((part) => part.id !== item.part.id);
}

export function takeAllLoot(world: World, stockId: string): World {
  return playerCommand(world, (w) => {
    requireLootable(w, stockId);
    requireIdleRefit(playerVehicle(w));
    collectSalvage(w, playerVehicle(w), stockId, Infinity);
  });
}

export function takeStores(world: World, stockId: string): World {
  return playerCommand(world, (w) => pourStores(w, playerVehicle(w), requireLootable(w, stockId)));
}

function requireLootable(world: World, stockId: string): SalvageStock {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  if (!world.player.scavenged.includes(stockId)) throw new Error('Search this site first');
  if (!canReachSalvage(playerVehicle(world), stock)) throw new Error('Stop within reach of the salvage');
  requireLootFree(world, playerVehicle(world), stockId);
  takeClaimed(world, stock);
  return stock;
}

function requireStockPart(stock: SalvageStock, partId: string): PartInstance {
  const part = stock.parts.find((p) => p.id === partId);
  if (!part) throw new Error(`No part ${partId} here`);
  return part;
}
