// Fog of war: which tiles the player vehicle can see, blocked by props and hills. A prop blocks sight with the boxes of its
// shape that span eye height, so low fences and junk leave it open. Water does not block sight.
// The player's current view is world state: player targeting, fire, discovery and the render all read it.

import { PHYSICS } from '../data/physics';
import { TERRAIN } from '../data/terrain';
import { TIME } from '../data/time';
import type { Obstacle, Vehicle, World } from './types';
import { heightAt, type Terrain } from './terrain';
import { boxDistance, propReach, reachableBoxes, stretchCrossesBox } from './mapgen';
import { isCheapMeeting, isHeadless } from './fidelity';
import { propsAlong, propsAround } from './prop-index';
import { sunAt } from './sun';
import { weatherOn } from './weather';
import { dist, segmentDist, type Vec } from './vec';
import { playerVehicle } from './damage';
import { cloudsSeenBy, contactDifficulty, contactsOf } from './detect';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';

function propsNear(world: World, a: Vec, b: Vec): Obstacle[] {
  return propsAlong(world, 'sight', a, b, 0);
}

type Screen = { pos: Vec; r: number };

export function sightRadius(world: World, viewer: Vehicle): number {
  const night = sunAt(world.turn) || vehicleHasPerk(world, viewer, 'nightEyes') ? 1 : TIME.nightSight;
  const weather = vehicleHasPerk(world, viewer, 'stormRider') ? 1 : weatherOn(world, viewer).sight;
  const skill = 1 + skillEffect(world, viewer, 'perception', 'sight');
  return TERRAIN.vision.radius * weather * night * skill;
}

export function grayRadius(world: World): number {
  return sightRadius(world, playerVehicle(world)) * TERRAIN.vision.grayFactor;
}

export function visibleTiles(world: World, from: Vec): Set<number> {
  const out = new Set<number>();
  forSeenTiles(world, from, () => true, (idx) => out.add(idx));
  return out;
}

export function exploreFrom(world: World, from: Vec): void {
  const explored = world.player.explored;
  forSeenTiles(world, from, (idx) => explored[idx] === 0, (idx) => { explored[idx] = 1; });
}

function forSeenTiles(world: World, from: Vec, test: (idx: number) => boolean, seen: (idx: number) => void): void {
  const size = world.size;
  const r = sightRadius(world, playerVehicle(world));
  const inView = plainViewFrom(world, from, r);
  const lo = { x: Math.max(0, Math.floor(from.x - r)), y: Math.max(0, Math.floor(from.y - r)) };
  const hi = { x: Math.min(size - 1, Math.ceil(from.x + r)), y: Math.min(size - 1, Math.ceil(from.y + r)) };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      const idx = y * size + x;
      const tile = { x: x + 0.5, y: y + 0.5 };
      if (!test(idx) || dist(from, tile) > r) continue;
      if (inView(tile)) seen(idx);
    }
  }
}

function plainViewFrom(world: World, from: Vec, r: number): (tile: Vec) => boolean {
  if (isHeadless()) return () => true;
  const props = propsAround(world, 'sight', from, r);
  return (tile) => inPlainView(world, from, tile, props, []);
}

export function canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean {
  if (observer.id === world.player.vehicleId) return playerSees(world, position);
  const target = position;
  if (dist(observer.pos, target) > sightRadius(world, observer)) return false;
  return isCheapMeeting(world, observer.pos, target) || inPlainView(world, observer.pos, target, propsNear(world, observer.pos, target), dustScreens(world));
}

function dustScreens(world: World): Screen[] {
  return world.dustClouds.filter((c) => c.screen).map((c) => ({ pos: c.pos, r: PERK_NUMBERS.dustScreen.radius }));
}

function inPlainView(world: World, a: Vec, b: Vec, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  if (dist(a, b) <= TERRAIN.vision.closeRadius) return true;
  const line = sightLine(world.terrain, a, b);
  return hasLineOfSight(world.terrain, line, props, screens) && clearOverTerrain(world.terrain, line);
}

export function hasLineOfFire(world: World, a: Vec, b: Vec): boolean {
  const line = sightLine(world.terrain, a, b);
  return hasLineOfSight(world.terrain, line, propsNear(world, a, b), []) && clearOverTerrain(world.terrain, line);
}

function hasLineOfSight(terrain: Terrain, line: SightLine, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  const { a, b } = line;
  const targetDist = dist(a, b);
  return props.every((o) => !propHides(terrain, o, line)) && screens.every((o) => dist(a, o.pos) >= targetDist || segmentDist(o.pos, a, b) >= o.r);
}

type SightLine = { a: Vec; b: Vec; from: number; to: number };

function sightLine(terrain: Terrain, a: Vec, b: Vec): SightLine {
  const eye = TERRAIN.vision.eyeHeight;
  return { a, b, from: heightAt(terrain, a.x, a.y) + eye, to: heightAt(terrain, b.x, b.y) + eye };
}

function propHides(terrain: Terrain, o: Obstacle, line: SightLine): boolean {
  if (segmentDist(o.pos, line.a, line.b) >= propReach(o)) return false;
  const { base, boxes } = reachableBoxes(o, terrain);
  return boxes.some((box) => {
    const lo = base + box.z0 / PHYSICS.metersPerTile;
    const hi = base + box.z1 / PHYSICS.metersPerTile;
    return stretchCrossesBox(box, line.a, line.b, enterHeights(line, lo, hi), leaveHeights(line, lo, hi)) && boxDistance(box, line.b) > 0;
  });
}

function enterHeights(line: SightLine, lo: number, hi: number): number {
  const rise = line.to - line.from;
  if (rise === 0) return line.from >= lo && line.from <= hi ? 0 : 1;
  return Math.max(0, Math.min((lo - line.from) / rise, (hi - line.from) / rise));
}

function leaveHeights(line: SightLine, lo: number, hi: number): number {
  const rise = line.to - line.from;
  if (rise === 0) return line.from >= lo && line.from <= hi ? 1 : 0;
  return Math.min(1, Math.max((lo - line.from) / rise, (hi - line.from) / rise));
}

function clearOverTerrain(terrain: Terrain, line: SightLine): boolean {
  const { a, b, from, to } = line;
  const n = Math.ceil(dist(a, b) * TERRAIN.vision.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > from + (to - from) * t) return false;
  }
  return true;
}

export function playerVisible(world: World): Set<number> {
  const v = world.vehicles.find((x) => x.id === world.player.vehicleId);
  return v ? visibleTiles(world, v.pos) : new Set<number>();
}

export function refreshVision(world: World): void {
  const seen = playerVisible(world);
  world.player.visible = [...seen].sort((a, b) => a - b);
  for (const idx of seen) world.player.explored[idx] = 1;
  world.player.marked = world.player.marked.filter((m) => world.turn <= m.until);
  const me = world.vehicles.find((x) => x.id === world.player.vehicleId);
  const known = new Set(world.player.contacts.map((c) => c.vehicleId));
  world.player.contacts = me ? contactsOf(world, me, Infinity) : [];
  world.player.clouds = me ? cloudsSeenBy(world, me).map((c) => c.id) : [];
  if (me) practiceNewContacts(world, me, known);
}

function practiceNewContacts(world: World, me: Vehicle, known: Set<string>): void {
  for (const c of world.player.contacts) {
    if (!known.has(c.vehicleId)) practice(world, 'contact', 1, contactDifficulty(world, me, c), c.vehicleId);
  }
}

export function tileCenter(world: World, idx: number): Vec {
  return { x: (idx % world.size) + 0.5, y: Math.floor(idx / world.size) + 0.5 };
}

export function tileOf(world: World, p: Vec): number {
  const x = Math.min(world.size - 1, Math.max(0, Math.floor(p.x)));
  const y = Math.min(world.size - 1, Math.max(0, Math.floor(p.y)));
  return y * world.size + x;
}

export function playerSees(world: World, p: Vec): boolean {
  return world.player.visible.includes(tileOf(world, p));
}

export function playerExplored(world: World, p: Vec): boolean {
  return world.player.explored[tileOf(world, p)] === 1;
}
