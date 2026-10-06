// Town and location models. Buildings that block movement are obstacles already (see obstacles.ts),
// so nothing here blocks. Blender models come from tools/blender/; each script's docstring gives its size.

import * as THREE from 'three';
import { REGION, type SiteLocationDef, type SiteEdge, type TownDef } from '../../data/region';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { hash2 } from '../../render/noise';
import { siteGates } from '../../sim/sites';
import { deckById, type Deck } from '../../sim/bridge';
import { deckSegments, heightAt, type DeckSegment, type Terrain } from '../../sim/terrain';
import { angleDiff, segmentDist } from '../../sim/vec';
import { instancedModel, model, type ModelName } from './models';
import type { RenderScope } from './scope';

const S = PHYSICS.metersPerTile;
type Site = TownDef | SiteLocationDef;
// Nose's 48 m bow from the 12 m cone.
const NOSE_SCALE = 4;
// The bridge model's 32 m by 7 m deck is stretched to the sim deck. Its trusses stand 2.4 m over the
// deck before this height scale.
const BRIDGE_RISE = 1.5;
const BRIDGE_DECK_TOP = 0.8; // meters from the model origin up to its deck top, before scaling
// The Broken Wing deck model's size in meters, between its rail lines (tools/blender/wing_deck.py).
const WING_DECK_LENGTH = 156;
const WING_DECK_WIDTH = 24;

// Site props stay within the site's collision footprint. Every prop is grounded independently.
class SiteBuilder {
  readonly root = new THREE.Group();
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
  // A door leaf hinged at site offset (x, z) that reaches length tiles toward yaw. The group named `door`
  // stands at the hinge, so turning it about y swings the leaf.
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
  // A Blender model standing on the ground at site offset (x, z), turned by yaw radians.
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
  // Many copies of one Blender model, each on the ground at its site offset, as instanced meshes.
  addInstances(name: ModelName, spots: { x: number; z: number; yaw: number }[]): void {
    const placements = spots.map(({ x, z, yaw }) => {
      const wx = this.site.pos.x + x;
      const wz = this.site.pos.y + z;
      const pos = new THREE.Vector3(wx * S, heightAt(this.terrain, wx, wz) * S, wz * S);
      return new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(1, 1, 1));
    });
    this.root.add(instancedModel(name, placements, placements.map(() => 1)));
  }
  // A site offset that must stay off every road, or the model would stand in traffic.
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

function buildSettlement(b: SiteBuilder, site: Site): void {
  const layout = REGION.settlement;
  const limit = site.radius - layout.houseWidth - 0.3;
  let homes = 0;
  for (let x = -limit; x <= limit; x += layout.streetSpacing) {
    for (let z = -limit; z <= limit; z += layout.streetSpacing) {
      if (Math.hypot(x, z) > limit) continue;
      if (site.id === 'bowl' ? Math.hypot(x, z) < 9 : Math.abs(x) < 21 && Math.abs(z) < 9) continue;
      const pos = { x: site.pos.x + x, y: site.pos.y + z };
      if (REGION.roads.some((road) => road.some((point, i) => i > 0 && segmentDist(pos, road[i - 1], point) < REGION.roadWidth / 2 + layout.houseWidth))) continue;
      const h = layout.houseHeights[homes % layout.houseHeights.length];
      const w = layout.houseWidth;
      const d = layout.houseDepth;
      b.addBox(x, z, w, h, d, homes % 3 ? PAL.wall.side : PAL.wall.top);
      b.addBox(x, z, w + 0.3, 0.12, d + 0.3, homes % 4 ? PAL.rust.top : PAL.metal, h);
      b.addBox(x, z + d / 2 + 0.02, 0.3, 0.55, 0.03, PAL.wall.dark);
      for (const dx of [-0.8, 0.8]) {
        b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 0.55);
        if (h > 1.5) b.addBox(x + dx, z + d / 2 + 0.02, 0.3, 0.3, 0.03, PAL.wall.dark, 1.25);
      }
      if (homes % 5 === 0) b.addTank(x - 0.6, z - 0.4, 0.3, 0.55, PAL.metalLight, h + 0.12);
      homes++;
    }
  }
  b.root.userData.homes = homes;
  // The water tower stands in the open center, clear of the pond, the hull and the roads.
  const tower = site.id === 'bowl' ? { x: -6, z: -6 } : { x: -18, z: 6 };
  b.offRoad(tower.x, tower.z, 1);
  b.addModel('water_tower', tower.x, tower.z);
  if (site.id === 'bowl') {
    b.addTank(0, 0, 6, 0.05, PAL.water);
    for (let row = 0; row < 4; row++) b.addBox(-6 + row * 3, 9, 2, 0.12, 4, PAL.scrub[0]);
  } else {
    b.addHull(-3, -1, 22, 10, 0);
    b.addModel('ship_nose', 12, -1, 0, NOSE_SCALE);
  }
}

type WallStyle = {
  height: number;
  thickness: number;
  segment: number; // tiles per straight section around the curve
  towerEvery: number | null; // sections between wall towers
  ragged: boolean; // sections vary in height, like scrap and posts
  fence: boolean; // posts and two rails instead of solid sections
  colors: number[]; // section colors, one picked per section
  postColor: number;
  doorColor: number;
  guarded: boolean; // a guard tower on each gate side and a banner pole at each gate
};

const SET = REGION.settlement;
const PALISADE: WallStyle = { height: SET.palisadeHeight, thickness: SET.palisadeThickness, segment: SET.palisadeSegment, towerEvery: null, ragged: true, fence: false, colors: [PAL.trunk], postColor: PAL.rust.side, doorColor: PAL.trunk, guarded: false };
const EDGE_STYLES: Record<SiteEdge | 'town', WallStyle> = {
  town: { height: SET.wallHeight, thickness: SET.wallThickness, segment: SET.wallSegment, towerEvery: SET.wallTowerEvery, ragged: false, fence: false, colors: [PAL.wall.side], postColor: PAL.wall.top, doorColor: PAL.rust.side, guarded: true },
  palisade: PALISADE,
  // Raider camps hide behind rusted scrap, with a gun tower on each side of every gate.
  camp: { ...PALISADE, colors: [PAL.rust.side], postColor: PAL.rust.dark, doorColor: PAL.rust.dark, guarded: true },
  stone: { height: SET.stoneHeight, thickness: SET.stoneThickness, segment: SET.stoneSegment, towerEvery: null, ragged: true, fence: false, colors: [PAL.rock.side, PAL.rock.top], postColor: PAL.rock.dark, doorColor: PAL.trunk, guarded: false },
  fence: { height: SET.fenceHeight, thickness: SET.fenceThickness, segment: SET.fenceSegment, towerEvery: null, ragged: false, fence: true, colors: [PAL.trunk], postColor: PAL.trunk, doorColor: PAL.metal, guarded: false },
  wrecks: { height: SET.wreckHeight, thickness: SET.wreckThickness, segment: SET.wreckSegment, towerEvery: null, ragged: true, fence: false, colors: [PAL.rust.side, PAL.metal, PAL.rust.dark], postColor: PAL.rust.dark, doorColor: PAL.metal, guarded: false },
};
const SINK = 0.3; // tiles each edge piece reaches below the ground, so slopes leave no gap under it
const DOOR_THICKNESS = 0.4; // door leaves as a share of the wall thickness

function edgeStyle(site: Site): WallStyle {
  return EDGE_STYLES['kind' in site ? site.edge : 'town'];
}

// The edge circle cut into straight sections whose outer corners lie on the collision edge. Sections near a
// gate stay open for the doors.
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

// Where square boxes of a given width stand at angle a with their outer corners on the edge.
function onEdge(ring: Ring, a: number, width: number): { x: number; z: number } {
  const r = Math.sqrt(ring.radius * ring.radius - (width / 2) ** 2) - width / 2;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// Closes the site on its collision edge, with shut doors at each gate. Box depth runs along the edge, so a
// yaw of -a turns it onto the tangent at angle a, and box width then runs outward.
function addWall(b: SiteBuilder, site: Site, style: WallStyle): void {
  const ring = edgeRing(site, style);
  const runs = gateRuns(ring.open);
  b.root.userData.wallSections = addSections(b, ring, style, site.pos.x);
  for (const [start, end] of runs) addGate(b, ring, style, start * ring.step, end * ring.step);
  b.root.userData.gates = runs.length;
  b.root.userData.doors = 2 * runs.length;
  b.root.userData.edgeReach = [ring.mid - style.thickness / 2, ring.radius];
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
    if (hasTower(ring, style, i)) addPost(b, ring, i * ring.step, style.thickness * 2, style.height * 1.4, style.postColor);
    sections++;
  }
  return sections;
}

// Two rails between posts. The post stands at the section start.
function addFenceSection(b: SiteBuilder, ring: Ring, style: WallStyle, p: { x: number; z: number }, a: number, i: number): void {
  for (const lift of [0.45, 0.85]) b.addBox(p.x, p.z, style.thickness, 0.06, ring.length, style.colors[0], style.height * lift, -a);
  addPost(b, ring, i * ring.step, 0.12, style.height, style.postColor);
}

function hasTower(ring: Ring, style: WallStyle, i: number): boolean {
  return style.towerEvery !== null && i % style.towerEvery === 0 && !ring.open[(i + ring.count - 1) % ring.count];
}

function addPost(b: SiteBuilder, ring: Ring, a: number, width: number, height: number, color: number): void {
  const q = onEdge(ring, a, width);
  b.addBox(q.x, q.z, width, height + SINK, width, color, -SINK, -a);
}

// Runs of open sections as [first, past last] section indices. A run may wrap past the last section.
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

// Posts or guard towers on both sides, and two door leaves hinged at the posts that meet in the middle.
function addGate(b: SiteBuilder, ring: Ring, style: WallStyle, from: number, to: number): void {
  for (const a of [from, to]) {
    if (style.guarded) addGuardTower(b, ring, style, a);
    else addPost(b, ring, a, style.thickness * 1.6, style.height * 1.4, style.postColor);
  }
  if (style.guarded) addBanner(b, ring, from);
  for (const a of [from, to]) addLamp(b, ring, style, a);
  const middle = (from + to) / 2;
  const doorHeight = style.fence ? style.height : style.height * 0.95;
  addLeaf(b, ring, style, from, middle, doorHeight);
  addLeaf(b, ring, style, to, middle, doorHeight);
}

// A leaf hinged on the edge at angle hinge that reaches the edge point at angle tip.
function addLeaf(b: SiteBuilder, ring: Ring, style: WallStyle, hinge: number, tip: number, height: number): void {
  const r = ring.radius - style.thickness / 2;
  const h = { x: Math.cos(hinge) * r, z: Math.sin(hinge) * r };
  const t = { x: Math.cos(tip) * r, z: Math.sin(tip) * r };
  const length = Math.hypot(t.x - h.x, t.z - h.z);
  b.addDoor(h.x, h.z, length, height, style.thickness * DOOR_THICKNESS, style.doorColor, -Math.atan2(t.z - h.z, t.x - h.x));
}

// A lamp on a post, or on the tower top, beside each gate, so a stop shows from far away.
function addLamp(b: SiteBuilder, ring: Ring, style: WallStyle, a: number): void {
  const top = style.guarded ? SET.guardTowerHeight : Math.max(SET.lampHeight, style.height * 1.4);
  const q = onEdge(ring, a, style.thickness);
  if (!style.guarded) b.addBox(q.x, q.z, 0.18, top + SINK, 0.18, PAL.metal, -SINK, -a);
  b.addBox(q.x, q.z, 0.2, 0.35, 0.6, PAL.metal, top, -a);
  b.addBox(q.x, q.z, 0.24, 0.22, 0.45, PAL.lamp.on, top + 0.06, -a);
}


function addGuardTower(b: SiteBuilder, ring: Ring, style: WallStyle, a: number): void {
  const tower = SET.guardTowerHeight;
  const t = style.thickness;
  addPost(b, ring, a, t * 2.4, tower, style.postColor);
  const q = onEdge(ring, a, t * 2.4);
  b.addBox(q.x, q.z, t * 3.2, 0.12, t * 3.2, PAL.wall.dark, tower, -a);
  const gun = onEdge(ring, a, -t * 1.4);
  b.addBox(gun.x, gun.z, 0.9, 0.12, 0.12, PAL.metal, tower + 0.2, -a);
}

// The pole rises from the gate's first tower. Its banner hangs across the tangent, so it faces the road.
function addBanner(b: SiteBuilder, ring: Ring, a: number): void {
  const tower = SET.guardTowerHeight;
  const q = onEdge(ring, a, 1);
  b.addBox(q.x, q.z, 0.12, SET.gatePoleHeight - tower, 0.12, PAL.trunk, tower);
  const flag = { x: q.x - Math.sin(a) * 0.45, z: q.z + Math.cos(a) * 0.45 };
  b.addBox(flag.x, flag.z, 0.05, 1, 0.8, PAL.rust.top, SET.gatePoleHeight - 1.1, -a);
}

function buildGranary(b: SiteBuilder): void {
  // Silos at the 1.1-tile radius of the old tanks. Their sheds face the loading ruin.
  for (let x = -3; x <= 3; x += 3) b.addModel('silo', x, -1, -Math.PI / 2, (1.1 * S) / 2.5);
  b.addRuin(0, 2.8, 6, 2.2);
  for (let i = 0; i < 8; i++) b.addBox(-2.5 + (i % 4) * 0.65, 2 + Math.floor(i / 4) * 0.65, 0.5, 0.45, 0.5, PAL.crate);
}

function buildPump(b: SiteBuilder): void {
  b.addRuin(-1.7, 0, 3, 3.8);
  b.addModel('pump_station', 2.5, 0);
  b.addBox(-2, 0, 1.2, 0.85, 2, PAL.rust.side);
}

function buildLock(b: SiteBuilder): void {
  for (const x of [-2, 2]) b.addBox(x, 0, 0.6, 1.1, 8, PAL.wall.side);
  b.addBox(0, 0, 3.6, 0.05, 8, PAL.water);
  // The gate wall runs along the model's Y, so a quarter turn sets it across the channel.
  b.addModel('lock_gate', 0, 0, Math.PI / 2);
  b.addRuin(3.7, 0, 1.7, 2);
}

function buildBridge(b: SiteBuilder, terrain: Terrain): void {
  const deck = deckById('canyon-bridge');
  const bridge = b.addModel('bridge', 0, 0, 0, new THREE.Vector3((deck.length * S) / 32, BRIDGE_RISE, (deck.width * S) / 7));
  // Trucks cross the bridge, which lies outside the site edge.
  bridge.userData.outsideEdge = true;
  poseOnDeck(bridge, deck, soleSegment(terrain, deck), BRIDGE_DECK_TOP * BRIDGE_RISE);
  b.addRuin(0, 0, 3, 2);
}

// The Broken Wing deck model, 156 m by 24 m with its top at the origin, stretched to the sim deck. It stands on the
// deck, not at the site, so addSites scopes it on its own.
function buildWingDeck(t: Terrain): THREE.Group {
  const deck = deckById('broken-wing');
  const root = new THREE.Group();
  root.name = 'landmark-wing-deck';
  const obj = model('wing_deck');
  obj.scale.set((deck.length * S) / WING_DECK_LENGTH, 1, (deck.width * S) / WING_DECK_WIDTH);
  poseOnDeck(obj, deck, soleSegment(t, deck), 0);
  root.add(obj);
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return root;
}

function buildOasis(b: SiteBuilder, well: boolean): void {
  if (well) {
    b.addTank(0, 0, 1.2, 0.8, PAL.wall.side);
    b.addTank(0, 0, 0.9, 0.04, PAL.water, 0.8);
    for (const x of [-1.5, 1.5]) b.addBox(x, 0, 0.18, 2.6, 0.18, PAL.trunk);
    b.addBox(0, 0, 3.3, 0.2, 0.25, PAL.trunk, 2.5);
    b.addRuin(2.7, 2.7, 2.3, 2);
    // The palm model leans, so yaw varies the lean.
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4;
      b.addModel('palm', Math.cos(a) * 4.8, Math.sin(a) * 4.8, a * 2.3);
    }
  } else {
    b.addTank(0, 0, 2.8, 0.04, PAL.waterLight);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      b.addModel('palm', Math.cos(a) * 4, Math.sin(a) * 4, a * 2.3);
    }
  }
}

function buildWrecks(b: SiteBuilder, id: string): void {
  if (id === 'salvage-yard') {
    for (const x of [-3, 0, 3]) {
      b.addBox(x, -2, 2.3, 1.2, 2, PAL.rust.side);
      b.addBox(x, -2, 2.6, 0.12, 2.4, PAL.metalLight, 1.3);
      for (let i = 0; i < 3; i++) b.addBox(x, 1 + i * 0.8, 1.5, 0.5, 0.6, i % 2 ? PAL.metal : PAL.rust.top);
    }
    b.addBox(-3, 1, 0.25, 4, 0.25, PAL.metal);
    b.addBox(-1.5, 1, 3.2, 0.22, 0.22, PAL.metal, 3.8);
    b.addModel('crates', 4.8, 1.8, 0.3);
  } else if (id === 'podfield') {
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

// Torn plates and a crate beside the road past the wing's tip ramp. The deck and the hoop stand clear of the site.
function buildWingSalvage(b: SiteBuilder): void {
  b.addTank(2.5, 2.8, 0.6, 1.4, PAL.rust.top);
  b.addTank(3.8, 2.2, 0.45, 1.1, PAL.rust.dark);
  b.addBox(3, 1.2, 3, 0.15, 1.2, PAL.metalLight, 0.2, -0.3);
  b.addBox(-3, 3, 2.2, 0.9, 1.3, PAL.rust.dark, 0, 0.2);
  b.addBox(-1, 4, 1.8, 0.12, 0.9, PAL.rust.side, 0.1, 0.6);
  b.addModel('crates', -3.8, 2.6, 0.5);
}

// Scrap shacks ring a fire pit. Fuel tanks and a stripped hull fill the gaps.
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

type SiteDecor = (b: SiteBuilder, site: Site, t: Terrain) => void;

const wrecks: SiteDecor = (b, site) => buildWrecks(b, site.id);
const camp: SiteDecor = (b, site) => buildCamp(b, site.id);
const settlement: SiteDecor = (b, site) => buildSettlement(b, site);

// How each site is dressed, by site id.
const SITE_DECOR: Record<string, SiteDecor> = {
  granary: (b) => buildGranary(b),
  'pump-station': (b) => buildPump(b),
  'south-lock': (b) => buildLock(b),
  'canyon-bridge': (b, _site, t) => buildBridge(b, t),
  dustwell: (b) => buildOasis(b, true),
  'green-pit': (b) => buildOasis(b, false),
  'broken-wing': (b) => buildWingSalvage(b),
  nose: settlement,
  bowl: settlement,
  'burnt-convoy': wrecks,
  podfield: wrecks,
  'ridge-wrecks': wrecks,
  'salvage-yard': wrecks,
  scrapjaw: camp,
  kiln: camp,
};

function buildSite(t: Terrain, site: Site): THREE.Group {
  const b = new SiteBuilder(t, site);
  const decor = SITE_DECOR[site.id];
  if (decor === undefined) throw new Error(`Missing landmark model for ${site.id}`);
  decor(b, site, t);
  addWall(b, site, edgeStyle(site));
  // Site models never move after they are built.
  b.root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  return b.root;
}

const UP = new THREE.Vector3(0, 1, 0);
// A territory has no edge, gates or models of its own: its props are baked.
const SITES = [...REGION.towns, ...REGION.locations.filter((l): l is SiteLocationDef => l.kind !== 'territory')];

// Every site model under one group, for inspection.
export function buildSites(t: Terrain): THREE.Group {
  const group = new THREE.Group();
  for (const site of SITES) group.add(buildSite(t, site));
  group.add(buildWingDeck(t));
  return group;
}

// Registers every site model with the scope at its site.
export function addSites(t: Terrain, scope: RenderScope): void {
  for (const site of SITES) scope.add(buildSite(t, site), site.pos, site.radius);
  const deck = deckById('broken-wing');
  scope.add(buildWingDeck(t), { x: deck.from.x + (deck.axis.x * deck.length) / 2, y: deck.from.y + (deck.axis.y * deck.length) / 2 }, deck.length / 2);
}

// Poses a deck model on one straight piece of its sim deck. Broken Wing, Canyon Bridge and the Fallen Sun's wing and
// flaps share it, so every drawn deck follows the deck line from sim/terrain.ts, which the physics deck also follows.
// It puts the model's middle on the piece's middle, pitched along the deck line and turned along the deck axis, so its
// +x runs toward the deck's to end. `top` is meters from the model origin up to its deck top, after scaling.
export function poseOnDeck(obj: THREE.Object3D, deck: Deck, seg: DeckSegment, top: number): void {
  const { axis } = deck;
  const { from, length, h0, h1 } = seg;
  const pitch = Math.atan2((h1 - h0) * S, length * S);
  obj.position.set((from.x + (axis.x * length) / 2) * S, ((h0 + h1) / 2) * S - top, (from.y + (axis.y * length) / 2) * S);
  // YXZ applies the pitch about the model's own z first, then the yaw.
  obj.rotation.set(0, -Math.atan2(axis.y, axis.x), pitch, 'YXZ');
}

// The one straight piece of a deck drawn as a single model, like Canyon Bridge and the Broken Wing deck. A deck with a
// change of grade is a bug for such a view.
export function soleSegment(t: Terrain, deck: Deck): DeckSegment {
  const segments = deckSegments(t, deck);
  if (segments.length !== 1) throw new Error(`Deck ${deck.id} has ${segments.length} pieces, not one`);
  return segments[0];
}
