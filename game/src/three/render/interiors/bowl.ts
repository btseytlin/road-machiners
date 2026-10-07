// Bowl's interior (C1): a terraced crater farm. Crop rows and fruit trees stand on the terraces, stairs climb the
// risers, and the crater floor holds houses in two rings around an off-center pond, a turning windmill, two stilt
// tanks and a greenhouse. Two sheds stand on bastion platforms. The crater itself is baked terrain (pitDepth).
//
// Offsets are site tiles: x is map x, z is map y. Houses, trees and crop rows stand only where every height corner
// of the tiles under their footprint is at one pit depth, so none stands on a riser (IV18). The authored floor pieces
// throw when they do not; the repeated ones are skipped.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { FACTION_COLORS, mix, PAL } from '../../../render/palette';
import { fortressCore, pitDepth } from '../../../sim/fortress';
import type { Site } from '../../../sim/sites';
import { segmentDist, type Vec } from '../../../sim/vec';
import { hash2 } from '../../../render/noise';
import { model, socket, type ModelName } from '../models';
import { spin } from '../site-motion';
import type { SiteBuilder } from '../sites';

const S = PHYSICS.metersPerTile;

// The pond, off center toward the camera's right as in C1, and what stands around it, in tiles.
const POND = { x: 2, z: 0.5, r: 2.6 };
const WINDMILL = { x: 4.1, z: 2.7 }; // on the pond's near shore
const TANKS = [
  { x: 5.6, z: -1.7 },
  { x: 6.2, z: -3.8 },
];
const GREENHOUSE = { x: -4, z: 5, yaw: 0.4, scale: 0.6 }; // the reused quonset, 13 m long
// Houses in two rings around the pond: ring radius in tiles and the tiles between neighbours along it.
const HOUSE_RINGS = [
  { r: 5.4, gap: 2.6 },
  { r: 8.4, gap: 2.6 },
];
const HOUSE_JITTER = { angle: 0.3, radius: 1.2, turn: 0.6 }; // share of a gap, tiles, radians
const HOUSE_SPAN = 2.4; // tiles, a house's footprint with its eaves (8.7 m by 6.7 m) turned any way
const HOUSES: ModelName[] = ['bowl_house_rust', 'bowl_house_red', 'bowl_house_grey'];
// Every flat pit tile out to FIELD_REACH tiles in from the curtain is planted, as C1's terraces are: two crop rows
// along the nearest curtain side, or a fruit tree. Each row piece is a short hedge of crops that stays in its tile.
const FIELD_REACH = 12.5;
const ROW = { length: 0.7, width: 0.26, height: 0.3, apart: 0.5 };
const TREE_SHARE = 0.16; // share of planted tiles that hold a tree
const TREE_SPAN = 0.9; // tiles, a fruit tree's crown
const STAIR = { at: 0.32, from: 1, to: 11.4, step: 0.3, width: 0.9, height: 0.3 }; // `at`: share along each side
const SHEDS = [4, 2]; // the bastions that carry a shed, by core corner index
const SHED_OUT = 1.2; // tiles out of the enclosure's corner toward the bastion's salient, onto its platform
const FENCE = { r: POND.r + 0.5, posts: 14, height: 0.28 };

const CROP = mix(FACTION_COLORS.bowl.top, PAL.palm, 0.3);
const STAIR_COLOR = PAL.wall.side;

type Side = { a: Vec; b: Vec; length: number; along: Vec; inward: Vec };
type Spot = { x: number; z: number; yaw: number };
type Disc = { x: number; z: number; r: number };

export function buildBowl(b: SiteBuilder, site: Site): void {
  const taken: Disc[] = [];
  buildFloor(b, site, taken);
  b.root.userData.homes = addHouses(b, site, taken);
  addTerraces(b, site, taken);
  addSheds(b, site);
}

// The pond, its fence, the windmill, the tanks and the greenhouse. Each claims its ground first.
function buildFloor(b: SiteBuilder, site: Site, taken: Disc[]): void {
  requireFlat(site, POND.x, POND.z, 2 * POND.r + 1, 'pond');
  b.addTank(POND.x, POND.z, POND.r, 0.05, PAL.water);
  b.addBox(POND.x - 1.2, POND.z - 1.6, 1.4, 0.08, 0.5, PAL.crate, 0.05, 0.6);
  addPondFence(b);
  taken.push({ ...POND, r: POND.r + 1.4 });
  addWindmill(b, site);
  taken.push({ ...WINDMILL, r: 1.5 });
  for (const tank of TANKS) {
    requireFlat(site, tank.x, tank.z, 1.4, 'stilt tank');
    b.addModel('stilt_tank', tank.x, tank.z, 0.3);
    taken.push({ ...tank, r: 1.5 });
  }
  requireFlat(site, GREENHOUSE.x, GREENHOUSE.z, 3.6, 'greenhouse');
  b.addModel('quonset', GREENHOUSE.x, GREENHOUSE.z, GREENHOUSE.yaw, GREENHOUSE.scale);
  taken.push({ ...GREENHOUSE, r: 2.6 });
}

// A rail on posts around the pond, open on the windmill's side.
function addPondFence(b: SiteBuilder): void {
  const gap = Math.atan2(WINDMILL.z - POND.z, WINDMILL.x - POND.x);
  const step = (2 * Math.PI) / FENCE.posts;
  const chord = 2 * FENCE.r * Math.sin(step / 2);
  for (let i = 0; i < FENCE.posts; i++) {
    const a = (i + 0.5) * step;
    if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < step) continue;
    const x = POND.x + Math.cos(a) * FENCE.r;
    const z = POND.z + Math.sin(a) * FENCE.r;
    b.addBox(x, z, 0.06, 0.06, chord, PAL.trunk, FENCE.height - 0.06, -a);
    b.addBox(x, z, 0.08, FENCE.height, 0.08, PAL.trunk, 0, -a);
  }
}

// The windmill faces the camera a little from the side, so its wheel reads as a turning disc.
function addWindmill(b: SiteBuilder, site: Site): void {
  requireFlat(site, WINDMILL.x, WINDMILL.z, 1.2, 'windmill');
  const tower = b.addModel('windmill_tower', WINDMILL.x, WINDMILL.z, -Math.PI / 4 + 0.4);
  const rotor = model('windmill_rotor');
  rotor.name = 'windmill-rotor';
  rotor.position.copy(socket('windmill_tower', 'rotor'));
  tower.add(rotor);
  b.addMover(rotor, spin(new THREE.Vector3(1, 0, 0), 3));
}

// Houses on the flat floor in rings around the pond, front doors toward the water. Returns how many stand.
function addHouses(b: SiteBuilder, site: Site, taken: Disc[]): number {
  const spots = HOUSE_RINGS.flatMap((ring, k) => ringSpots(ring.r, ring.gap, k * 0.5)).filter((s) => isFloorSpot(site, s, HOUSE_SPAN, taken));
  for (const s of spots) taken.push({ x: s.x, z: s.z, r: HOUSE_SPAN / 2 + 0.3 });
  HOUSES.forEach((name, k) => {
    const mine = spots.filter((_, i) => i % HOUSES.length === k);
    if (mine.length > 0) b.addInstances(name, mine).name = 'bowl-houses';
  });
  return spots.length;
}

// Spots on a ring around the pond, each turned so its +x faces the pond. Each is shifted and turned a little by a
// fixed hash, so the rings read as a village rather than a pattern.
function ringSpots(r: number, gap: number, offset: number): Spot[] {
  const count = Math.floor((2 * Math.PI * r) / gap);
  return Array.from({ length: count }, (_, i) => {
    const a = ((i + offset + (hash2(i, r) - 0.5) * HOUSE_JITTER.angle) * 2 * Math.PI) / count;
    const at = r + (hash2(r, i) - 0.5) * HOUSE_JITTER.radius;
    const yaw = -Math.atan2(-Math.sin(a), -Math.cos(a)) + (hash2(i + 7, r) - 0.5) * HOUSE_JITTER.turn;
    return { x: POND.x + Math.cos(a) * at, z: POND.z + Math.sin(a) * at, yaw };
  });
}

function isFloorSpot(site: Site, s: Spot, span: number, taken: Disc[]): boolean {
  return flatDepth(site, s.x, s.z, span) !== null && !taken.some((d) => Math.hypot(d.x - s.x, d.z - s.z) < d.r + span / 2);
}

// Stairs down every curtain side, then crops and trees on every flat terrace tile clear of them and the floor pieces.
function addTerraces(b: SiteBuilder, site: Site, taken: Disc[]): void {
  const sides = curtainSides(site);
  const stairs = sides.flatMap((side) => sideStair(site, side));
  const clear = [...taken, ...stairs.map((s) => ({ x: s.x, z: s.z, r: STAIR.width }))];
  const rows: Spot[] = [];
  const trees: Spot[] = [];
  for (const tile of fieldTiles(site, sides, clear)) plantTile(site, tile, rows, trees);
  b.root.add(boxes('bowl-crops', rows, { w: ROW.length, h: ROW.height, d: ROW.width }, CROP, b));
  b.root.add(boxes('bowl-stairs', stairs, { w: STAIR.width, h: STAIR.height, d: STAIR.step }, STAIR_COLOR, b));
  b.addInstances('fruit_tree', trees).name = 'bowl-trees';
}

// The sides of the main enclosure with their direction and the normal into the site. The pit follows them.
function curtainSides(site: Site): Side[] {
  const outline = fortressCore(site);
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const left = { x: -along.y, y: along.x };
    const toCenter = (site.pos.x - a.x) * left.x + (site.pos.y - a.y) * left.y;
    return { a, b, length, along, inward: toCenter > 0 ? left : { x: -left.x, y: -left.y } };
  });
}

// The site offset `s` tiles along a side and `d` tiles in from it.
function onSide(site: Site, side: Side, s: number, d: number): Vec {
  return { x: side.a.x + side.along.x * s + side.inward.x * d - site.pos.x, y: side.a.y + side.along.y * s + side.inward.y * d - site.pos.y };
}

// The centers of the flat pit tiles within FIELD_REACH of the curtain and clear of the floor pieces, as spots turned
// along their nearest curtain side.
function fieldTiles(site: Site, sides: Side[], clear: Disc[]): Spot[] {
  const tiles: Spot[] = [];
  const reach = Math.ceil(site.radius);
  for (let x = Math.floor(site.pos.x) - reach; x < site.pos.x + reach; x++) {
    for (let y = Math.floor(site.pos.y) - reach; y < site.pos.y + reach; y++) {
      const tile = fieldTile(site, sides, { x: x + 0.5, y: y + 0.5 });
      if (tile !== null && !clear.some((d) => Math.hypot(d.x - tile.x, d.z - tile.z) < d.r + 0.5)) tiles.push(tile);
    }
  }
  return tiles;
}

function fieldTile(site: Site, sides: Side[], c: Vec): Spot | null {
  const depth = flatRect(site, { x: c.x - site.pos.x, z: c.y - site.pos.y, yaw: 0 }, 0.98, 0.98);
  if (depth === null || depth === 0) return null;
  const near = sides.map((side) => ({ side, d: segmentDist(c, side.a, side.b) })).sort((m, n) => m.d - n.d)[0];
  if (near.d > FIELD_REACH) return null;
  return { x: c.x - site.pos.x, z: c.y - site.pos.y, yaw: -Math.atan2(near.side.along.y, near.side.along.x) };
}

// A tree, or two crop rows across the tile, each kept only where the pit depth is one across its footprint.
function plantTile(site: Site, tile: Spot, rows: Spot[], trees: Spot[]): void {
  const h = hash2(tile.x + site.pos.x, tile.z + site.pos.y);
  if (h < TREE_SHARE) {
    const tree = { ...tile, yaw: h * 40 };
    if (levelUnder(site, tree, TREE_SPAN, TREE_SPAN)) trees.push(tree);
    return;
  }
  for (const k of [-0.5, 0.5]) {
    const row = { x: tile.x + Math.sin(tile.yaw) * k * ROW.apart, z: tile.z + Math.cos(tile.yaw) * k * ROW.apart, yaw: tile.yaw };
    if (levelUnder(site, row, ROW.length, ROW.width)) rows.push(row);
  }
}

// Whether the pit depth is one at the corners and center of a w by d footprint turned by the spot's yaw.
function levelUnder(site: Site, s: Spot, w: number, d: number): boolean {
  const ax = Math.cos(s.yaw);
  const az = -Math.sin(s.yaw);
  const points = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]].map(([i, j]) => ({
    x: site.pos.x + s.x + (ax * i * w) / 2 - (az * j * d) / 2,
    y: site.pos.y + s.z + (az * i * w) / 2 + (ax * j * d) / 2,
  }));
  return new Set(points.map((p) => pitDepth(site, p))).size === 1;
}

// Steps down the risers from the rim to the floor, one flight per side. Flat ground between risers gets no step.
function sideStair(site: Site, side: Side): Spot[] {
  const yaw = -Math.atan2(side.along.y, side.along.x);
  const steps: Spot[] = [];
  for (let d = STAIR.from; d <= STAIR.to; d += STAIR.step) {
    const p = onSide(site, side, side.length * STAIR.at, d);
    if (flatRect(site, { x: p.x, z: p.y, yaw }, STAIR.width, STAIR.step) === null) steps.push({ x: p.x, z: p.y, yaw });
  }
  return steps;
}

// Scrap sheds on two bastion platforms, facing the crater.
function addSheds(b: SiteBuilder, site: Site): void {
  const core = fortressCore(site);
  for (const corner of SHEDS) {
    const v = core[corner];
    const d = Math.hypot(v.x - site.pos.x, v.y - site.pos.y);
    const out = { x: (v.x - site.pos.x) / d, y: (v.y - site.pos.y) / d };
    b.addModel('shack', v.x - site.pos.x + out.x * SHED_OUT, v.y - site.pos.y + out.y * SHED_OUT, -Math.atan2(-out.y, -out.x));
  }
}

// One instanced mesh of boxes, one per spot, standing on the ground with their width along the spot's yaw.
function boxes(name: string, spots: Spot[], size: { w: number; h: number; d: number }, color: number, b: SiteBuilder): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size.w * S, size.h * S, size.d * S), new THREE.MeshLambertMaterial({ color, flatShading: true }), spots.length);
  mesh.name = name;
  const turn = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    const at = new THREE.Vector3((b.site.pos.x + s.x) * S, (b.groundAt(s.x, s.z) + size.h / 2) * S, (b.site.pos.y + s.z) * S);
    mesh.setMatrixAt(i, new THREE.Matrix4().compose(at, turn.setFromAxisAngle(UP, s.yaw), one));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);

function requireFlat(site: Site, x: number, z: number, span: number, what: string): void {
  if (flatDepth(site, x, z, span) === null) throw new Error(`Bowl ${what} at ${x},${z} does not stand on one flat pit level`);
}

// The pit depth under a square of span tiles centered at site offset (x, z), or null when its tiles are not flat.
function flatDepth(site: Site, x: number, z: number, span: number): number | null {
  return flatRect(site, { x, z, yaw: 0 }, span, span);
}

// The pit depth under a w by d rectangle turned by the spot's yaw, or null when any height corner of the tiles
// under it lies at another depth.
function flatRect(site: Site, s: Spot, w: number, d: number): number | null {
  const ax = Math.cos(s.yaw);
  const az = -Math.sin(s.yaw);
  const reachX = (Math.abs(ax) * w + Math.abs(az) * d) / 2;
  const reachZ = (Math.abs(az) * w + Math.abs(ax) * d) / 2;
  const cx = site.pos.x + s.x;
  const cz = site.pos.y + s.z;
  const depths = new Set<number>();
  for (let x = Math.floor(cx - reachX); x <= Math.ceil(cx + reachX); x++) {
    for (let z = Math.floor(cz - reachZ); z <= Math.ceil(cz + reachZ); z++) depths.add(pitDepth(site, { x, y: z }));
  }
  return depths.size === 1 ? [...depths][0] : null;
}
