// Inventory commands. Field equipment changes use parked refit jobs.

import { GOODS } from '../data/goods';
import { partDef } from '../data/parts';
import { skillEffect, vehicleHasPerk } from './progress';
import { playerVehicle } from './damage';
import { newId } from './factory';
import { cabShield, gunLayoutScore } from './armor';
import { findSpot, freeCells, gridOf, isMounted, itemCells, MOUNT_CELLS, mountSpots, placementError, type Cell, type Spot } from './grid';
import { requireShop, shopAt } from './market';
import { disarm } from './claymore';
import { workTimeMult } from './utility';
import { startJob } from './jobs';
import { RULES } from '../data/rules';
import { PERK_NUMBERS } from '../data/skills';
import { canReachSalvage, dumpOnPile, truckPickupItem } from './salvage';
import { fitStores } from './resources';
import { itemMass } from './mass';
import { npcMassRoom, vehicleStats } from './stats';
import type { GridItem, PartInstance, RefitJob, RefitMove, RefitPickup, Refusal, Vehicle, World } from './types';
import { playerCommand, Refused } from './world';

export function mountPart(world: World, v: Vehicle, part: PartInstance, mount: Cell[] = MOUNT_CELLS[partDef(part.defId).kind]): boolean {
  const item: PartItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'part', part };
  const spot = installSpot(v, item, mount);
  if (!spot) return false;
  v.items.push({ ...item, ...spot });
  return true;
}

type PartItem = Extract<GridItem, { kind: 'part' }>;

export function installSpot(v: Vehicle, item: PartItem, mount: Cell[] = MOUNT_CELLS[partDef(item.part.defId).kind]): Spot | null {
  const others = { ...v, items: v.items.filter((it) => it.id !== item.id) };
  const def = partDef(item.part.defId);
  if (def.kind === 'weapon' || def.tall) return bestArcSpot(others, item, mount);
  if (def.kind === 'armor') return bestShieldSpot(others, item, mount);
  return findSpot(gridOf(others), others.items, item, mount, null);
}

export function stowSpot(v: Vehicle, item: GridItem): Spot | null {
  const avoid = item.kind === 'part' ? MOUNT_CELLS[partDef(item.part.defId).kind] : null;
  return findSpot(gridOf(v), v.items, item, null, avoid);
}

function bestArcSpot(v: Vehicle, item: GridItem, mount: Cell[]): Spot | null {
  let best: Spot | null = null;
  let bestScore = -1;
  for (const spot of mountSpots(gridOf(v), v.items, item, mount)) {
    const score = gunLayoutScore({ ...v, items: [...v.items, { ...item, ...spot }] });
    if (score > bestScore) [best, bestScore] = [spot, score];
  }
  return best;
}

function bestShieldSpot(v: Vehicle, item: GridItem, mount: Cell[]): Spot | null {
  let best: Spot | null = null;
  let bestScore = -1;
  for (const spot of mountSpots(gridOf(v), v.items, item, mount)) {
    const score = cabShield({ ...v, items: [...v.items, { ...item, ...spot }] });
    if (score > bestScore) [best, bestScore] = [spot, score];
  }
  return best;
}

export function cargoMassRoom(v: Vehicle): number {
  return v.brain ? npcMassRoom(v) : Infinity;
}

export function cargoRoom(v: Vehicle, good: string): number {
  return Math.min(freeCells(v), Math.floor(cargoMassRoom(v) / GOODS[good].mass));
}

export function hasCargoRoom(v: Vehicle): boolean {
  return Object.keys(GOODS).some((good) => cargoRoom(v, good) > 0);
}

function stowPlace(v: Vehicle, item: GridItem): Spot | null {
  return itemMass(item) > cargoMassRoom(v) ? null : stowSpot(v, item);
}

export function canStowPart(v: Vehicle, part: PartInstance): boolean {
  return stowPlace(v, { id: 'probe', x: 0, y: 0, rot: 0, kind: 'part', part }) !== null;
}

export function stowPart(world: World, v: Vehicle, part: PartInstance): boolean {
  const item: GridItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'part', part };
  const spot = stowPlace(v, item);
  if (!spot) return false;
  v.items.push({ ...item, ...spot });
  return true;
}

export function addGoods(world: World, v: Vehicle, good: string, n: number): number {
  const count = Math.min(n, cargoRoom(v, good));
  for (let i = 0; i < count; i++) {
    const item: GridItem = { id: newId(world, 'i'), x: 0, y: 0, rot: 0, kind: 'good', good };
    const spot = findSpot(gridOf(v), v.items, item, null, null);
    if (!spot) return i;
    v.items.push({ ...item, ...spot });
  }
  return count;
}

export function removeGoods(v: Vehicle, good: string, n: number): void {
  const held = v.items.filter((it) => it.kind === 'good' && it.good === good);
  if (held.length < n) throw new Error(`Cannot remove ${n} ${good}, holding ${held.length}`);
  const drop = new Set(held.slice(held.length - n).map((it) => it.id));
  v.items = v.items.filter((it) => !drop.has(it.id));
}

export function removeAllGoods(v: Vehicle): void {
  v.items = v.items.filter((it) => it.kind !== 'good');
}

export function spareParts(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && !isMounted(v.chassisId, it) ? [it.part] : []));
}

export function moveItem(world: World, itemId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    const result = planItemMove(me, itemId, to);
    if (result.error !== null) throw new Refused(result.error);
    const moving = findItem(me, itemId);
    if (moving.kind === 'part') disarm(moving.part);
    const { moves, items, turns } = result.plan;
    if (turns > 0 && !shopAt(w)) {
      const work = refitTurns(w, me, turns);
      startJob(w, me, { kind: 'refit', moves, pickup: null, turnsLeft: work, total: work });
    } else applyRefitLayout(w, me, items);
  });
}

export function refitTurns(world: World, v: Vehicle, planned: number): number {
  return Math.max(1, Math.ceil(planned * workTimeMult(v) * (1 - skillEffect(world, v, 'machining', 'refit'))));
}

export function lootRefitTurns(world: World, v: Vehicle, planned: number): number {
  return vehicleHasPerk(world, v, 'cannibal') ? PERK_NUMBERS.cannibal.turns : refitTurns(world, v, planned);
}

export function storePart(world: World, itemId: string): World {
  return playerCommand(world, (w) => {
    requireShop(w);
    const me = playerVehicle(w);
    requireIdleRefit(me);
    const item = findItem(me, itemId);
    if (item.kind !== 'part') throw new Error('Only parts go into garage storage');
    requireRemovable(item);
    me.items = me.items.filter((it) => it.id !== itemId);
    disarm(item.part);
    w.player.storage.push(item.part);
    afterRefit(w);
  });
}

export function takeFromStorage(world: World, partId: string, to: Spot): World {
  return playerCommand(world, (w) => {
    requireShop(w);
    const me = playerVehicle(w);
    requireIdleRefit(me);
    const i = w.player.storage.findIndex((p) => p.id === partId);
    if (i < 0) throw new Error(`No stored part ${partId}`);
    const item: GridItem = { id: newId(w, 'i'), kind: 'part', part: w.player.storage[i], ...to };
    const err = placementError(gridOf(me), me.items, item, null);
    if (err) throw new Refused(err);
    w.player.storage.splice(i, 1);
    me.items.push(item);
    afterRefit(w);
  });
}

export function dumpItem(world: World, itemId: string): World {
  return playerCommand(world, (w) => {
    const me = playerVehicle(w);
    requireIdleRefit(me);
    const item = findItem(me, itemId);
    if (isMounted(me.chassisId, item)) throw new Error('Remove an installed part before dumping it');
    dumpOnPile(w, me, item);
  });
}

function findItem(v: Vehicle, itemId: string): GridItem {
  const item = v.items.find((it) => it.id === itemId);
  if (!item) throw new Error(`No item ${itemId}`);
  return item;
}

function requireRemovable(item: GridItem): void {
  if (item.kind === 'part' && partDef(item.part.defId).kind === 'core') throw new Refused({ id: 'builtInFixed' });
}

export function afterRefit(w: World): void {
  const me = playerVehicle(w);
  const error = getLayoutError(me, me.items);
  if (error) throw new Refused(error);
  applyRefitLayout(w, me, me.items);
}

type RefitPlan = { moves: RefitMove[]; items: GridItem[]; turns: number };
type PlanResult = { plan: RefitPlan; error: null } | { plan: null; error: Refusal };

export function requireIdleRefit(v: Vehicle): void {
  if (v.job?.kind === 'refit') throw new Refused({ id: 'refitRunning' });
}

export function getLayoutError(v: Vehicle, items: GridItem[]): Refusal | null {
  const grid = gridOf({ ...v, items });
  for (const item of items) {
    const error = placementError(grid, items, item, item.id);
    if (error) return { id: 'badLayout', cause: error };
  }
  return null;
}

export function planItemMove(v: Vehicle, itemId: string, to: Spot): PlanResult {
  const item = v.items.find((entry) => entry.id === itemId);
  if (!item) return { plan: null, error: { id: 'itemGone' } };
  if (v.job?.kind === 'refit') return { plan: null, error: { id: 'refitRunning' } };
  const moved = { ...item, ...getSpot(to) };
  const cells = new Set(itemCells(moved).map((cell) => `${cell.x},${cell.y}`));
  const targets = v.items.filter((other) => other.id !== itemId && itemCells(other).some((cell) => cells.has(`${cell.x},${cell.y}`)));
  if (targets.length > 1) return { plan: null, error: { id: 'twoInTheWay' } };
  const moves: RefitMove[] = [{ itemId, from: getSpot(item), to: getSpot(to) }];
  const target = targets[0];
  if (target) moves.push({ itemId: target.id, from: getSpot(target), to: { x: item.x, y: item.y, rot: target.rot } });
  return planMoves(v, moves);
}

function planMoves(v: Vehicle, moves: RefitMove[]): PlanResult {
  const items = [...v.items];
  let turns = 0;
  for (const move of moves) {
    const index = items.findIndex((item) => item.id === move.itemId);
    const item = items[index];
    const problem = getMoveError(item, move);
    if (problem) return { plan: null, error: problem };
    if (matchesSpot(item, move.to)) continue;
    const moved = { ...item, ...move.to };
    turns += RULES.refitTurnsPerPart * (Number(isMounted(v.chassisId, item)) + Number(isMounted(v.chassisId, moved)));
    items[index] = moved;
  }
  const error = getLayoutError(v, items);
  return error ? { plan: null, error } : { plan: { moves, items, turns }, error: null };
}

function getMoveError(item: GridItem | undefined, move: RefitMove): Refusal | null {
  if (!item || !matchesSpot(item, move.from)) return { id: 'refitItemMoved' };
  if (item.kind === 'part' && partDef(item.part.defId).kind === 'core') return { id: 'builtInFixed' };
  return null;
}

export function getRefitLayout(world: World, v: Vehicle, job: RefitJob): { items: GridItem[]; error: null } | { items: null; error: Refusal } {
  const result = planMoves(v, job.moves);
  if (result.error !== null) return { items: null, error: result.error };
  const items = result.plan.items;
  if (job.pickup) {
    const pickup = getRefitPickup(world, v, job.pickup);
    if (!('kind' in pickup)) return { items: null, error: pickup };
    items.push(pickup);
  }
  const error = getLayoutError(v, items);
  return error ? { items: null, error } : { items, error: null };
}

function getRefitPickup(world: World, v: Vehicle, pickup: RefitPickup): GridItem | Refusal {
  if (pickup.from === 'truck') return truckPickupItem(world, v, pickup);
  const { stockId, partId, itemId, to } = pickup;
  const stock = world.salvage.find((entry) => entry.id === stockId);
  if (!stock || !world.player.scavenged.includes(stockId) || !canReachSalvage(v, stock)) return { id: 'salvageOutOfReach' };
  const part = stock.parts.find((entry) => entry.id === partId);
  if (!part) return { id: 'salvagePartGone' };
  return { kind: 'part', id: itemId, part, ...to };
}

export function applyRefitLayout(world: World, v: Vehicle, items: GridItem[]): void {
  v.items = items;
  const stats = vehicleStats(world, v);
  for (const id of Object.keys(v.weaponOrders)) {
    if (!stats.weapons.some((mount) => mount.part.id === id)) delete v.weaponOrders[id];
  }
  fitStores(world, v);
}

function getSpot(item: Spot): Spot {
  return { x: item.x, y: item.y, rot: item.rot };
}

function matchesSpot(item: GridItem, spot: Spot): boolean {
  return item.x === spot.x && item.y === spot.y && item.rot === spot.rot;
}
