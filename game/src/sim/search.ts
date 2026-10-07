// Scavenging search: a parked job that takes turns in proportion to the stock. A finished search
// opens the stock to the player, who takes what they want from it. An NPC takes everything that fits.

import { SALVAGE } from '../data/salvage';
import { playerVehicle } from './damage';
import { startJob } from './jobs';
import { practice, skillEffect } from './progress';
import { canReachSalvage, collectSalvage, requireLootFree, salvageUnits } from './salvage';
import { breakLootWarning } from './loot-warning';
import type { Job, Vehicle, World } from './types';
import { playerCommand } from './world';

// Turns a search needs: the stock's units at unitsPerTurn a turn, cut by the player's machining.
function estimateTurns(world: World, v: Vehicle, units: number): number {
  const cut = 1 - skillEffect(world, v, 'machining', 'search');
  return Math.max(1, Math.ceil((units / SALVAGE.unitsPerTurn) * cut));
}

// Mutates a draft world: starts a search job at the given stock. Shared by the player command and NPCs. A pile
// takes a fixed number of turns.
export function beginSearch(world: World, v: Vehicle, stockId: string): void {
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock) throw new Error(`Unknown salvage ${stockId}`);
  const turns = stock.pile ? SALVAGE.pileSearchTurns : estimateTurns(world, v, salvageUnits(stock));
  startJob(world, v, { kind: 'search', stockId, turnsLeft: turns, total: turns });
}

export function startSearch(world: World, stockId: string): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    requireLootFree(w, me, stockId);
    breakLootWarning(w, me, stockId);
    beginSearch(w, me, stockId);
  });
}

// A truck nudged out of reach while it searches, like a blocked one creeping on toward its order, stops the search.
export function isSearchStalled(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  const stock = world.salvage.find((entry) => entry.id === job.stockId);
  return !!stock && !canReachSalvage(v, stock);
}

export function searchTurn(world: World, v: Vehicle, job: Extract<Job, { kind: 'search' }>): boolean {
  if (!world.salvage.some((entry) => entry.id === job.stockId)) throw new Error(`Unknown salvage ${job.stockId}`);
  job.turnsLeft = Math.max(0, job.turnsLeft - 1);
  if (job.turnsLeft > 0) return false;
  finishSearch(world, v, job.stockId);
  return true;
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
