// Wear and part condition. Parts lose HP with distance driven, speed and rough ground, and rarely break down.
// The distance driven comes from each vehicle's trail. One rule for the player and NPCs. The player's driving also
// practices from the rough ground it crosses.

import { ECONOMY } from '../data/goods';
import { partDef, type PartDef } from '../data/parts';
import { TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { CONDITION, WEAR } from '../data/wear';
import { playerVehicle } from './damage';
import { corePart, mountedParts } from './grid';
import { practice, regionOf } from './progress';
import { chance, randInt } from './rng';
import { tileAt } from './terrain';
import { isTowed } from './tow';
import type { PartInstance, Vehicle, World } from './types';
import { dist } from './vec';
import { weatherAt } from './weather';

export function applyWear(world: World): void {
  for (const v of world.vehicles) wearVehicle(world, v);
  practiceRoughGround(world);
}

function wearVehicle(world: World, v: Vehicle): void {
  const { distance, terrainWear } = trailWear(world, v);
  if (distance <= 0) return;
  const speedFactor = 1 + WEAR.speedWeight * v.speed;
  const weatherWear = weatherAt(world, v.pos).wear;
  const oddsScale = distance * terrainWear * speedFactor * weatherWear;
  const cab = corePart(v, 'cab').id;
  const floor = (id: string): number => (id === cab ? 1 : 0);

  for (const p of mountedParts(v).filter((p) => p.hp > 0)) {
    if (chance(world, Math.min(1, WEAR.chancePerTile * oddsScale))) damagePart(p, maxHp(p) * WEAR.hpShare, floor(p.id));
  }

  breakDown(world, v, oddsScale, floor);
  failDrive(world, v, oddsScale);
}

function breakDown(world: World, v: Vehicle, oddsScale: number, floor: (id: string) => number): void {
  const working = mountedParts(v).filter((p) => p.hp > 0);
  if (working.length === 0) return;
  if (!chance(world, Math.min(1, WEAR.breakdownChancePerTile * oddsScale))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  damagePart(part, Math.round(maxHp(part) * WEAR.breakdownHpShare), floor(part.id));
  world.events.push({ t: 'breakdown', vehicle: v.id, part: part.id });
}

function failDrive(world: World, v: Vehicle, oddsScale: number): void {
  const engine = mountedParts(v, 'engine')[0];
  const working = [engine, corePart(v, 'transmission')].filter((p): p is PartInstance => p !== undefined && p.hp > 0);
  if (working.length === 0) return;
  if (!chance(world, Math.min(1, WEAR.failureChancePerTile * oddsScale))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  damagePart(part, part.hp, 0);
  world.events.push({ t: 'breakdown', vehicle: v.id, part: part.id });
}

function trailWear(world: World, v: Vehicle): { distance: number; terrainWear: number } {
  let distance = 0;
  let weighted = 0;
  for (const { len, type } of trailSegments(world, v)) {
    distance += len;
    weighted += len * TERRAIN_TYPES[type].wear;
  }
  return { distance, terrainWear: distance > 0 ? weighted / distance : 0 };
}

function trailSegments(world: World, v: Vehicle): { len: number; type: TerrainTypeId }[] {
  const trail = v.trail;
  const out: { len: number; type: TerrainTypeId }[] = [];
  for (let i = 1; i < trail.length; i++) {
    const len = dist(trail[i - 1], trail[i]);
    if (len <= 0) continue;
    const mid = { x: (trail[i - 1].x + trail[i].x) / 2, y: (trail[i - 1].y + trail[i].y) / 2 };
    out.push({ len, type: world.terrain.types[tileAt(world.terrain, mid)] });
  }
  return out;
}

const GROUND_WEARS = Object.values(TERRAIN_TYPES).map((t) => t.wear);
const SMOOTHEST = Math.min(...GROUND_WEARS);
const ROUGHEST = Math.max(...GROUND_WEARS);

function roughness(type: TerrainTypeId): number {
  return (TERRAIN_TYPES[type].wear - SMOOTHEST) / (ROUGHEST - SMOOTHEST);
}

function practiceRoughGround(world: World): void {
  if (isTowed(world)) return;
  let tiles = 0;
  let weighted = 0;
  for (const { len, type } of trailSegments(world, playerVehicle(world))) {
    const rough = roughness(type);
    if (rough === 0) continue;
    tiles += len;
    weighted += len * rough;
  }
  if (tiles > 0) practice(world, 'roughTiles', tiles, weighted / tiles, regionOf(playerVehicle(world).pos));
}

export function maxHp(part: PartInstance): number {
  return Math.round(partDef(part.defId).hp * (1 - CONDITION.hpLoss * part.wear));
}

export function wornDef<T extends PartDef>(part: PartInstance): T {
  const def = partDef(part.defId);
  const steps = part.wear;
  const hp = maxHp(part);
  const loss = CONDITION.statLoss;
  switch (def.kind) {
    case 'weapon':
      return { ...def, hp, spread: def.spread * (1 + loss.spread * steps) } as T;
    case 'engine':
      return { ...def, hp, speedBonus: def.speedBonus - loss.speedBonus * steps, accelBonus: def.accelBonus - loss.accelBonus * steps } as T;
    case 'armor':
      return { ...def, hp, armor: def.armor * (1 - loss.armor * steps), blastArmor: def.blastArmor * (1 - loss.armor * steps) } as T;
    case 'scanner':
      return { ...def, hp, range: def.range * (1 - loss.scannerRange * steps) } as T;
    default:
      return { ...def, hp } as T;
  }
}

export function isJunk(part: PartInstance): boolean {
  return part.wear > CONDITION.maxWear;
}

export function damagePart(part: PartInstance, amount: number, floor: number): void {
  if (!(amount >= 0) || !(floor >= 0)) throw new Error(`Bad damage ${amount} with floor ${floor} on ${part.id}`);
  const wasWorking = part.hp > 0;
  part.hp = Math.min(part.hp, Math.max(floor, part.hp - amount));
  if (!wasWorking || part.hp > 0) return;
  part.wear = partDef(part.defId).kind === 'core' ? Math.min(CONDITION.maxWear, part.wear + 1) : part.wear + 1;
}

export function restorePart(part: PartInstance, hp: number): void {
  const next = Math.min(maxHp(part), hp);
  if (next < part.hp) throw new Error(`Restore of ${part.id} to ${hp} HP would lower it from ${part.hp}`);
  if (part.hp === 0 && next > 0 && isJunk(part)) throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  part.hp = next;
}

export function carryHp(part: PartInstance, hp: number): void {
  const floor = isJunk(part) ? 0 : 1;
  part.hp = Math.min(maxHp(part), Math.max(floor, hp));
}

export function rebuildJunk(part: PartInstance): void {
  const name = partDef(part.defId).name;
  if (!isJunk(part)) throw new Error(`${name} is not junk`);
  if (part.rebuilt) throw new Error(`${name} was rebuilt before`);
  part.wear = CONDITION.maxWear;
  part.rebuilt = true;
  part.hp = maxHp(part);
}

export function scrapPatchPart(part: PartInstance, share: number): void {
  if (isJunk(part)) part.wear = CONDITION.maxWear;
  part.hp = Math.max(part.hp, Math.ceil(maxHp(part) * share));
}

export function wearFactor(wear: number): number {
  const table = CONDITION.valueFactor;
  const lo = Math.min(Math.floor(wear), table.length - 1);
  const hi = Math.min(lo + 1, table.length - 1);
  const frac = Math.min(1, wear - lo);
  return table[lo] * (1 - frac) + table[hi] * frac;
}

export function scrapValue(part: PartInstance): number {
  return ECONOMY.scrapPerKg * partDef(part.defId).mass;
}

export function partValue(part: PartInstance): number {
  if (isJunk(part)) return scrapValue(part);
  return partDef(part.defId).value * wearFactor(part.wear);
}
