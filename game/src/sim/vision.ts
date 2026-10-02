// Fog of war: which tiles the player vehicle can see, blocked by props and hills. A prop blocks sight with the boxes of its
// shape that span eye height, so low fences and junk leave it open. Water does not block sight.
// The player's current view is world state: player targeting, fire, discovery and the render all read it.
// NPCs query the same occlusion rules from their own positions.

import { PHYSICS } from '../data/physics';
import { TERRAIN } from '../data/terrain';
import { TIME } from '../data/time';
import type { Contact, Obstacle, Vehicle, World } from './types';
import { heightAt, type Terrain } from './terrain';
import { boxDistance, propBoxes, propReach, segmentCrossesBox } from './mapgen';
import { sunAt } from './sun';
import { weatherAt } from './weather';
import { dist, segmentDist, type Vec } from './vec';
import { playerVehicle } from './damage';
import { cloudsSeenBy, contactDifficulty, contactsOf } from './detect';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';

const BLOCKING: Obstacle['kind'][] = ['rock', 'wreck', 'building', 'landmark'];
const EYE = TERRAIN.vision.eyeHeight * PHYSICS.metersPerTile; // meters above the ground

function blocksSight(o: Obstacle): boolean {
  return BLOCKING.includes(o.kind);
}

// The sight-blocking props that can touch the line a-b. Every point of the line lies within dist(a, b) of a, so a prop
// farther than that plus its reach cannot hide anything.
function propsNear(world: World, a: Vec, b: Vec): Obstacle[] {
  const d = dist(a, b);
  return world.obstacles.filter((o) => blocksSight(o) && dist(a, o.pos) < d + propReach(o));
}

// A dust screen: a circle that blocks sight lines through it.
type Screen = { pos: Vec; r: number };

// A viewer's vision radius at a point: the base radius, shrunk by weather and at night, and widened by the
// player's perception. Night eyes keeps it at night, and storm rider keeps it in weather.
export function sightRadius(world: World, viewer: Vehicle, at: Vec = viewer.pos): number {
  const night = sunAt(world.turn) || vehicleHasPerk(world, viewer, 'nightEyes') ? 1 : TIME.nightSight;
  const weather = vehicleHasPerk(world, viewer, 'stormRider') ? 1 : weatherAt(world, at).sight;
  const skill = 1 + skillEffect(world, viewer, 'perception', 'sight');
  return TERRAIN.vision.radius * weather * night * skill;
}

// Reach of the player's gray vision at a point. It ignores rocks and hills, and it shows places but never vehicles.
export function grayRadius(world: World, at: Vec): number {
  return sightRadius(world, playerVehicle(world), at) * TERRAIN.vision.grayFactor;
}

// Tile indices (y * world.size + x) the player would see from a point, within vision radius and line of sight.
export function visibleTiles(world: World, from: Vec): Set<number> {
  const out = new Set<number>();
  forSeenTiles(world, from, () => true, (idx) => out.add(idx));
  return out;
}

// Marks the tiles the player would see from a point as explored. Explored tiles skip the sight test.
export function exploreFrom(world: World, from: Vec): void {
  const explored = world.player.explored;
  forSeenTiles(world, from, (idx) => explored[idx] === 0, (idx) => { explored[idx] = 1; });
}

// Calls `seen` for each tile within vision radius of `from` that passes `test` and lies in plain view.
function forSeenTiles(world: World, from: Vec, test: (idx: number) => boolean, seen: (idx: number) => void): void {
  const size = world.size;
  const r = sightRadius(world, playerVehicle(world), from);
  // Every sight line lies within r of the viewer, so props beyond r plus their reach cannot touch it.
  const props = world.obstacles.filter((o) => blocksSight(o) && dist(from, o.pos) < r + propReach(o));
  const lo = { x: Math.max(0, Math.floor(from.x - r)), y: Math.max(0, Math.floor(from.y - r)) };
  const hi = { x: Math.min(size - 1, Math.ceil(from.x + r)), y: Math.min(size - 1, Math.ceil(from.y + r)) };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      const idx = y * size + x;
      const tile = { x: x + 0.5, y: y + 0.5 };
      if (!test(idx) || dist(from, tile) > r) continue;
      if (inPlainView(world, from, tile, props, [])) seen(idx);
    }
  }
}

export function canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean {
  if (observer.id === world.player.vehicleId) return playerSees(world, position);
  const target = position;
  return dist(observer.pos, target) <= sightRadius(world, observer) &&
    inPlainView(world, observer.pos, target, propsNear(world, observer.pos, target), dustScreens(world));
}

// Dust screen clouds block sight like rocks, for NPCs only. The player's view never counts them.
function dustScreens(world: World): Screen[] {
  return world.dustClouds.filter((c) => c.screen).map((c) => ({ pos: c.pos, r: PERK_NUMBERS.dustScreen.radius }));
}

// Within the close radius, rocks and hills do not hide anything.
function inPlainView(world: World, a: Vec, b: Vec, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  return dist(a, b) <= TERRAIN.vision.closeRadius || (hasLineOfSight(a, b, props, screens) && clearOverTerrain(world.terrain, a, b));
}

// A straight line past rocks and over hills, with no close radius: a shot needs it even when the target is seen.
export function hasLineOfFire(world: World, a: Vec, b: Vec): boolean {
  return hasLineOfSight(a, b, propsNear(world, a, b), []) && clearOverTerrain(world.terrain, a, b);
}

// A dust screen blocks sight only if it sits between the viewer and the target.
function hasLineOfSight(a: Vec, b: Vec, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  const targetDist = dist(a, b);
  return props.every((o) => !propHides(o, a, b)) && screens.every((o) => dist(a, o.pos) >= targetDist || segmentDist(o.pos, a, b) >= o.r);
}

// A prop hides b from a where the line crosses a box that spans eye height above the prop's ground. A box that
// holds b does not hide it, so the viewer sees the prop's own face.
function propHides(o: Obstacle, a: Vec, b: Vec): boolean {
  if (segmentDist(o.pos, a, b) >= propReach(o)) return false;
  return propBoxes(o).some((box) => box.z0 <= EYE && box.z1 >= EYE && segmentCrossesBox(box, a, b) && boxDistance(box, b) > 0);
}

// Hills block sight: the ground between must stay under the line from the viewer's eye to the target's top.
function clearOverTerrain(terrain: Terrain, a: Vec, b: Vec): boolean {
  const V = TERRAIN.vision;
  const eyeA = heightAt(terrain, a.x, a.y) + V.eyeHeight;
  const eyeB = heightAt(terrain, b.x, b.y) + V.eyeHeight;
  const n = Math.ceil(dist(a, b) * V.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > eyeA + (eyeB - eyeA) * t) return false;
  }
  return true;
}

// Tiles currently visible from the player vehicle. Empty if the player vehicle is gone.
export function playerVisible(world: World): Set<number> {
  const v = world.vehicles.find((x) => x.id === world.player.vehicleId);
  return v ? visibleTiles(world, v.pos) : new Set<number>();
}

// Recomputes the player's view and marks it explored. Run after anything that moves the player. It awards nothing,
// so load can rebuild the view from a save. Returns the contacts that are new since the last view, which the turn
// pays for with practiceContacts().
export function refreshVision(world: World): Contact[] {
  const seen = playerVisible(world);
  world.player.visible = [...seen].sort((a, b) => a - b);
  for (const idx of seen) world.player.explored[idx] = 1;
  world.player.marked = world.player.marked.filter((m) => world.turn <= m.until);
  const me = world.vehicles.find((x) => x.id === world.player.vehicleId);
  const known = new Set(world.player.contacts.map((c) => c.vehicleId));
  world.player.contacts = me ? contactsOf(world, me, Infinity) : [];
  world.player.clouds = me ? cloudsSeenBy(world, me).map((c) => c.id) : [];
  return world.player.contacts.filter((c) => !known.has(c.vehicleId));
}

// The player practices perception once per vehicle that becomes a contact, harder near the edge of reach.
export function practiceContacts(world: World, fresh: readonly Contact[]): void {
  for (const c of fresh) practice(world, 'contact', 1, contactDifficulty(world, playerVehicle(world), c), c.vehicleId);
}

export function tileCenter(world: World, idx: number): Vec {
  return { x: (idx % world.size) + 0.5, y: Math.floor(idx / world.size) + 0.5 };
}

export function tileOf(world: World, p: Vec): number {
  const x = Math.min(world.size - 1, Math.max(0, Math.floor(p.x)));
  const y = Math.min(world.size - 1, Math.max(0, Math.floor(p.y)));
  return y * world.size + x;
}

// Whether the player currently sees a map point. Reads the stored view, so call refreshVision first.
export function playerSees(world: World, p: Vec): boolean {
  return world.player.visible.includes(tileOf(world, p));
}

export function playerExplored(world: World, p: Vec): boolean {
  return world.player.explored[tileOf(world, p)] === 1;
}
