// Town and location models. Buildings that block movement are obstacles already (see obstacles.ts),
// so nothing here blocks. Blender models come from tools/blender/; each script's docstring gives its size.

import * as THREE from 'three';
import { REGION, type SiteLocationDef, type SiteEdge, type TownDef } from '../../data/region';
import { FORTRESS_SITES, FORTRESS_STYLES } from '../../data/fortress';
import { fortressGates, insideCurtain, onFortressRock, type FortGate } from '../../sim/fortress';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { isFortress, siteGates } from '../../sim/sites';
import { deckById, deckCenterAt, type Deck } from '../../sim/bridge';
import { deckSegments, heightAt, type DeckSegment, type Terrain } from '../../sim/terrain';
import { angleDiff, segmentDist } from '../../sim/vec';
import { instancedModel, model, type ModelName } from './models';
import type { RenderScope } from './scope';
import { SiteMotion, type Motion } from './site-motion';
import { buildBowl } from './interiors/bowl';
import { buildDustwell, buildGranary, buildSalvageYard } from './interiors/compounds';
import { buildNose } from './interiors/nose';
import { SITE_LIGHT_POOL, type SiteLight, type SiteLightKind } from './siteLights';

const S = PHYSICS.metersPerTile;
type Site = TownDef | SiteLocationDef;
const BRIDGE_RISE = 1.5;
const BRIDGE_DECK_TOP = 0.8;
const WING_DECK_LENGTH = 156;
const WING_DECK_WIDTH = 24;

export type Mover = { node: THREE.Object3D; motion: Motion };
type Fixture = { kind: SiteLightKind; head: THREE.Object3D; home: THREE.Vector3; aim: { x: number; z: number; lift?: number }; color?: number };
const MOTION_PHASE_SPAN = 60;

export class SiteBuilder {
  readonly root = new THREE.Group();
  readonly movers: Mover[] = [];
  readonly fixtures: Fixture[] = [];
  private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
  constructor(private readonly terrain: Terrain, readonly site: Site) {
    this.root.name = `landmark-${site.id}`;
  }
  groundAt(x: number, z: number): number {
    return heightAt(this.terrain, this.site.pos.x + x, this.site.pos.y + z);
  }
  private material(color: number): THREE.MeshLambertMaterial {
    let material = this.materials.get(color);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color, flatShading: true });
      if (color === PAL.lamp.on) material.emissive.setHex(color);
      this.materials.set(color, material);
    }
    return material;
  }
  addShape(geometry: THREE.BufferGeometry, color: number, x: number, z: number, lift: number, yaw = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material(color));
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    mesh.position.set(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }
  addDoor(x: number, z: number, length: number, height: number, thickness: number, color: number, yaw: number): THREE.Group {
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    const door = new THREE.Group();
    door.name = 'door';
    door.position.set(wx * S, (heightAt(this.terrain, wx, wz) - SINK) * S, wz * S);
    door.rotation.y = yaw;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(length * S, (height + SINK) * S, thickness * S), this.material(color));
    leaf.position.set((length / 2) * S, ((height + SINK) / 2) * S, 0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    door.add(leaf);
    this.root.add(door);
    return door;
  }
  addBox(x: number, z: number, w: number, h: number, d: number, color: number, lift = 0, yaw = 0): THREE.Mesh {
    return this.addShape(new THREE.BoxGeometry(w * S, h * S, d * S), color, x, z, lift + h / 2, yaw);
  }
  addTank(x: number, z: number, radius: number, height: number, color: number, lift = 0): void {
    this.addShape(new THREE.CylinderGeometry(radius * S, radius * S, height * S, 10), color, x, z, lift + height / 2);
  }
  addLampHead(x: number, z: number, top: number, yaw: number): THREE.Mesh {
    this.addBox(x, z, 0.2, 0.35, 0.6, PAL.metal, top, yaw);
    return this.addBox(x, z, 0.24, 0.22, 0.45, PAL.lamp.on, top + 0.06, yaw);
  }
  // A pole with a lamp head on top. Everything stands at x, z so that pullInside() moves pole and head together.
  addMast(x: number, z: number, height: number, yaw: number): THREE.Mesh {
    this.addBox(x, z, 0.18, height + SINK, 0.18, PAL.metal, -SINK, yaw);
    return this.addLampHead(x, z, height, yaw);
  }
  addWorkLight(kind: SiteLightKind, x: number, z: number, height: number, aim: { x: number; z: number; lift?: number }, color: number): void {
    this.addLight(kind, this.addMast(x, z, height, 0), aim, color);
  }
  addWash(reach: number, color: number): void {
    this.addWorkLight('wash', WASH.mast * reach, WASH.mast * reach, WORK_MAST, { x: -WASH.aim * reach, z: -WASH.aim * reach, lift: WASH.lift }, color);
  }
  // Registers a work light at a lamp head. The aim is a ground point in site tiles, relative to the site centre.
  addLight(kind: SiteLightKind, head: THREE.Object3D, aim: { x: number; z: number; lift?: number }, color?: number): void {
    let root: THREE.Object3D | null = head;
    while (root && root !== this.root) root = root.parent;
    if (!root) throw new Error(`Light head of ${this.site.id} is not inside its site root`);
    this.fixtures.push({ kind, head, home: head.position.clone(), aim, color });
  }
  addMover(node: THREE.Object3D, motion: Motion): void {
    if (this.movers.some((m) => m.node === node)) throw new Error(`Moving part ${node.name || node.uuid} of ${this.site.id} was added twice`);
    this.movers.push({ node, motion });
  }
  addModel(name: ModelName, x: number, z: number, yaw = 0, scale: number | THREE.Vector3 = 1, lift = 0): THREE.Object3D {
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    const obj = model(name);
    obj.position.set(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
    obj.rotation.y = yaw;
    if (typeof scale === 'number') obj.scale.setScalar(scale);
    else obj.scale.copy(scale);
    this.root.add(obj);
    return obj;
  }
  addInstances(name: ModelName, spots: { x: number; z: number; yaw: number; scale?: number; lift?: number }[]): THREE.Group {
    const placements = spots.map(({ x, z, yaw, scale = 1, lift = 0 }) => {
      const wx = this.site.pos.x + x;
      const wz = this.site.pos.y + z;
      const pos = new THREE.Vector3(wx * S, (heightAt(this.terrain, wx, wz) + lift) * S, wz * S);
      return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(scale, scale, scale));
    });
    const group = instancedModel(name, placements, placements.map(() => 1));
    this.root.add(group);
    return group;
  }
  offRoad(x: number, z: number, clearance: number): void {
    const pos = { x: this.site.pos.x + x, y: this.site.pos.y + z };
    if (REGION.roads.some((road) => road.some((point, i) => i > 0 && segmentDist(pos, road[i - 1], point) < REGION.roadWidth / 2 + clearance))) {
      throw new Error(`Site prop at ${x},${z} of ${this.site.id} stands on a road`);
    }
  }
  addRuin(x: number, z: number, width: number, depth: number): void {
    this.addBox(x, z, width, 0.12, depth, PAL.wall.dark);
    this.addBox(x - width / 2, z, 0.2, 1.2, depth, PAL.wall.side);
    this.addBox(x, z - depth / 2, width, 0.85, 0.2, PAL.wall.top);
    this.addBox(x + width / 2, z - depth / 3, 0.2, 0.55, depth / 3, PAL.wall.side);
    this.addBox(x + 0.3, z + 0.3, width * 0.7, 0.12, depth * 0.8, PAL.rust.top, 0.08, 0.35);
  }
  addHull(x: number, z: number, length: number, width: number, yaw: number): void {
    this.addBox(x, z, length, 0.3, width, PAL.metal, 0.1, yaw);
    for (let i = 0; i < 5; i++) {
      const along = (i / 4 - 0.5) * length;
      for (const side of [-1, 1]) {
        const dx = along * Math.cos(yaw) + side * width * 0.42 * Math.sin(yaw);
        const dz = -along * Math.sin(yaw) + side * width * 0.42 * Math.cos(yaw);
        const rib = this.addBox(x + dx, z + dz, 0.16, width * 0.65, 0.18, PAL.metalLight, 0.25, yaw);
        rib.rotation.x = side * 0.25;
      }
    }
    const shell = new THREE.CylinderGeometry(width * 0.5 * S, width * 0.42 * S, length * 0.72 * S, 8, 1, true, 0, Math.PI * 1.55).rotateZ(Math.PI / 2);
    const hull = this.addShape(shell, PAL.metalLight, x, z, width * 0.4, yaw);
    (hull.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      this.addBox(x, z + side * width * 0.42, length * 0.68, 0.12, 0.2, PAL.rust.top, width * 0.55, yaw);
    }
    for (let i = -1; i <= 1; i++) {
      this.addBox(x + i * length * 0.2, z, 0.2, 0.22, width * 0.7, PAL.metal, width * 0.88, yaw);
      this.addBox(x + i * length * 0.3, z - width * 0.6, length * 0.12, 0.12, width * 0.3, PAL.metalLight, 0.15, yaw + i * 0.4);
    }
  }
}

export function fitsCurtain(site: Site, x: number, z: number, w: number, d: number): boolean {
  return [-1, 1].every((i) => [-1, 1].every((j) => insideCurtain(site, { x: site.pos.x + x + (i * w) / 2, y: site.pos.y + z + (j * d) / 2 })));
}

type WallStyle = {
  height: number;
  thickness: number;
  segment: number;
  ragged: boolean;
  fence: boolean;
  colors: number[];
  postColor: number;
  doorColor: number;
};

const SET = REGION.settlement;
const EDGE_STYLES: Record<SiteEdge, WallStyle> = {
  fence: { height: SET.fenceHeight, thickness: SET.fenceThickness, segment: SET.fenceSegment, ragged: false, fence: true, colors: [PAL.trunk], postColor: PAL.trunk, doorColor: PAL.metal },
  wrecks: { height: SET.wreckHeight, thickness: SET.wreckThickness, segment: SET.wreckSegment, ragged: true, fence: false, colors: [PAL.rust.side, PAL.metal, PAL.rust.dark], postColor: PAL.rust.dark, doorColor: PAL.metal },
};
const LAMP_REACH = 0.3;
const SINK = 0.3;
const DOOR_THICKNESS = 0.4;
const GATE_APRON_AIM = 2.5;
const WORK_MAST = 3.3;
const FIRE_MAST = 0.7;
const WASH = { mast: 2.4, aim: 3.8, lift: 3 };

function edgeStyle(site: Site): WallStyle {
  const edge = 'edge' in site ? site.edge : undefined;
  if (edge === undefined) throw new Error(`Site ${site.id} has no edge style`);
  return EDGE_STYLES[edge];
}

type Ring = { radius: number; count: number; step: number; open: boolean[]; mid: number; length: number };

function edgeRing(site: Site, style: WallStyle): Ring {
  const radius = site.radius;
  const gates = siteGates(site).map((g) => Math.atan2(g.y - site.pos.y, g.x - site.pos.x));
  const count = Math.ceil((2 * Math.PI * radius) / style.segment);
  const step = (2 * Math.PI) / count;
  const gateHalf = SET.gateWidth / 2 / radius;
  const open = Array.from({ length: count }, (_, i) => gates.some((e) => Math.abs(angleDiff((i + 0.5) * step, e)) < gateHalf + step / 2));
  return { radius, count, step, open, mid: radius * Math.cos(step / 2) - style.thickness / 2, length: 2 * radius * Math.sin(step / 2) };
}

function onEdge(ring: Ring, a: number, width: number): { x: number; z: number } {
  const r = Math.sqrt(ring.radius * ring.radius - (width / 2) ** 2) - width / 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function addWall(b: SiteBuilder, site: Site, style: WallStyle): void {
  const ring = edgeRing(site, style);
  const runs = gateRuns(ring.open);
  b.root.userData.wallSections = addSections(b, ring, style, site.pos.x);
  for (const [start, end] of runs) addGate(b, ring, style, start * ring.step, end * ring.step);
  b.root.userData.gates = runs.length;
  b.root.userData.doors = 2 * runs.length;
  b.root.userData.edgeReach = [ring.mid - style.thickness / 2, ring.radius];
  b.root.userData.wallThickness = style.thickness;
}

function addSections(b: SiteBuilder, ring: Ring, style: WallStyle, seed: number): number {
  let sections = 0;
  for (let i = 0; i < ring.count; i++) {
    if (ring.open[i]) continue;
    const a = (i + 0.5) * ring.step;
    const height = style.ragged ? style.height * (0.8 + 0.4 * hash2(i, seed)) : style.height;
    const color = style.colors[Math.floor(hash2(i, seed + 7) * style.colors.length)];
    const p = { x: Math.cos(a) * ring.mid, z: Math.sin(a) * ring.mid };
    if (style.fence) addFenceSection(b, ring, style, p, a, i);
    else b.addBox(p.x, p.z, style.thickness, height + SINK, ring.length, color, -SINK, -a);
    sections++;
  }
  return sections;
}

function addFenceSection(b: SiteBuilder, ring: Ring, style: WallStyle, p: { x: number; z: number }, a: number, i: number): void {
  for (const lift of [0.45, 0.85]) b.addBox(p.x, p.z, style.thickness, 0.06, ring.length, style.colors[0], style.height * lift, -a);
  addPost(b, ring, i * ring.step, 0.12, style.height, style.postColor);
}

function addPost(b: SiteBuilder, ring: Ring, a: number, width: number, height: number, color: number): void {
  const q = onEdge(ring, a, width);
  b.addBox(q.x, q.z, width, height + SINK, width, color, -SINK, -a);
}

function gateRuns(open: boolean[]): [number, number][] {
  const n = open.length;
  const runs: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!open[i] || open[(i + n - 1) % n]) continue;
    let end = i;
    while (open[end % n]) end++;
    runs.push([i, end]);
  }
  return runs;
}

function addGate(b: SiteBuilder, ring: Ring, style: WallStyle, from: number, to: number): void {
  for (const a of [from, to]) addPost(b, ring, a, style.thickness * 1.6, style.height * 1.4, style.postColor);
  for (const a of [from, to]) addLamp(b, ring, style, a);
  const middle = (from + to) / 2;
  const doorHeight = style.fence ? style.height : style.height * 0.95;
  addLeaf(b, ring, style, from, middle, doorHeight);
  addLeaf(b, ring, style, to, middle, doorHeight);
}

function addLeaf(b: SiteBuilder, ring: Ring, style: WallStyle, hinge: number, tip: number, height: number): void {
  const r = ring.radius - style.thickness / 2;
  const h = { x: Math.cos(hinge) * r, z: Math.sin(hinge) * r };
  const t = { x: Math.cos(tip) * r, z: Math.sin(tip) * r };
  const length = Math.hypot(t.x - h.x, t.z - h.z);
  b.addDoor(h.x, h.z, length, height, style.thickness * DOOR_THICKNESS, style.doorColor, -Math.atan2(t.z - h.z, t.x - h.x));
}

function addLamp(b: SiteBuilder, ring: Ring, style: WallStyle, a: number): void {
  const top = Math.max(SET.lampHeight, style.height * 1.4);
  const q = onEdge(ring, a, style.thickness);
  b.addBox(q.x, q.z, 0.18, top + SINK, 0.18, PAL.metal, -SINK, -a);
  b.addLampHead(q.x, q.z, top, -a);
}

function isBannered(site: Site): boolean {
  return REGION.towns.some((t) => t.id === site.id) || ('kind' in site && site.kind === 'camp');
}

function dressGates(b: SiteBuilder, site: Site): void {
  const guarded = isBannered(site);
  const first = b.root.children.length;
  for (const fort of fortressGates(site)) dressGate(b, site, fort, guarded);
  for (const piece of b.root.children.slice(first)) piece.userData.gateFurniture = true;
}

function dressGate(b: SiteBuilder, site: Site, fort: FortGate, guarded: boolean): void {
  const { face, out, width, height } = fort;
  const a = Math.atan2(out.y, out.x);
  const at = (reach: number, side: number) => ({ x: face.x - site.pos.x + out.x * reach - out.y * side, z: face.y - site.pos.y + out.y * reach + out.x * side });
  for (const side of [-1, 1]) {
    const p = at(LAMP_REACH, (side * width) / 4);
    const bracket = at(LAMP_REACH / 2, (side * width) / 4);
    b.addBox(bracket.x, bracket.z, LAMP_REACH, 0.12, 0.12, PAL.metal, SET.lampHeight - 0.12, -a);
    const head = b.addLampHead(p.x, p.z, SET.lampHeight, -a);
    if (side === 1) b.addLight('gate', head, at(GATE_APRON_AIM, 0));
  }
  if (!guarded) return;
  const lift = (x: number, z: number) => b.groundAt(face.x - site.pos.x, face.y - site.pos.y) - b.groundAt(x, z);
  const depth = FORTRESS_STYLES[FORTRESS_SITES[site.id].style].gate.depth;
  const pole = at(-depth / 2, width / 2 - 0.6);
  b.addBox(pole.x, pole.z, 0.12, SET.gatePoleHeight - height, 0.12, PAL.trunk, height + lift(pole.x, pole.z), -a);
  const flag = at(-depth / 2 + 0.5, width / 2 - 0.6);
  b.addBox(flag.x, flag.z, 0.05, 1, 0.8, PAL.rust.top, SET.gatePoleHeight - 1.1 + lift(flag.x, flag.z), -a);
}

function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addModel('pump_station', 2.5, 0);
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
  b.addWorkLight('flood', 3.2, 2.6, WORK_MAST, { x: 2.5, z: 0, lift: 1.5 }, PAL.siteLight.warm);
  b.addWash(1, PAL.siteLight.warm);
}

function buildLock(b: SiteBuilder): void {
  for (const x of [-1.6, 1.6]) b.addBox(x, 0, 0.6, 1.1, 3.8, PAL.wall.side);
  b.addBox(0, 0, 2.6, 0.05, 3.8, PAL.water);
  b.addModel('lock_gate', 0, 0, Math.PI / 2);
  b.addRuin(3.7, 0, 1.7, 2);
  b.addWorkLight('flood', 2.4, 2.4, WORK_MAST, { x: 0, z: 0, lift: 1 }, PAL.siteLight.warm);
  b.addWash(0.9, PAL.siteLight.warm);
}

function sampleSightOnDeck(obj: THREE.Object3D, deck: Deck): void {
  obj.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.outline) return;
    const pos = o.geometry.getAttribute('position');
    const at = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const c = deckCenterAt(deck, p.x / S, p.z / S, Math.SQRT1_2);
      at[i * 2] = c.x * S;
      at[i * 2 + 1] = c.y * S;
    }
    o.geometry.setAttribute('sightAt', new THREE.BufferAttribute(at, 2));
  });
}

function buildBridge(b: SiteBuilder, terrain: Terrain): void {
  const deck = deckById('canyon-bridge');
  const bridge = b.addModel('bridge', 0, 0, 0, new THREE.Vector3((deck.length * S) / 32, BRIDGE_RISE, (deck.width * S) / 7));
  bridge.userData.outsideEdge = true;
  poseOnDeck(bridge, deck, soleSegment(terrain, deck), BRIDGE_DECK_TOP * BRIDGE_RISE);
  sampleSightOnDeck(bridge, deck);
  b.addRuin(0, 0, 3, 2);
}

function buildWingDeck(t: Terrain): THREE.Group {
  const deck = deckById('broken-wing');
  const root = new THREE.Group();
  root.name = 'landmark-wing-deck';
  const obj = model('wing_deck');
  obj.scale.set((deck.length * S) / WING_DECK_LENGTH, 1, (deck.width * S) / WING_DECK_WIDTH);
  poseOnDeck(obj, deck, soleSegment(t, deck), 0);
  root.add(obj);
  sampleSightOnDeck(obj, deck);
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return root;
}

function buildOasis(b: SiteBuilder): void {
  b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    b.addModel('palm', Math.cos(a) * 4, Math.sin(a) * 4, a * 2.3);
  }
  b.addWorkLight('flood', 1.9, 3.1, WORK_MAST, { x: -1.5, z: -2.5, lift: 1.5 }, PAL.siteLight.warm);
  b.addWash(1, PAL.siteLight.warm);
}

function buildWrecks(b: SiteBuilder, id: string): void {
  if (id === 'podfield') {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4;
      const pod = b.addShape(new THREE.CapsuleGeometry(0.45 * S, 1.1 * S, 2, 6), PAL.metalLight, Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0.65);
      pod.rotation.z = 0.7 + i * 0.3;
    }
    b.addModel('crates', 0, 0, 0.3);
  } else {
    b.addHull(-1, 0, id === 'ridge-wrecks' ? 7 : 4, 2, 0.3);
    b.addHull(2, 3, 3.5, 1.5, -0.6);
    for (let i = 0; i < 5; i++) b.addBox(-3 + i, -3, 0.5, 0.25, 1, PAL.rust.dark, 0, i);
    b.addModel('crates', 3.5, -2.5, 0.3);
  }
}

function buildWingSalvage(b: SiteBuilder): void {
  b.addTank(2.5, 2.8, 0.6, 1.4, PAL.rust.top);
  b.addTank(3.8, 2.2, 0.45, 1.1, PAL.rust.dark);
  b.addBox(3, 1.2, 3, 0.15, 1.2, PAL.metalLight, 0.2, -0.3);
  b.addBox(-3, 3, 2.2, 0.9, 1.3, PAL.rust.dark, 0, 0.2);
  b.addBox(-1, 4, 1.8, 0.12, 0.9, PAL.rust.side, 0.1, 0.6);
  b.addModel('crates', -3.8, 2.6, 0.5);
}

function buildCamp(b: SiteBuilder, id: string): void {
  const turn = id === 'kiln' ? 1.3 : 0;
  for (let i = 0; i < 3; i++) {
    const a = turn + i * 2.1;
    const x = Math.cos(a) * 3.2;
    const z = Math.sin(a) * 3.2;
    b.addBox(x, z, 1.8, 1.1, 1.4, i % 2 ? PAL.rust.side : PAL.metal, 0, -a);
    b.addBox(x, z, 2.1, 0.12, 1.7, PAL.rust.top, 1.1, -a + 0.1);
  }
  b.addTank(0, 0, 0.7, 0.12, PAL.rust.dark);
  for (const a of [turn + 1, turn + 1.3]) b.addTank(Math.cos(a) * 4.3, Math.sin(a) * 4.3, 0.45, 0.9, PAL.rust.top);
  b.addHull(Math.cos(turn + 3.1) * 3.6, Math.sin(turn + 3.1) * 3.6, 3, 1.4, turn + 1.6);
  b.addModel('crates', Math.cos(turn + 5.2) * 3.5, Math.sin(turn + 5.2) * 3.5, turn);
  b.addLight('fire', b.addMast(0, 0, FIRE_MAST, 0), { x: -0.4, z: -0.4 }, PAL.siteLight.fire);
  b.addWash(1, PAL.siteLight.warm);
}

function closeSite(b: SiteBuilder, site: Site, t: Terrain): void {
  if (isFortress(site)) {
    pullInside(site, b.root, t);
    dressGates(b, site);
  } else {
    if (isBannered(site)) throw new Error(`Town or camp ${site.id} has no fortress`);
    addWall(b, site, edgeStyle(site));
  }
}

function insideSiteCurtain(site: Site, obj: THREE.Object3D): boolean {
  let inside = true;
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh && inside) inside = copiesOf(o).every((at) => verticesInside(site, o.geometry, at));
  });
  return inside;
}

function copiesOf(o: THREE.Mesh): THREE.Matrix4[] {
  if (!(o instanceof THREE.InstancedMesh)) return [o.matrixWorld];
  return Array.from({ length: o.count }, (_, k) => o.matrixWorld.clone().multiply(o.getMatrixAt(k, new THREE.Matrix4())));
}

function verticesInside(site: Site, geometry: THREE.BufferGeometry, at: THREE.Matrix4): boolean {
  const v = new THREE.Vector3();
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(at);
    const p = { x: v.x / S, y: v.z / S };
    if (!insideCurtain(site, p) && !onFortressRock(site, p)) return false;
  }
  return true;
}

function pullInside(site: Site, root: THREE.Group, t: Terrain): void {
  const cx = site.pos.x * S;
  const cz = site.pos.y * S;
  const homes = root.children.map((child) => child.position.clone());
  let fits = false;
  for (let step = 20; step >= 0 && !fits; step--) {
    const k = step / 20;
    root.children.forEach((child, i) => child.position.set(cx + (homes[i].x - cx) * k, homes[i].y, cz + (homes[i].z - cz) * k));
    fits = root.children.every((child) => insideSiteCurtain(site, child));
  }
  if (!fits) throw new Error(`The interior of ${site.id} does not fit inside its curtain`);
  root.children.forEach((child, i) => {
    child.position.y += (heightAt(t, child.position.x / S, child.position.z / S) - heightAt(t, homes[i].x / S, homes[i].z / S)) * S;
  });
}

type SiteDecor = (b: SiteBuilder, site: Site, t: Terrain) => void;

const wrecks: SiteDecor = (b, site) => buildWrecks(b, site.id);
const camp: SiteDecor = (b, site) => buildCamp(b, site.id);

const SITE_DECOR: Record<string, SiteDecor> = {
  granary: (b) => buildGranary(b),
  'pump-station': (b) => buildPump(b),
  'south-lock': (b) => buildLock(b),
  'canyon-bridge': (b, _site, t) => buildBridge(b, t),
  dustwell: (b) => buildDustwell(b),
  'green-pit': (b) => buildOasis(b),
  'broken-wing': (b) => buildWingSalvage(b),
  nose: (b, site) => buildNose(b, site),
  bowl: (b, site) => buildBowl(b, site),
  'burnt-convoy': wrecks,
  podfield: wrecks,
  'ridge-wrecks': wrecks,
  'salvage-yard': (b) => buildSalvageYard(b),
  scrapjaw: camp,
  kiln: camp,
};

type BuiltSite = { root: THREE.Group; movers: Mover[]; lights: SiteLight[] };

function resolveLights(b: SiteBuilder, site: Site, t: Terrain): SiteLight[] {
  const lights = b.fixtures.map((f, i): SiteLight => {
    const shift = f.head.position.clone().sub(f.home);
    const x = site.pos.x + f.aim.x + shift.x / S;
    const z = site.pos.y + f.aim.z + shift.z / S;
    const at = f.head.position;
    const ground = heightAt(t, x, z) * S;
    return { id: `${site.id}:${f.kind}:${i}`, siteId: site.id, kind: f.kind, at: { x: at.x, y: at.y, z: at.z }, aim: { x: x * S, y: ground + (f.aim.lift ?? 0) * S, z: z * S }, ground, color: f.color };
  });
  if (!isFortress(site)) {
    if (lights.length > 0) throw new Error(`Abandoned site ${site.id} has work lights`);
    return lights;
  }
  const gates = lights.filter((l) => l.kind === 'gate').length;
  if (gates !== fortressGates(site).length) throw new Error(`Site ${site.id} has ${gates} gate lights for ${fortressGates(site).length} gates`);
  if (lights.length === gates) throw new Error(`Site ${site.id} has no interior work light`);
  if (lights.length > SITE_LIGHT_POOL) throw new Error(`Site ${site.id} has ${lights.length} work lights, more than the pool of ${SITE_LIGHT_POOL}`);
  return lights;
}

function buildSite(t: Terrain, site: Site): BuiltSite {
  const b = new SiteBuilder(t, site);
  const decor = SITE_DECOR[site.id];
  if (decor === undefined) throw new Error(`Missing landmark model for ${site.id}`);
  decor(b, site, t);
  closeSite(b, site, t);
  const lights = resolveLights(b, site, t);
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return { root: b.root, movers: b.movers, lights };
}

const UP = new THREE.Vector3(0, 1, 0);
const SITES = [...REGION.towns, ...REGION.locations.filter((l): l is SiteLocationDef => l.kind !== 'territory')];

export function buildSites(t: Terrain): BuiltSite {
  const root = new THREE.Group();
  const movers: Mover[] = [];
  const lights: SiteLight[] = [];
  for (const site of SITES) {
    const built = buildSite(t, site);
    root.add(built.root);
    movers.push(...built.movers);
    lights.push(...built.lights);
  }
  root.add(buildWingDeck(t));
  return { root, movers, lights };
}

export function addSites(t: Terrain, scope: RenderScope): SiteLight[] {
  const motion = new SiteMotion();
  const lights: SiteLight[] = [];
  for (const site of SITES) {
    const built = buildSite(t, site);
    scope.add(built.root, site.pos, site.radius);
    lights.push(...built.lights);
    const phase = hash2(site.pos.x, site.pos.y) * MOTION_PHASE_SPAN;
    for (const mover of built.movers) motion.add(mover.node, (seconds, node, rest) => mover.motion(seconds + phase, node, rest));
  }
  let last = performance.now();
  scope.onFrame(() => {
    const now = performance.now();
    motion.tick((now - last) / 1000);
    last = now;
  });
  const deck = deckById('broken-wing');
  scope.add(buildWingDeck(t), { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 }, deck.length / 2);
  return lights;
}

export function poseOnDeck(obj: THREE.Object3D, deck: Deck, seg: DeckSegment, top: number): void {
  const { axis } = deck;
  const { from, length, h0, h1 } = seg;
  const pitch = Math.atan2((h1 - h0) * S, length * S);
  obj.position.set((from.x + (axis.x * length) / 2) * S, ((h0 + h1) / 2) * S - top, (from.y + (axis.y * length) / 2) * S);
  obj.rotation.set(0, -Math.atan2(axis.y, axis.x), pitch, 'YXZ');
}

export function soleSegment(t: Terrain, deck: Deck): DeckSegment {
  const segments = deckSegments(t, deck);
  if (segments.length !== 1) throw new Error(`Deck ${deck.id} has ${segments.length} pieces, not one`);
  return segments[0];
}
