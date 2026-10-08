// Area hazards: world objects that sit still on a circle of ground and end when their turns run out
// (advanceUtilityEffects in src/sim/utility.ts ages them). Smoke clouds spoil aim through them: they block no sight and
// no line of fire, so they are not cover, and combat.ts reads smokeCrosses() for the `smoke` spread cause. Ground

import { chassisDef } from '../data/chassis';
import { PARTS } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { CALTROPS, FLARE, OIL } from '../data/utilities';
import { bodyOf } from './body';
import { judgeStray } from './combat';
import { damagePart } from './damage';
import { newId } from './factory';
import { coreParts } from './grid';
import type { Blocker } from './path';
import { getResources } from './resources';
import { sunAt } from './sun';
import type { Flare, GroundField, Vehicle, World } from './types';
import { dist, segmentDist, type Vec } from './vec';
import { canVehicleSee } from './vision';

export function deploySmoke(world: World, source: Vehicle, pos: Vec, r: number, turns: number): void {
  world.smoke.push({ id: newId(world, 's'), source: source.id, pos: { ...pos }, r, turnsLeft: turns });
}

export function smokeCrosses(world: World, a: Vec, b: Vec): boolean {
  return world.smoke.some((c) => segmentDist(c.pos, a, b) <= c.r);
}

export type FieldDrop = { radius: number; turns: number; behind: number };

export type OilSpill = { turns: number; behind: number; fuel: number };

const STILL_TRAIL = 0.25;
const START_RUN = 1;

export function pathBehind(v: Vehicle, d: number): Vec {
  if (!(d >= 0)) throw new Error(`pathBehind needs a distance of 0 or more, got ${d}`);
  const points: Vec[] = [...v.trail, v.pos].map((p) => ({ x: p.x, y: p.y }));
  const legs = points.slice(1).map((to, i) => ({ from: points[i], to, length: dist(points[i], to) })).filter((leg) => leg.length > 0);
  if (legs.reduce((sum, leg) => sum + leg.length, 0) < STILL_TRAIL) return along(v.pos, { x: -Math.cos(v.heading), y: -Math.sin(v.heading) }, d);
  let left = d;
  for (const leg of [...legs].reverse()) {
    if (left <= leg.length) return along(leg.to, backward(leg), left);
    left -= leg.length;
  }
  return along(legs[0].from, startBackward(legs), left);
}

function startBackward(legs: { from: Vec; to: Vec; length: number }[]): Vec {
  const start = legs[0].from;
  let ahead = legs[legs.length - 1].to;
  let left = START_RUN;
  for (const leg of legs) {
    if (left <= leg.length) {
      ahead = along(leg.from, { x: (leg.to.x - leg.from.x) / leg.length, y: (leg.to.y - leg.from.y) / leg.length }, left);
      break;
    }
    left -= leg.length;
  }
  const length = dist(ahead, start);
  if (length === 0) return backward(legs[0]);
  return { x: (start.x - ahead.x) / length, y: (start.y - ahead.y) / length };
}

function backward(leg: { from: Vec; to: Vec; length: number }): Vec {
  return { x: (leg.from.x - leg.to.x) / leg.length, y: (leg.from.y - leg.to.y) / leg.length };
}

function along(p: Vec, unit: Vec, d: number): Vec {
  return { x: p.x + unit.x * d, y: p.y + unit.y * d };
}

export function dropClearance(v: Vehicle, gap: number): number {
  return bodyOf(v.chassisId).half.x / PHYSICS.metersPerTile + gap;
}

export function dropField(world: World, v: Vehicle, kind: GroundField['kind'], drop: FieldDrop): void {
  const pos = pathBehind(v, dropClearance(v, drop.behind) + drop.radius);
  world.fields.push({ id: newId(world, 'g'), kind, source: v.id, pos, r: drop.radius, turnsLeft: drop.turns, hit: [] });
}

export function oilShort(world: World, v: Vehicle, fuel: number): boolean {
  return getResources(world, v).fuel < fuel;
}

export function spillOil(world: World, v: Vehicle, spill: OilSpill): void {
  if (oilShort(world, v, spill.fuel)) throw new Error(`${v.id} has no ${spill.fuel} fuel units to spill`);
  const near = dropClearance(v, spill.behind) + OIL.blobR;
  const blobs: GroundField[] = Array.from({ length: OIL.blobs }, (_, i) => ({
    id: newId(world, 'g'),
    kind: 'oil',
    source: v.id,
    pos: pathBehind(v, near + i * OIL.spacing),
    r: OIL.blobR,
    turnsLeft: spill.turns,
    hit: [],
  }));
  if (blobs.length !== OIL.blobs) throw new Error(`A spill made ${blobs.length} oil fields, not OIL.blobs = ${OIL.blobs}`);
  getResources(world, v).fuel -= spill.fuel;
  world.fields.push(...blobs);
}

export function caltropHits(world: World): void {
  for (const f of world.fields) if (f.kind === 'caltrops') hitCrossers(world, f);
}

function hitCrossers(world: World, f: GroundField): void {
  for (const v of world.vehicles) if (!f.hit.includes(v.id) && crosses(v, f)) hitWheels(world, f, v);
}

function crosses(v: Vehicle, f: GroundField): boolean {
  const points: Vec[] = [...v.trail, v.pos];
  const reach = f.r + chassisDef(v.chassisId).radius;
  return points.some((p, i) => segmentDist(f.pos, points[Math.max(0, i - 1)], p) <= reach);
}

function hitWheels(world: World, f: GroundField, v: Vehicle): void {
  f.hit.push(v.id);
  const hits = coreParts(v, 'wheel').map((wheel) => ({ part: wheel.id, damage: damagePart(world, v, wheel, CALTROPS.damage) }));
  world.events.push({ t: 'caltrops', vehicle: v.id, field: f.id, source: f.source, hits });
  judgeField(world, f, v, hits.reduce((sum, h) => sum + h.damage, 0));
}

function judgeField(world: World, f: GroundField, v: Vehicle, dealt: number): void {
  const source = world.vehicles.find((x) => x.id === f.source);
  if (!source || source.id === v.id || dealt === 0) return;
  v.lastHitBy = source.id;
  judgeStray(world, source, v, dealt);
}

export function oilPatches(world: World): { pos: Vec; r: number }[] {
  return world.fields.filter((f) => f.kind === 'oil').map((f) => ({ pos: { ...f.pos }, r: f.r }));
}

export function fieldBlockers(world: World, v: Vehicle): Blocker[] {
  return world.fields.filter((f) => f.source === v.id || canVehicleSee(world, v, f.pos)).map((f) => ({ pos: f.pos, r: f.r }));
}

export type FlareBurn = { radius: number; turns: number };

export function launchFlare(world: World, v: Vehicle, pos: Vec, burn: FlareBurn): void {
  world.flares.push({ id: newId(world, 'f'), source: v.id, pos: { ...pos }, r: burn.radius, turnsLeft: burn.turns });
}

export function litFlares(world: World): Flare[] {
  return sunAt(world.turn) ? [] : world.flares;
}

export function litAt(world: World, p: Vec): boolean {
  return litFlares(world).some((f) => dist(f.pos, p) <= f.r);
}

const BURN_TURNS = flareBurnTurns();

function flareBurnTurns(): number {
  const turns = new Set(Object.values(PARTS).flatMap((d) => (d.kind === 'utility' && d.effect.type === 'flare' ? [d.effect.turns] : [])));
  if (turns.size !== 1) throw new Error(`Flare parts burn for ${[...turns].join(', ') || 'no'} turns; the launch turn needs one`);
  return [...turns][0];
}

export type FlareSighting = { launcher: Vehicle; at: Vec | null };

export function flareSightings(world: World, viewer: Vehicle): FlareSighting[] {
  return litFlares(world).flatMap((f) => {
    const launcher = world.vehicles.find((v) => v.id === f.source);
    return launcher && launcher.id !== viewer.id ? sightingsOf(viewer, f, launcher) : [];
  });
}

function sightingsOf(viewer: Vehicle, f: Flare, launcher: Vehicle): FlareSighting[] {
  const light = dist(viewer.pos, f.pos) <= FLARE.seenRange ? [{ launcher, at: { ...f.pos } }] : [];
  const flash = f.turnsLeft === BURN_TURNS && dist(viewer.pos, launcher.pos) <= FLARE.seenRange;
  return flash ? [...light, { launcher, at: null }] : light;
}
