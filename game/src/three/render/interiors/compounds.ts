// The small walled compounds' interiors: Dustwell (C2), the Granary (C3) and the Salvage Yard (C4), each a few
// machines and sheds inside a short curtain.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { FACTION_COLORS, PAL } from '../../../render/palette';
import { hash2 } from '../../../render/noise';
import { model, socket } from '../models';
import { hoist, rock, slew, travel } from '../site-motion';
import type { SiteBuilder } from '../sites';

const PUMP = { x: -1.6, z: 0.3, yaw: Math.PI / 2 };
const WELL = 7 / 4;
const STROKE = { amplitude: (18 * Math.PI) / 180, period: 6 };
const TANKS = [
  { x: 0.45, z: -2.2 },
  { x: 2.0, z: -2.0 },
];
const TANK_OUTLET = (2.6 + 0.45) / 4;
const SQUAT = { x: -0.1, z: 1.9, height: 0.42 };
const SHED = { x: 0.3, z: -0.3, yaw: -Math.PI / 2 };
const SHED_SCALE = 1.5;
const SHED_DOOR = {
  reach: (2.03 * SHED_SCALE) / 4 + 0.01,
  width: (0.9 * SHED_SCALE) / 4 - 0.04,
  height: (1.8 * SHED_SCALE) / 4 - 0.05,
};
const SHED_LAMP = { reach: 0.12, size: 0.14, lift: 0.66, throw: 2 };
const PIPE = { size: 0.08, lift: 0.12, support: 0.6 };
const MAST = 3.3;
const DUSTWELL_LIGHTS = [
  { x: 1.6, z: 1.4, aim: { x: -1.6, z: 0.4, lift: 2.5 } },
  { x: 2.4, z: 1.0, aim: { x: 1.2, z: -2.1, lift: 2 } },
];

export function buildDustwell(b: SiteBuilder): void {
  addPumpjack(b);
  for (const tank of TANKS) b.addModel('storage_tank', tank.x, tank.z).name = 'dustwell-tank';
  b.addModel('storage_tank', SQUAT.x, SQUAT.z, 0.6, new THREE.Vector3(1, SQUAT.height, 1)).name = 'dustwell-tank';
  addShed(b, 'dustwell', SHED);
  addPipes(b);
  for (const l of DUSTWELL_LIGHTS) b.addWorkLight('flood', l.x, l.z, MAST, l.aim, PAL.siteLight.sodium);
  b.addWash(0.65, PAL.siteLight.sodium);
}

function addPumpjack(b: SiteBuilder): void {
  const base = b.addModel('pumpjack_base', PUMP.x, PUMP.z, PUMP.yaw);
  base.name = 'pumpjack';
  const beam = model('pumpjack_beam');
  beam.name = 'pumpjack-beam';
  beam.position.copy(socket('pumpjack_base', 'beam'));
  base.add(beam);
  b.addMover(beam, rock(new THREE.Vector3(0, 0, 1), STROKE.amplitude, STROKE.period));
}

function addShed(b: SiteBuilder, site: string, shed: { x: number; z: number; yaw: number }): void {
  b.addModel('shack', shed.x, shed.z, shed.yaw, SHED_SCALE).name = `${site}-shed`;
  const out = { x: Math.cos(shed.yaw), z: -Math.sin(shed.yaw) };
  const at = (reach: number) => ({ x: shed.x + out.x * reach, z: shed.z + out.z * reach });
  const door = at(SHED_DOOR.reach);
  b.addBox(door.x, door.z, 0.02, SHED_DOOR.height, SHED_DOOR.width, PAL.rust.dark, 0, shed.yaw).name = `${site}-shed-door`;
  const bracket = at(SHED_DOOR.reach + SHED_LAMP.reach / 2);
  b.addBox(bracket.x, bracket.z, SHED_LAMP.reach, 0.03, 0.03, PAL.metal, SHED_LAMP.lift + SHED_LAMP.size, shed.yaw);
  const lamp = at(SHED_DOOR.reach + SHED_LAMP.reach);
  const head = b.addBox(lamp.x, lamp.z, SHED_LAMP.size, SHED_LAMP.size, SHED_LAMP.size, PAL.lamp.on, SHED_LAMP.lift, shed.yaw);
  head.name = `${site}-shed-lamp`;
  b.addLight('window', head, { x: lamp.x + out.x * SHED_LAMP.throw, z: lamp.z + out.z * SHED_LAMP.throw }, PAL.siteLight.amber);
}

function addPipes(b: SiteBuilder): void {
  const well = { x: PUMP.x, z: PUMP.z - WELL };
  const end = TANKS[TANKS.length - 1].x;
  const length = end - well.x;
  b.addBox(well.x + length / 2, well.z, length, PIPE.size, PIPE.size, PAL.metal, PIPE.lift);
  for (let x = well.x + PIPE.support; x < end; x += PIPE.support) b.addBox(x, well.z, PIPE.size, PIPE.lift, PIPE.size * 2, PAL.rust.dark);
  for (const tank of TANKS) {
    const outlet = tank.z + TANK_OUTLET;
    const run = Math.abs(well.z - outlet);
    b.addBox(tank.x, (well.z + outlet) / 2, PIPE.size, PIPE.size, run, PAL.metal, PIPE.lift);
  }
}

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

const GRANARY_LIGHTS = [
  { x: 1.5, z: 2.0, aim: { x: -1.5, z: -0.9, lift: 2.5 } },
  { x: 2.4, z: -0.4, aim: { x: -0.4, z: -1.8, lift: 3 } },
  { x: -0.6, z: 2.4, aim: { x: -1.4, z: 0.8, lift: 0.8 } },
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
  for (const l of GRANARY_LIGHTS) b.addWorkLight('flood', l.x, l.z, MAST, l.aim, PAL.siteLight.warm);
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

const SALVAGE_LIGHTS = [
  { x: 1.6, z: 2.0, aim: { x: -0.4, z: 1.1, lift: 4 } },
  { x: 0.2, z: -0.3, aim: { x: -2.0, z: -2.0, lift: 2 } },
  { x: 0.3, z: 2.2, aim: { x: -1.2, z: 0.4, lift: 0.8 } },
];
const CRANE = { x: 0.1, z: 1.3, yaw: (160 * Math.PI) / 180 };
const SLEW = { amplitude: (35 * Math.PI) / 180, period: 14 };
const HOIST = { range: 2, period: 7 };
const HANG = 5.2;
const CONTAINER = { x: -1.85, z: 2.55, yaw: 0, length: 1.5, width: 0.6, height: 0.65, ribs: 6 };
const YARD_SHED = { x: -1.55, z: -0.1, yaw: 0 };
const STACKS = [
  { x: -2.55, z: 0.95, yaw: Math.PI / 2, layers: 6 },
  { x: -1.3, z: 1.75, yaw: 0.25, layers: 5 },
  { x: 0.6, z: -2.0, yaw: 0, layers: 4 },
];
const SLAB = { length: 1.05, height: 0.12, width: 0.45, shift: 0.04, twist: 0.08 };
const SLAB_COLORS = [PAL.rust.top, PAL.rust.side, PAL.rust.dark, PAL.metal, FACTION_COLORS.convoys.side];
const JEEP = { x: 1.3, z: -0.3, yaw: 0.5 };
const WRECKS = [{ x: 1.5, z: 0.9, yaw: 1.9 }];
const YARD_PROPS = [
  { name: 'crates', x: 1.5, z: -1.6, yaw: 0.3 },
  { name: 'drums', x: -0.3, z: -1.2, yaw: 1.2 },
] as const;

export function buildSalvageYard(b: SiteBuilder): void {
  addCrane(b);
  addContainer(b);
  addShed(b, 'salvage', YARD_SHED);
  for (const stack of STACKS) addScrapStack(b, stack);
  b.addModel('wreck', JEEP.x, JEEP.z, JEEP.yaw).name = 'salvage-jeep';
  for (const w of WRECKS) b.addModel('wreck', w.x, w.z, w.yaw).name = 'salvage-wreck';
  for (const p of YARD_PROPS) b.addModel(p.name, p.x, p.z, p.yaw);
  for (const l of SALVAGE_LIGHTS) b.addWorkLight('flood', l.x, l.z, MAST, l.aim, PAL.siteLight.sodium);
  b.addWash(0.65, PAL.siteLight.sodium);
}

function addCrane(b: SiteBuilder): void {
  const base = b.addModel('crane_base', CRANE.x, CRANE.z, CRANE.yaw);
  base.name = 'salvage-crane';
  const upper = model('crane_upper');
  upper.name = 'crane-upper';
  upper.position.copy(socket('crane_base', 'slew'));
  base.add(upper);
  const grab = model('crane_grab');
  grab.name = 'crane-grab';
  grab.position.copy(socket('crane_upper', 'hook'));
  grab.position.y -= HANG;
  upper.add(grab);
  b.addMover(upper, slew(SLEW.amplitude, SLEW.period));
  b.addMover(grab, hoist(HOIST.range, HOIST.period));
}

function addContainer(b: SiteBuilder): void {
  const { x, z, yaw, length, width, height, ribs } = CONTAINER;
  b.addBox(x, z, length, height, width, FACTION_COLORS.convoys.top, 0, yaw).name = 'salvage-container';
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (let i = 0; i < ribs; i++) {
    const t = ((i + 0.5) / ribs - 0.5) * length;
    b.addBox(x + along.x * t, z + along.z * t, 0.03, height - 0.04, width + 0.03, FACTION_COLORS.convoys.side, 0.02, yaw);
  }
}

function addScrapStack(b: SiteBuilder, stack: { x: number; z: number; yaw: number; layers: number }): void {
  for (let k = 0; k < stack.layers; k++) {
    const jitter = (salt: number) => hash2(k * 7 + salt, Math.round(stack.x * 100 + stack.z * 10)) - 0.5;
    const color = SLAB_COLORS[Math.floor((jitter(3) + 0.5) * SLAB_COLORS.length)];
    const slab = b.addBox(stack.x + jitter(1) * SLAB.shift, stack.z + jitter(2) * SLAB.shift, SLAB.length, SLAB.height, SLAB.width, color, k * SLAB.height, stack.yaw + jitter(4) * SLAB.twist);
    if (k === 0) slab.name = 'salvage-stack';
  }
}
