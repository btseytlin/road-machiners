// Wear and part condition. Parts lose HP with distance driven, speed and rough ground, and rarely break down.
// The distance driven comes from each vehicle's trail. One rule for the player and NPCs. The player's driving also
// practices from the rough ground it crosses.
// This file is the only place that writes part HP. A part gains one wear step each time it drops from above
// 0 HP to 0 HP. Each step lowers its max HP and its job stat. A part past the last wear step is junk,
// and no repair rebuilds it from 0 HP. Only the Rebuild perk's garage work brings it back, once per part.

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
import { weatherOn } from './weather';

export function applyWear(world: World): void {
  for (const v of world.vehicles) wearVehicle(world, v);
  practiceRoughGround(world);
}

function wearVehicle(world: World, v: Vehicle): void {
  const { distance, terrainWear } = trailWear(world, v);
  if (distance <= 0) return;
  const speedFactor = 1 + WEAR.speedWeight * v.speed;
  const weatherWear = weatherOn(world, v).wear;
  const oddsScale = distance * terrainWear * speedFactor * weatherWear;
  // Wear never breaks the cab. Only a fight or a crash can knock the driver out.
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

// A failure takes the first engine or the transmission to 0 HP, so the truck strands.
function failDrive(world: World, v: Vehicle, oddsScale: number): void {
  const engine = mountedParts(v, 'engine')[0];
  const working = [engine, corePart(v, 'transmission')].filter((p): p is PartInstance => p !== undefined && p.hp > 0);
  if (working.length === 0) return;
  if (!chance(world, Math.min(1, WEAR.failureChancePerTile * oddsScale))) return;
  const part = working[randInt(world, 0, working.length - 1)];
  damagePart(part, part.hp, 0);
  world.events.push({ t: 'breakdown', vehicle: v.id, part: part.id });
}

// Distance driven this turn and the wear multiplier of the ground it crossed, weighted by distance.
function trailWear(world: World, v: Vehicle): { distance: number; terrainWear: number } {
  let distance = 0;
  let weighted = 0;
  for (const { len, type } of trailSegments(world, v)) {
    distance += len;
    weighted += len * TERRAIN_TYPES[type].wear;
  }
  return { distance, terrainWear: distance > 0 ? weighted / distance : 0 };
}

// Each step of this turn's trail with its length in tiles and the ground under its middle.
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

// Ground roughness from 0 on the smoothest ground to 1 on the roughest, read from the wear multipliers.
const GROUND_WEARS = Object.values(TERRAIN_TYPES).map((t) => t.wear);
const SMOOTHEST = Math.min(...GROUND_WEARS);
const ROUGHEST = Math.max(...GROUND_WEARS);

function roughness(type: TerrainTypeId): number {
  return (TERRAIN_TYPES[type].wear - SMOOTHEST) / (ROUGHEST - SMOOTHEST);
}

// The player practices driving on tiles crossed off the smoothest ground, harder on rougher ground. A towed
// truck is not driven.
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

// ---- Part condition.

export function maxHp(part: PartInstance): number {
  return Math.round(partDef(part.defId).hp * (1 - CONDITION.hpLoss * part.wear));
}

// The def with the part's worn max HP and job stat. The caller names the def type it knows the part has.
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
    case 'utility': // a passive utility loses max HP only
      return { ...def, hp, reload: wornReloadTurns(def.reload, steps) } as T;
    default: // cargo and core parts lose max HP only
      return { ...def, hp } as T;
  }
}

// A reload in turns after `steps` wear steps. Integer percent math, so 10 turns at one step is exactly 11.
export function wornTurns(turns: number, steps: number): number {
  return Math.ceil((turns * (100 + CONDITION.statLoss.reloadPercent * steps)) / 100);
}

// A passive utility has no reload to wear.
function wornReloadTurns(reload: number | null, steps: number): number | null {
  return reload === null ? null : wornTurns(reload, steps);
}

export function isJunk(part: PartInstance): boolean {
  return part.wear > CONDITION.maxWear;
}

// Lowers HP by `amount`, but not below `floor` and never upward. The drop to 0 adds one wear step.
// A built-in core part stops at the last step: it cannot be swapped out, so it never turns to junk.
export function damagePart(part: PartInstance, amount: number, floor: number): void {
  if (!(amount >= 0) || !(floor >= 0)) throw new Error(`Bad damage ${amount} with floor ${floor} on ${part.id}`);
  const wasWorking = part.hp > 0;
  part.hp = Math.min(part.hp, Math.max(floor, part.hp - amount));
  if (!wasWorking || part.hp > 0) return;
  part.wear = partDef(part.defId).kind === 'core' ? Math.min(CONDITION.maxWear, part.wear + 1) : part.wear + 1;
}

// Raises HP to `hp`, capped at max HP. Throws for a junk part rising from 0 HP and for a restore that lowers HP.
export function restorePart(part: PartInstance, hp: number): void {
  const next = Math.min(maxHp(part), hp);
  if (next < part.hp) throw new Error(`Restore of ${part.id} to ${hp} HP would lower it from ${part.hp}`);
  if (part.hp === 0 && next > 0 && isJunk(part)) throw new Error(`${partDef(part.defId).name} is junk and cannot be rebuilt`);
  part.hp = next;
}

// Sets HP for a part carried over from an old save, within 0 to max HP. A working part keeps at least 1 HP.
export function carryHp(part: PartInstance, hp: number): void {
  const floor = isJunk(part) ? 0 : 1;
  part.hp = Math.min(maxHp(part), Math.max(floor, hp));
}

// A junk part goes back to the last wear step at full HP, once per part. The Rebuild perk's town garage work.
export function rebuildJunk(part: PartInstance): void {
  const name = partDef(part.defId).name;
  if (!isJunk(part)) throw new Error(`${name} is not junk`);
  if (part.rebuilt) throw new Error(`${name} was rebuilt before`);
  part.wear = CONDITION.maxWear;
  part.rebuilt = true;
  part.hp = maxHp(part);
}

// The scrap patch raises a part to `share` of max HP. A junk part first goes back to the last wear step.
export function scrapPatchPart(part: PartInstance, share: number): void {
  if (isJunk(part)) part.wear = CONDITION.maxWear;
  part.hp = Math.max(part.hp, Math.ceil(maxHp(part) * share));
}

// The wear factor applied to a part's base value, read off CONDITION.valueFactor. A fractional wear, as
// from averaging several parts' wear steps, interpolates between the two steps it falls between.
export function wearFactor(wear: number): number {
  const table = CONDITION.valueFactor;
  const lo = Math.min(Math.floor(wear), table.length - 1);
  const hi = Math.min(lo + 1, table.length - 1);
  const frac = Math.min(1, wear - lo);
  return table[lo] * (1 - frac) + table[hi] * frac;
}

// Scrap value from mass alone, the sell floor for any part and the whole value of a junk part.
export function scrapValue(part: PartInstance): number {
  return ECONOMY.scrapPerKg * partDef(part.defId).mass;
}

// A part's current worth: base value times the wear factor. Junk is worth its scrap value only.
export function partValue(part: PartInstance): number {
  if (isJunk(part)) return scrapValue(part);
  return partDef(part.defId).value * wearFactor(part.wear);
}
