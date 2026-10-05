// The views of the utility effects that lie in the world: smoke clouds, ground fields, flares, harpoon lines and
// emitter pulses. HazardViews owns them and updates them each frame. Render only: they read the world and never change it.
// No hazard view draws a ring, disc or band at a hazard's radius (IV23). Each is drawn as the thing it is, built so its
// visible edge sits near the sim radius. Only the planning-time aim UI marks the ground.
//
// Smoke clouds from world.smoke: a dense black plume of puffs in two height layers that fill the circle out to its
// radius, with a ragged soft edge from each puff's own size and offset. Its center hides the ground and trucks behind
// it; trucks inside still show through their stencil outlines. A new cloud billows out from its source: the Sprout's
// truck, or where the mortar's shell lands. A cloud thins in its last turn. Puffs between the camera and the player's
// truck thin out, so the player always finds its own truck inside a cloud.
//
// Ground fields from world.fields: a caltrop field is steel spikes strewn densest along the line its dropper drove and
// thinning toward the radius. An oil field is a flat, opaque, glossy black blob with a noise-shaped rim and a faint
// rainbow sheen. Blobs of one spill overlap, so they merge into one streak with no darker overlaps.
//
// Shown: clouds and fields the player sees any part of, and the player's own.
//
// Flares from world.flares: a red glow hanging over its point and a red point light, drawn while it burns within
// FLARE.seenRange of the player. It sinks FLARE_LOOK.sink a turn. The truck its launch or its light shows is marked by
// contacts.ts from the player's contacts.
//
// Emitter pulses from the turn's pulse events: a blue-white flash at the emitter and jagged electric arcs to each truck
// it hit, where the player sees the user, a truck it hit or the player is involved. Trucks with shut-down turns ahead
// crackle with sparks while they are drawn.
//
// Timing (TurnClock, from the playback in game.ts): a hazard made in the turn now playing, absent from the world
// before it, shows when it happens. Oil and caltrops appear as their dropper's animated spot passes them (fieldShown).
// Smoke, flares, harpoon lines and pulses start when movement has played, at the volley (volleyShown). There a flare
// flies from its cannon on a Flight arc and ignites at the top, and a mortar shell flies to where its cloud billows.
// Hazards from earlier turns, and everything after a load, show at once.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { FLARE } from '../../data/utilities';
import { groundPoint, type V3 } from '../../phys/frames';
import { PAL } from '../../render/palette';
import { hash2, valueNoise } from '../../render/noise';
import { playerVehicle } from '../../sim/damage';
import { dropClearance } from '../../sim/hazards';
import { heightAt, markHeightAt, type Terrain } from '../../sim/terrain';
import type { Flare, GameEvent, GroundField, SmokeCloud, Vehicle, World } from '../../sim/types';
import { shutDownTurnsLeft } from '../../sim/utility';
import { dist, type Vec } from '../../sim/vec';
import { playerSees } from '../../sim/vision';
import { HarpoonLinesView } from './lines';
import type { VehicleView } from './vehicle';

const S = PHYSICS.metersPerTile;

// Where the turn's playback stands. before: the world before the turn. progress: 0..1 of the movement played.
// moved: movement has played and the volley is on. Null while no turn plays.
export type TurnClock = { before: World | null; progress: number; moved: boolean };

// Every utility effect view, under one root.
export class HazardViews {
  private readonly smoke = new SmokeCloudsView();
  private readonly fields = new GroundFieldsView();
  private readonly flares = new FlaresView();
  private readonly lines = new HarpoonLinesView();
  private readonly pulses = new PulseView();
  readonly root = new THREE.Group();

  constructor() {
    this.root.add(this.smoke.root, this.fields.root, this.flares.root, this.lines.root, this.pulses.root);
  }

  // views: the vehicle views by vehicle id, which flights leave from, harpoon lines run between and sparks crackle on.
  // camera: the one drawing the scene, for the smoke's cutaway over the player's truck.
  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null, camera: THREE.Camera): void {
    this.smoke.update(world, terrain, views, nowMs, clock, cutawayOf(world, views, camera));
    this.fields.update(world, terrain, clock);
    this.flares.update(world, terrain, views, nowMs, clock);
    const fresh = new Set(world.lines.filter((l) => madeThisTurn(clock, 'lines', l.id)).map((l) => l.id));
    this.lines.update(world, views, nowMs, { fresh, moved: clock === null || clock.moved });
    this.pulses.update(world, terrain, views, nowMs, clock);
  }
}

// ---- Reveal timing

type HazardList = 'smoke' | 'fields' | 'flares' | 'lines';

// Whether the hazard with this id was made in the turn now playing: a turn plays and the world before it lacks it.
function madeThisTurn(clock: TurnClock | null, list: HazardList, id: string): boolean {
  return clock !== null && clock.before !== null && !clock.before[list].some((h) => h.id === id);
}

// Whether a hazard made at the volley shows yet: once movement has played. One from an earlier turn shows at once.
export function volleyShown(clock: TurnClock | null, list: HazardList, id: string): boolean {
  return clock === null || clock.moved || !madeThisTurn(clock, list, id);
}

// Whether a field shows yet. One dropped this turn appears once its dropper's animated spot, sampled from its trail at
// the playback's progress, is past the field along the trail by half the dropper's length plus the field's radius: it
// lands just clear of the rear. A dropper gone from the world shows it when movement has played.
export function fieldShown(world: World, f: GroundField, clock: TurnClock | null): boolean {
  if (clock === null || clock.moved || !madeThisTurn(clock, 'fields', f.id)) return true;
  const dropper = world.vehicles.find((v) => v.id === f.source);
  if (!dropper) return false;
  return arcAt(dropper.trail, clock.progress) >= arcOf(pathOf(dropper), f.pos) + dropClearance(dropper, f.r);
}

// The ground the truck drove this turn, from its start to its position.
function pathOf(v: Vehicle): Vec[] {
  return [...v.trail, v.pos].map((p) => ({ x: p.x, y: p.y }));
}

// Tiles along the trail at this share of the turn. Trail poses are evenly spaced in time from the start pose.
function arcAt(trail: readonly Vec[], progress: number): number {
  if (trail.length < 2) return 0;
  const lengths = runningLengths(trail);
  const at = Math.min(1, Math.max(0, progress)) * (trail.length - 1);
  const i = Math.min(trail.length - 2, Math.floor(at));
  return lengths[i] + (at - i) * (lengths[i + 1] - lengths[i]);
}

function runningLengths(points: readonly Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + dist(points[i - 1], points[i]));
  return out;
}

// Tiles along the path to the point nearest p. Before the path's start it is negative, along the first leg's line.
function arcOf(path: readonly Vec[], p: Vec): number {
  const near = nearestOnPath(path, p);
  return near ? near.arc : -dist(path[0], p);
}

type PathSpot = { arc: number; dir: Vec; gap: number };

// The spot on the path nearest p, with the path's direction there, or null for a path with no length.
function nearestOnPath(path: readonly Vec[], p: Vec): PathSpot | null {
  const lengths = runningLengths(path);
  let best: PathSpot | null = null;
  for (let i = 1; i < path.length; i++) {
    const spot = spotOnLeg(path[i - 1], path[i], p, i === 1);
    if (spot && (!best || spot.gap < best.gap)) best = { ...spot, arc: lengths[i - 1] + spot.arc };
  }
  return best;
}

// The nearest spot to p on the leg from a to b. The first leg runs on back past its start.
function spotOnLeg(a: Vec, b: Vec, p: Vec, first: boolean): PathSpot | null {
  const length = dist(a, b);
  if (length === 0) return null;
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const along = Math.min(length, Math.max(first ? -Infinity : 0, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y));
  return { arc: along, dir, gap: dist(p, { x: a.x + dir.x * along, y: a.y + dir.y * along }) };
}

// ---- Flight: a flare or a mortar shell between its launcher and where it goes

// A body thrown from one point to another over ms, on a parabola `apex` meters above the straight line at mid flight.
// An apex of a quarter of the rise ends the climb at the top, as a flare's.
export class Flight {
  constructor(
    private readonly from: V3,
    private readonly to: V3,
    private readonly apex: number,
    readonly ms: number,
    readonly startMs: number,
  ) {}

  // Share of the flight flown at nowMs, 0..1.
  share(nowMs: number): number {
    return Math.min(1, Math.max(0, (nowMs - this.startMs) / this.ms));
  }

  // The point at share t of the flight.
  at(t: number): V3 {
    const lift = 4 * this.apex * t * (1 - t);
    return { x: this.from.x + (this.to.x - this.from.x) * t, y: this.from.y + (this.to.y - this.from.y) * t + lift, z: this.from.z + (this.to.z - this.from.z) * t };
  }
}

type FlightLook = { head: number; headSize: number; additive: boolean; trail: number; trailPuffs: number; trailLag: number; trailSize: number; trailOpacity: number };

type Flying = { flight: Flight; head: THREE.Sprite; trail: THREE.Sprite[] };

// The heads and fading smoke trails of every body in flight. A body is dropped when it lands.
class FlightsView {
  readonly root = new THREE.Group();
  private readonly flying: Flying[] = [];
  private readonly headMaterial: THREE.SpriteMaterial;
  private readonly trailTexture = createSmokeTexture();

  constructor(private readonly look: FlightLook) {
    const blending = look.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.headMaterial = new THREE.SpriteMaterial({ map: createGlowTexture(), color: look.head, transparent: true, depthWrite: false, blending });
  }

  launch(flight: Flight): void {
    const head = new THREE.Sprite(this.headMaterial);
    head.renderOrder = FLARE_ORDER;
    head.scale.setScalar(this.look.headSize * S);
    const trail = Array.from({ length: this.look.trailPuffs }, () => {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.trailTexture, color: this.look.trail, transparent: true, depthWrite: false }));
      puff.renderOrder = FLARE_ORDER - 1;
      return puff;
    });
    this.root.add(head, ...trail);
    this.flying.push({ flight, head, trail });
  }

  update(nowMs: number): void {
    for (const body of [...this.flying]) {
      const t = body.flight.share(nowMs);
      if (t >= 1) this.land(body);
      else this.fly(body, t);
    }
  }

  // The head at t, and each trail puff where the head was a little earlier, fading and spreading with its lag.
  private fly(body: Flying, t: number): void {
    body.head.position.copy(body.flight.at(t));
    body.trail.forEach((puff, i) => {
      const lag = (i + 1) * this.look.trailLag;
      puff.visible = t > lag;
      puff.position.copy(body.flight.at(Math.max(0, t - lag)));
      puff.scale.setScalar(this.look.trailSize * S * (1 + i * 0.25));
      puff.material.opacity = this.look.trailOpacity * (1 - i / body.trail.length);
    });
  }

  private land(body: Flying): void {
    this.root.remove(body.head, ...body.trail);
    for (const puff of body.trail) puff.material.dispose();
    this.flying.splice(this.flying.indexOf(body), 1);
  }
}

type UtilityEvent = Extract<GameEvent, { t: 'utility' }>;

// The utility event that launched a round of this effect from source at pos this turn, if any.
function launchOf(world: World, effect: 'mortar' | 'flare', source: string, pos: Vec): UtilityEvent | null {
  const launched = (e: GameEvent): e is UtilityEvent => e.t === 'utility' && e.effect === effect && e.vehicle === source;
  return world.events.filter(launched).find((e) => e.point !== null && e.point.x === pos.x && e.point.y === pos.y) ?? null;
}

// Where a round leaves: the launcher's part on the drawn truck. A launcher the player does not see, or no longer
// carrying the part, starts it at its last contact point, else at the target point.
function launchPoint(world: World, views: ReadonlyMap<string, VehicleView>, e: UtilityEvent, target: Vec): V3 {
  const view = views.get(e.vehicle);
  const launcher = world.vehicles.find((v) => v.id === e.vehicle);
  if (view && launcher?.items.some((i) => i.kind === 'part' && i.part.id === e.part)) return view.partPoint(e.part);
  const contact = world.player.contacts.find((c) => c.vehicleId === e.vehicle);
  return groundPoint(world.terrain, contact ? contact.center : target);
}

// ---- Smoke clouds

const SMOKE_ORDER = 905; // above the fog (900) and dust (904), below contact markers
const SMOKE_LOOK = {
  basePuffs: 16,
  puffsPerArea: 2.2, // sprites per square tile of cloud, on top of basePuffs
  size: { min: 3, max: 4 }, // tiles across a puff
  opacity: { min: 0.8, max: 0.9 }, // per puff
  inset: 1.3, // tiles in from the radius the puff centers spread to, about a puff's soft half width
  ragged: 0.6, // tiles each puff's center is pushed in or out, so the edge is ragged
  low: { share: 0.6, from: 0.35, to: 0.9 }, // the ground layer: share of puffs, height range in tiles
  high: { from: 1.3, to: 2.3, spread: 0.8 }, // the upper layer: height range in tiles, share of the low layer's spread
  billowMs: 1500, // a new cloud's time to billow out from its source
  lastTurn: 0.55, // opacity share in the cloud's last turn, so a thinning cloud reads as ending
  wobble: 0.35, // tiles each puff wanders
  wobbleSeconds: 5,
  // Over the player's truck: a puff is thinnest while its center lies within `inner` of its half width of the truck on
  // screen, whole once it is `clear` tiles past its half width, and keeps `floor` of its opacity at its thinnest.
  cutaway: { inner: 0.9, clear: 0.6, floor: 0.04 },
};
// The mortar's shell: a dark round with a gray smoke trail on a low arc.
const SHELL = { flightMs: 900, apex: 3 }; // apex: tiles above the straight line at mid flight
const SHELL_LOOK: FlightLook = { head: PAL.shell.head, headSize: 0.5, additive: false, trail: PAL.shell.trail, trailPuffs: 6, trailLag: 0.05, trailSize: 0.5, trailOpacity: 0.55 };
const RIM_SAMPLES = 8; // rim points checked for sight, besides the center

type Puff = { sprite: THREE.Sprite; home: THREE.Vector3; size: number; opacity: number; seed: number };
// bornMs: when the billow starts. from: where it starts, in meters from the cloud's center.
type CloudView = { group: THREE.Group; puffs: Puff[]; bornMs: number; from: THREE.Vector3 };

class SmokeCloudsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, CloudView>();
  private readonly texture = createSmokeTexture();
  private readonly shells = new FlightsView(SHELL_LOOK);

  constructor() {
    this.root.add(this.shells.root);
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null, cutaway: Cutaway | null): void {
    const shown = new Map(world.smoke.filter((c) => volleyShown(clock, 'smoke', c.id) && isShown(world, c)).map((c) => [c.id, c]));
    for (const [id, view] of this.views) {
      if (shown.has(id)) continue;
      this.root.remove(view.group);
      for (const p of view.puffs) p.sprite.material.dispose();
      this.views.delete(id);
    }
    for (const c of shown.values()) {
      const view = this.views.get(c.id) ?? this.makeView(world, views, c, madeThisTurn(clock, 'smoke', c.id), nowMs);
      place(terrain, view, c, nowMs, cutaway);
    }
    this.shells.update(nowMs);
  }

  private makeView(world: World, views: ReadonlyMap<string, VehicleView>, c: SmokeCloud, fresh: boolean, nowMs: number): CloudView {
    const group = new THREE.Group();
    group.position.copy(groundPoint(world.terrain, c.pos));
    const puffs = puffsOf(c, this.texture);
    group.add(...puffs.map((p) => p.sprite));
    this.root.add(group);
    const view = { group, puffs, ...this.billow(world, views, c, fresh, nowMs) };
    this.views.set(c.id, view);
    return view;
  }

  // A new cloud billows: a mortar's from where its shell lands, once it lands, and a Sprout's from its truck at once.
  private billow(world: World, views: ReadonlyMap<string, VehicleView>, c: SmokeCloud, fresh: boolean, nowMs: number): Pick<CloudView, 'bornMs' | 'from'> {
    const center = groundPoint(world.terrain, c.pos);
    if (!fresh) return { bornMs: -Infinity, from: new THREE.Vector3() };
    const shot = launchOf(world, 'mortar', c.source, c.pos);
    if (shot) {
      this.shells.launch(new Flight(launchPoint(world, views, shot, c.pos), center, SHELL.apex * S, SHELL.flightMs, nowMs));
      return { bornMs: nowMs + SHELL.flightMs, from: new THREE.Vector3() };
    }
    const truck = views.get(c.source);
    const from = truck ? new THREE.Vector3().copy(truck.center()).sub(center) : new THREE.Vector3();
    return { bornMs: nowMs, from };
  }
}

// The cloud's puffs, laid out once from its id. The low layer fills the circle; the high layer piles over its middle.
export function puffsOf(c: SmokeCloud, texture: THREE.Texture): Puff[] {
  const count = Math.round(SMOKE_LOOK.basePuffs + SMOKE_LOOK.puffsPerArea * c.r * c.r);
  const seed = hashId(c.id);
  return Array.from({ length: count }, (_, i) => {
    const k = seed + i * 17;
    const low = hash2(k, 19) < SMOKE_LOOK.low.share;
    const reach = Math.max(0, c.r - SMOKE_LOOK.inset) * (low ? 1 : SMOKE_LOOK.high.spread);
    // Square root spreads the puffs evenly over the disk instead of crowding the center.
    const r = Math.max(0, Math.sqrt(hash2(k, 3)) * reach + (hash2(k, 23) - 0.5) * 2 * SMOKE_LOOK.ragged);
    const a = hash2(k, 5) * 2 * Math.PI;
    const band = low ? SMOKE_LOOK.low : SMOKE_LOOK.high;
    const home = new THREE.Vector3(Math.cos(a) * r * S, (band.from + (band.to - band.from) * hash2(k, 7)) * S, Math.sin(a) * r * S);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: PAL.smoke, transparent: true, opacity: 0, depthWrite: false }));
    sprite.renderOrder = SMOKE_ORDER;
    const size = SMOKE_LOOK.size.min + (SMOKE_LOOK.size.max - SMOKE_LOOK.size.min) * hash2(k, 11);
    const opacity = SMOKE_LOOK.opacity.min + (SMOKE_LOOK.opacity.max - SMOKE_LOOK.opacity.min) * hash2(k, 13);
    return { sprite, home, size, opacity, seed: k };
  });
}

// The player sees an area hazard when it sees its center or a point of its rim. The player's own always shows.
function isShown(world: World, c: { source: string; pos: Vec; r: number }): boolean {
  if (c.source === world.player.vehicleId) return true;
  const rim: Vec[] = Array.from({ length: RIM_SAMPLES }, (_, i) => {
    const a = (2 * Math.PI * i) / RIM_SAMPLES;
    return { x: c.pos.x + Math.cos(a) * c.r, y: c.pos.y + Math.sin(a) * c.r };
  });
  return [c.pos, ...rim].some((p) => p.x >= 0 && p.y >= 0 && p.x < world.size && p.y < world.size && playerSees(world, p));
}

// Where the player's truck is drawn and which way the camera looks, so puffs over the truck can thin out.
export type Cutaway = { at: THREE.Vector3; look: THREE.Vector3 };

function cutawayOf(world: World, views: ReadonlyMap<string, VehicleView>, camera: THREE.Camera): Cutaway | null {
  const truck = views.get(world.player.vehicleId);
  return truck ? { at: new THREE.Vector3().copy(truck.center()), look: camera.getWorldDirection(new THREE.Vector3()) } : null;
}

const CUT_OFF = new THREE.Vector3();
const PUFF_AT = new THREE.Vector3();

// Opacity share of a puff at p of this half width: low where it lies between the camera and the player's truck,
// rising to whole once it clears the truck on screen by SMOKE_LOOK.cutaway.clear.
export function cutShare(cut: Cutaway | null, p: THREE.Vector3, half: number): number {
  if (!cut) return 1;
  const off = CUT_OFF.copy(p).sub(cut.at);
  const along = off.dot(cut.look);
  if (along > 0) return 1; // behind the truck as seen
  const across = off.addScaledVector(cut.look, -along).length();
  const { inner, clear, floor } = SMOKE_LOOK.cutaway;
  const t = Math.min(1, Math.max(0, (across - half * inner) / (half * (1 - inner) + clear * S)));
  return floor + (1 - floor) * t * t * (3 - 2 * t);
}

// Each puff swells out from the billow's start to its spot, and wanders a little.
function place(terrain: Terrain, view: CloudView, c: SmokeCloud, nowMs: number, cutaway: Cutaway | null): void {
  view.group.position.y = heightAt(terrain, c.pos.x, c.pos.y) * S;
  const grown = easeOut(Math.min(1, Math.max(0, (nowMs - view.bornMs) / SMOKE_LOOK.billowMs)));
  const fade = Math.min(1, grown * 2) * (c.turnsLeft <= 1 ? SMOKE_LOOK.lastTurn : 1);
  const t = nowMs / 1000 / SMOKE_LOOK.wobbleSeconds;
  for (const p of view.puffs) {
    const wx = (valueNoise(p.seed * 0.11 + t, 2.3) - 0.5) * 2 * SMOKE_LOOK.wobble * S;
    const wz = (valueNoise(5.1, p.seed * 0.11 + t) - 0.5) * 2 * SMOKE_LOOK.wobble * S;
    p.sprite.position.lerpVectors(view.from, p.home, grown).add({ x: wx, y: 0, z: wz });
    p.sprite.scale.setScalar(p.size * S * (0.3 + 0.7 * grown));
    const at = PUFF_AT.copy(p.sprite.position).add(view.group.position);
    p.sprite.material.opacity = p.opacity * fade * cutShare(cutaway, at, (p.size * S) / 2);
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function createSmokeTexture(): THREE.CanvasTexture {
  // A full core with a long soft falloff, so overlapping puffs make a solid screen with a soft edge.
  return radialTexture([[0, 1], [0.45, 0.85], [0.75, 0.4], [1, 0]]);
}

function radialTexture(stops: [number, number][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a hazard texture');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// A stable seed from an id, so a hazard's scatter keeps its look from frame to frame.
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---- Ground fields

const FIELD_ORDER = 903; // above the fog (900), below dust (904) and smoke (905)
const FIELD_LOOK = {
  spikesPerArea: 6, // spikes per square tile of field, on top of baseSpikes
  baseSpikes: 8,
  spike: { radius: 0.1, height: 0.2 }, // tiles
  across: 0.45, // share of the radius most spikes lie within across the drop line
};
const OIL_LOOK = {
  rim: { min: 0.6, max: 1.25 }, // the blob's rim, in shares of the field's radius
  lobes: { min: 2, max: 3 },
  noise: 0.6, // share of the rim's shape from noise; the rest from the lobes
  angles: 32, // rim points
  rings: [0.5, 1], // shares of the rim the draped rings lie at, so the blob follows the ground
  lift: 0.06, // meters above the ground
  roughness: 0.25,
  // The rainbow highlight: on `share` of the blobs, so a streak has no repeating pattern. Size and offset in shares of
  // the radius.
  sheen: { share: 0.35, size: 0.45, shift: 0.3, opacity: 0.14 },
  wobble: 2.4, // noise cycles around the rim
};

type FieldView = { objects: THREE.Object3D[]; materials: THREE.Material[] };

class GroundFieldsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FieldView>();
  private readonly spikeGeometry = new THREE.ConeGeometry(FIELD_LOOK.spike.radius * S, FIELD_LOOK.spike.height * S, 4);
  private readonly spikeMaterial = new THREE.MeshLambertMaterial({ color: PAL.caltrops.spike, flatShading: true });
  // One opaque material for every blob, so overlapping blobs draw as one slick.
  private readonly oilMaterial = new THREE.MeshStandardMaterial({
    color: PAL.oil.slick, roughness: OIL_LOOK.roughness, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private readonly sheenTexture = createSheenTexture();

  update(world: World, terrain: Terrain, clock: TurnClock | null): void {
    const shown = new Map(world.fields.filter((f) => fieldShown(world, f, clock) && isShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) if (!shown.has(id)) this.drop(id, view);
    for (const f of shown.values()) if (!this.views.has(f.id)) this.views.set(f.id, this.makeView(world, terrain, f, clock));
  }

  private drop(id: string, view: FieldView): void {
    this.root.remove(...view.objects);
    for (const o of view.objects) if (o instanceof THREE.Mesh && o.geometry !== this.spikeGeometry) o.geometry.dispose();
    for (const m of view.materials) m.dispose();
    this.views.delete(id);
  }

  // A field sits still, so its look is built once.
  private makeView(world: World, terrain: Terrain, f: GroundField, clock: TurnClock | null): FieldView {
    const view = f.kind === 'oil' ? this.blob(terrain, f) : { objects: [this.scatter(terrain, f, dropLine(world, f, clock))], materials: [] };
    this.root.add(...view.objects);
    return view;
  }

  // A flat glossy blob with a noise-shaped rim draped on the ground, and on some blobs a faint sheen spot.
  private blob(terrain: Terrain, f: GroundField): FieldView {
    const seed = hashId(f.id);
    const slick = new THREE.Mesh(blobGeometry(terrain, f, seed), this.oilMaterial);
    slick.renderOrder = FIELD_ORDER;
    const { share, size, shift, opacity } = OIL_LOOK.sheen;
    if (hash2(seed, 29) >= share) return { objects: [slick], materials: [] };
    // Pushed toward the camera past every blob's own offset, so a neighbor blob never clips it.
    const material = new THREE.MeshBasicMaterial({
      map: this.sheenTexture, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    const a = hash2(seed, 31) * 2 * Math.PI;
    const at = { x: f.pos.x + Math.cos(a) * f.r * shift, y: f.pos.y + Math.sin(a) * f.r * shift };
    sheen.position.set(at.x * S, markHeightAt(terrain, f.pos, at.x, at.y) * S + OIL_LOOK.lift * 2, at.y * S);
    sheen.scale.setScalar(f.r * size * 2 * S);
    sheen.rotation.y = a;
    sheen.renderOrder = FIELD_ORDER + 1;
    return { objects: [slick, sheen], materials: [material] };
  }

  // Spikes strewn densest along the drop line and thinning toward the radius, each at its own lean on the ground.
  // With no known drop line they spread evenly over the disk.
  private scatter(terrain: Terrain, f: GroundField, line: Vec | null): THREE.Group {
    const group = new THREE.Group();
    const seed = hashId(f.id);
    const count = Math.round(FIELD_LOOK.baseSpikes + FIELD_LOOK.spikesPerArea * Math.PI * f.r * f.r);
    for (let i = 0; i < count; i++) {
      const k = seed + i * 17;
      const p = line ? onLine(f, line, k) : onDisk(f, k);
      const spike = new THREE.Mesh(this.spikeGeometry, this.spikeMaterial);
      spike.position.set(p.x * S, heightAt(terrain, p.x, p.y) * S + (FIELD_LOOK.spike.height * S) / 2, p.y * S);
      spike.rotation.set((hash2(k, 7) - 0.5) * 0.8, hash2(k, 11) * Math.PI, (hash2(k, 13) - 0.5) * 0.8);
      group.add(spike);
    }
    return group;
  }
}

// The direction of the dropper's path at a caltrop field dropped this turn, or null when not known.
function dropLine(world: World, f: GroundField, clock: TurnClock | null): Vec | null {
  if (!madeThisTurn(clock, 'fields', f.id)) return null;
  const dropper = world.vehicles.find((v) => v.id === f.source);
  const spot = dropper ? nearestOnPath(pathOf(dropper), f.pos) : null;
  return spot ? spot.dir : null;
}

function onDisk(f: GroundField, k: number): Vec {
  const r = Math.sqrt(hash2(k, 3)) * f.r;
  const a = hash2(k, 5) * 2 * Math.PI;
  return { x: f.pos.x + Math.cos(a) * r, y: f.pos.y + Math.sin(a) * r };
}

// Even along the line, bunched toward it across, and pulled inside the radius.
function onLine(f: GroundField, dir: Vec, k: number): Vec {
  const along = (hash2(k, 3) - 0.5) * 2 * f.r;
  const across = ((hash2(k, 5) + hash2(k, 17) + hash2(k, 19) - 1.5) / 1.5) * f.r * FIELD_LOOK.across * 2;
  const shrink = Math.min(1, f.r / Math.max(1e-6, Math.hypot(along, across)));
  return { x: f.pos.x + (dir.x * along - dir.y * across) * shrink, y: f.pos.y + (dir.y * along + dir.x * across) * shrink };
}

// A fan of rim points around the center, through draped rings so the blob lies on the ground. Normals point up, so
// every blob shades alike and overlaps do not show.
function blobGeometry(terrain: Terrain, f: GroundField, seed: number): THREE.BufferGeometry {
  const rim = Array.from({ length: OIL_LOOK.angles }, (_, i) => rimRadius(f.r, seed, (2 * Math.PI * i) / OIL_LOOK.angles));
  const positions = [...drape(terrain, f, 0, 0)];
  for (const share of OIL_LOOK.rings) rim.forEach((r, i) => positions.push(...drape(terrain, f, (2 * Math.PI * i) / OIL_LOOK.angles, r * share)));
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(blobIndices(OIL_LOOK.angles, OIL_LOOK.rings.length));
  return geometry;
}

// The rim's radius at angle a: 2-3 lobes blended with noise around the rim, seeded by the field.
function rimRadius(r: number, seed: number, a: number): number {
  const { lobes, noise, rim } = OIL_LOOK;
  const count = lobes.min + Math.floor(hash2(seed, 41) * (lobes.max - lobes.min + 1));
  const lobe = 0.5 + 0.5 * Math.cos(count * a + hash2(seed, 43) * 2 * Math.PI);
  const n = valueNoise((seed % 97) + Math.cos(a) * OIL_LOOK.wobble, (seed % 89) + Math.sin(a) * OIL_LOOK.wobble);
  return r * (rim.min + (rim.max - rim.min) * ((1 - noise) * lobe + noise * n));
}

function drape(terrain: Terrain, f: GroundField, a: number, r: number): number[] {
  const x = f.pos.x + Math.cos(a) * r;
  const y = f.pos.y + Math.sin(a) * r;
  return [x * S, markHeightAt(terrain, f.pos, x, y) * S + OIL_LOOK.lift, y * S];
}

// Vertex 0 is the center, then each ring of `angles` points. Triangles face up.
function blobIndices(angles: number, rings: number): number[] {
  const idx: number[] = [];
  const ring = (j: number, i: number) => 1 + j * angles + (i % angles);
  for (let i = 0; i < angles; i++) {
    idx.push(0, ring(0, i + 1), ring(0, i));
    for (let j = 1; j < rings; j++) idx.push(ring(j - 1, i), ring(j - 1, i + 1), ring(j, i), ring(j - 1, i + 1), ring(j, i + 1), ring(j, i));
  }
  return idx;
}

function createSheenTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the oil sheen texture');
  // Thin rainbow bands fading out to the edge, as light on a film of oil.
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  ['rgba(120,90,200,0)', 'rgba(120,90,200,0.8)', 'rgba(60,170,190,0.8)', 'rgba(200,190,80,0.7)', 'rgba(210,90,120,0.5)', 'rgba(210,90,120,0)'].forEach((c, i, all) => g.addColorStop(i / (all.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// ---- Flares

const FLARE_ORDER = 906; // above smoke (905), below contact markers
const FLARE_LOOK = {
  height: 6, // tiles above the ground the flare hangs
  sink: 1, // tiles the hanging flare sinks a turn
  flightMs: 1600, // from the cannon to the top
  igniteMs: 300, // the light's ramp once lit
  glow: 3, // tiles across the glow sprite
  light: { intensity: 60, reach: 1.6, decay: 1 }, // reach: the light's range as a share of the flare's radius
  flicker: { share: 0.25, speed: 6 }, // the glow and the light waver by this share, this many noise cycles a second
  lastTurn: 0.55, // brightness share in the flare's last turn, so a dying flare reads as ending
};
const FLARE_FLIGHT: FlightLook = { head: PAL.flare.head, headSize: 1.1, additive: true, trail: PAL.flare.trail, trailPuffs: 10, trailLag: 0.04, trailSize: 0.55, trailOpacity: 0.5 };

// igniteMs: when it lights at the top. bornTurn: the world's turn when first drawn, for its sinking.
type FlareView = { glow: THREE.Sprite; igniteMs: number; bornTurn: number };

class FlaresView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FlareView>();
  private readonly texture = createGlowTexture();
  private readonly flights = new FlightsView(FLARE_FLIGHT);
  // A change in light count recompiles every material, so the pool only grows, to the most flares shown at once.
  // Unused lights stay dark.
  private readonly lights: THREE.PointLight[] = [];

  constructor() {
    this.root.add(this.flights.root);
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null): void {
    const shown = new Map(world.flares.filter((f) => volleyShown(clock, 'flares', f.id) && flareShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) if (!shown.has(id)) this.drop(id, view);
    while (this.lights.length < shown.size) this.addLight();
    this.lights.forEach((light) => (light.intensity = 0));
    const progress = clock ? clock.progress : 1;
    [...shown.values()].forEach((f, i) => {
      const view = this.views.get(f.id) ?? this.makeView(world, views, f, madeThisTurn(clock, 'flares', f.id), nowMs);
      this.place(terrain, view, this.lights[i], f, { nowMs, turn: world.turn, progress });
    });
    this.flights.update(nowMs);
  }

  private addLight(): void {
    const light = new THREE.PointLight(PAL.flare.light, 0, 0, FLARE_LOOK.light.decay);
    this.lights.push(light);
    this.root.add(light);
  }

  // A new flare flies from its cannon to its top and lights there. One from an earlier turn burns at once.
  private makeView(world: World, views: ReadonlyMap<string, VehicleView>, f: Flare, fresh: boolean, nowMs: number): FlareView {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, color: PAL.flare.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.renderOrder = FLARE_ORDER;
    glow.scale.setScalar(FLARE_LOOK.glow * S);
    this.root.add(glow);
    const shot = fresh ? launchOf(world, 'flare', f.source, f.pos) : null;
    if (shot) {
      const top = groundPoint(world.terrain, f.pos);
      top.y += FLARE_LOOK.height * S;
      const from = launchPoint(world, views, shot, f.pos);
      this.flights.launch(new Flight(from, top, (top.y - from.y) / 4, FLARE_LOOK.flightMs, nowMs));
    }
    const view = { glow, igniteMs: shot ? nowMs + FLARE_LOOK.flightMs : -Infinity, bornTurn: world.turn };
    this.views.set(f.id, view);
    return view;
  }

  private drop(id: string, view: FlareView): void {
    this.root.remove(view.glow);
    view.glow.material.dispose();
    this.views.delete(id);
  }

  // Lit, the glow and its light waver together, ramp up at ignition, dim in the flare's last turn and sink a little
  // each turn from the turn after its launch.
  private place(terrain: Terrain, view: FlareView, light: THREE.PointLight, f: Flare, at: { nowMs: number; turn: number; progress: number }): void {
    const lit = Math.min(1, Math.max(0, (at.nowMs - view.igniteMs) / FLARE_LOOK.igniteMs));
    const wave = 1 - FLARE_LOOK.flicker.share * valueNoise((at.nowMs / 1000) * FLARE_LOOK.flicker.speed, hashId(f.id) % 97);
    const bright = lit * wave * (f.turnsLeft <= 1 ? FLARE_LOOK.lastTurn : 1);
    const sunk = Math.max(0, at.turn - view.bornTurn - 1 + at.progress) * FLARE_LOOK.sink;
    view.glow.position.set(f.pos.x * S, (heightAt(terrain, f.pos.x, f.pos.y) + FLARE_LOOK.height - sunk) * S, f.pos.y * S);
    view.glow.visible = lit > 0;
    view.glow.material.opacity = bright;
    light.intensity = FLARE_LOOK.light.intensity * bright;
    light.distance = f.r * FLARE_LOOK.light.reach * S;
    light.position.copy(view.glow.position);
  }
}

// A flare shows within FLARE.seenRange of the player, and the player's own always does.
function flareShown(world: World, f: Flare): boolean {
  return f.source === world.player.vehicleId || dist(playerVehicle(world).pos, f.pos) <= FLARE.seenRange;
}

function createGlowTexture(): THREE.CanvasTexture {
  // A hot white core that fades out through the sprite's color.
  return radialTexture([[0, 1], [0.25, 0.8], [1, 0]]);
}

// ---- Emitter pulses

const PULSE_ORDER = 906; // above smoke (905), below contact markers
const PULSE_LOOK = {
  ms: 600, // the flash and the arcs, from the volley to gone
  flash: 3.5, // tiles across the flash at its start
  rise: 1.2, // meters above a truck's center the flash and the arcs' ends sit
  segments: 9, // points along an arc
  jitter: 0.9, // meters an arc's inner points jump off the straight line, every frame
  strands: 2, // lines per arc, each jittered on its own, so it reads thicker than one pixel
  sparks: 10, // per shut-down truck
  sparkSize: 0.7, // meters across a spark; a sprite, since points on the orthographic camera size in pixels
  sparkReach: 1.4, // meters from the truck's center a spark jumps to
  sparkHeight: 2.2, // meters above the truck's center the sparks spread up to, so most clear the body and show
};

type PulseEvent = Extract<GameEvent, { t: 'pulse' }>;
// A pulse's look while it plays: the flash at the user, and the strands of each arc to a hit truck.
type Strand = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
type Zap = { e: PulseEvent; flash: THREE.Sprite; arcs: { to: string; strands: Strand[] }[]; startMs: number };

class PulseView {
  readonly root = new THREE.Group();
  private readonly zaps: Zap[] = [];
  private played = new Set<string>(); // pulse events of the shown turn whose zap has started
  private turn = -1;
  private readonly sparks = new Map<string, THREE.Group>(); // by vehicle id
  private readonly glowTexture = createGlowTexture();
  private readonly sparkMaterial = new THREE.SpriteMaterial({ map: this.glowTexture, color: PAL.pulse.spark, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null): void {
    if (clock === null || clock.moved) this.startZaps(world, nowMs);
    for (const zap of [...this.zaps]) this.play(zap, terrain, views, nowMs);
    this.crackle(world, views);
  }

  private startZaps(world: World, nowMs: number): void {
    if (world.turn !== this.turn) {
      this.turn = world.turn;
      this.played = new Set();
    }
    for (const e of world.events) {
      if (e.t !== 'pulse' || this.played.has(e.vehicle) || !pulseShown(world, e)) continue;
      this.played.add(e.vehicle);
      this.zaps.push(this.makeZap(e, nowMs));
    }
  }

  private makeZap(e: PulseEvent, nowMs: number): Zap {
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture, color: PAL.pulse.flash, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.renderOrder = PULSE_ORDER;
    const arcs = e.hit.map((to) => ({ to, strands: Array.from({ length: PULSE_LOOK.strands }, () => makeStrand()) }));
    this.root.add(flash, ...arcs.flatMap((a) => a.strands));
    return { e, flash, arcs, startMs: nowMs };
  }

  // The flash swells and fades; each arc flickers to a new jagged line every frame and fades with it.
  private play(zap: Zap, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    const t = (nowMs - zap.startMs) / PULSE_LOOK.ms;
    if (t >= 1) return this.end(zap);
    const from = zapPoint(userPoint(zap.e, terrain, views));
    zap.flash.position.copy(from);
    zap.flash.scale.setScalar(PULSE_LOOK.flash * S * (0.6 + 0.6 * t));
    zap.flash.material.opacity = 1 - t;
    for (const arc of zap.arcs) {
      const target = views.get(arc.to);
      for (const strand of arc.strands) jag(strand, from, target ? zapPoint(target.center()) : null, 1 - t);
    }
  }

  private end(zap: Zap): void {
    const strands = zap.arcs.flatMap((a) => a.strands);
    this.root.remove(zap.flash, ...strands);
    zap.flash.material.dispose();
    for (const s of strands) {
      s.geometry.dispose();
      s.material.dispose();
    }
    this.zaps.splice(this.zaps.indexOf(zap), 1);
  }

  // Sparks jump to new spots around each drawn truck with shut-down turns ahead, every frame.
  private crackle(world: World, views: ReadonlyMap<string, VehicleView>): void {
    const shut = shutDownViews(world, views);
    for (const [id, group] of this.sparks) {
      if (shut.has(id)) continue;
      this.root.remove(group);
      this.sparks.delete(id);
    }
    for (const [id, view] of shut) jump(this.sparksOf(id), view.center());
  }

  private sparksOf(id: string): THREE.Group {
    const known = this.sparks.get(id);
    if (known) return known;
    const group = new THREE.Group();
    for (let i = 0; i < PULSE_LOOK.sparks; i++) {
      const spark = new THREE.Sprite(this.sparkMaterial);
      spark.renderOrder = PULSE_ORDER;
      spark.frustumCulled = false;
      group.add(spark);
    }
    this.root.add(group);
    this.sparks.set(id, group);
    return group;
  }
}

function makeStrand(): Strand {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PULSE_LOOK.segments * 3), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: PAL.pulse.arc, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  line.renderOrder = PULSE_ORDER;
  line.frustumCulled = false;
  return line;
}

// The pulse's user as drawn, else where it pulsed.
function userPoint(e: PulseEvent, terrain: Terrain, views: ReadonlyMap<string, VehicleView>): V3 {
  const view = views.get(e.vehicle);
  return view ? view.center() : groundPoint(terrain, e.pos);
}

function zapPoint(p: V3): V3 {
  return { x: p.x, y: p.y + PULSE_LOOK.rise, z: p.z };
}

// Lays a strand from a to b with its inner points knocked off the line at random. Render only, so Math.random() is
// fine: an arc needs no repeatable pattern. A hit truck that is not drawn gets no arc.
function jag(strand: Strand, a: V3, b: V3 | null, opacity: number): void {
  strand.visible = b !== null;
  if (!b) return;
  const at = strand.geometry.getAttribute('position');
  const last = PULSE_LOOK.segments - 1;
  for (let i = 0; i <= last; i++) {
    const t = i / last;
    const off = i === 0 || i === last ? 0 : PULSE_LOOK.jitter;
    at.setXYZ(i, a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 2 * off, a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 2 * off, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * 2 * off);
  }
  at.needsUpdate = true;
  strand.material.opacity = opacity;
}

// The drawn trucks with shut-down turns ahead, by vehicle id.
function shutDownViews(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, VehicleView> {
  const shut = new Map<string, VehicleView>();
  for (const v of world.vehicles) {
    const view = views.get(v.id);
    if (view && shutDownTurnsLeft(world, v) > 0) shut.set(v.id, view);
  }
  return shut;
}

// The player sees a pulse it fired or that hit it, or one whose user or a hit truck it sees.
function pulseShown(world: World, e: PulseEvent): boolean {
  const me = world.player.vehicleId;
  if (e.vehicle === me || e.hit.includes(me) || playerSees(world, e.pos)) return true;
  return e.hit.some((id) => {
    const v = world.vehicles.find((x) => x.id === id);
    return v !== undefined && playerSees(world, v.pos);
  });
}

// Scatters the sparks around a truck's center. Render only, so Math.random() is fine: sparks need no repeatable pattern.
function jump(group: THREE.Group, at: { x: number; y: number; z: number }): void {
  for (const spark of group.children) {
    const a = Math.random() * 2 * Math.PI;
    const r = Math.random() * PULSE_LOOK.sparkReach;
    spark.position.set(at.x + Math.cos(a) * r, at.y + PULSE_LOOK.sparkHeight * Math.random(), at.z + Math.sin(a) * r);
    spark.scale.setScalar(PULSE_LOOK.sparkSize * (0.5 + Math.random()));
  }
}
