// Nose's interior (C5): the Fallen Sun's nose and broken hull perched on a rock rise across the back of the ring, its
// torn stern running into a crag at the back right, and in front of it an open sandy yard built up with scrap shelters,
// a two-level timber platform with stairs up the rise, a red awning, a water tower, a jib crane and a van.
//
// The layout is authored in the ship's frame, from the south gate: u runs along the ship toward its nose, v runs back,
// away from that gate, and both are in tiles from the site center. The frame is derived from fortressGates(), so it
// follows the gates wherever the site's turn puts them. nose_rise and nose_crag are authored in this frame in meters
// (tools/blender/nose_rock_kit.py), with +x along u and +y toward the gate. The ship rests on the rise's two sockets, so
// its pose is the rise's decision. The radar dish on its nose turns.
//
// Offsets are site tiles: x is map x, z is map y.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { PAL } from '../../../render/palette';
import { hash2 } from '../../../render/noise';
import { fortressGates, type FortGate } from '../../../sim/fortress';
import type { Site } from '../../../sim/sites';
import { model, socket, type ModelName } from '../models';
import { spin } from '../site-motion';
import { fitsCurtain, type SiteBuilder } from '../sites';

const S = PHYSICS.metersPerTile;
const ROLL = THREE.MathUtils.degToRad(-4); // the ship's top leans toward the gate
// The ship's sections, each origin in meters along the ship from the nose joint. ship_nose and the hull rings and ribs
// have their origin at their rear joint; the stern has its origin at its front joint and runs back.
const SECTIONS: readonly { name: ModelName; at: number }[] = [
  { name: 'ship_nose', at: 0 },
  { name: 'ship_hull_ring', at: -45 },
  { name: 'ship_hull_ribs', at: -90 },
  { name: 'ship_hull_stern', at: -90 },
];
const DISH_TURN = 8; // seconds per turn of the radar dish
const DISH_SCALE = 1.5; // the 10 m dish on a 36 m hull
// The rise stands this far back from the center, in tiles, along its straight front edge, and its hole leaves the WNW
// gate's open ground. Both are authored in nose_rise.py, so the code checks the gate against them.
export const RISE = { front: 1, clip: 30, hole: { u: 23, v: 20, r: 8.5 } };
const HOLE_TOLERANCE = 1; // tiles the WNW gate may lie off the hole's center

// The yard's open ground at each gate, in tiles past half the gate's width. It is the 34 m disc nose_rise leaves bare.
export const GATE_CLEAR = 5.5;
// A shelter's scale ranges over `scale`, and its footprint disc is `reach` tiles of radius per unit of scale.
const SHELTER = { scale: [1.1, 1.4], reach: 1.1, gap: 0.3, rows: 3.9, along: 3.9, rowStart: 4.3, jitter: { u: 0.45, v: 0.45, yaw: 0.2 }, lane: 2, skip: 0.1 };
const SCAFFOLD_RUN = [-10, -7, -4, -1]; // u of each two-level platform, which are 3 tiles long
const SCAFFOLD_BACK = 0.7; // tiles from a scaffold's center to the terrace face behind it
const AWNING = { u: 5, v: -4.6, w: 3.6, d: 2.8, lift: 1, post: 0.1 };
const WATER_TOWER = { u: 15, v: -7.5, scale: 1.25 };
const JIB_CRANE = { u: 20, v: -4.5 };
const VAN = { u: -8, v: -17, yaw: 0.5 };
const CRATES = [
  { u: 16.5, v: -3 },
  { u: 2, v: -6.5 },
  { u: -13, v: -4 },
  { u: 9, v: -12 },
  { u: -3, v: -11.5 },
  { u: 12.5, v: -17 },
];
const RUBBLE = { count: 44, scale: [2, 6], reach: 29.3 }; // rocks along the terrace foot, in meters of radius
const ROCK_SINK = 0.25 * 1.1;
const UP = new THREE.Vector3(0, 1, 0);

type Disc = { x: number; z: number; r: number };
type Spot = { x: number; z: number; yaw: number };
type Shelter = Spot & { scale: number; r: number };

// The ship's frame at a site: unit u and v in site offsets, and the yaws that turn a model's +x along u and toward the gate.
type Frame = { u: { x: number; z: number }; v: { x: number; z: number }; yaw: number; faceYaw: number; south: FortGate; wnw: FortGate };

function frameOf(site: Site): Frame {
  const gates = fortressGates(site);
  if (gates.length !== 2) throw new Error(`Nose has ${gates.length} gates, and its interior is laid out for two`);
  const [south, wnw] = gates[0].out.y > gates[1].out.y ? gates : [gates[1], gates[0]];
  const g = south.out;
  return { u: { x: -g.y, z: g.x }, v: { x: -g.x, z: -g.y }, yaw: Math.atan2(-g.x, -g.y), faceYaw: -Math.atan2(g.y, g.x), south, wnw };
}

function placeAt(f: Frame, u: number, v: number): { x: number; z: number } {
  return { x: u * f.u.x + v * f.v.x, z: u * f.u.z + v * f.v.z };
}

export function buildNose(b: SiteBuilder, site: Site): void {
  const f = frameOf(site);
  checkHole(site, f);
  addMasses(b, f);
  const taken = gateDiscs(site);
  addYard(b, f, taken);
  b.root.userData.homes = addShelters(b, site, f, taken);
  addRubble(b, site, f, gateDiscs(site));
  b.root.userData.structures = taken;
}

// The WNW gate must lie where nose_rise leaves its hole, or the rise would cover the gate's ground.
function checkHole(site: Site, f: Frame): void {
  const at = { x: f.wnw.face.x - site.pos.x, z: f.wnw.face.y - site.pos.y };
  const u = at.x * f.u.x + at.z * f.u.z;
  const v = at.x * f.v.x + at.z * f.v.z;
  if (Math.hypot(u - RISE.hole.u, v - RISE.hole.v) > HOLE_TOLERANCE) throw new Error(`Nose's WNW gate lies at u ${u.toFixed(1)}, v ${v.toFixed(1)}, not at the hole of nose_rise (${RISE.hole.u}, ${RISE.hole.v})`);
}

// The rise and the crag in the frame, and the ship resting on the rise's two sockets: its group stands at the front
// socket and leans to the rear one. The sections rest in it, and the radar dish turns on the nose.
function addMasses(b: SiteBuilder, f: Frame): void {
  const frame = new THREE.Group();
  frame.name = 'nose-frame';
  frame.position.set(b.site.pos.x * S, b.groundAt(0, 0) * S, b.site.pos.y * S);
  frame.rotation.y = f.yaw;
  b.root.add(frame);
  const rise = model('nose_rise');
  rise.name = 'nose-rise';
  const crag = model('nose_crag');
  crag.name = 'nose-crag';
  frame.add(rise, crag);
  const front = socket('nose_rise', 'ship_front');
  const rear = socket('nose_rise', 'ship_rear');
  const ship = new THREE.Group();
  ship.name = 'nose-ship';
  ship.position.copy(front);
  ship.rotation.set(ROLL, 0, Math.atan2(front.y - rear.y, front.x - rear.x), 'ZXY');
  frame.add(ship);
  const sections = SECTIONS.map(({ name, at }) => {
    const section = model(name);
    section.name = 'nose-ship-section';
    section.position.set(at, 0, 0);
    ship.add(section);
    return section;
  });
  const dish = model('radar_dish');
  dish.name = 'nose-radar-dish';
  dish.scale.setScalar(DISH_SCALE);
  dish.position.copy(socket('ship_nose', 'dish'));
  sections[0].add(dish);
  b.addMover(dish, spin(UP, DISH_TURN));
}

// The open ground inside each gate.
function gateDiscs(site: Site): Disc[] {
  return fortressGates(site).map((g) => ({ x: g.face.x - site.pos.x, z: g.face.y - site.pos.y, r: g.width / 2 + GATE_CLEAR }));
}

// The platforms along the terrace foot, the awning, the water tower, the jib crane, crates and the van. Each claims its ground.
function addYard(b: SiteBuilder, f: Frame, taken: Disc[]): void {
  for (const u of SCAFFOLD_RUN) {
    const p = placeAt(f, u, RISE.front - SCAFFOLD_BACK);
    b.addModel('hull_scaffold', p.x, p.z, f.faceYaw).name = 'nose-scaffold';
    taken.push({ ...p, r: 2.2 });
  }
  addAwning(b, f, taken);
  const tower = placeAt(f, WATER_TOWER.u, WATER_TOWER.v);
  b.addModel('water_tower', tower.x, tower.z, f.faceYaw, WATER_TOWER.scale).name = 'nose-water-tower';
  taken.push({ ...tower, r: 1.8 });
  const crane = placeAt(f, JIB_CRANE.u, JIB_CRANE.v);
  b.addModel('jib_crane', crane.x, crane.z, f.faceYaw + Math.PI / 2).name = 'nose-jib-crane';
  taken.push({ ...crane, r: 2.6 });
  for (const [i, c] of CRATES.entries()) {
    const p = placeAt(f, c.u, c.v);
    b.addModel('crates', p.x, p.z, i * 1.3);
    taken.push({ ...p, r: 1 });
  }
  const p = placeAt(f, VAN.u, VAN.v);
  const van = b.addModel('base_van', p.x, p.z, f.faceYaw + VAN.yaw);
  van.name = 'nose-van';
  van.updateMatrixWorld(true);
  van.position.y -= new THREE.Box3().setFromObject(van).min.y - van.position.y;
  taken.push({ ...p, r: 1.4 });
}

// C5's red open awning: a roof on four posts.
function addAwning(b: SiteBuilder, f: Frame, taken: Disc[]): void {
  const { w, d, lift, post } = AWNING;
  const p = placeAt(f, AWNING.u, AWNING.v);
  b.addBox(p.x, p.z, w, 0.08, d, PAL.roof[2], lift, f.faceYaw).name = 'nose-awning';
  for (const [i, j] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const q = placeAt(f, AWNING.u + i * (w / 2 - post), AWNING.v + j * (d / 2 - post));
    b.addBox(q.x, q.z, post, lift, post, PAL.trunk, 0, f.faceYaw);
  }
  taken.push({ ...p, r: 2.4 });
}

// Shelters in loose rows with alleys, from the terrace toward the south gate, each clear of the curtain, the gates, a
// lane to the south gate and every other structure. Returns how many stand.
function addShelters(b: SiteBuilder, site: Site, f: Frame, taken: Disc[]): number {
  const placed = shelterRows(site, f, taken);
  b.addInstances('scrap_shelter_flat', placed.filter((_, i) => hash2(i, 50) < 0.5)).name = 'nose-shelters';
  b.addInstances('scrap_shelter_lean', placed.filter((_, i) => hash2(i, 50) >= 0.5)).name = 'nose-shelters';
  return placed.length;
}

function shelterRows(site: Site, f: Frame, taken: Disc[]): Shelter[] {
  const placed: Shelter[] = [];
  for (let row = 0; RISE.front - SHELTER.rowStart - row * SHELTER.rows >= -site.radius; row++) {
    const v = RISE.front - SHELTER.rowStart - row * SHELTER.rows;
    for (let k = -10; k <= 10; k++) {
      const u = k * SHELTER.along + (row % 2) * (SHELTER.along / 2);
      const spot = shelterSpot(f, u, v, row, k);
      if (hash2(row * 5 + 1, k + 77) < SHELTER.skip || !shelterFits(site, spot, taken, f)) continue;
      taken.push({ x: spot.x, z: spot.z, r: spot.r });
      placed.push(spot);
    }
  }
  return placed;
}

// A candidate near a row's slot, in a size of its own. Most doors face the gate, the rest along the ship either way.
function shelterSpot(f: Frame, u: number, v: number, row: number, k: number): Shelter {
  const jitter = (a: number, b: number) => (hash2(a, b) - 0.5) * 2;
  const facing = hash2(row + 100, k);
  const turn = facing < 0.7 ? 0 : facing < 0.85 ? Math.PI / 2 : -Math.PI / 2;
  const [lo, hi] = SHELTER.scale;
  const scale = lo + (hi - lo) * hash2(k + 31, row * 11 + 2);
  const yaw = f.faceYaw + turn + jitter(row * 7 + k, 19) * SHELTER.jitter.yaw;
  return { ...placeAt(f, u + jitter(row * 17 + k, 3) * SHELTER.jitter.u, v + jitter(k + 29, row * 13 + 5) * SHELTER.jitter.v), yaw, scale, r: SHELTER.reach * scale };
}

function shelterFits(site: Site, spot: Shelter, taken: Disc[], f: Frame): boolean {
  if (!fitsCurtain(site, spot.x, spot.z, 2 * spot.r, 2 * spot.r)) return false;
  const v = spot.x * f.v.x + spot.z * f.v.z;
  if (v > RISE.front - SHELTER.rowStart + 1) return false;
  const u = spot.x * f.u.x + spot.z * f.u.z;
  if (Math.abs(u) < SHELTER.lane && v < -8) return false;
  return !taken.some((d) => Math.hypot(d.x - spot.x, d.z - spot.z) < d.r + spot.r + SHELTER.gap);
}

// Rubble along the terrace foot, as one instanced rock model, each rock inside the curtain and clear of the structures.
function addRubble(b: SiteBuilder, site: Site, f: Frame, gates: Disc[]): void {
  const rocks: (Spot & { scale: number; lift: number })[] = [];
  const [lo, hi] = RUBBLE.scale;
  for (let i = 0; i < RUBBLE.count; i++) {
    const u = (hash2(i * 7 + 1, 5) - 0.5) * 2 * 26;
    const v = RISE.front - 0.2 - hash2(i * 7 + 2, 9) * 1.4;
    const p = placeAt(f, u, v);
    const scale = lo + (hi - lo) * hash2(i * 7 + 3, 11);
    const r = scale / S;
    if (Math.hypot(p.x, p.z) + r > RUBBLE.reach || gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < g.r + r)) continue;
    if (SCAFFOLD_RUN.some((su) => Math.abs(su - u) < 2.4)) continue;
    if (!fitsCurtain(site, p.x, p.z, r, r)) continue;
    rocks.push({ ...p, yaw: hash2(i * 7 + 4, 13) * 2 * Math.PI, scale, lift: (-ROCK_SINK * scale) / S });
  }
  b.addInstances('rock', rocks).name = 'nose-rocks';
}
