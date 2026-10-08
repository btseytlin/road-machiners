// Harpoon lines. The harpoon is a gun of one round (WeaponDef.line). A round of it that strikes its target ties a line
// to the part it hit first; the fire phase calls attachLine(). The line is a world object that ends after its turns
// (advanceUtilityEffects ages it), when it tears, when the shooter cuts it, or when either anchor part leaves its truck or the harpoon breaks.
// Physics reads the holding lines at turn start through lineAnchors() and pulls the two trucks together while the line
// is stretched. A stretch pull above HARPOON.tearForce tears it, and physics reports the tear for tearLine().

import { PHYSICS } from '../data/physics';
import { HARPOON } from '../data/utilities';
import { cellRect } from './body';
import { damagePart } from './damage';
import { newId } from './factory';
import { itemCells, mountedItems } from './grid';
import type { GridItem, HarpoonLine, Vehicle, World } from './types';

const S = PHYSICS.metersPerTile;

// A point on a truck in body meters: +x the nose, +z the truck's right, +y up from the box center.
export type BodyPoint = { x: number; y: number; z: number };

// A holding line as physics needs it: the two trucks, each anchor in its truck's body space, and the length in
// meters past which the line pulls.
export type LineAnchor = { id: string; from: string; to: string; fromAt: BodyPoint; toAt: BodyPoint; length: number };

type PartItem = Extract<GridItem, { kind: 'part' }>;

export type Ends = { from: Vehicle; fromPart: string; to: Vehicle; toPart: string };

// Ties a line from the harpoon on the shooter to the part its round hit on the target, for `turns` turns. The line is
// as long as its anchors stand apart now.
export function attachLine(world: World, ends: Ends, turns: number): void {
  const length = anchorGap(ends);
  world.lines.push({ id: newId(world, 'l'), from: ends.from.id, fromPart: ends.fromPart, to: ends.to.id, toPart: ends.toPart, length, turnsLeft: turns });
}

// Meters between the two anchors on the ground plane, from the trucks' poses.
function anchorGap(ends: Ends): number {
  const a = mapPoint(ends.from, anchorOf(ends.from, ends.fromPart, BRACED));
  const b = mapPoint(ends.to, anchorOf(ends.to, ends.toPart, HELD));
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function mapPoint(v: Vehicle, at: BodyPoint): { x: number; z: number } {
  const cos = Math.cos(v.heading);
  const sin = Math.sin(v.heading);
  return { x: v.pos.x * S + cos * at.x - sin * at.z, z: v.pos.y * S + sin * at.x + cos * at.z };
}

// Heights of the line's two ends in body meters. The harpoon is braced to the frame, so the shooter's end pulls at
// its center of mass and never tips the shooter. The held end pulls at the body's center, above the center of mass,
// so a hard pull across a truck can tip it over. The rope is drawn from the parts themselves.
const BRACED = -PHYSICS.truck.comBelow;
const HELD = 0;

// The anchor of a part: the center of its cells in body meters, at the given height.
function anchorOf(v: Vehicle, partId: string, y: number): BodyPoint {
  const item = mountedItem(v, partId);
  if (!item) throw new Error(`${v.name} has no mounted part ${partId}`);
  const r = cellRect(v.chassisId, itemCells(item));
  return { x: (r.x0 + r.x1) / 2, y, z: (r.z0 + r.z1) / 2 };
}

function mountedItem(v: Vehicle, partId: string): PartItem | undefined {
  return mountedItems(v).find((it) => it.part.id === partId);
}

// A line holds while both trucks are in the world, the harpoon is mounted above 0 HP and the held part is mounted.
function holdsEnds(world: World, line: HarpoonLine): Ends | null {
  const from = world.vehicles.find((v) => v.id === line.from);
  const to = world.vehicles.find((v) => v.id === line.to);
  if (!from || !to) return null;
  const harpoon = mountedItem(from, line.fromPart);
  if (!harpoon || harpoon.part.hp <= 0 || !mountedItem(to, line.toPart)) return null;
  return { from, fromPart: line.fromPart, to, toPart: line.toPart };
}

// Drops the lines that no longer hold.
export function endLines(world: World): void {
  world.lines = world.lines.filter((line) => holdsEnds(world, line) !== null);
}

// The holding lines with their anchors in body space, for physics at turn start.
export function lineAnchors(world: World): LineAnchor[] {
  return world.lines.flatMap((line) => {
    const ends = holdsEnds(world, line);
    if (!ends) return [];
    return [{ id: line.id, from: line.from, to: line.to, fromAt: anchorOf(ends.from, ends.fromPart, BRACED), toAt: anchorOf(ends.to, ends.toPart, HELD), length: line.length }];
  });
}

// The shooter lets go of the line its harpoon holds, so a heavier truck no longer drags it. The held part takes no
// damage, and the harpoon can fire again once it reloads.
export function cutLine(world: World, shooter: Vehicle, harpoonId: string): void {
  const line = world.lines.find((l) => l.from === shooter.id && l.fromPart === harpoonId);
  if (!line) throw new Error(`${shooter.name} has no line out from ${harpoonId}`);
  world.lines = world.lines.filter((l) => l !== line);
}

// The line tore under a hard pull: the part it held takes the tear damage, once, and the line is gone.
export function tearLine(world: World, lineId: string): void {
  const line = world.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`There is no line ${lineId}`);
  world.lines = world.lines.filter((l) => l.id !== lineId);
  const to = world.vehicles.find((v) => v.id === line.to);
  const held = to && mountedItem(to, line.toPart);
  if (!to || !held) throw new Error(`Line ${lineId} tore with no held part ${line.toPart}`);
  const damage = damagePart(world, to, held.part, HARPOON.tearDamage);
  world.events.push({ t: 'lineTorn', line: line.id, vehicle: to.id, part: line.toPart, damage });
}
