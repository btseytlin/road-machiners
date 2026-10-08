// Fog of war: which tiles the player vehicle can see, blocked by props and hills. A prop blocks sight with the boxes of its
// shape that the line from the viewer's eye to the target's top passes through, so low fences and junk leave it open
// and a viewer up on a deck sees over them. Boxes out of reach under a deck block nothing. Water does not block sight.
// The player's current view is world state: player targeting, fire, discovery and the render all read it.
// NPCs query the same occlusion rules from their own positions.

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
import { litAt, litFlares } from './hazards';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { PERK_NUMBERS } from '../data/skills';

// The sight-blocking props whose reach touches the line a-b. A prop farther from the line than its reach cannot hide
// anything.
function propsNear(world: World, a: Vec, b: Vec): Obstacle[] {
  return propsAlong(world, 'sight', a, b, 0);
}

// A dust screen: a circle that blocks sight lines through it.
type Screen = { pos: Vec; r: number };

// A viewer's vision radius: the base radius, shrunk by the weather the viewer feels and at night, and widened by the
// player's perception. Night eyes keeps it at night, and storm rider keeps it in weather. lit: the viewed ground lies in
// a flare's light, which keeps the night from shrinking sight to it and leaves every other factor.
export function sightRadius(world: World, viewer: Vehicle, lit = false): number {
  const night = nightFactor(world, viewer, lit);
  const weather = vehicleHasPerk(world, viewer, 'stormRider') ? 1 : weatherOn(world, viewer).sight;
  const skill = 1 + skillEffect(world, viewer, 'perception', 'sight');
  return TERRAIN.vision.radius * weather * night * skill;
}

// The night's share of sight: none of it by day, with night eyes, or to ground in a flare's light.
function nightFactor(world: World, viewer: Vehicle, lit: boolean): number {
  return lit || sunAt(world.turn) || vehicleHasPerk(world, viewer, 'nightEyes') ? 1 : TIME.nightSight;
}

// Reach of the player's gray vision. It ignores rocks and hills, and it shows places but never vehicles.
export function grayRadius(world: World): number {
  return sightRadius(world, playerVehicle(world)) * TERRAIN.vision.grayFactor;
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

// Calls `seen` for each tile within vision radius of `from` that passes `test` and lies in plain view. At night the
// ground in a flare's light is seen out to the radius without the night's halving, so each lit flare in reach scans its
// own disk too. A tile in both is seen twice, which every caller takes as once.
function forSeenTiles(world: World, from: Vec, test: (idx: number) => boolean, seen: (idx: number) => void): void {
  const me = playerVehicle(world);
  const r = sightRadius(world, me);
  forTilesIn(world, from, r, { pos: from, r }, test, seen);
  const lit = sightRadius(world, me, true);
  if (lit > r) for (const f of litFlares(world)) if (dist(from, f.pos) - f.r < lit) forTilesIn(world, from, lit, f, test, seen);
}

type Disk = { pos: Vec; r: number };

// Calls `seen` for each tile inside the disk and within reach of `from` that passes `test` and lies in plain view.
function forTilesIn(world: World, from: Vec, reach: number, disk: Disk, test: (idx: number) => boolean, seen: (idx: number) => void): void {
  const size = world.size;
  const inView = plainViewFrom(world, from, reach);
  const lo = { x: Math.max(0, Math.floor(disk.pos.x - disk.r)), y: Math.max(0, Math.floor(disk.pos.y - disk.r)) };
  const hi = { x: Math.min(size - 1, Math.ceil(disk.pos.x + disk.r)), y: Math.min(size - 1, Math.ceil(disk.pos.y + disk.r)) };
  for (let x = lo.x; x <= hi.x; x++) {
    for (let y = lo.y; y <= hi.y; y++) {
      const idx = y * size + x;
      const tile = { x: x + 0.5, y: y + 0.5 };
      if (!test(idx) || !inDisks(tile, { pos: from, r: reach }, disk)) continue;
      if (inView(tile)) seen(idx);
    }
  }
}

function inDisks(p: Vec, a: Disk, b: Disk): boolean {
  return dist(a.pos, p) <= a.r && dist(b.pos, p) <= b.r;
}

// Whether a tile within reach of `from` lies in plain view. The recorder's player sees the whole radius.
function plainViewFrom(world: World, from: Vec, r: number): (tile: Vec) => boolean {
  if (isHeadless()) return () => true;
  // Every sight line lies within reach of the viewer, so props beyond r plus their reach cannot touch it.
  const props = propsAround(world, 'sight', from, r);
  return (tile) => inPlainView(world, from, tile, props, []);
}

export function canVehicleSee(world: World, observer: Vehicle, position: Vec): boolean {
  if (observer.id === world.player.vehicleId) return playerSees(world, position);
  const target = position;
  if (dist(observer.pos, target) > sightRadius(world, observer, litAt(world, target))) return false;
  // Out of the player's live range, sight is the radius alone.
  return isCheapMeeting(world, observer.pos, target) || inPlainView(world, observer.pos, target, propsNear(world, observer.pos, target), dustScreens(world));
}

// Dust screen clouds block sight like rocks, for NPCs only. The player's view never counts them.
function dustScreens(world: World): Screen[] {
  return world.dustClouds.filter((c) => c.screen).map((c) => ({ pos: c.pos, r: PERK_NUMBERS.dustScreen.radius }));
}

// Within the close radius, rocks and hills do not hide anything.
function inPlainView(world: World, a: Vec, b: Vec, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  if (dist(a, b) <= TERRAIN.vision.closeRadius) return true;
  const line = sightLine(world.terrain, a, b);
  return hasLineOfSight(world.terrain, line, props, screens) && clearOverTerrain(world.terrain, line);
}

// A straight line past rocks and over hills, with no close radius: a shot needs it even when the target is seen.
export function hasLineOfFire(world: World, a: Vec, b: Vec): boolean {
  const line = sightLine(world.terrain, a, b);
  return hasLineOfSight(world.terrain, line, propsNear(world, a, b), []) && clearOverTerrain(world.terrain, line);
}

// A dust screen blocks sight only if it sits between the viewer and the target.
export function hasLineOfSight(terrain: Terrain, line: SightLine, props: readonly Obstacle[], screens: readonly Screen[]): boolean {
  const { a, b } = line;
  const targetDist = dist(a, b);
  return props.every((o) => !propHides(terrain, o, line)) && screens.every((o) => dist(a, o.pos) >= targetDist || segmentDist(o.pos, a, b) >= o.r);
}

// The line from the viewer's eye to the target's top, in height units over each end's height: a deck where the end
// stands on one, else the ground. Props and hills both test against it.
export type SightLine = { a: Vec; b: Vec; from: number; to: number };

export function sightLine(terrain: Terrain, a: Vec, b: Vec): SightLine {
  const eye = TERRAIN.vision.eyeHeight;
  return { a, b, from: heightAt(terrain, a.x, a.y) + eye, to: heightAt(terrain, b.x, b.y) + eye };
}

// A prop hides the target where the line passes through one of its boxes: over the box's footprint and within its
// height. A box that holds the target does not hide it, so the viewer sees the prop's own face.
function propHides(terrain: Terrain, o: Obstacle, line: SightLine): boolean {
  if (segmentDist(o.pos, line.a, line.b) >= propReach(o)) return false;
  const { base, boxes } = reachableBoxes(o, terrain);
  return boxes.some((box) => {
    const lo = base + box.z0 / PHYSICS.metersPerTile;
    const hi = base + box.z1 / PHYSICS.metersPerTile;
    return stretchCrossesBox(box, line.a, line.b, enterHeights(line, lo, hi), leaveHeights(line, lo, hi)) && boxDistance(box, line.b) > 0;
  });
}

// The fraction of the line where its height comes to lie from lo to hi, and where it leaves that band. A line that
// never lies in the band enters after it leaves.
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

// Hills block sight: the ground between must stay under the line from the viewer's eye to the target's top.
export function clearOverTerrain(terrain: Terrain, line: SightLine): boolean {
  const { a, b, from, to } = line;
  const n = Math.ceil(dist(a, b) * TERRAIN.vision.samplesPerTile);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ground = heightAt(terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (ground > from + (to - from) * t) return false;
  }
  return true;
}

// Tiles currently visible from the player vehicle. Empty if the player vehicle is gone.
export function playerVisible(world: World): Set<number> {
  const v = world.vehicles.find((x) => x.id === world.player.vehicleId);
  return v ? visibleTiles(world, v.pos) : new Set<number>();
}

// Recomputes the player's view and marks it explored. Run after anything that moves the player.
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

// The player practices perception once per vehicle that becomes a contact, harder near the edge of reach.
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

// Whether the player currently sees a map point. Reads the stored view, so call refreshVision first.
export function playerSees(world: World, p: Vec): boolean {
  return world.player.visible.includes(tileOf(world, p));
}

export function playerExplored(world: World, p: Vec): boolean {
  return world.player.explored[tileOf(world, p)] === 1;
}
