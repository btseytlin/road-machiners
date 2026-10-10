// The claymore ram: arming it, its blast in a hard crash on its side into a truck or an obstacle, and disarming it
// once it breaks or leaves its mount. utility.ts hands it the arming order and crash-contact.ts each crash. The
// charge state and the reload belong to utility.ts.

import { partDef, type ClaymoreDef } from '../data/parts';
import { coversSide, lanePoint, walkLane, type PartHit, type Round, type Side } from './armor';
import { blastTruck, isHostile, noteAttack } from './combat';
import type { CrashContact } from './crash-contact';
import { isMounted, itemCells, mountedItems, mountedParts, sideOf, type SideLetter } from './grid';
import { towsClient } from './tow';
import type { GridItem, PartInstance, Vehicle, World } from './types';

type PartItem = Extract<GridItem, { kind: 'part' }>;
import type { Vec } from './vec';
import { chargeOf, wornReload } from './utility';

export type ClaymoreCrash = { impact: number; own: CrashContact; theirs: CrashContact | null };

export function claymoreOf(part: PartInstance): ClaymoreDef {
  const def = partDef(part.defId);
  if (def.kind !== 'armor' || !def.claymore) throw new Error(`${def.id} is not a claymore ram`);
  return def.claymore;
}

export function armClaymore(v: Vehicle, part: PartInstance): void {
  claymoreOf(part);
  const charge = chargeOf(part);
  if (charge.armed || charge.reload > 0 || part.hp <= 0) throw new Error(`${v.id} cannot arm claymore ram ${part.id}`);
  charge.armed = true;
}

export function disarm(part: PartInstance): void {
  delete part.charge?.armed;
}

export function claymoresSetOff(world: World, user: Vehicle, other: Vehicle | null, crash: ClaymoreCrash): PartInstance[] {
  if (other && (towsClient(world, user, other) || towsClient(world, other, user))) return [];
  return armedOn(user, crash).filter((part) => crash.impact >= claymoreOf(part).minImpact);
}

export function detonateOnCrash(world: World, user: Vehicle, other: Vehicle, rams: PartInstance[], crash: ClaymoreCrash): void {
  for (const part of rams) detonate(world, user, other, part, crash);
}

export function detonateOnObstacle(world: World, user: Vehicle, obstacle: string, rams: PartInstance[], crash: ClaymoreCrash): void {
  for (const part of rams) {
    const pos = ramPoint(user, part);
    const selfHits = spend(world, user, part, crash);
    world.events.push({ t: 'claymore', vehicle: user.id, part: part.id, other: obstacle, pos, hits: [], selfHits });
  }
}

function armedOn(v: Vehicle, crash: ClaymoreCrash): PartInstance[] {
  return mountedParts(v, 'armor').filter((p) => p.charge?.armed && p.hp > 0 && coversSide(v, p, crash.own.side));
}

function detonate(world: World, user: Vehicle, other: Vehicle, part: PartInstance, crash: ClaymoreCrash): void {
  if (!crash.theirs) throw new Error('A truck crash has no contact on the other truck');
  const c = claymoreOf(part);
  const calm = !isHostile(world, other, user);
  const pos = ramPoint(user, part);
  const hits = blastTruck(world, other, contactPoint(other, crash.theirs), c.blast.radius, blastRound(c.blast), null);
  const selfHits = spend(world, user, part, crash);
  if (hits.length > 0) other.lastHitBy = user.id;
  noteAttack(world, user, other, calm);
  world.events.push({ t: 'claymore', vehicle: user.id, part: part.id, other: other.id, pos, hits, selfHits });
}

function spend(world: World, user: Vehicle, part: PartInstance, crash: ClaymoreCrash): PartHit[] {
  const charge = chargeOf(part);
  delete charge.armed;
  charge.reload = wornReload(part);
  const self = blastRound(claymoreOf(part).selfBlast);
  return crash.own.lanes.flatMap((lane) => walkLane(world, user, crash.own.side, lane, self));
}

function blastRound(b: { damage: number; pen: number }): Round {
  return { damage: b.damage, pen: b.pen, blast: true, armorShare: 1 };
}

function contactPoint(v: Vehicle, contact: CrashContact): Vec {
  if (contact.lanes.length === 0) throw new Error('Crash has no touched lanes');
  return lanePoint(v, contact.side, (Math.min(...contact.lanes) + Math.max(...contact.lanes)) / 2);
}

export function cookOffClaymores(world: World): void {
  for (const v of world.vehicles) {
    for (const item of mountedItems(v, 'armor')) if (item.part.charge?.armed && item.part.hp <= 0) cookOff(world, v, item);
  }
}

function cookOff(world: World, v: Vehicle, item: PartItem): void {
  const pos = ramPoint(v, item.part);
  const c = claymoreOf(item.part);
  const charge = chargeOf(item.part);
  delete charge.armed;
  charge.reload = wornReload(item.part);
  const hits = blastTruck(world, v, pos, c.blast.radius, blastRound(c.blast), null);
  world.events.push({ t: 'claymoreCookOff', vehicle: v.id, part: item.part.id, pos, hits });
}

function ramPoint(v: Vehicle, part: PartInstance): Vec {
  const item = mountedItems(v, 'armor').find((it) => it.part.id === part.id);
  const letter = item && sideOf(v, part);
  if (!item || !letter) throw new Error(`Claymore ram ${part.id} on ${v.id} is not mounted on a side`);
  const side = SIDES[letter];
  const lanes = itemCells(item).map((c) => (side === 'front' || side === 'rear' ? c.x : c.y));
  return lanePoint(v, side, (Math.min(...lanes) + Math.max(...lanes)) / 2);
}

const SIDES: Record<SideLetter, Side> = { F: 'front', B: 'rear', L: 'left', R: 'right' };

export function settleClaymores(world: World): void {
  for (const part of [...world.vehicles.flatMap(unfitClaymores), ...looseParts(world)]) disarm(part);
}

function unfitClaymores(v: Vehicle): PartInstance[] {
  return v.items.flatMap((it) => (it.kind === 'part' && it.part.charge?.armed && (it.part.hp <= 0 || !isMounted(v.chassisId, it)) ? [it.part] : []));
}

function looseParts(world: World): PartInstance[] {
  return [...world.player.storage, ...world.salvage.flatMap((s) => [...s.parts, ...s.hidden.parts])];
}
