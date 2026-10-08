// Discovery, the oasis and scavenging.

import { SALVAGE } from '../data/salvage';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { isKnockedOut } from './defeat';
import { inTowReach } from './tow';
import { canLootTruck, canReachSalvage, collectSalvage, hasRevealed, hasSalvage, hiddenUnits, lootBlocker, pourStores, requireLootFree, salvageInRange, takeBasis } from './salvage';
import { takeClaimed } from './parley';
import { newId } from './factory';
import { goodsCount, isMounted, type Spot } from './grid';
import { getLayoutError, lootRefitTurns, requireIdleRefit } from './inventory';
import { inCombat } from './combat';
import { startJob } from './jobs';
import { beginSearch } from './search';
import { practice } from './progress';
import { isFortress, locationAt, siteGap, type Site } from './sites';
import { shopAt } from './market';
import type { GridItem, PartInstance, SalvageStock, Vehicle, World } from './types';
import { tileCenter } from './vision';
import { playerCommand } from './world';
import { suppliesCap } from './stats';

export function discoverSites(world: World): void {
  for (const s of [...REGION.towns, ...REGION.locations]) {
    if (
      world.player.discovered.includes(s.id) ||
      !seesArea(world, s)
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

function seesArea(world: World, site: Site): boolean {
  const reach = isFortress(site) ? REGION.sites.pad.length : 0;
  return world.player.visible.some((idx) => siteGap(site, tileCenter(world, idx)) <= reach);
}

export function salvageHere(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => hasSalvage(stock) && canReachSalvage(me, stock)) ?? null;
}

export function salvageNear(world: World): SalvageStock | null {
  return salvageListNear(world)[0] ?? null;
}

export function salvageListNear(world: World): SalvageStock[] {
  const me = playerVehicle(world);
  return world.salvage.filter((stock) => hasSalvage(stock) && salvageInRange(me, stock));
}

export function downedNear(world: World): Vehicle | null {
  return downedListNear(world)[0] ?? null;
}

export function downedListNear(world: World): Vehicle[] {
  const me = playerVehicle(world);
  return world.vehicles.filter((v) => v.id !== me.id && isKnockedOut(v) && inTowReach(me, v));
}

export function downedHere(world: World): Vehicle | null {
  const me = playerVehicle(world);
  return world.vehicles.find((v) => canLootTruck(me, v)) ?? null;
}

export function emptySalvageNear(world: World): SalvageStock | null {
  const me = playerVehicle(world);
  return world.salvage.find((stock) => !stock.pile && !hasSalvage(stock) && salvageInRange(me, stock)) ?? null;
}

export function lootBlockerHere(world: World, targetId: string): Vehicle | null {
  return lootBlocker(world, playerVehicle(world), targetId);
}

function reachableStock(world: World, stockId: string): SalvageStock | null {
  const me = playerVehicle(world);
  const stock = world.salvage.find((s) => s.id === stockId);
  return stock && hasSalvage(stock) && canReachSalvage(me, stock) ? stock : null;
}

export function needsSearch(world: World, stock: SalvageStock): boolean {
  return hiddenUnits(stock) > 0 || !world.player.scavenged.includes(stock.id);
}

export function canScavenge(world: World, stockId: string): boolean {
  const me = playerVehicle(world);
  const stock = reachableStock(world, stockId);
  return stock !== null && needsSearch(world, stock) && !inCombat(world, me) && !lootBlocker(world, me, stockId);
}

export function hasLootFor(world: World, stock: SalvageStock): boolean {
  return world.player.scavenged.includes(stock.id) && hasRevealed(stock);
}

export function canLoot(world: World, stockId: string): boolean {
  const stock = reachableStock(world, stockId);
  return stock !== null && hasLootFor(world, stock);
}

export function scavenge(world: World, stockId: string): World {
  return playerCommand(world, (w) => {
    if (w.salvage.some((s) => s.id === stockId)) requireLootFree(w, playerVehicle(w), stockId);
    if (!canScavenge(w, stockId)) throw new Error('Nothing to search in reach');
    beginSearch(w, playerVehicle(w), stockId);
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
  if (item.kind === 'part' && isMounted(me.chassisId, item) && !shopAt(world)) {
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
