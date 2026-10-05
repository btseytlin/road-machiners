// Area hazards: world objects that sit still on a circle of ground and end when their turns run out
// (advanceUtilityEffects in src/sim/utility.ts ages them). Smoke clouds spoil aim through them: they block no sight and
// no line of fire, so they are not cover, and combat.ts reads smokeCrosses() for the `smoke` spread cause. Ground
// fields are caltrop fields and oil patches dropped on the path a truck just drove (pathBehind). A caltrop field hurts
// the wheels of each truck that drives through it, once per truck. A spill lays a streak of overlapping oil patches,
// and each cuts wheel grip in physics, which reads the patches at turn start
// through oilPatches(). Route planners steer around the fields a driver has seen. A flare burns over a point: at night
// it takes the night's halving off sight to the ground inside its light (vision.ts asks litAt()), and its launch and
// its light show its launcher far off (detect.ts turns flareSightings() into contacts).

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

// ---- Smoke clouds. The Sprout and the Smoke mortar make them.

// Puts a cloud of radius r tiles at pos, made by source, for the given turns.
export function deploySmoke(world: World, source: Vehicle, pos: Vec, r: number, turns: number): void {
  world.smoke.push({ id: newId(world, 's'), source: source.id, pos: { ...pos }, r, turnsLeft: turns });
}

// Whether the segment from a to b touches any live cloud: an end inside a cloud, or the line through it.
export function smokeCrosses(world: World, a: Vec, b: Vec): boolean {
  return world.smoke.some((c) => segmentDist(c.pos, a, b) <= c.r);
}

// ---- Ground fields. The Caltrops and the Oil spiller drop them.

// How a field is dropped: its radius in tiles, its turns, and the gap in tiles from the truck's rear to its near edge.
export type FieldDrop = { radius: number; turns: number; behind: number };

// How oil is spilled: the streak's turns, the gap in tiles from the truck's rear to its near edge, and the fuel units
// it spends. The streak's size is in OIL.
export type OilSpill = { turns: number; behind: number; fuel: number };

// Below this many tiles of trail the truck counts as stopped this turn: a meter, past a parked truck's settling.
const STILL_TRAIL = 0.25;
// Tiles of trail from its start that set the way the path goes on back past it.
const START_RUN = 1;

// The point d tiles back along the path v drove this turn, [...trail, pos], from its position. Behind means behind in
// travel, so a reversing truck gets ground ahead of its nose. Past the trail's start the path goes on straight the way
// its first START_RUN tiles ran. A truck that moved less than STILL_TRAIL, such as a parked truck settling, gets the
// line behind its heading.
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

// The unit direction back past the trail's start: from the point START_RUN along the trail, or its end when shorter,
// to its start, so a first leg of settling jitter does not turn it.
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
  if (length === 0) return backward(legs[0]); // the trail came back to its start
  return { x: (start.x - ahead.x) / length, y: (start.y - ahead.y) / length };
}

// The unit direction from a leg's end back to its start.
function backward(leg: { from: Vec; to: Vec; length: number }): Vec {
  return { x: (leg.from.x - leg.to.x) / leg.length, y: (leg.from.y - leg.to.y) / leg.length };
}

function along(p: Vec, unit: Vec, d: number): Vec {
  return { x: p.x + unit.x * d, y: p.y + unit.y * d };
}

// Tiles from v's center to the near edge of what it drops: half its body length plus the gap behind its rear.
export function dropClearance(v: Vehicle, gap: number): number {
  return bodyOf(v.chassisId).half.x / PHYSICS.metersPerTile + gap;
}

// Puts a field on v's path behind it. Its near edge lies `behind` tiles behind the rear, so the dropper starts clear of it.
export function dropField(world: World, v: Vehicle, kind: GroundField['kind'], drop: FieldDrop): void {
  const pos = pathBehind(v, dropClearance(v, drop.behind) + drop.radius);
  world.fields.push({ id: newId(world, 'g'), kind, source: v.id, pos, r: drop.radius, turnsLeft: drop.turns, hit: [] });
}

// Whether v has too little fuel in its tank to spill this many units of oil.
export function oilShort(world: World, v: Vehicle, fuel: number): boolean {
  return getResources(world, v).fuel < fuel;
}

// Spends the fuel and lays a streak of OIL.blobs oil fields on v's path behind it, the first `behind` tiles behind
// its rear. Throws when the tank holds too little.
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

// After movement: every truck whose trail this turn came within a caltrop field's radius plus its own radius takes
// CALTROPS.damage on each wheel, once per field.
export function caltropHits(world: World): void {
  for (const f of world.fields) if (f.kind === 'caltrops') hitCrossers(world, f);
}

function hitCrossers(world: World, f: GroundField): void {
  for (const v of world.vehicles) if (!f.hit.includes(v.id) && crosses(v, f)) hitWheels(world, f, v);
}

// The trail ends at the truck's position, so a truck with no trail this turn stands at its position.
function crosses(v: Vehicle, f: GroundField): boolean {
  const points: Vec[] = [...v.trail, v.pos];
  const reach = f.r + chassisDef(v.chassisId).radius;
  return points.some((p, i) => segmentDist(f.pos, points[Math.max(0, i - 1)], p) <= reach);
}

function hitWheels(world: World, f: GroundField, v: Vehicle): void {
  f.hit.push(v.id);
  const dealt = coreParts(v, 'wheel').reduce((sum, wheel) => sum + damagePart(world, v, wheel, CALTROPS.damage), 0);
  world.events.push({ t: 'caltrops', vehicle: v.id, field: f.id, source: f.source });
  judgeField(world, f, v, dealt);
}

// Judged like stray fire from the dropper. A dropper on its own field, or one no longer in the world, blames nobody.
function judgeField(world: World, f: GroundField, v: Vehicle, dealt: number): void {
  const source = world.vehicles.find((x) => x.id === f.source);
  if (!source || source.id === v.id || dealt === 0) return;
  v.lastHitBy = source.id;
  judgeStray(world, source, v, dealt);
}

// The live oil patches, in tiles. Overlapping patches stay separate; physics counts a wheel in any of them once.
export function oilPatches(world: World): { pos: Vec; r: number }[] {
  return world.fields.filter((f) => f.kind === 'oil').map((f) => ({ pos: { ...f.pos }, r: f.r }));
}

// The fields v's route planner steers around, like parked trucks: those it sees now and those it dropped.
export function fieldBlockers(world: World, v: Vehicle): Blocker[] {
  return world.fields.filter((f) => f.source === v.id || canVehicleSee(world, v, f.pos)).map((f) => ({ pos: f.pos, r: f.r }));
}

// ---- Flares. The Flare cannon fires them.

// How a flare burns: the radius in tiles it lights, and its turns.
export type FlareBurn = { radius: number; turns: number };

// Puts a burning flare on pos, fired by v. No sight of the point is needed.
export function launchFlare(world: World, v: Vehicle, pos: Vec, burn: FlareBurn): void {
  world.flares.push({ id: newId(world, 'f'), source: v.id, pos: { ...pos }, r: burn.radius, turnsLeft: burn.turns });
}

// The flares whose light counts now: every burning flare at night, none by day.
export function litFlares(world: World): Flare[] {
  return sunAt(world.turn) ? [] : world.flares;
}

// Whether a burning flare lights the point at night.
export function litAt(world: World, p: Vec): boolean {
  return litFlares(world).some((f) => dist(f.pos, p) <= f.r);
}

// The turns every flare burns. A flare that still has them all was launched this turn: the activation step fires it
// after the effects aged, and they age next at the start of the next turn's effects, after the NPCs planned.
const BURN_TURNS = flareBurnTurns();

function flareBurnTurns(): number {
  const turns = new Set(Object.values(PARTS).flatMap((d) => (d.kind === 'utility' && d.effect.type === 'flare' ? [d.effect.turns] : [])));
  if (turns.size !== 1) throw new Error(`Flare parts burn for ${[...turns].join(', ') || 'no'} turns; the launch turn needs one`);
  return [...turns][0];
}

// A launcher seen by its flare at night: at the burning flare's point, or at null for the launch flash in the turn it
// fired, which shows the launcher itself.
export type FlareSighting = { launcher: Vehicle; at: Vec | null };

// What a viewer sees of other trucks' flares at night: every flare within FLARE.seenRange, and every launch this turn
// whose launcher lies within it. Hills do not hide a flare in the sky. A flare whose launcher is gone shows nobody.
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
