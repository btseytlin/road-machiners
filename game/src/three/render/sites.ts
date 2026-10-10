// Town and location models. Buildings that block movement are obstacles already (see obstacles.ts),
// so nothing here blocks. Blender models come from tools/blender/; each script's docstring gives its size.

import * as THREE from 'three';
import { REGION, type SiteLocationDef, type TownDef } from '../../data/region';
import { FORTRESS_SITES, FORTRESS_STYLES } from '../../data/fortress';
import { fortressGates, insideCurtain, onFortressRock, type FortGate } from '../../sim/fortress';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { isFortress } from '../../sim/sites';
import { deckById, deckCenterAt, type Deck } from '../../sim/bridge';
import { deckSegments, heightAt, type DeckSegment, type Terrain } from '../../sim/terrain';
import { segmentDist } from '../../sim/vec';
import { instancedModel, model, type ModelName } from './models';
import type { RenderScope } from './scope';
import { SiteMotion, type Motion } from './site-motion';
import { buildBowl } from './interiors/bowl';
import { addMarket, buildDustwell, buildGranary, buildSalvageYard } from './interiors/compounds';
import { buildNose } from './interiors/nose';

const S = PHYSICS.metersPerTile;
type Site = TownDef | SiteLocationDef;
const BRIDGE_RISE = 1.5;
const BRIDGE_DECK_TOP = 0.8;
const WING_DECK_LENGTH = 156;
const WING_DECK_WIDTH = 24;

export type Mover = { node: THREE.Object3D; motion: Motion };
const MOTION_PHASE_SPAN = 60;

export class SiteBuilder {
  readonly root = new THREE.Group();
  readonly movers: Mover[] = [];
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
  addBox(x: number, z: number, w: number, h: number, d: number, color: number, lift = 0, yaw = 0): THREE.Mesh {
    return this.addShape(new THREE.BoxGeometry(w * S, h * S, d * S), color, x, z, lift + h / 2, yaw);
  }
  addTank(x: number, z: number, radius: number, height: number, color: number, lift = 0): void {
    this.addShape(new THREE.CylinderGeometry(radius * S, radius * S, height * S, 10), color, x, z, lift + height / 2);
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

const LAMP_REACH = 0.3;
const SET = REGION.settlement;

function addLampHead(b: SiteBuilder, x: number, z: number, top: number, yaw: number): void {
  b.addBox(x, z, 0.2, 0.35, 0.6, PAL.metal, top, yaw);
  b.addBox(x, z, 0.24, 0.22, 0.45, PAL.lamp.on, top + 0.06, yaw);
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
    addLampHead(b, p.x, p.z, SET.lampHeight, -a);
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

function buildCanyonBridge(t: Terrain): THREE.Group {
  const deck = deckById('canyon-bridge');
  const root = new THREE.Group();
  root.name = 'landmark-canyon-bridge';
  const bridge = model('bridge');
  bridge.scale.set((deck.length * S) / 32, BRIDGE_RISE, (deck.width * S) / 7);
  bridge.userData.outsideEdge = true;
  poseOnDeck(bridge, deck, soleSegment(t, deck), BRIDGE_DECK_TOP * BRIDGE_RISE);
  root.add(bridge);
  sampleSightOnDeck(bridge, deck);
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return root;
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

const GREEN_PIT_MARKET = { x: -2.4, z: 1.2, drums: { u: 0.2, v: 1.7 } };
const GREEN_PIT_SHACKS = [
  { x: 1.4, z: -3.0, yaw: Math.PI / 2 },
  { x: 3.0, z: -1.2, yaw: Math.PI },
];

function buildGreenPit(b: SiteBuilder): void {
  b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    b.addModel('palm', Math.cos(a) * 4, Math.sin(a) * 4, a * 2.3);
  }
  addMarket(b, 'green-pit', GREEN_PIT_MARKET);
  for (const shack of GREEN_PIT_SHACKS) b.addModel('shack', shack.x, shack.z, shack.yaw, 1.2).name = 'green-pit-shack';
  b.addModel('crates', -1.2, -3.2, 0.4);
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
}

function closeSite(b: SiteBuilder, site: Site, t: Terrain): void {
  if (!isFortress(site)) throw new Error(`Site ${site.id} has no fortress`);
  pullInside(site, b.root, t);
  dressGates(b, site);
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

const camp: SiteDecor = (b, site) => buildCamp(b, site.id);

const SITE_DECOR: Record<string, SiteDecor> = {
  granary: (b) => buildGranary(b),
  'pump-station': (b) => buildPump(b),
  dustwell: (b) => buildDustwell(b),
  'green-pit': (b) => buildGreenPit(b),
  nose: (b, site) => buildNose(b, site),
  bowl: (b, site) => buildBowl(b, site),
  'salvage-yard': (b) => buildSalvageYard(b),
  scrapjaw: camp,
  kiln: camp,
};

type BuiltSite = { root: THREE.Group; movers: Mover[] };

function buildSite(t: Terrain, site: Site): BuiltSite {
  const b = new SiteBuilder(t, site);
  const decor = SITE_DECOR[site.id];
  if (decor === undefined) throw new Error(`Missing landmark model for ${site.id}`);
  decor(b, site, t);
  closeSite(b, site, t);
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return { root: b.root, movers: b.movers };
}

const UP = new THREE.Vector3(0, 1, 0);
const SITES = [...REGION.towns, ...REGION.locations.filter((l): l is SiteLocationDef => l.kind !== 'territory')];

export function buildSites(t: Terrain): BuiltSite {
  const root = new THREE.Group();
  const movers: Mover[] = [];
  for (const site of SITES) {
    const built = buildSite(t, site);
    root.add(built.root);
    movers.push(...built.movers);
  }
  root.add(buildCanyonBridge(t), buildWingDeck(t));
  return { root, movers };
}

export function addSites(t: Terrain, scope: RenderScope): void {
  const motion = new SiteMotion();
  for (const site of SITES) {
    const built = buildSite(t, site);
    scope.add(built.root, site.pos, site.radius);
    const phase = hash2(site.pos.x, site.pos.y) * MOTION_PHASE_SPAN;
    for (const mover of built.movers) motion.add(mover.node, (seconds, node, rest) => mover.motion(seconds + phase, node, rest));
  }
  let last = performance.now();
  scope.onFrame(() => {
    const now = performance.now();
    motion.tick((now - last) / 1000);
    last = now;
  });
  for (const [id, build] of [['canyon-bridge', buildCanyonBridge], ['broken-wing', buildWingDeck]] as const) {
    const deck = deckById(id);
    scope.add(build(t), { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 }, deck.length / 2);
  }
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
