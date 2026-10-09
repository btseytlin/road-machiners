// Nose's interior (C5): the Fallen Sun's nose and broken hull perched on a rock rise across the back of the ring, its
// torn stern running into a crag at the back right, and in front of it an open sandy yard built up with scrap shelters,
// a two-level timber platform with stairs up the rise, a red awning, a water tower, a jib crane and a van.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { hash2 } from '../../../render/noise';
import { fortressGates, type FortGate } from '../../../sim/fortress';
import { boxDistance, propBoxes, propObstacle, type PosedBox } from '../../../sim/mapgen';
import { noseFrame, noseRocks } from '../../../sim/nose';
import type { Site } from '../../../sim/sites';
import { model, socket, type ModelName } from '../models';
import { spin } from '../site-motion';
import { fitsCurtain, type SiteBuilder } from '../sites';

const S = PHYSICS.metersPerTile;
const ROLL = THREE.MathUtils.degToRad(-4);
const SECTIONS: readonly { name: ModelName; at: number }[] = [
  { name: 'ship_nose', at: 0 },
  { name: 'ship_hull_ring', at: -45 },
  { name: 'ship_hull_ribs', at: -90 },
  { name: 'ship_hull_stern', at: -90 },
];
const DISH_TURN = 8;
const DISH_SCALE = 1.5;
export const RISE = { front: 1, bend: { u: -26.25, slope: 1.6 }, west: 10.25, hole: { u: 23, v: 20, r: 8.5 } };

export function riseFront(u: number): number {
  return RISE.front - Math.max(0, RISE.bend.u - u) * RISE.bend.slope;
}
const HOLE_TOLERANCE = 1;

export const GATE_CLEAR = 5.5;
const SHELTER = { scale: [1.1, 1.4], reach: 1.1, gap: 0.3, rows: 3.9, along: 3.9, rowStart: 4.3, rockClear: 2, jitter: { u: 0.45, v: 0.45, yaw: 0.2 }, lane: 2, skip: 0.1 };
const SCAFFOLD_RUN = [-10, -7, -4, -1];
const SCAFFOLD_BACK = 0.7;
const AWNING = {
  u: 5,
  v: -4.6,
  scale: 1.3,
  goods: [
    { model: 'crates', u: -0.6, v: 0.2 },
    { model: 'crates', u: 0.5, v: 0.3 },
    { model: 'drums', u: 1.1, v: -0.3 },
  ] as const satisfies readonly { model: ModelName; u: number; v: number }[],
};
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
  { u: 10.5, v: 15.5 },
];
const LAMPS = { rows: [-1.5, -4, -6.5, -9, -11.5, -14, -16.5, -19, -21.5], along: 2, reach: 26, count: 14, gap: 2.5, keepOut: 0.6, span: 0.4 };
const RUBBLE = { count: 44, scale: [2, 6], reach: 29.3 };
const ROCK_SINK = 0.25 * 1.1;
const UP = new THREE.Vector3(0, 1, 0);

type Disc = { x: number; z: number; r: number };
type Spot = { x: number; z: number; yaw: number };
type Shelter = Spot & { scale: number; r: number };

type Frame = { u: { x: number; z: number }; v: { x: number; z: number }; yaw: number; faceYaw: number; south: FortGate; wnw: FortGate };

function frameOf(site: Site): Frame {
  const { u, v, yaw, south, wnw } = noseFrame(site);
  const g = south.out;
  return { u: { x: u.x, z: u.y }, v: { x: v.x, z: v.y }, yaw: -yaw, faceYaw: -Math.atan2(g.y, g.x), south, wnw };
}

function placeAt(f: Frame, u: number, v: number): { x: number; z: number } {
  return { x: u * f.u.x + v * f.v.x, z: u * f.u.z + v * f.v.z };
}

export function buildNose(b: SiteBuilder, site: Site): void {
  const f = frameOf(site);
  checkHole(site, f);
  addShip(b, f);
  const taken = gateDiscs(site);
  addYard(b, f, taken);
  b.root.userData.homes = addShelters(b, site, f, taken);
  addRubble(b, site, f, [...gateDiscs(site), ...taken]);
  b.root.userData.structures = taken;
  lampSpots(site, f, taken).forEach((s, i) => b.addLantern(s.x, s.z, i * 0.7));
}

function lampSpots(site: Site, f: Frame, taken: Disc[]): Spot[] {
  return spreadOut(lampCandidates(f).filter((c) => lampFits(site, taken, c)).map((c) => c.s));
}

function lampCandidates(f: Frame): { s: Spot; u: number; v: number }[] {
  const all: { s: Spot; u: number; v: number }[] = [];
  for (const v of LAMPS.rows) {
    for (let u = -LAMPS.reach; u <= LAMPS.reach; u += LAMPS.along) all.push({ s: { ...placeAt(f, u, v), yaw: 0 }, u, v });
  }
  return all;
}

function lampFits(site: Site, taken: Disc[], c: { s: Spot; u: number; v: number }): boolean {
  if (Math.abs(c.u) < SHELTER.lane && c.v < -8) return false;
  return fitsCurtain(site, c.s.x, c.s.z, LAMPS.span, LAMPS.span) && !taken.some((d) => Math.hypot(d.x - c.s.x, d.z - c.s.z) < d.r + LAMPS.keepOut);
}

function spreadOut(free: Spot[]): Spot[] {
  const chosen: Spot[] = [];
  while (chosen.length < LAMPS.count && free.length > 0) {
    const apart = (s: Spot) => Math.min(...chosen.map((c) => Math.hypot(c.x - s.x, c.z - s.z)), Infinity);
    const best = free.reduce((m, s) => (apart(s) > apart(m) ? s : m));
    if (apart(best) < LAMPS.gap) break;
    chosen.push(best);
    free.splice(free.indexOf(best), 1);
  }
  return chosen;
}

function checkHole(site: Site, f: Frame): void {
  const at = { x: f.wnw.face.x - site.pos.x, z: f.wnw.face.y - site.pos.y };
  const u = at.x * f.u.x + at.z * f.u.z;
  const v = at.x * f.v.x + at.z * f.v.z;
  if (Math.hypot(u - RISE.hole.u, v - RISE.hole.v) > HOLE_TOLERANCE) throw new Error(`Nose's WNW gate lies at u ${u.toFixed(1)}, v ${v.toFixed(1)}, not at the hole of nose_rise (${RISE.hole.u}, ${RISE.hole.v})`);
}

function addShip(b: SiteBuilder, f: Frame): void {
  const frame = new THREE.Group();
  frame.name = 'nose-frame';
  frame.position.set(b.site.pos.x * S, b.groundAt(0, 0) * S, b.site.pos.y * S);
  frame.rotation.y = f.yaw;
  b.root.add(frame);
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

function gateDiscs(site: Site): Disc[] {
  return fortressGates(site).map((g) => ({ x: g.face.x - site.pos.x, z: g.face.y - site.pos.y, r: g.width / 2 + GATE_CLEAR }));
}

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

function addAwning(b: SiteBuilder, f: Frame, taken: Disc[]): void {
  const p = placeAt(f, AWNING.u, AWNING.v);
  b.addModel('lean_to', p.x, p.z, f.faceYaw, AWNING.scale).name = 'nose-awning';
  for (const [k, goods] of AWNING.goods.entries()) {
    const q = placeAt(f, AWNING.u + goods.u, AWNING.v + goods.v);
    b.addModel(goods.model, q.x, q.z, f.faceYaw + k);
  }
  taken.push({ ...p, r: 2.4 });
}

function addShelters(b: SiteBuilder, site: Site, f: Frame, taken: Disc[]): number {
  const placed = shelterRows(site, f, taken);
  b.addInstances('scrap_shelter_flat', placed.filter((_, i) => hash2(i, 50) < 0.5)).name = 'nose-shelters';
  b.addInstances('scrap_shelter_lean', placed.filter((_, i) => hash2(i, 50) >= 0.5)).name = 'nose-shelters';
  return placed.length;
}

function shelterRows(site: Site, f: Frame, taken: Disc[]): Shelter[] {
  const placed: Shelter[] = [];
  const rock = noseRocks(site).flatMap((p, k) => propBoxes(propObstacle(p, k)));
  const first = -Math.ceil((site.radius + RISE.front) / SHELTER.rows);
  for (let row = first; RISE.front - SHELTER.rowStart - row * SHELTER.rows >= -site.radius; row++) {
    const v = RISE.front - SHELTER.rowStart - row * SHELTER.rows;
    for (let k = -10; k <= 10; k++) {
      const u = k * SHELTER.along + Math.abs(row % 2) * (SHELTER.along / 2);
      const spot = shelterSpot(f, u, v, row, k);
      if (hash2(row * 5 + 1, k + 77) < SHELTER.skip || !shelterFits(site, spot, taken, f, rock)) continue;
      taken.push({ x: spot.x, z: spot.z, r: spot.r });
      placed.push(spot);
    }
  }
  return placed;
}

function shelterSpot(f: Frame, u: number, v: number, row: number, k: number): Shelter {
  const jitter = (a: number, b: number) => (hash2(a, b) - 0.5) * 2;
  const facing = hash2(row + 100, k);
  const turn = facing < 0.7 ? 0 : facing < 0.85 ? Math.PI / 2 : -Math.PI / 2;
  const [lo, hi] = SHELTER.scale;
  const scale = lo + (hi - lo) * hash2(k + 31, row * 11 + 2);
  const yaw = f.faceYaw + turn + jitter(row * 7 + k, 19) * SHELTER.jitter.yaw;
  return { ...placeAt(f, u + jitter(row * 17 + k, 3) * SHELTER.jitter.u, v + jitter(k + 29, row * 13 + 5) * SHELTER.jitter.v), yaw, scale, r: SHELTER.reach * scale };
}

function shelterFits(site: Site, spot: Shelter, taken: Disc[], f: Frame, rock: readonly PosedBox[]): boolean {
  if (!fitsCurtain(site, spot.x, spot.z, 2 * spot.r, 2 * spot.r)) return false;
  const at = { x: site.pos.x + spot.x, y: site.pos.y + spot.z };
  if (rock.some((b) => boxDistance(b, at) < SHELTER.rockClear)) return false;
  const v = spot.x * f.v.x + spot.z * f.v.z;
  const u = spot.x * f.u.x + spot.z * f.u.z;
  if (Math.abs(u) < SHELTER.lane && v < -8) return false;
  return !taken.some((d) => Math.hypot(d.x - spot.x, d.z - spot.z) < d.r + spot.r + SHELTER.gap);
}

function addRubble(b: SiteBuilder, site: Site, f: Frame, clear: Disc[]): void {
  const rocks: (Spot & { scale: number; lift: number })[] = [];
  const [lo, hi] = RUBBLE.scale;
  for (let i = 0; i < RUBBLE.count; i++) {
    const u = (hash2(i * 7 + 1, 5) - 0.5) * 2 * 26;
    const p = placeAt(f, u, RISE.front - 0.2 - hash2(i * 7 + 2, 9) * 1.4);
    const scale = lo + (hi - lo) * hash2(i * 7 + 3, 11);
    if (!rubbleFits(site, u, { ...p, r: scale / S }, clear)) continue;
    rocks.push({ ...p, yaw: hash2(i * 7 + 4, 13) * 2 * Math.PI, scale, lift: (-ROCK_SINK * scale) / S });
  }
  b.addInstances('rock', rocks).name = 'nose-rocks';
}

function rubbleFits(site: Site, u: number, rock: Disc, clear: Disc[]): boolean {
  if (u > RISE.west || Math.hypot(rock.x, rock.z) + rock.r > RUBBLE.reach) return false;
  if (clear.some((g) => Math.hypot(g.x - rock.x, g.z - rock.z) < g.r + rock.r)) return false;
  if (SCAFFOLD_RUN.some((su) => Math.abs(su - u) < 2.4)) return false;
  return fitsCurtain(site, rock.x, rock.z, rock.r, rock.r);
}
