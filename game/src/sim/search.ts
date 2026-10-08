// Scavenging search: a parked job that takes turns in proportion to the stock. Each turn reveals hidden loot. A
// finished search opens the stock's revealed loot to the player, who takes what they want from it. An NPC takes the
// revealed loot that fits.

import { SALVAGE } from '../data/salvage';
import { SEARCH } from '../data/utilities';
import { playerVehicle } from './damage';
import { startJob } from './jobs';
import { practice, skillEffect } from './progress';
import { canReachSalvage, collectSalvage, hiddenUnits, requireLootFree, revealTurn, salvageUnits, type Found } from './salvage';
import type { Rng } from './rng';
import type { Job, SalvageStock, Vehicle, World } from './types';
import { hasWorkingUtility } from './utility';
import { playerCommand } from './world';

const SEARCH_SALT = 0x73656172;

export function searchStream(seed: number): Rng {
  return { rngState: seed ^ SEARCH_SALT };
}

function estimateTurns(world: World, v: Vehicle, stock: SalvageStock): number {
  const units = hiddenUnits(stock) || salvageUnits(stock);
  const cut = 1 - skillEffect(world, v, 'machining', 'search');
  return Math.max(1, Math.ceil((units / SALVAGE.unitsPerTurn) * cut));
}

export function beginSearch(world: World, v: Vehicle, stockId: string): void {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  const turns = stock.pile ? SALVAGE.pileSearchTurns : estimateTurns(world, v, stock);
  startJob(world, v, { kind: 'search', stockId, turnsLeft: turns, total: turns });
}

export function startSearch(world: World, stockId: string): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    requireLootFree(w, me, stockId);
    beginSearch(w, me, stockId);
  });
}

export function isSearchStalled(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  const stock = world.salvage.find((entry) => entry.id === job.stockId);
  return !!stock && !canReachSalvage(v, stock);
}

export function searchTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  const stock = world.salvage.find((entry) => entry.id === job.stockId);
  if (!stock) throw new Error(`Unknown salvage ${job.stockId}`);
  revealFor(world, v, stock);
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishSearch(world, v, job.stockId);
  return true;
}

function revealFor(world: World, v: Vehicle, stock: SalvageStock): void {
  const found = revealTurn(world, stock, hasWorkingUtility(v, 'scraper') ? SEARCH.scraperReveal : SEARCH.reveal);
  if (foundAny(found) && v.id === world.player.vehicleId) world.events.push({ t: 'found', vehicle: v.id, stock: stock.id, ...found });
}

function foundAny(found: Found): boolean {
  return found.parts.length > 0 || Object.keys(found.goods).length > 0 || found.fuel > 0 || found.supplies > 0;
}

function finishSearch(world: World, v: Vehicle, stockId: string): void {
  if (v.id !== world.player.vehicleId) {
    collectSalvage(world, v, stockId, Infinity);
    return;
  }
  if (!world.player.scavenged.includes(stockId)) {
    world.player.scavenged.push(stockId);
    practice(world, 'search', 1, null, stockId);
  }
  world.events.push({ t: 'searched', stock: stockId });
}
