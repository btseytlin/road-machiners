import * as THREE from 'three';
import { REGION, type SiteLocationDef, type TownDef } from '../../data/region';
import { FORTRESS, FORTRESS_STYLES, type FortressKind } from '../../data/fortress';
import { fortressGates, fortressOutline, fortressPieces, fortressStyle, insideCurtain, onFortressRock, type FortGate, type FortressPiece } from '../../sim/fortress';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { isFortress, siteLook } from '../../sim/sites';
import { atlasOf } from '../../sim/atlas';
import { deckById, deckCenterAt, type Deck } from '../../sim/bridge';
import { deckSegments, heightAt, type DeckSegment, type Terrain } from '../../sim/terrain';
import { pointInPolygon, segmentDist } from '../../sim/vec';
import { instancedModel, model, type ModelName } from './models';
import type { RenderScope } from './scope';
import type { PlayClock } from '../play-clock';
import { SiteMotion, type Motion } from './site-motion';
import { buildBowl } from './interiors/bowl';
import { buildCamp } from './interiors/camp';
import { buildDustwell } from './interiors/dustwell';
import { buildGranary } from './interiors/granary';
import { buildOasis, buildPump } from './interiors/masonry';
import { buildNose } from './interiors/nose';
import { buildSalvageYard } from './interiors/salvage';
import { NIGHT_POOLS, type PoolLamp } from './lightPools';
import { SITE_LIGHT_POOL, type SiteLight, type SiteLightKind } from './siteLights';

const S = PHYSICS.metersPerTile;
type Site = TownDef | SiteLocationDef;
const BRIDGE_RISE = 1.5;
const BRIDGE_DECK_TOP = 0.8;
const WING_DECK_LENGTH = 156;
const WING_DECK_WIDTH = 24;

export type Mover = { node: THREE.Object3D; motion: Motion };
type Fixture = { kind: SiteLightKind; head: THREE.Object3D; home: THREE.Vector3; aim: { x: number; z: number; lift?: number }; color?: number; range?: number; intensity?: number };
const MOTION_PHASE_SPAN = 60;

export class SiteBuilder {
  readonly root = new THREE.Group();
  readonly movers: Mover[] = [];
  readonly fixtures: Fixture[] = [];
  readonly lamps: THREE.Mesh[] = [];
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
      if (color === PAL.lamp.on || color === PAL.lamp.amber) material.emissive.setHex(color);
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
  addLampHead(x: number, z: number, top: number, yaw: number): THREE.Mesh {
    this.addBox(x, z, 0.2 / LAMP_SHRINK, 0.35 / LAMP_SHRINK, 0.6 / LAMP_SHRINK, PAL.metal, top, yaw);
    const head = this.addBox(x, z, 0.24 / LAMP_SHRINK, 0.22 / LAMP_SHRINK, 0.45 / LAMP_SHRINK, PAL.lamp.amber, top + 0.06 / LAMP_SHRINK, yaw);
    this.lamps.push(head);
    return head;
  }
  addWallLamp(face: { x: number; z: number }, out: { x: number; z: number }, height: number): THREE.Mesh {
    const yaw = Math.atan2(-out.z, out.x);
    const bracket = { x: face.x + (out.x * SCONCE.reach) / 2, z: face.z + (out.z * SCONCE.reach) / 2 };
    this.addBox(bracket.x, bracket.z, SCONCE.reach, 0.12, 0.12, PAL.metal, height - 0.12, yaw);
    return this.addLampHead(face.x + out.x * SCONCE.reach, face.z + out.z * SCONCE.reach, height, yaw);
  }
  addLantern(x: number, z: number, yaw: number): THREE.Mesh {
    const out = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const hang = { x: x + out.x * LANTERN.arm, z: z + out.z * LANTERN.arm };
    this.addBox(x, z, LANTERN.post, LANTERN.height + SINK, LANTERN.post, PAL.trunk, -SINK, yaw);
    this.addBox(x + (out.x * LANTERN.arm) / 2, z + (out.z * LANTERN.arm) / 2, LANTERN.arm + LANTERN.post, LANTERN.post * 0.7, LANTERN.post * 0.7, PAL.trunk, LANTERN.height - LANTERN.post, yaw);
    this.addBox(hang.x, hang.z, LANTERN.cap, LANTERN.cap / 3, LANTERN.cap, PAL.metal, LANTERN.height - LANTERN.post - LANTERN.drop - LANTERN.cap / 3, yaw);
    const glass = this.addBox(hang.x, hang.z, LANTERN.glass, LANTERN.glass * 1.3, LANTERN.glass, PAL.lamp.amber, LANTERN.height - LANTERN.post - LANTERN.drop - LANTERN.cap / 3 - LANTERN.glass * 1.3, yaw);
    this.lamps.push(glass);
    return glass;
  }
  addFirePit(x: number, z: number): THREE.Mesh {
    this.addTank(x, z, FIRE_PIT.ring, FIRE_PIT.rim, PAL.rust.dark);
    const flame = this.addShape(new THREE.ConeGeometry(FIRE_PIT.flame * S, FIRE_PIT.flame * 2.2 * S, 5), PAL.lamp.amber, x, z, FIRE_PIT.rim + FIRE_PIT.flame * 1.1);
    flame.castShadow = false;
    this.lamps.push(flame);
    return flame;
  }
  addWorkLight(kind: SiteLightKind, x: number, z: number, height: number, aim: { x: number; z: number; lift?: number }, color: number, range?: number, intensity?: number): void {
    const anchor = new THREE.Group();
    const wx = this.site.pos.x + x;
    const wz = this.site.pos.y + z;
    anchor.position.set(wx * S, (heightAt(this.terrain, wx, wz) + height) * S, wz * S);
    this.root.add(anchor);
    this.addLight(kind, anchor, aim, color, range, intensity);
  }
  addFill(): void {
    this.addWorkLight('fill', 0, 0, FILL.height, { x: 0, z: 0 }, PAL.siteLight.amber, this.site.radius * FILL.reach * S);
  }
  addWash(reach: number, color: number): void {
    this.addWorkLight('wash', WASH.mast * reach, WASH.mast * reach, WORK_MAST, { x: -WASH.aim * reach, z: -WASH.aim * reach, lift: WASH.lift }, color);
  }
  addLight(kind: SiteLightKind, head: THREE.Object3D, aim: { x: number; z: number; lift?: number }, color?: number, range?: number, intensity?: number): void {
    let root: THREE.Object3D | null = head;
    while (root && root !== this.root) root = root.parent;
    if (!root) throw new Error(`Light head of ${this.site.id} is not inside its site root`);
    this.fixtures.push({ kind, head, home: head.position.clone(), aim, color, range, intensity });
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
const LAMP_SHRINK = 1.5;
const SINK = 0.3;
const GATE_APRON_AIM = 2.5;
const WORK_MAST = 3.3;
const LANTERN = { height: 1.15, post: 0.09, arm: 0.28, cap: 0.17, glass: 0.11, drop: 0.04 };
const FIRE_PIT = { ring: 0.45, rim: 0.12, flame: 0.16 };
const FILL = { height: 6, reach: 1.6 };
const SCONCE = { every: 3, reach: 0.7, height: 2.3, throw: 2.5, gap: 1.5 };
const WASH = { mast: 2.4, aim: 3.8, lift: 3 };
const SET = REGION.settlement;

function isBannered(site: Site): boolean {
  return REGION.towns.some((t) => t.id === site.id) || ('kind' in site && site.kind === 'camp');
}

function dressGates(b: SiteBuilder, site: Site): void {
  const guarded = isBannered(site);
  const first = b.root.children.length;
  for (const fort of fortressGates(site)) dressGate(b, site, fort, guarded);
  addSconces(b, site);
  b.addFill();
  for (const piece of b.root.children.slice(first)) piece.userData.gateFurniture = true;
}

type Vec2 = { x: number; z: number };
type Mount = { n: Vec2; face: Vec2; lamp: Vec2; throwAt: Vec2; inside: boolean };

function sconceNormals(piece: FortressPiece): Vec2[] {
  const across = { x: -Math.sin(piece.yaw), z: Math.cos(piece.yaw) };
  const sides = [across, { x: -across.x, z: -across.z }];
  if (piece.kind === 'wall') return sides;
  const along = { x: Math.cos(piece.yaw), z: Math.sin(piece.yaw) };
  return [...sides, along, { x: -along.x, z: -along.z }];
}

function sconceMount(site: Site, centre: Vec2, depth: number, n: Vec2): Mount {
  const face = { x: centre.x + (n.x * depth) / 2, z: centre.z + (n.z * depth) / 2 };
  const lamp = { x: face.x + n.x * SCONCE.reach, z: face.z + n.z * SCONCE.reach };
  const throwAt = { x: lamp.x + n.x * SCONCE.throw, z: lamp.z + n.z * SCONCE.throw };
  return { n, face, lamp, throwAt, inside: insideAt(site, lamp) };
}

function insideAt(site: Site, p: Vec2): boolean {
  return insideCurtain(site, { x: site.pos.x + p.x, y: site.pos.y + p.z });
}

function wantsSconce(site: Site, kind: FortressKind, m: Mount): boolean {
  if (kind === 'tower') return m.inside;
  return kind === 'wall' && m.inside && insideAt(site, m.throwAt);
}

function outermost(mounts: Mount[], centre: Vec2): Mount[] {
  const outward = (m: Mount) => m.n.x * centre.x + m.n.z * centre.z;
  const outside = mounts.filter((m) => !m.inside).sort((a, b) => outward(b) - outward(a));
  return outside.slice(0, 1);
}

function hangSconce(b: SiteBuilder, m: Mount): void {
  b.addWallLamp(m.face, m.n, SCONCE.height);
}

const PIECE_DEPTH: Partial<Record<FortressKind, number>> = { wall: FORTRESS.wallDepth, tower: FORTRESS.towerSize };

function sconceMounts(site: Site, piece: FortressPiece): Mount[] {
  const depth = PIECE_DEPTH[piece.kind];
  if (depth === undefined) return [];
  const centre = { x: piece.pos.x - site.pos.x, z: piece.pos.y - site.pos.y };
  const mounts = sconceNormals(piece).map((n) => sconceMount(site, centre, depth, n));
  const lit = mounts.filter((m) => wantsSconce(site, piece.kind, m));
  return piece.kind === 'tower' ? [...lit, ...outermost(mounts, centre)] : lit;
}

function spaced(kind: FortressKind, seen: { walls: number }): boolean {
  return kind !== 'wall' || seen.walls++ % SCONCE.every === 0;
}

function clearOf(hung: Vec2[], m: Mount): boolean {
  return hung.every((p) => Math.hypot(p.x - m.lamp.x, p.z - m.lamp.z) >= SCONCE.gap);
}

function addSconces(b: SiteBuilder, site: Site): void {
  const seen = { walls: 0 };
  const hung: Vec2[] = [];
  const pieces = fortressPieces(site).sort((p, q) => Number(q.kind === 'tower') - Number(p.kind === 'tower'));
  for (const piece of pieces) {
    for (const m of sconceMounts(site, piece)) {
      if (!spaced(piece.kind, seen) || !clearOf(hung, m)) continue;
      hangSconce(b, m);
      hung.push(m.lamp);
    }
  }
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
  const depth = FORTRESS_STYLES[fortressStyle(site)].gate.depth;
  const pole = at(-depth / 2, width / 2 - 0.6);
  b.addBox(pole.x, pole.z, 0.12, SET.gatePoleHeight - height, 0.12, PAL.trunk, height + lift(pole.x, pole.z), -a);
  const flag = at(-depth / 2 + 0.5, width / 2 - 0.6);
  b.addBox(flag.x, flag.z, 0.05, 1, 0.8, PAL.rust.top, SET.gatePoleHeight - 1.1 + lift(flag.x, flag.z), -a);
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
  'green-pit': (b) => buildOasis(b),
  nose: (b, site) => buildNose(b, site),
  bowl: (b, site) => buildBowl(b, site),
  'salvage-yard': (b) => buildSalvageYard(b),
  scrapjaw: camp,
  kiln: camp,
};

type BuiltSite = { root: THREE.Group; movers: Mover[]; lights: SiteLight[]; lamps: PoolLamp[] };

function lightNights(b: SiteBuilder, site: Site): PoolLamp[] {
  if (!isFortress(site)) return [];
  b.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) NIGHT_POOLS.light(material);
  });
  const outline = fortressOutline(site);
  return b.lamps.map((head) => {
    head.add(NIGHT_POOLS.halo());
    const at = { x: head.position.x / S, y: head.position.z / S };
    return { site, x: at.x, z: at.y, inside: pointInPolygon(at, outline) };
  });
}

function resolveLights(b: SiteBuilder, site: Site, t: Terrain): SiteLight[] {
  const lights = b.fixtures.map((f, i): SiteLight => {
    const shift = f.head.position.clone().sub(f.home);
    const x = site.pos.x + f.aim.x + shift.x / S;
    const z = site.pos.y + f.aim.z + shift.z / S;
    const at = f.head.position;
    const ground = heightAt(t, x, z) * S;
    return { id: `${site.id}:${f.kind}:${i}`, siteId: site.id, kind: f.kind, at: { x: at.x, y: at.y, z: at.z }, aim: { x: x * S, y: ground + (f.aim.lift ?? 0) * S, z: z * S }, ground, color: f.color, range: f.range, intensity: f.intensity };
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
  const decor = SITE_DECOR[siteLook(site)];
  if (decor === undefined) throw new Error(`Missing landmark model for ${siteLook(site)}`);
  decor(b, site, t);
  closeSite(b, site, t);
  const lights = resolveLights(b, site, t);
  const lamps = lightNights(b, site);
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return { root: b.root, movers: b.movers, lights, lamps };
}

const UP = new THREE.Vector3(0, 1, 0);
function sitesOf(t: Terrain): (TownDef | SiteLocationDef)[] {
  const atlas = atlasOf(t);
  return [...atlas.towns, ...atlas.locations.filter((l): l is SiteLocationDef => l.kind !== 'territory')];
}

function deckOf(t: Terrain, id: string): Deck | null {
  return atlasOf(t).decks.decks.find((d) => d.id === id) ?? null;
}

const DECK_MODELS = [
  { id: 'canyon-bridge', build: buildCanyonBridge },
  { id: 'broken-wing', build: buildWingDeck },
] as const;

export function buildSites(t: Terrain): BuiltSite {
  const root = new THREE.Group();
  const movers: Mover[] = [];
  const lights: SiteLight[] = [];
  const lamps: PoolLamp[] = [];
  for (const site of sitesOf(t)) {
    const built = buildSite(t, site);
    root.add(built.root);
    movers.push(...built.movers);
    lights.push(...built.lights);
    lamps.push(...built.lamps);
  }
  for (const { id, build } of DECK_MODELS) if (deckOf(t, id)) root.add(build(t));
  return { root, movers, lights, lamps };
}

export function addSites(t: Terrain, scope: RenderScope, play: PlayClock): { lights: SiteLight[]; lamps: PoolLamp[] } {
  const motion = new SiteMotion();
  const lights: SiteLight[] = [];
  const lamps: PoolLamp[] = [];
  for (const site of sitesOf(t)) {
    const built = buildSite(t, site);
    scope.add(built.root, site.pos, site.radius);
    lights.push(...built.lights);
    lamps.push(...built.lamps);
    const phase = hash2(site.pos.x, site.pos.y) * MOTION_PHASE_SPAN;
    for (const mover of built.movers) motion.add(mover.node, (seconds, node, rest) => mover.motion(seconds + phase, node, rest));
  }
  let last = play.nowMs();
  scope.onFrame(() => {
    const now = play.nowMs();
    motion.tick((now - last) / 1000);
    last = now;
  });
  for (const { id, build } of DECK_MODELS) {
    const deck = deckOf(t, id);
    if (deck) scope.add(build(t), { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 }, deck.length / 2);
  }
  return { lights, lamps };
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
