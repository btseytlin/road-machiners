import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { FACTION_COLORS, PAL } from '../../../render/palette';
import { socket } from '../models';
import { travel } from '../site-motion';
import type { SiteBuilder } from '../sites';

const S = PHYSICS.metersPerTile;
const SILOS = { x: -1.77, z: -0.92, apart: 1.1 };
const ELEVATOR = { x: 0, z: -2.83, yaw: -1.4 };
const BELT = { width: 1.2, depth: 0.25, rail: 0.3, legs: [1 / 3, 2 / 3] };
const SACK = { length: 0.9, height: 0.45, width: 0.6, count: 4, speed: 0.6 };
const FOOT_HEAP = { reach: 0.15, r: 0.5, h: 0.38 };
const MID_HEAP = { r: 0.38, h: 0.28 };
const SHELTERS = [
  { x: -2.47, z: 1.63 },
  { x: 1.63, z: -2.19 },
];
const SHELTER_SACKS = { u: -0.25, v: -0.45 };
const SHELTER_CRATES = { u: -0.15, v: 0.5 };
const YARD_CRATES = [{ x: -1.5, z: 2.3, yaw: 0.4 }];
const BINS = { x: 1.6, z: 1.4, size: 0.72, apart: 0.8, wall: 0.2, plank: 0.05, fill: 0.15 };
const STACK_SACK = { w: 0.24, h: 0.12, d: 0.16 };
const STACK_ROWS = [4, 3, 2];

const SHELTER_LANTERNS = [
  { x: 2.4, z: -0.6 },
  { x: -2.6, z: 0.4 },
];
const GRAIN = FACTION_COLORS.bowl.cab;
const SACK_COLOR = PAL.wall.top;
const UP = new THREE.Vector3(0, 1, 0);

export function buildGranary(b: SiteBuilder): void {
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    b.addModel('grain_silo', SILOS.x + dx * SILOS.apart, SILOS.z + dz * SILOS.apart).name = 'granary-silo';
  }
  addConveyor(b);
  for (const shelter of SHELTERS) addShelter(b, shelter.x, shelter.z);
  for (const c of YARD_CRATES) b.addModel('crates', c.x, c.z, c.yaw);
  for (const [i, j] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addBin(b, BINS.x + (i * BINS.apart) / 2, BINS.z + (j * BINS.apart) / 2);
  for (const l of SHELTER_LANTERNS) b.addLantern(l.x, l.z, Math.atan2(l.z, -l.x));
}

function addConveyor(b: SiteBuilder): void {
  const elevator = b.addModel('grain_elevator', ELEVATOR.x, ELEVATOR.z, ELEVATOR.yaw);
  elevator.name = 'granary-elevator';
  const top = socket('grain_elevator', 'belt_top');
  const foot = socket('grain_elevator', 'belt_foot');
  const run = top.clone().sub(foot);
  const length = run.length();
  const dir = run.clone().normalize();
  const across = dir.clone().cross(UP).normalize();
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, across.clone().cross(dir), across));
  const part = (size: THREE.Vector3, color: number, along: number, over: number, aside = 0) => {
    const mesh = b.addBox(0, 0, size.x / S, size.y / S, size.z / S, color);
    elevator.add(mesh);
    mesh.position.copy(foot).addScaledVector(dir, along).add(new THREE.Vector3(0, over, aside).applyQuaternion(turn));
    mesh.quaternion.copy(turn);
    return mesh;
  };
  part(new THREE.Vector3(length, BELT.depth, BELT.width), PAL.metalLight, length / 2, -BELT.depth / 2).name = 'granary-belt';
  for (const side of [-1, 1]) part(new THREE.Vector3(length, BELT.rail, 0.1), PAL.rust.side, length / 2, BELT.rail / 2, (side * BELT.width) / 2);
  for (const share of BELT.legs) {
    for (const side of [-1, 1]) {
      const p = foot.clone().addScaledVector(run, share).add(new THREE.Vector3(0, -BELT.depth, (side * (BELT.width - 0.2)) / 2).applyQuaternion(turn));
      const leg = b.addBox(0, 0, 0.04, p.y / S, 0.04, PAL.rust.dark);
      elevator.add(leg);
      leg.position.set(p.x, p.y / 2, p.z);
      leg.rotation.set(0, 0, 0);
    }
  }
  elevator.updateMatrixWorld(true);
  const ground = (p: THREE.Vector3) => elevator.localToWorld(p.clone());
  const heap = ground(foot.clone().addScaledVector(dir.clone().setY(0).normalize(), -FOOT_HEAP.reach * S));
  addHeap(b, heap.x / S - b.site.pos.x, heap.z / S - b.site.pos.y, FOOT_HEAP.r, FOOT_HEAP.h);
  const middle = ground(foot.clone().addScaledVector(run, 0.5));
  addHeap(b, middle.x / S - b.site.pos.x, middle.z / S - b.site.pos.y, MID_HEAP.r, MID_HEAP.h);

  const spacing = length / SACK.count;
  const sacks = new THREE.Group();
  sacks.name = 'granary-sacks';
  sacks.position.copy(foot);
  sacks.quaternion.copy(turn);
  elevator.add(sacks);
  for (let i = 0; i < SACK.count; i++) {
    const sack = b.addBox(0, 0, SACK.length / S, SACK.height / S, SACK.width / S, SACK_COLOR);
    sacks.add(sack);
    sack.position.set(i * spacing + SACK.length / 2, SACK.height / 2, 0);
    sack.rotation.set(0, 0, 0);
  }
  b.addMover(sacks, travel(dir.clone().multiplyScalar(spacing), spacing / SACK.speed));
}

function addHeap(b: SiteBuilder, x: number, z: number, r: number, h: number): void {
  b.addShape(new THREE.ConeGeometry(r * S, h * S, 9), GRAIN, x, z, h / 2).name = 'granary-heap';
}

function addShelter(b: SiteBuilder, x: number, z: number): void {
  const yaw = Math.atan2(z, -x);
  b.addModel('lean_to', x, z, yaw).name = 'granary-shelter';
  const u = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const v = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const at = (p: { u: number; v: number }) => ({ x: x + u.x * p.u + v.x * p.v, z: z + u.z * p.u + v.z * p.v });
  const sacks = at(SHELTER_SACKS);
  addSackStack(b, sacks.x, sacks.z, yaw, v);
  const crates = at(SHELTER_CRATES);
  b.addModel('crates', crates.x, crates.z, yaw);
}

function addSackStack(b: SiteBuilder, x: number, z: number, yaw: number, along: { x: number; z: number }): void {
  STACK_ROWS.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const t = (i - (count - 1) / 2) * STACK_SACK.d * 1.05;
      b.addBox(x + along.x * t, z + along.z * t, STACK_SACK.w, STACK_SACK.h, STACK_SACK.d, SACK_COLOR, row * STACK_SACK.h, yaw);
    }
  });
}

function addBin(b: SiteBuilder, x: number, z: number): void {
  const half = BINS.size / 2;
  for (const s of [-1, 1]) {
    b.addBox(x + s * (half - BINS.plank / 2), z, BINS.plank, BINS.wall, BINS.size, PAL.trunk);
    b.addBox(x, z + s * (half - BINS.plank / 2), BINS.size, BINS.wall, BINS.plank, PAL.trunk);
  }
  b.addBox(x, z, BINS.size - 2 * BINS.plank, BINS.fill, BINS.size - 2 * BINS.plank, GRAIN, BINS.wall - BINS.fill - 0.03).name = 'granary-bin';
}
