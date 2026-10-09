// Static map obstacles: rocks, wrecks, buildings, water and baked landmarks. Map rocks are drawn once
// as an instanced model per terrain chunk, and dead trees likewise through TreeInstances, which hides a broken tree.
// Other obstacles are synced by id, so wrecks that appear mid-game (a vehicle dying) get added without touching the

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashStr } from '../../render/noise';
import { PAL } from '../../render/palette';
import { PHYSICS } from '../../data/physics';
import { propPose, propReach, type PropPose } from '../../sim/mapgen';
import { propBase } from '../../sim/bridge';
import { bodyOf } from '../../sim/body';
import { baseModel, grayed, HULK_TILT, HULK_TONE, WEAR_LOOK_STEPS } from '../../render/partLooks';
import { heightAt, type Terrain } from '../../sim/terrain';
import { hasSalvage, salvageUnits } from '../../sim/salvage';
import type { BrokenProp, Obstacle, SalvageStock, World } from '../../sim/types';
import { dist } from '../../sim/vec';
import type { V3, VehicleFrame } from '../../phys/frames';
import type { TurnResult } from '../../phys/drive';
import { DebrisSim, disposeTree, FLY_REACH, truckBoxes } from './debris';
import { jag } from './vehicle';
import { instancedModel, model, socket } from './models';
import { NIGHT_POOLS } from './lightPools';
import { FORT_MODELS } from '../../sim/fortress';
import { PartDebris } from './partDebris';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';
import { posed, TreeInstances } from './trees';

const S = PHYSICS.metersPerTile;
const CRATES_RADIUS = 1.5;
const PILE_FULL_UNITS = 20;
const PILE_MIN_SIZE = 0.5;

export class ObstacleViews {
  private readonly byId = new Map<string, THREE.Object3D>();
  private fixed: Fixed | null = null;
  private readonly piles = new Map<string, { obj: THREE.Object3D; units: number }>();
  private readonly debris = new Map<string, THREE.Object3D>();
  private readonly flying: DebrisSim;
  readonly parts: PartDebris;
  private obstacles: readonly Obstacle[] = [];
  private readonly glows = new Map<string, Glow>();
  private clock = 0;

  constructor(private readonly scope: RenderScope, private readonly terrain: Terrain) {
    this.flying = new DebrisSim(terrain);
    this.parts = new PartDebris(scope, terrain);
  }

  sync(obstacles: Obstacle[], salvage: SalvageStock[], broken: readonly BrokenProp[]): void {
    this.obstacles = obstacles;
    this.syncDebris(broken);
    this.syncPiles(salvage);
    const fixed = this.fixed ?? this.addFixed(obstacles);
    syncRocks(fixed.rocks, obstacles);
    syncTrees(fixed, obstacles);
    const views = obstacles.filter((o) => o.kind !== 'rock' && !isTree(o));
    for (const o of views) if (!this.byId.has(o.id)) this.addView(o);
    const seen = new Set(views.map((o) => o.id));
    for (const [id, obj] of this.byId) {
      if (seen.has(id)) continue;
      this.scope.remove(obj);
      disposeTree(obj);
      this.byId.delete(id);
      this.glows.delete(id);
    }
  }

  private addFixed(obstacles: Obstacle[]): Fixed {
    const trees = obstacles.filter(isTree);
    this.fixed = {
      rocks: this.addRocks(obstacles.filter((o) => o.kind === 'rock')),
      trees: new TreeInstances(this.scope, this.terrain, trees),
      treeIds: new Set(trees.map((o) => o.id)),
    };
    addPowerLines(this.terrain, obstacles, this.scope);
    return this.fixed;
  }

  private addView(o: Obstacle): void {
    const obj = buildObstacle(this.terrain, o);
    obj.traverse((m) => {
      m.updateMatrix();
      m.matrixAutoUpdate = false;
    });
    this.scope.add(obj, o.pos, viewReach(o));
    this.byId.set(o.id, obj);
    if (obj.userData.glow) this.glows.set(o.id, obj.userData.glow as Glow);
  }

  play(anim: { result: TurnResult } | null, step: number | null, world: World, frames: Record<string, VehicleFrame>, dt: number): void {
    if (anim) this.smash(anim.result, step ?? Infinity, world.broken);
    const trucks = truckBoxes(world.vehicles, frames);
    this.flying.moveTrucks(trucks);
    this.flying.step(dt);
    this.parts.play(trucks, dt);
    this.pulse(dt);
  }

  private pulse(dt: number): void {
    this.clock += dt;
    const k = 1 + REACTOR_PULSE.share * Math.sin((this.clock / REACTOR_PULSE.period) * Math.PI * 2);
    for (const glow of this.glows.values()) {
      for (const m of glow.materials) m.emissiveIntensity = REACTOR_GLOW.emissive * k;
      glow.light.intensity = REACTOR_GLOW.intensity * k;
    }
  }

  private smash(result: TurnResult, step: number, broken: readonly BrokenProp[]): void {
    for (const b of result.breaks) {
      if (b.step > step || this.debris.has(b.prop)) continue;
      const found = broken.find((p) => p.obstacle.id === b.prop);
      if (!found) throw new Error(`Prop ${b.prop} broke this turn but is not broken`);
      this.dropStanding(b.prop);
      this.addDebris(found.obstacle, this.flying.burst(found.obstacle, velocityAt(result.frames[b.vehicle], b.step), this.obstacles));
    }
  }

  private dropStanding(id: string): void {
    if (this.fixed?.trees.has(id)) {
      this.fixed.trees.hide(id);
      return;
    }
    const standing = this.byId.get(id);
    if (!standing) return;
    this.scope.remove(standing);
    disposeTree(standing);
    this.byId.delete(id);
  }

  private syncDebris(broken: readonly BrokenProp[]): void {
    const ids = new Set(broken.map((b) => b.obstacle.id));
    for (const [id, obj] of this.debris) {
      if (ids.has(id)) continue;
      this.scope.remove(obj);
      disposeTree(obj);
      this.debris.delete(id);
    }
    const fresh = broken.filter(({ obstacle }) => !this.debris.has(obstacle.id));
    if (fresh.length === 0) return;
    const sim = new DebrisSim(this.terrain);
    for (const { obstacle } of fresh) this.addDebris(obstacle, sim.burst(obstacle, null, this.obstacles));
    sim.settle();
    sim.free();
  }

  private addDebris(o: Obstacle, pieces: THREE.Group): void {
    pieces.matrixAutoUpdate = false;
    this.scope.add(pieces, o.pos, propReach(o) + FLY_REACH / S);
    this.debris.set(o.id, pieces);
  }

  private syncPiles(salvage: SalvageStock[]): void {
    const shown = salvage.filter((stock) => stock.pile && hasSalvage(stock));
    const ids = new Set(shown.map((stock) => stock.id));
    for (const [id, pile] of this.piles) {
      if (ids.has(id)) continue;
      this.scope.remove(pile.obj);
      disposeTree(pile.obj);
      this.piles.delete(id);
    }
    for (const stock of shown) {
      const pile = this.piles.get(stock.id) ?? this.addPile(stock);
      const units = salvageUnits(stock);
      if (pile.units === units) continue;
      pile.units = units;
      pile.obj.scale.setScalar(Math.max(PILE_MIN_SIZE, Math.min(1, Math.sqrt(units / PILE_FULL_UNITS))));
      pile.obj.traverse((o) => o.updateMatrix());
    }
  }

  private addPile(stock: SalvageStock): { obj: THREE.Object3D; units: number } {
    const obj = model('crates');
    obj.position.set(stock.pos.x * S, heightAt(this.terrain, stock.pos.x, stock.pos.y) * S, stock.pos.y * S);
    obj.rotation.y = hashStr(stock.id) * Math.PI * 2;
    obj.traverse((o) => (o.matrixAutoUpdate = false));
    const pile = { obj, units: 0 };
    this.scope.add(obj, stock.pos, CRATES_RADIUS / S);
    this.piles.set(stock.id, pile);
    return pile;
  }

  private addRocks(rocks: Obstacle[]): Set<string> {
    const byChunk = new Map<string, Obstacle[]>();
    for (const o of rocks) {
      const key = `${Math.floor(o.pos.x / TERRAIN_CHUNK)},${Math.floor(o.pos.y / TERRAIN_CHUNK)}`;
      const list = byChunk.get(key);
      if (list) list.push(o);
      else byChunk.set(key, [o]);
    }
    for (const list of byChunk.values()) {
      const placed = list.map((o) => rockPlacement(this.terrain, o));
      const group = instancedModel('rock', placed.map((p) => p.matrix), placed.map((p) => p.tint));
      const center = list.reduce((c, o) => ({ x: c.x + o.pos.x / list.length, y: c.y + o.pos.y / list.length }), { x: 0, y: 0 });
      const reach = Math.max(...list.map((o) => dist(center, o.pos) + propReach(o)));
      this.scope.add(group, center, reach);
    }
    return new Set(rocks.map((o) => o.id));
  }
}

function viewReach(o: Obstacle): number {
  return o.kind === 'water' || o.kind === 'site' ? o.r : propReach(o);
}

function velocityAt(frames: VehicleFrame[] | undefined, step: number): V3 {
  if (!frames || frames.length < 2) throw new Error(`Break at step ${step} by a truck with no turn frames`);
  const a = frames[Math.max(0, step - 1)].pos;
  const b = frames[Math.min(frames.length - 1, step + 1)].pos;
  const k = PHYSICS.stepsPerSecond / (Math.min(frames.length - 1, step + 1) - Math.max(0, step - 1));
  return { x: (b.x - a.x) * k, y: (b.y - a.y) * k, z: (b.z - a.z) * k };
}

function buildObstacle(t: Terrain, o: Obstacle): THREE.Object3D {
  if (o.kind === 'water') return buildWater(t, o);
  if (o.kind === 'site') return new THREE.Group();
  return buildProp(t, o);
}

function seat(t: Terrain, o: Obstacle): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.pos.x * S, propBase(t, o) * S, o.pos.y * S);
  return g;
}

function rockPlacement(t: Terrain, o: Obstacle): { matrix: THREE.Matrix4; tint: number } {
  const g = posed(propBase(t, o), propPose(o));
  g.updateMatrix();
  return { matrix: g.matrix, tint: 0.9 + hashStr(o.id) * 0.2 };
}

function buildProp(t: Terrain, o: Obstacle): THREE.Object3D {
  const pose = propPose(o);
  if (pose.model === 'hulk') return buildHulk(t, o, pose);
  const g = posed(propBase(t, o), pose);
  const obj = model(pose.model);
  if (FORT_PIECE_MODELS.has(pose.model)) lightFortPiece(obj);
  if (pose.model === 'building') paintRoof(obj, o.id);
  g.add(obj);
  paintShipGlow(obj);
  if (pose.model === 'reactor') lightCore(obj, g);
  return g;
}

const FORT_PIECE_MODELS: ReadonlySet<string> = new Set([...FORT_MODELS.values()].map((f) => f.model));

function lightFortPiece(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) for (const material of Array.isArray(o.material) ? o.material : [o.material]) NIGHT_POOLS.light(material);
  });
}

export type HulkPose = Extract<PropPose, { model: 'hulk' }>;

export function buildHulk(t: Terrain, o: Obstacle, pose: HulkPose): THREE.Group {
  const g = posed(propBase(t, o), pose);
  const obj = model(baseModel(pose.chassisId));
  char(obj);
  jag(obj, o.id, WEAR_LOOK_STEPS);
  obj.position.y = bodyOf(pose.chassisId).half.y;
  obj.rotation.set((hashStr(`${o.id}:roll`) * 2 - 1) * HULK_TILT, 0, (hashStr(`${o.id}:pitch`) * 2 - 1) * HULK_TILT);
  g.add(obj);
  return g;
}

function char(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material;
    if (!(mat instanceof THREE.MeshLambertMaterial)) throw new Error(`Hulk mesh ${o.name} has material ${mat.type}, expected one Lambert material`);
    mat.color.setHex(grayed(mat.color.getHex(), 1)).multiplyScalar(HULK_TONE);
    mat.emissive.setHex(0x000000);
  });
}

function lightCore(reactor: THREE.Object3D, g: THREE.Group): void {
  const materials: THREE.MeshLambertMaterial[] = [];
  eachMaterial(reactor, (m) => {
    if (m.name !== 'glow') return;
    m.emissive.setHex(PAL.reactorGlow);
    m.emissiveIntensity = REACTOR_GLOW.emissive;
    materials.push(m);
  });
  const light = new THREE.PointLight(PAL.reactorLight, REACTOR_GLOW.intensity, REACTOR_GLOW.range, REACTOR_GLOW.decay);
  light.position.set(0, REACTOR_GLOW.height, 0);
  g.add(light);
  const glow: Glow = { materials, light };
  g.userData.glow = glow;
}

export function paintShipGlow(obj: THREE.Object3D): void {
  eachMaterial(obj, (m) => {
    if (m.name !== 'ship_glow') return;
    m.emissive.setHex(PAL.shipGlow);
    m.emissiveIntensity = SHIP_GLOW.emissive;
    m.color.multiplyScalar(SHIP_GLOW.base);
  });
}

function paintRoof(house: THREE.Object3D, id: string): void {
  const roof = PAL.roof[Math.floor(hashStr(id) * 97) % PAL.roof.length];
  eachMaterial(house, (m) => {
    if (m.name === 'roof') m.color.setHex(roof);
  });
}

function eachMaterial(obj: THREE.Object3D, fn: (m: THREE.MeshLambertMaterial) => void): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) fn(m as THREE.MeshLambertMaterial);
  });
}

function buildWater(t: Terrain, o: Obstacle): THREE.Object3D {
  const r = o.r * S;
  const g = seat(t, o);
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 24), new THREE.MeshLambertMaterial({ color: PAL.water }));
  pond.position.y = 0.1;
  pond.receiveShadow = true;
  g.add(pond);
  return g;
}

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

function isTree(o: Obstacle): o is Landmark {
  return o.kind === 'landmark' && o.look === 'deadTree';
}

type Fixed = { rocks: Set<string>; trees: TreeInstances; treeIds: Set<string> };

function syncRocks(ids: Set<string>, obstacles: readonly Obstacle[]): void {
  const rocks = obstacles.filter((o) => o.kind === 'rock');
  for (const o of rocks) if (!ids.has(o.id)) throw new Error(`Rock ${o.id} appeared after map generation; rocks are drawn as fixed instances`);
  if (rocks.length !== ids.size) throw new Error('A map rock was removed; rocks are drawn as fixed instances');
}

function syncTrees(fixed: Fixed, obstacles: readonly Obstacle[]): void {
  const standing = new Set(obstacles.filter(isTree).map((o) => o.id));
  for (const id of standing) fixed.trees.show(id);
  for (const id of fixed.treeIds) if (!standing.has(id)) fixed.trees.hide(id);
}

const REACTOR_GLOW = { emissive: 2.2, intensity: 500, range: 40, decay: 1.5, height: 8 };
const SHIP_GLOW = { emissive: 1.0, base: 0.2 };
const REACTOR_PULSE = { share: 0.2, period: 5 };
type Glow = { materials: THREE.MeshLambertMaterial[]; light: THREE.PointLight };
const WIRES = ['wire0', 'wire1', 'wire2'];
const SAG = 0.7;
const WIRE_POINTS = 8;

export function addPowerLines(t: Terrain, obstacles: Obstacle[], scope: RenderScope): void {
  const poles = new Map(obstacles.filter((o): o is Landmark => o.kind === 'landmark' && o.look === 'pole').map((o) => [o.id, o]));
  const material = new THREE.MeshLambertMaterial({ color: PAL.wheel });
  for (const a of poles.values()) {
    const b = poles.get(nextId(a.id));
    if (!b) continue;
    const ends = [a, b].map((p) => buildProp(t, p));
    for (const e of ends) e.updateMatrixWorld(true);
    const spans = WIRES.map((w) => span(socket('power_pole', w).applyMatrix4(ends[0].matrixWorld), socket('power_pole', w).applyMatrix4(ends[1].matrixWorld)));
    const mesh = new THREE.Mesh(mergeGeometries(spans), material);
    scope.add(mesh, { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }, dist(a.pos, b.pos) / 2 + 1);
  }
}

function nextId(id: string): string {
  const cut = id.lastIndexOf('-');
  return `${id.slice(0, cut)}-${Number(id.slice(cut + 1)) + 1}`;
}

function span(from: THREE.Vector3, to: THREE.Vector3): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= WIRE_POINTS; i++) {
    const k = i / WIRE_POINTS;
    points.push(from.clone().lerp(to, k).add(new THREE.Vector3(0, -SAG * 4 * k * (1 - k), 0)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), WIRE_POINTS, 0.05, 3, false);
}
