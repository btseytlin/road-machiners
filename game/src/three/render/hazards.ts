// The views of the utility effects that lie in the world: smoke clouds, ground fields, flares, harpoon lines and
// emitter pulses. HazardViews owns them and updates them each frame. Render only: they read the world and never change it.
// No hazard view draws a ring, disc or band at a hazard's radius (IV23). Each is drawn as the thing it is, built so its

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
import { CARD_SHAPES, ROUND_SHAPE, type Card, type FxCards } from './particles/cards';
import { liveNear, Particles, type ParticleLook } from './particles/particles';
import { newWake, stepWake, WakeTracker, type WakeMover, type WakeState } from './particles/wake';
import type { VehicleView } from './vehicle';

const S = PHYSICS.metersPerTile;

export type TurnClock = { before: World | null; progress: number; moved: boolean };

export class HazardViews {
  private readonly smoke = new SmokeCloudsView();
  private readonly fields = new GroundFieldsView();
  private readonly flares = new FlaresView();
  private readonly lines = new HarpoonLinesView();
  private readonly pulses = new PulseView();
  readonly root = new THREE.Group();
  private played: { before: World; turn: number } | null = null;

  constructor() {
    this.root.add(this.smoke.root, this.fields.root, this.flares.root, this.lines.root, this.pulses.root);
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, turnClock: TurnClock | null, camera: THREE.Camera): void {
    const clock = this.clockOf(world, turnClock);
    this.smoke.update(world, terrain, views, nowMs, clock, cutawayOf(world, views, camera));
    this.fields.update(world, terrain, clock, nowMs);
    this.flares.update(world, terrain, views, nowMs, clock);
    const fresh = clock === null ? NO_IDS : new Set(world.lines.filter((l) => madeThisTurn(clock, 'lines', l.id)).map((l) => l.id));
    this.lines.update(world, views, nowMs, { fresh, playing: turnClock !== null });
    this.pulses.update(world, terrain, views, nowMs, clock);
  }

  draw(cards: FxCards): void {
    this.smoke.draw(cards);
    this.flares.draw(cards);
    this.pulses.draw(cards);
  }

  private clockOf(world: World, clock: TurnClock | null): TurnClock | null {
    if (clock) {
      this.played = clock.before ? { before: clock.before, turn: world.turn } : null;
      return clock;
    }
    return this.played && this.played.turn === world.turn ? { before: this.played.before, progress: 1, moved: true } : null;
  }
}

const NO_IDS: ReadonlySet<string> = new Set();

type HazardList = 'smoke' | 'fields' | 'flares' | 'lines';

function madeThisTurn(clock: TurnClock | null, list: HazardList, id: string): boolean {
  return clock !== null && clock.before !== null && !clock.before[list].some((h) => h.id === id);
}

export function volleyShown(clock: TurnClock | null, list: HazardList, id: string): boolean {
  return clock === null || clock.moved || !madeThisTurn(clock, list, id);
}

export function fieldShown(world: World, f: GroundField, clock: TurnClock | null): boolean {
  if (clock === null || clock.moved || !madeThisTurn(clock, 'fields', f.id)) return true;
  const dropper = world.vehicles.find((v) => v.id === f.source);
  if (!dropper) return false;
  return arcAt(dropper.trail, clock.progress) >= arcOf(pathOf(dropper), f.pos) + dropClearance(dropper, f.r);
}

function pathOf(v: Vehicle): Vec[] {
  return [...v.trail, v.pos].map((p) => ({ x: p.x, y: p.y }));
}

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

function arcOf(path: readonly Vec[], p: Vec): number {
  const near = nearestOnPath(path, p);
  return near ? near.arc : -dist(path[0], p);
}

type PathSpot = { arc: number; dir: Vec; gap: number };

function nearestOnPath(path: readonly Vec[], p: Vec): PathSpot | null {
  const lengths = runningLengths(path);
  let best: PathSpot | null = null;
  for (let i = 1; i < path.length; i++) {
    const spot = spotOnLeg(path[i - 1], path[i], p, i === 1);
    if (spot && (!best || spot.gap < best.gap)) best = { ...spot, arc: lengths[i - 1] + spot.arc };
  }
  return best;
}

function spotOnLeg(a: Vec, b: Vec, p: Vec, first: boolean): PathSpot | null {
  const length = dist(a, b);
  if (length === 0) return null;
  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const along = Math.min(length, Math.max(first ? -Infinity : 0, (p.x - a.x) * dir.x + (p.y - a.y) * dir.y));
  return { arc: along, dir, gap: dist(p, { x: a.x + dir.x * along, y: a.y + dir.y * along }) };
}

export class Flight {
  constructor(
    private readonly from: V3,
    private readonly to: V3,
    private readonly apex: number,
    readonly ms: number,
    readonly startMs: number,
  ) {}

  share(nowMs: number): number {
    return Math.min(1, Math.max(0, (nowMs - this.startMs) / this.ms));
  }

  at(t: number): V3 {
    const lift = 4 * this.apex * t * (1 - t);
    return { x: this.from.x + (this.to.x - this.from.x) * t, y: this.from.y + (this.to.y - this.from.y) * t + lift, z: this.from.z + (this.to.z - this.from.z) * t };
  }
}

type FlightLook = { casing: number; length: number; radius: number; trail: number; trailPuffs: number; trailLag: number; trailSize: number; trailOpacity: number };

type Flying = { flight: Flight; head: THREE.Mesh; trail: Card[]; live: Card[] };

const UP = new THREE.Vector3(0, 1, 0);
const HEADING = new THREE.Vector3();
const FLIGHT_LOOKAHEAD = 0.01;
const FLIGHT_CARDS = 100;
const TRAIL_SPIN = 2.4;

class FlightsView {
  readonly root = new THREE.Group();
  private readonly flying: Flying[] = [];
  private readonly headGeometry: THREE.CylinderGeometry;
  private readonly headMaterial: THREE.MeshLambertMaterial;
  private readonly trailColor: THREE.Color;

  constructor(private readonly look: FlightLook) {
    this.headGeometry = new THREE.CylinderGeometry(look.radius * S, look.radius * S, look.length * S, 8);
    this.headMaterial = new THREE.MeshLambertMaterial({ color: look.casing });
    this.trailColor = new THREE.Color(look.trail);
  }

  launch(flight: Flight): void {
    const head = new THREE.Mesh(this.headGeometry, this.headMaterial);
    head.renderOrder = FLARE_ORDER;
    const trail = Array.from({ length: this.look.trailPuffs }, (_, i) => this.trailCard(i));
    this.root.add(head);
    this.flying.push({ flight, head, trail, live: [] });
  }

  draw(cards: FxCards): void {
    let left = FLIGHT_CARDS;
    for (const body of this.flying) {
      const n = Math.min(body.live.length, left);
      for (let i = 0; i < n; i++) cards.lit.push(body.live[i]);
      left -= n;
    }
  }

  update(nowMs: number): void {
    for (const body of [...this.flying]) {
      const t = body.flight.share(nowMs);
      if (t >= 1) this.land(body);
      else this.fly(body, t, nowMs);
    }
  }

  private trailCard(i: number): Card {
    const { r, g, b } = this.trailColor;
    const shape = i % CARD_SHAPES;
    const spin = i * TRAIL_SPIN;
    return { x: 0, y: 0, z: 0, size: 0, spin, shape, r, g, b, alpha: 0, sx: 0, sy: 0, sz: 0 };
  }

  private fly(body: Flying, t: number, nowMs: number): void {
    const at = body.flight.at(t);
    const ahead = body.flight.at(t + FLIGHT_LOOKAHEAD);
    body.head.position.copy(at);
    body.head.quaternion.setFromUnitVectors(UP, HEADING.set(ahead.x - at.x, ahead.y - at.y, ahead.z - at.z).normalize());
    body.live.length = 0;
    body.trail.forEach((card, i) => {
      const lag = (i + 1) * this.look.trailLag;
      if (t <= lag) return;
      const p = body.flight.at(Math.max(0, t - lag));
      card.x = p.x;
      card.y = p.y;
      card.z = p.z;
      card.size = this.look.trailSize * S * (1 + i * 0.25);
      card.spin = i * TRAIL_SPIN + nowMs * 0.0004;
      card.alpha = this.look.trailOpacity * (1 - i / body.trail.length);
      body.live.push(card);
    });
  }

  private land(body: Flying): void {
    this.root.remove(body.head);
    this.flying.splice(this.flying.indexOf(body), 1);
  }
}

type UtilityEvent = Extract<GameEvent, { t: 'utility' }>;

function launchOf(world: World, effect: 'mortar' | 'flare', source: string, pos: Vec): UtilityEvent | null {
  const launched = (e: GameEvent): e is UtilityEvent => e.t === 'utility' && e.effect === effect && e.vehicle === source;
  return world.events.filter(launched).find((e) => e.point !== null && e.point.x === pos.x && e.point.y === pos.y) ?? null;
}

function launchPoint(world: World, views: ReadonlyMap<string, VehicleView>, e: UtilityEvent, target: Vec): V3 {
  const view = views.get(e.vehicle);
  const launcher = world.vehicles.find((v) => v.id === e.vehicle);
  if (view && launcher?.items.some((i) => i.kind === 'part' && i.part.id === e.part)) return view.partPoint(e.part);
  const contact = world.player.contacts.find((c) => c.vehicleId === e.vehicle);
  return groundPoint(world.terrain, contact ? contact.center : target);
}

const SMOKE_LOOK = {
  basePuffs: 16,
  puffsPerArea: 2.2,
  maxPuffs: 120,
  cardBudget: 800,
  cardSize: 0.95,
  clearance: 0.3,
  lit: { toward: 0x8a847d, lift: 0.5 },
  tint: { min: 0.6, max: 1.4 },
  heightShade: { low: 0.55, high: 1.35 },
  turnRate: 0.12,
  size: { min: 3, max: 4 },
  opacity: { min: 0.8, max: 0.9 },
  inset: 1.3,
  ragged: 0.6,
  low: { share: 0.6, from: 0.35, to: 0.9 },
  high: { from: 1.3, to: 2.3, spread: 0.8 },
  billowMs: 1500,
  lastTurn: 0.55,
  wobble: 0.35,
  wobbleSeconds: 5,
  cutaway: { inner: 0.9, clear: 0.6, floor: 0.04 },
};
export const SHELL = { flightMs: 900, apex: 3 };
const SHELL_LOOK: FlightLook = { casing: PAL.shell.casing, length: 0.05, radius: 0.015, trail: PAL.shell.trail, trailPuffs: 6, trailLag: 0.05, trailSize: 0.5, trailOpacity: 0.55 };
const RIM_SAMPLES = 8;

type Puff = { home: THREE.Vector3; size: number; opacity: number; seed: number; side: number; spin: number; shade: number; card: Card; wake: WakeState };
type CloudView = { ground: THREE.Vector3; puffs: Puff[]; bornMs: number; from: THREE.Vector3; limit: number };
type Step = { nowMs: number; cutaway: Cutaway | null; movers: readonly WakeMover[]; dt: number };

class SmokeCloudsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, CloudView>();
  private readonly shells = new FlightsView(SHELL_LOOK);
  private readonly wake = new WakeTracker();

  constructor() {
    this.root.add(this.shells.root);
  }

  draw(cards: FxCards): void {
    this.shells.draw(cards);
    for (const view of this.views.values()) {
      for (let i = 0; i < view.limit; i++) if (view.puffs[i].card.alpha > 0.003) cards.lit.push(view.puffs[i].card);
    }
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null, cutaway: Cutaway | null): void {
    const shown = new Map(world.smoke.filter((c) => volleyShown(clock, 'smoke', c.id) && isShown(world, c)).map((c) => [c.id, c]));
    for (const id of this.views.keys()) if (!shown.has(id)) this.views.delete(id);
    const { movers, dt } = this.wake.update(positionsOf(views), nowMs);
    const share = Math.floor(SMOKE_LOOK.cardBudget / Math.max(1, shown.size));
    for (const c of shown.values()) {
      const view = this.views.get(c.id) ?? this.makeView(world, views, c, madeThisTurn(clock, 'smoke', c.id), nowMs);
      view.limit = Math.min(view.puffs.length, share);
      place(terrain, view, c, { nowMs, cutaway, movers, dt });
    }
    this.shells.update(nowMs);
  }

  private makeView(world: World, views: ReadonlyMap<string, VehicleView>, c: SmokeCloud, fresh: boolean, nowMs: number): CloudView {
    const ground = new THREE.Vector3().copy(groundPoint(world.terrain, c.pos));
    const view = { ground, puffs: puffsOf(c), limit: 0, ...this.billow(world, views, c, fresh, nowMs) };
    this.views.set(c.id, view);
    return view;
  }

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

function positionsOf(views: ReadonlyMap<string, VehicleView>): Map<string, { x: number; z: number }> {
  return new Map([...views].map(([id, view]) => [id, view.center()]));
}

export function puffsOf(c: SmokeCloud): Puff[] {
  const count = Math.min(SMOKE_LOOK.maxPuffs, Math.round(SMOKE_LOOK.basePuffs + SMOKE_LOOK.puffsPerArea * c.r * c.r));
  const seed = hashId(c.id);
  return Array.from({ length: count }, (_, i) => {
    const k = seed + i * 17;
    const low = hash2(k, 19) < SMOKE_LOOK.low.share;
    const reach = Math.max(0, c.r - SMOKE_LOOK.inset) * (low ? 1 : SMOKE_LOOK.high.spread);
    const r = Math.max(0, Math.sqrt(hash2(k, 3)) * reach + (hash2(k, 23) - 0.5) * 2 * SMOKE_LOOK.ragged);
    const a = hash2(k, 5) * 2 * Math.PI;
    const band = low ? SMOKE_LOOK.low : SMOKE_LOOK.high;
    const home = new THREE.Vector3(Math.cos(a) * r * S, (band.from + (band.to - band.from) * hash2(k, 7)) * S, Math.sin(a) * r * S);
    const size = SMOKE_LOOK.size.min + (SMOKE_LOOK.size.max - SMOKE_LOOK.size.min) * hash2(k, 11);
    const opacity = SMOKE_LOOK.opacity.min + (SMOKE_LOOK.opacity.max - SMOKE_LOOK.opacity.min) * hash2(k, 13);
    const spin = hash2(k, 29) * 2 * Math.PI;
    const shade = SMOKE_LOOK.tint.min + (SMOKE_LOOK.tint.max - SMOKE_LOOK.tint.min) * hash2(k, 41);
    return { home, size, opacity, seed: k, side: hash2(k, 37) < 0.5 ? -1 : 1, spin, shade, card: smokeCard(k, spin), wake: newWake() };
  });
}

const SMOKE_COLOR = new THREE.Color(PAL.smoke).lerp(new THREE.Color(SMOKE_LOOK.lit.toward), SMOKE_LOOK.lit.lift);

function smokeCard(k: number, spin: number): Card {
  const shape = Math.floor(hash2(k, 43) * CARD_SHAPES);
  return { x: 0, y: 0, z: 0, size: 0, spin, shape, r: 0, g: 0, b: 0, alpha: 0, sx: 0, sy: 0, sz: 0 };
}

function shadeCard(card: Card, shade: number, height: number): void {
  const { low, high } = SMOKE_LOOK.heightShade;
  const k = shade * (low + (high - low) * Math.min(1, Math.max(0, height / (SMOKE_LOOK.high.to * S))));
  card.r = SMOKE_COLOR.r * k;
  card.g = SMOKE_COLOR.g * k;
  card.b = SMOKE_COLOR.b * k;
}

function isShown(world: World, c: { source: string; pos: Vec; r: number }): boolean {
  if (c.source === world.player.vehicleId) return true;
  const rim: Vec[] = Array.from({ length: RIM_SAMPLES }, (_, i) => {
    const a = (2 * Math.PI * i) / RIM_SAMPLES;
    return { x: c.pos.x + Math.cos(a) * c.r, y: c.pos.y + Math.sin(a) * c.r };
  });
  return [c.pos, ...rim].some((p) => p.x >= 0 && p.y >= 0 && p.x < world.size && p.y < world.size && playerSees(world, p));
}

export type Cutaway = { at: THREE.Vector3; look: THREE.Vector3 };

function cutawayOf(world: World, views: ReadonlyMap<string, VehicleView>, camera: THREE.Camera): Cutaway | null {
  const truck = views.get(world.player.vehicleId);
  return truck ? { at: new THREE.Vector3().copy(truck.center()), look: camera.getWorldDirection(new THREE.Vector3()) } : null;
}

const CUT_OFF = new THREE.Vector3();
const PUFF_AT = new THREE.Vector3();

export function cutShare(cut: Cutaway | null, p: THREE.Vector3, half: number): number {
  if (!cut) return 1;
  const off = CUT_OFF.copy(p).sub(cut.at);
  const along = off.dot(cut.look);
  if (along > 0) return 1;
  const across = off.addScaledVector(cut.look, -along).length();
  const { inner, clear, floor } = SMOKE_LOOK.cutaway;
  const t = Math.min(1, Math.max(0, (across - half * inner) / (half * (1 - inner) + clear * S)));
  return floor + (1 - floor) * t * t * (3 - 2 * t);
}

const PUFF_LOCAL = new THREE.Vector3();
const PUFF_SPOT = { x: 0, z: 0, height: 0 };

function place(terrain: Terrain, view: CloudView, c: SmokeCloud, step: Step): void {
  view.ground.y = heightAt(terrain, c.pos.x, c.pos.y) * S;
  const grown = easeOut(Math.min(1, Math.max(0, (step.nowMs - view.bornMs) / SMOKE_LOOK.billowMs)));
  const fade = Math.min(1, grown * 2) * (c.turnsLeft <= 1 ? SMOKE_LOOK.lastTurn : 1);
  for (let i = 0; i < view.limit; i++) placePuff(view, view.puffs[i], step, grown, fade);
}

function placePuff(view: CloudView, p: Puff, step: Step, grown: number, fade: number): void {
  const t = step.nowMs / 1000 / SMOKE_LOOK.wobbleSeconds;
  const wx = (valueNoise(p.seed * 0.11 + t, 2.3) - 0.5) * 2 * SMOKE_LOOK.wobble * S;
  const wz = (valueNoise(5.1, p.seed * 0.11 + t) - 0.5) * 2 * SMOKE_LOOK.wobble * S;
  const local = PUFF_LOCAL.lerpVectors(view.from, p.home, grown);
  PUFF_SPOT.x = view.ground.x + local.x + wx;
  PUFF_SPOT.z = view.ground.z + local.z + wz;
  PUFF_SPOT.height = local.y;
  stepWake(p.wake, PUFF_SPOT, p.side, step.movers, step.dt);
  const card = p.card;
  card.size = p.size * S * SMOKE_LOOK.cardSize * (0.3 + 0.7 * grown);
  card.x = PUFF_SPOT.x + p.wake.ox;
  card.y = view.ground.y + Math.max(local.y, card.size * SMOKE_LOOK.clearance);
  card.z = PUFF_SPOT.z + p.wake.oz;
  shadeCard(card, p.shade, local.y);
  card.spin = p.spin + (step.nowMs / 1000) * SMOKE_LOOK.turnRate * p.side;
  card.alpha = p.opacity * fade * cutShare(step.cutaway, PUFF_AT.set(card.x, card.y, card.z), (p.size * S) / 2);
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeIn(t: number): number {
  return t * t;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const FIELD_ORDER = 903;
const FIELD_LOOK = {
  spikesPerArea: 6,
  baseSpikes: 8,
  spike: { radius: 0.1, height: 0.2 },
  across: 0.45,
  fall: { height: 0.8, ms: 300, stagger: 250 },
  sink: { ms: 1200, depth: 1.5 },
};
const OIL_LOOK = {
  rim: { min: 0.6, max: 1.25 },
  lobes: { min: 2, max: 3 },
  noise: 0.6,
  angles: 32,
  rings: [0.5, 1],
  lift: 0.06,
  roughness: 0.25,
  sheen: { share: 0.35, size: 0.45, shift: 0.3, opacity: 0.14 },
  wobble: 2.4,
  spreadMs: 700,
  soakMs: 1400,
};

type Spike = { mesh: THREE.Mesh; restY: number; delayMs: number };
type Sheen = { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; angle: number };
type FieldView = {
  f: GroundField;
  root: THREE.Group;
  bornMs: number;
  goneMs: number | null;
  spikes: Spike[];
  slick: THREE.Mesh | null;
  sheen: Sheen | null;
  spread: number;
};

class GroundFieldsView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FieldView>();
  private readonly spikeGeometry = new THREE.ConeGeometry(FIELD_LOOK.spike.radius * S, FIELD_LOOK.spike.height * S, 4);
  private readonly spikeMaterial = new THREE.MeshLambertMaterial({ color: PAL.caltrops.spike, flatShading: true });
  private readonly oilMaterial = new THREE.MeshStandardMaterial({
    color: PAL.oil.slick, roughness: OIL_LOOK.roughness, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private readonly sheenTexture = createSheenTexture();

  update(world: World, terrain: Terrain, clock: TurnClock | null, nowMs: number): void {
    const shown = new Map(world.fields.filter((f) => fieldShown(world, f, clock) && isShown(world, f)).map((f) => [f.id, f]));
    for (const [id, view] of this.views) markGone(view, shown.has(id), nowMs);
    for (const f of shown.values()) if (!this.views.has(f.id)) this.views.set(f.id, this.makeView(world, terrain, f, clock, nowMs));
    for (const [id, view] of this.views) if (!this.pose(terrain, view, nowMs)) this.drop(id, view);
  }

  private pose(terrain: Terrain, view: FieldView, nowMs: number): boolean {
    return view.slick ? this.poseBlob(terrain, view, nowMs) : poseSpikes(view, nowMs);
  }

  private drop(id: string, view: FieldView): void {
    this.root.remove(view.root);
    view.slick?.geometry.dispose();
    view.sheen?.mesh.geometry.dispose();
    view.sheen?.mesh.material.dispose();
    this.views.delete(id);
  }

  private makeView(world: World, terrain: Terrain, f: GroundField, clock: TurnClock | null, nowMs: number): FieldView {
    const root = new THREE.Group();
    const view: FieldView = { f, root, bornMs: madeThisTurn(clock, 'fields', f.id) ? nowMs : -Infinity, goneMs: null, spikes: [], slick: null, sheen: null, spread: -1 };
    if (f.kind === 'oil') this.blob(view);
    else view.spikes = this.scatter(terrain, f, dropLine(world, f, clock), root);
    this.root.add(root);
    return view;
  }

  private blob(view: FieldView): void {
    const seed = hashId(view.f.id);
    view.slick = new THREE.Mesh(new THREE.BufferGeometry(), this.oilMaterial);
    view.slick.renderOrder = FIELD_ORDER;
    view.root.add(view.slick);
    const { share, opacity } = OIL_LOOK.sheen;
    if (hash2(seed, 29) >= share) return;
    const material = new THREE.MeshBasicMaterial({
      map: this.sheenTexture, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    const angle = hash2(seed, 31) * 2 * Math.PI;
    mesh.rotation.y = angle;
    mesh.renderOrder = FIELD_ORDER + 1;
    view.root.add(mesh);
    view.sheen = { mesh, angle };
  }

  private poseBlob(terrain: Terrain, view: FieldView, nowMs: number): boolean {
    const spread = view.goneMs === null
      ? easeOut(Math.min(1, (nowMs - view.bornMs) / OIL_LOOK.spreadMs))
      : 1 - easeIn(Math.min(1, (nowMs - view.goneMs) / OIL_LOOK.soakMs));
    if (spread !== view.spread) {
      const { f } = view;
      view.spread = spread;
      view.slick!.geometry.dispose();
      view.slick!.geometry = blobGeometry(terrain, f, hashId(f.id), spread);
      if (view.sheen) {
        const { size, shift } = OIL_LOOK.sheen;
        const off = f.r * shift * spread;
        const at = { x: f.pos.x + Math.cos(view.sheen.angle) * off, y: f.pos.y + Math.sin(view.sheen.angle) * off };
        view.sheen.mesh.position.set(at.x * S, markHeightAt(terrain, f.pos, at.x, at.y) * S + OIL_LOOK.lift * 2, at.y * S);
        view.sheen.mesh.scale.setScalar(Math.max(1e-3, f.r * size * 2 * S * spread));
      }
    }
    view.root.visible = spread > 0;
    return view.goneMs === null || nowMs - view.goneMs < OIL_LOOK.soakMs;
  }

  private scatter(terrain: Terrain, f: GroundField, line: Vec | null, root: THREE.Group): Spike[] {
    const seed = hashId(f.id);
    const count = Math.round(FIELD_LOOK.baseSpikes + FIELD_LOOK.spikesPerArea * Math.PI * f.r * f.r);
    return Array.from({ length: count }, (_, i) => {
      const k = seed + i * 17;
      const p = line ? onLine(f, line, k) : onDisk(f, k);
      const mesh = new THREE.Mesh(this.spikeGeometry, this.spikeMaterial);
      const restY = heightAt(terrain, p.x, p.y) * S + (FIELD_LOOK.spike.height * S) / 2;
      mesh.position.set(p.x * S, restY, p.y * S);
      mesh.rotation.set((hash2(k, 7) - 0.5) * 0.8, hash2(k, 11) * Math.PI, (hash2(k, 13) - 0.5) * 0.8);
      root.add(mesh);
      return { mesh, restY, delayMs: hash2(k, 23) * FIELD_LOOK.fall.stagger };
    });
  }
}

function markGone(view: FieldView, shown: boolean, nowMs: number): void {
  if (shown) view.goneMs = null;
  else view.goneMs ??= nowMs;
}

function poseSpikes(view: FieldView, nowMs: number): boolean {
  const { fall, sink, spike } = FIELD_LOOK;
  let drawn = false;
  for (const s of view.spikes) {
    const landed = Math.min(1, Math.max(0, (nowMs - view.bornMs - s.delayMs) / fall.ms));
    const sunk = view.goneMs === null ? 0 : Math.min(1, Math.max(0, (nowMs - view.goneMs - s.delayMs) / sink.ms));
    s.mesh.visible = nowMs >= view.bornMs + s.delayMs && sunk < 1;
    s.mesh.position.y = s.restY + fall.height * S * (1 - landed * landed) - easeIn(sunk) * spike.height * S * sink.depth;
    drawn ||= sunk < 1;
  }
  return drawn;
}

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

function onLine(f: GroundField, dir: Vec, k: number): Vec {
  const along = (hash2(k, 3) - 0.5) * 2 * f.r;
  const across = ((hash2(k, 5) + hash2(k, 17) + hash2(k, 19) - 1.5) / 1.5) * f.r * FIELD_LOOK.across * 2;
  const shrink = Math.min(1, f.r / Math.max(1e-6, Math.hypot(along, across)));
  return { x: f.pos.x + (dir.x * along - dir.y * across) * shrink, y: f.pos.y + (dir.y * along + dir.x * across) * shrink };
}

function blobGeometry(terrain: Terrain, f: GroundField, seed: number, spread: number): THREE.BufferGeometry {
  const rim = Array.from({ length: OIL_LOOK.angles }, (_, i) => rimRadius(f.r, seed, (2 * Math.PI * i) / OIL_LOOK.angles) * spread);
  const positions = [...drape(terrain, f, 0, 0)];
  for (const share of OIL_LOOK.rings) rim.forEach((r, i) => positions.push(...drape(terrain, f, (2 * Math.PI * i) / OIL_LOOK.angles, r * share)));
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(blobIndices(OIL_LOOK.angles, OIL_LOOK.rings.length));
  return geometry;
}

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
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  ['rgba(120,90,200,0)', 'rgba(120,90,200,0.8)', 'rgba(60,170,190,0.8)', 'rgba(200,190,80,0.7)', 'rgba(210,90,120,0.5)', 'rgba(210,90,120,0)'].forEach((c, i, all) => g.addColorStop(i / (all.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const FLARE_ORDER = 906;
export const FLARE_LOOK = {
  height: 6,
  sink: 1,
  flightMs: 1600,
  igniteMs: 300,
  core: 0.5,
  halo: { size: 3, opacity: 0.75 },
  burst: { size: 4, ms: 300 },
  light: { intensity: 60, reach: 1.6, decay: 1 },
  flicker: { share: 0.25, speed: 6 },
  lastTurn: 0.55,
};
const FLARE_FLIGHT: FlightLook = { casing: PAL.flare.casing, length: 0.09, radius: 0.024, trail: PAL.flare.trail, trailPuffs: 10, trailLag: 0.04, trailSize: 0.55, trailOpacity: 0.5 };

type FlareView = { at: THREE.Vector3; shine: FlareShine | null; igniteMs: number; bornTurn: number; emit: { sparks: number; smoke: number } };
type FlareShine = { bright: number; haloScale: number; haloAlpha: number };

const FLARE_SPARK: ParticleLook = { life: 0.9, size: { from: 0.45, to: 0.12 }, colors: [0xfff4d0, 0xffb040, 0xff5014], alpha: { peak: 1, fadeIn: 0.05 }, drag: 0.6, gravity: 9, streak: 0.14, form: 'round' };
const FLARE_SMOKE: ParticleLook = { life: 4, size: { from: 1, to: 4 }, colors: [0xc89878, 0x9a928c, 0x6c6762], alpha: { peak: 0.4, fadeIn: 0.15 }, drag: 0.5, gravity: -0.9, streak: 0, form: 'cloud' };
const FLARE_FX = {
  sparks: { perSecond: 28, pool: 200, speed: { min: 1.5, spread: 3.5 }, up: 1.2, scale: { min: 0.6, spread: 0.8 } },
  smoke: { perSecond: 8, pool: 120, drift: 0.5, rise: 0.4, scale: { min: 0.8, spread: 0.4 } },
  views: 12,
  maxStepMs: 100,
};

class FlaresView {
  readonly root = new THREE.Group();
  private readonly views = new Map<string, FlareView>();
  private readonly flights = new FlightsView(FLARE_FLIGHT);
  private readonly lights: THREE.PointLight[] = [];
  private seenIn: World | null = null;
  private readonly nearby = liveNear(() => {
    if (!this.seenIn) throw new Error('A flare spawned particles before its first update');
    return this.seenIn;
  });
  private readonly sparks = new Particles(FLARE_FX.sparks.pool, this.nearby);
  private readonly smoke = new Particles(FLARE_FX.smoke.pool, this.nearby);
  private readonly color = new THREE.Color();
  private lastMs: number | null = null;

  constructor() {
    this.root.add(this.flights.root);
  }

  draw(cards: FxCards): void {
    this.flights.draw(cards);
    this.sparks.draw(cards.glow);
    this.smoke.draw(cards.lit);
    let drawn = 0;
    for (const view of this.views.values()) {
      if (!view.shine || drawn++ >= FLARE_FX.views) continue;
      const { bright, haloScale, haloAlpha } = view.shine;
      this.glow(cards, view.at, PAL.flare.halo, haloScale * S, haloAlpha);
      this.glow(cards, view.at, PAL.flare.core, FLARE_LOOK.core * S, bright);
    }
  }

  private glow(cards: FxCards, at: THREE.Vector3, hex: number, size: number, alpha: number): void {
    this.color.set(hex);
    cards.glow.push({ x: at.x, y: at.y, z: at.z, size, spin: 0, shape: ROUND_SHAPE, r: this.color.r, g: this.color.g, b: this.color.b, alpha, sx: 0, sy: 0, sz: 0 });
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null): void {
    const dt = this.lastMs === null ? 0 : Math.min(FLARE_FX.maxStepMs, Math.max(0, nowMs - this.lastMs)) / 1000;
    this.lastMs = nowMs;
    this.seenIn = world;
    this.sparks.tick(dt);
    this.smoke.tick(dt);
    const shown = new Map(world.flares.filter((f) => volleyShown(clock, 'flares', f.id) && flareShown(world, f)).map((f) => [f.id, f]));
    for (const [id] of this.views) if (!shown.has(id)) this.views.delete(id);
    while (this.lights.length < shown.size) this.addLight();
    this.lights.forEach((light) => (light.intensity = 0));
    const progress = clock ? clock.progress : 1;
    [...shown.values()].forEach((f, i) => {
      const view = this.views.get(f.id) ?? this.makeView(world, views, f, madeThisTurn(clock, 'flares', f.id), nowMs);
      this.place(terrain, view, this.lights[i], f, { nowMs, turn: world.turn, progress, dt });
    });
    this.flights.update(nowMs);
  }

  private addLight(): void {
    const light = new THREE.PointLight(PAL.flare.light, 0, 0, FLARE_LOOK.light.decay);
    this.lights.push(light);
    this.root.add(light);
  }

  private makeView(world: World, views: ReadonlyMap<string, VehicleView>, f: Flare, fresh: boolean, nowMs: number): FlareView {
    const shot = fresh ? launchOf(world, 'flare', f.source, f.pos) : null;
    if (shot) {
      const top = groundPoint(world.terrain, f.pos);
      top.y += FLARE_LOOK.height * S;
      const from = launchPoint(world, views, shot, f.pos);
      this.flights.launch(new Flight(from, top, (top.y - from.y) / 4, FLARE_LOOK.flightMs, nowMs));
    }
    const view = { at: new THREE.Vector3(), shine: null, igniteMs: shot ? nowMs + FLARE_LOOK.flightMs : -Infinity, bornTurn: world.turn, emit: { sparks: 0, smoke: 0 } };
    this.views.set(f.id, view);
    return view;
  }

  private place(terrain: Terrain, view: FlareView, light: THREE.PointLight, f: Flare, at: { nowMs: number; turn: number; progress: number; dt: number }): void {
    const lit = Math.min(1, Math.max(0, (at.nowMs - view.igniteMs) / FLARE_LOOK.igniteMs));
    const burst = lit > 0 ? 1 - Math.min(1, (at.nowMs - view.igniteMs) / FLARE_LOOK.burst.ms) : 0;
    const wave = 1 - FLARE_LOOK.flicker.share * valueNoise((at.nowMs / 1000) * FLARE_LOOK.flicker.speed, hashId(f.id) % 97);
    const bright = lit * wave * (f.turnsLeft <= 1 ? FLARE_LOOK.lastTurn : 1);
    const sunk = Math.max(0, at.turn - view.bornTurn - 1 + at.progress) * FLARE_LOOK.sink;
    const { halo, burst: wide } = FLARE_LOOK;
    view.at.set(f.pos.x * S, (heightAt(terrain, f.pos.x, f.pos.y) + FLARE_LOOK.height - sunk) * S, f.pos.y * S);
    view.shine = lit > 0 ? { bright, haloScale: halo.size + (wide.size - halo.size) * burst, haloAlpha: halo.opacity * bright + (1 - halo.opacity) * burst } : null;
    if (lit > 0) this.emit(view, bright, at.dt);
    light.intensity = FLARE_LOOK.light.intensity * bright * (1 + burst);
    light.distance = f.r * FLARE_LOOK.light.reach * S;
    light.position.copy(view.at);
  }

  private emit(view: FlareView, bright: number, dt: number): void {
    const { sparks, smoke } = FLARE_FX;
    view.emit.sparks += sparks.perSecond * bright * dt;
    view.emit.smoke += smoke.perSecond * dt;
    for (; view.emit.sparks >= 1; view.emit.sparks--) {
      const a = Math.random() * Math.PI * 2;
      const speed = sparks.speed.min + Math.random() * sparks.speed.spread;
      const vel = { x: Math.cos(a) * speed, y: sparks.up * (Math.random() - 0.3) * speed, z: Math.sin(a) * speed };
      this.sparks.spawn(view.at, vel, FLARE_SPARK, sparks.scale.min + Math.random() * sparks.scale.spread);
    }
    for (; view.emit.smoke >= 1; view.emit.smoke--) {
      const vel = { x: (Math.random() - 0.5) * smoke.drift, y: smoke.rise, z: (Math.random() - 0.5) * smoke.drift };
      this.smoke.spawn(view.at, vel, FLARE_SMOKE, smoke.scale.min + Math.random() * smoke.scale.spread);
    }
  }
}

function flareShown(world: World, f: Flare): boolean {
  return f.source === world.player.vehicleId || dist(playerVehicle(world).pos, f.pos) <= FLARE.seenRange;
}

const PULSE_ORDER = 906;
const PULSE_LOOK = {
  ms: 600,
  flash: 3.5,
  rise: 1.2,
  segments: 9,
  jitter: 0.9,
  strands: 2,
  sparks: 10,
  sparkSize: 0.12,
  sparkReach: 1.4,
  sparkHeight: 2.2,
  sparkStreak: 0.7,
  crackleMs: 90,
  strandSparks: [2, 4, 6],
  strandStreak: 0.5,
  maxZaps: 4,
  maxArcs: 4,
  maxShut: 6,
};

type PulseEvent = Extract<GameEvent, { t: 'pulse' }>;
type Strand = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
const NO_STREAK = new THREE.Vector3();
type Flash = { at: THREE.Vector3; size: number; alpha: number };
type Zap = { e: PulseEvent; flash: Flash; arcs: { to: string; strands: Strand[] }[]; startMs: number };
type Crackle = { spots: { at: THREE.Vector3; streak: THREE.Vector3 }[]; nextMs: number };

class PulseView {
  readonly root = new THREE.Group();
  private readonly zaps: Zap[] = [];
  private played = new Set<string>();
  private turn = -1;
  private readonly sparks = new Map<string, Crackle>();
  private readonly color = new THREE.Color();

  draw(cards: FxCards): void {
    for (const zap of this.zaps.slice(0, PULSE_LOOK.maxZaps)) {
      this.spark(cards, zap.flash.at, PAL.pulse.flash, zap.flash.size, zap.flash.alpha, NO_STREAK);
      for (const arc of zap.arcs.slice(0, PULSE_LOOK.maxArcs)) this.strandSparks(cards, arc.strands[0], zap.flash.alpha);
    }
    for (const crackle of [...this.sparks.values()].slice(0, PULSE_LOOK.maxShut)) {
      for (const spot of crackle.spots) this.spark(cards, spot.at, PAL.pulse.spark, PULSE_LOOK.sparkSize * S, 1, spot.streak);
    }
  }

  private strandSparks(cards: FxCards, strand: Strand, alpha: number): void {
    if (!strand.visible) return;
    const at = strand.geometry.getAttribute('position');
    const point = new THREE.Vector3();
    const streak = new THREE.Vector3();
    for (const i of PULSE_LOOK.strandSparks) {
      point.fromBufferAttribute(at, i);
      streak.fromBufferAttribute(at, i + 1).sub(new THREE.Vector3().fromBufferAttribute(at, i - 1)).multiplyScalar(PULSE_LOOK.strandStreak);
      this.spark(cards, point, PAL.pulse.spark, PULSE_LOOK.sparkSize * S, alpha, streak);
    }
  }

  private spark(cards: FxCards, at: THREE.Vector3, hex: number, size: number, alpha: number, streak: THREE.Vector3): void {
    this.color.set(hex);
    cards.glow.push({ x: at.x, y: at.y, z: at.z, size, spin: 0, shape: ROUND_SHAPE, r: this.color.r, g: this.color.g, b: this.color.b, alpha, sx: streak.x, sy: streak.y, sz: streak.z });
  }

  update(world: World, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number, clock: TurnClock | null): void {
    if (clock === null || clock.moved) this.startZaps(world, nowMs);
    for (const zap of [...this.zaps]) this.play(zap, terrain, views, nowMs);
    this.crackle(world, views, nowMs);
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
    const flash = { at: new THREE.Vector3(), size: 0, alpha: 0 };
    const arcs = e.hit.map((to) => ({ to, strands: Array.from({ length: PULSE_LOOK.strands }, () => makeStrand()) }));
    this.root.add(...arcs.flatMap((a) => a.strands));
    return { e, flash, arcs, startMs: nowMs };
  }

  private play(zap: Zap, terrain: Terrain, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    const t = (nowMs - zap.startMs) / PULSE_LOOK.ms;
    if (t >= 1) return this.end(zap);
    const from = zapPoint(userPoint(zap.e, terrain, views));
    zap.flash.at.set(from.x, from.y, from.z);
    zap.flash.size = PULSE_LOOK.flash * S * (0.6 + 0.6 * t);
    zap.flash.alpha = 1 - t;
    for (const arc of zap.arcs) {
      const target = views.get(arc.to);
      for (const strand of arc.strands) jag(strand, from, target ? zapPoint(target.center()) : null, 1 - t);
    }
  }

  private end(zap: Zap): void {
    const strands = zap.arcs.flatMap((a) => a.strands);
    this.root.remove(...strands);
    for (const s of strands) {
      s.geometry.dispose();
      s.material.dispose();
    }
    this.zaps.splice(this.zaps.indexOf(zap), 1);
  }

  private crackle(world: World, views: ReadonlyMap<string, VehicleView>, nowMs: number): void {
    const shut = shutDownViews(world, views);
    for (const id of this.sparks.keys()) if (!shut.has(id)) this.sparks.delete(id);
    for (const [id, view] of shut) {
      const crackle = this.sparks.get(id) ?? this.makeCrackle();
      this.sparks.set(id, crackle);
      if (nowMs >= crackle.nextMs) {
        jump(crackle, view.center());
        crackle.nextMs = nowMs + PULSE_LOOK.crackleMs;
      }
    }
  }

  private makeCrackle(): Crackle {
    const spots = Array.from({ length: PULSE_LOOK.sparks }, () => ({ at: new THREE.Vector3(), streak: new THREE.Vector3() }));
    return { spots, nextMs: -Infinity };
  }
}

function makeStrand(): Strand {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(PULSE_LOOK.segments * 3), 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: PAL.pulse.arc, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  line.renderOrder = PULSE_ORDER;
  line.frustumCulled = false;
  return line;
}

function userPoint(e: PulseEvent, terrain: Terrain, views: ReadonlyMap<string, VehicleView>): V3 {
  const view = views.get(e.vehicle);
  return view ? view.center() : groundPoint(terrain, e.pos);
}

function zapPoint(p: V3): V3 {
  return { x: p.x, y: p.y + PULSE_LOOK.rise, z: p.z };
}

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

function shutDownViews(world: World, views: ReadonlyMap<string, VehicleView>): Map<string, VehicleView> {
  const shut = new Map<string, VehicleView>();
  for (const v of world.vehicles) {
    const view = views.get(v.id);
    if (view && shutDownTurnsLeft(world, v) > 0) shut.set(v.id, view);
  }
  return shut;
}

function pulseShown(world: World, e: PulseEvent): boolean {
  const me = world.player.vehicleId;
  if (e.vehicle === me || e.hit.includes(me) || playerSees(world, e.pos)) return true;
  return e.hit.some((id) => {
    const v = world.vehicles.find((x) => x.id === id);
    return v !== undefined && playerSees(world, v.pos);
  });
}

function jump(crackle: Crackle, at: { x: number; y: number; z: number }): void {
  for (const spot of crackle.spots) {
    const a = Math.random() * 2 * Math.PI;
    const r = Math.random() * PULSE_LOOK.sparkReach;
    spot.at.set(at.x + Math.cos(a) * r, at.y + PULSE_LOOK.sparkHeight * Math.random(), at.z + Math.sin(a) * r);
    const b = Math.random() * 2 * Math.PI;
    spot.streak.set(Math.cos(b), Math.random() - 0.3, Math.sin(b)).multiplyScalar(PULSE_LOOK.sparkStreak);
  }
}
