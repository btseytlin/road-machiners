// The small walled compounds' interiors: Dustwell (C2), the Granary (C3) and the Salvage Yard (C4), each a few
// machines and sheds inside a short curtain.

import * as THREE from 'three';
import { PHYSICS } from '../../../data/physics';
import { FACTION_COLORS, PAL } from '../../../render/palette';
import { hash2 } from '../../../render/noise';
import { model, socket } from '../models';
import { hoist, rock, slew, travel } from '../site-motion';
import type { SiteBuilder } from '../sites';

// Dustwell's interior (C2): a water pumpjack along the back-left wall with its beam rocking, two tall storage tanks in
// the back-right corner, a squat tank on the left, a lit shed just inside the gate and pipes from the wellhead to the
// tanks.
//
// Offsets are site tiles: x is map x, z is map y. The gate faces east (+x), so the camera, at +x +y, sees the gate face
// on the right as C2 does. "Back" is west and north, away from the camera.

// The pumpjack's bearing, along the west wall. Its +X (horsehead and wellhead) points north, so the beam runs along the
// wall as in C2, with the horsehead at the back.
const PUMP = { x: -1.6, z: 0.3, yaw: Math.PI / 2 };
const WELL = 7 / 4; // tiles from the bearing to the wellhead (pumpjack_base WELL_X)
// C2's walking beam rocks +-18 degrees on a 6 s stroke.
const STROKE = { amplitude: (18 * Math.PI) / 180, period: 6 };
const TANKS = [
  { x: 0.45, z: -2.2 },
  { x: 2.0, z: -2.0 },
];
const TANK_OUTLET = (2.6 + 0.45) / 4; // tiles from a tank's center to its outlet valve, on its +z side
const SQUAT = { x: -0.1, z: 1.9, height: 0.42 }; // height: share of the tall tank's
// The reused scrap shack, 1.5x so it reads as C2's shed, its door (+X) turned to face the yard (+z). C2's shed stands
// just behind the gate, but the 12 m east wall hides everything there lower than about 5 m from the camera, so it
// stands two tiles further in, in front of the tanks, where its roof shows over the walls.
const SHED = { x: 0.3, z: -0.3, yaw: -Math.PI / 2 };
// A shed is the scrap shack at this scale. Its door fills the shack's door gap (tools/blender/shack.py), in tiles
// after the scale.
const SHED_SCALE = 1.5;
const SHED_DOOR = {
  reach: (2.03 * SHED_SCALE) / 4 + 0.01, // just out of the door plane, 2.03 m along the shack's +X
  width: (0.9 * SHED_SCALE) / 4 - 0.04, // inside the 0.9 m gap
  height: (1.8 * SHED_SCALE) / 4 - 0.05, // under the 1.8 m lintel
};
const SHED_LAMP = { reach: 0.12, size: 0.14, lift: 0.66 }; // tiles: a lantern hung over the door, out from the door plane
const PIPE = { size: 0.08, lift: 0.12, support: 0.6 }; // tiles; supports every `support` tiles

export function buildDustwell(b: SiteBuilder): void {
  addPumpjack(b);
  for (const tank of TANKS) b.addModel('storage_tank', tank.x, tank.z).name = 'dustwell-tank';
  b.addModel('storage_tank', SQUAT.x, SQUAT.z, 0.6, new THREE.Vector3(1, SQUAT.height, 1)).name = 'dustwell-tank';
  addShed(b, 'dustwell', SHED);
  addPipes(b);
}

function addPumpjack(b: SiteBuilder): void {
  const base = b.addModel('pumpjack_base', PUMP.x, PUMP.z, PUMP.yaw);
  base.name = 'pumpjack';
  const beam = model('pumpjack_beam');
  beam.name = 'pumpjack-beam';
  beam.position.copy(socket('pumpjack_base', 'beam'));
  base.add(beam);
  // The beam's Blender Y, its rocking axis, is the model's local z.
  b.addMover(beam, rock(new THREE.Vector3(0, 0, 1), STROKE.amplitude, STROKE.period));
}

// A shed with a shut door and a lit lantern over it, as C2's and C4's sheds glow at the door. Its door (the shack's
// +X) faces along yaw.
function addShed(b: SiteBuilder, site: string, shed: { x: number; z: number; yaw: number }): void {
  b.addModel('shack', shed.x, shed.z, shed.yaw, SHED_SCALE).name = `${site}-shed`;
  const out = { x: Math.cos(shed.yaw), z: -Math.sin(shed.yaw) };
  const at = (reach: number) => ({ x: shed.x + out.x * reach, z: shed.z + out.z * reach });
  const door = at(SHED_DOOR.reach);
  b.addBox(door.x, door.z, 0.02, SHED_DOOR.height, SHED_DOOR.width, PAL.rust.dark, 0, shed.yaw).name = `${site}-shed-door`;
  const bracket = at(SHED_DOOR.reach + SHED_LAMP.reach / 2);
  b.addBox(bracket.x, bracket.z, SHED_LAMP.reach, 0.03, 0.03, PAL.metal, SHED_LAMP.lift + SHED_LAMP.size, shed.yaw);
  const lamp = at(SHED_DOOR.reach + SHED_LAMP.reach);
  b.addBox(lamp.x, lamp.z, SHED_LAMP.size, SHED_LAMP.size, SHED_LAMP.size, PAL.lamp.on, SHED_LAMP.lift, shed.yaw).name = `${site}-shed-lamp`;
}

// A header pipe on low supports from the wellhead east past both tank outlets, with a stub up to each outlet.
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

// The Granary's interior (C3): four cone-topped silos in a 2x2 cluster at the back, a grain elevator beside them with
// an inclined conveyor down to a grain heap, sacks riding the belt, two open lean-to shelters with sacks and crates on
// the sides, and four open grain bins near the gate.
//
// Offsets are site tiles: x is map x, z is map y. The gate faces south (+z), and the camera, at +x +y, sees it at the
// front left as C3 does. "Back" on screen is northwest (-x -z) and "right" is northeast (+x -z). The 12 m ring hides
// everything below about 5 m in the front (southeast) half from the default camera, so the silos, the elevator and
// the shelters stand in the back and side half, and only the low bins stand near the gate.

const S = PHYSICS.metersPerTile;

// The silo cluster's center and the tiles from it to each silo, along the screen axes, so the 2x2 square faces the
// camera as in C3. Each silo's footprint is 3 m across its pad.
const SILOS = { x: -1.77, z: -0.92, apart: 1.1 };
// The elevator right of the silos on screen. The yaw turns its +X, the belt side, toward the front so the belt runs
// down to the front left on screen, and puts its spout (-Y) over the silos.
const ELEVATOR = { x: 0, z: -2.83, yaw: -1.4 };
// The belt bed between the elevator's belt sockets, and the sacks on it, in meters. C3's sacks ride at 0.6 m/s.
const BELT = { width: 1.2, depth: 0.25, rail: 0.3, legs: [1 / 3, 2 / 3] };
const SACK = { length: 0.9, height: 0.45, width: 0.6, count: 4, speed: 0.6 };
// Grain heaps in tiles: one past the belt's foot and a smaller one under its middle, as in C3.
const FOOT_HEAP = { reach: 0.15, r: 0.5, h: 0.38 };
const MID_HEAP = { r: 0.38, h: 0.28 };
// The two lean-tos, back to the ring and open toward the middle: left and right of the silos on screen.
const SHELTERS = [
  { x: -2.47, z: 1.63 },
  { x: 1.63, z: -2.19 },
];
// Under each shelter, in tiles along its open side (u) and along its width (v): a sack stack and a crate pile.
const SHELTER_SACKS = { u: -0.25, v: -0.45 };
const SHELTER_CRATES = { u: -0.15, v: 0.5 };
const YARD_CRATES = [{ x: -1.5, z: 2.3, yaw: 0.4 }];
// The four open bins, a 2x2 block right of the gate lane, in tiles: wall height, wall thickness and the grain's depth.
const BINS = { x: 1.6, z: 1.4, size: 0.72, apart: 0.8, wall: 0.2, plank: 0.05, fill: 0.15 };
// A sack in a stack, in tiles, and the stack's rows from the bottom.
const STACK_SACK = { w: 0.24, h: 0.12, d: 0.16 };
const STACK_ROWS = [4, 3, 2];

const GRAIN = FACTION_COLORS.bowl.cab; // straw
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
}

// The elevator, the belt bed from its foot socket up to its top socket on two pairs of legs, the heaps, and the sacks
// that ride the belt as one mover. The belt hangs in the elevator's own frame, in meters, so it follows the elevator.
function addConveyor(b: SiteBuilder): void {
  const elevator = b.addModel('grain_elevator', ELEVATOR.x, ELEVATOR.z, ELEVATOR.yaw);
  elevator.name = 'granary-elevator';
  const top = socket('grain_elevator', 'belt_top');
  const foot = socket('grain_elevator', 'belt_foot');
  const run = top.clone().sub(foot);
  const length = run.length();
  const dir = run.clone().normalize();
  // The belt's frame: x up the belt, y square to it and upward, z across it.
  const across = dir.clone().cross(UP).normalize();
  const turn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, across.clone().cross(dir), across));
  // A box of the given meters, moved onto the elevator, its center laid `along` meters up the belt, `over` meters
  // above the belt's top face and `aside` meters across it.
  const part = (size: THREE.Vector3, color: number, along: number, over: number, aside = 0) => {
    const mesh = b.addBox(0, 0, size.x / S, size.y / S, size.z / S, color);
    elevator.add(mesh);
    mesh.position.copy(foot).addScaledVector(dir, along).add(new THREE.Vector3(0, over, aside).applyQuaternion(turn));
    mesh.quaternion.copy(turn);
    return mesh;
  };
  part(new THREE.Vector3(length, BELT.depth, BELT.width), PAL.metalLight, length / 2, -BELT.depth / 2).name = 'granary-belt';
  for (const side of [-1, 1]) part(new THREE.Vector3(length, BELT.rail, 0.1), PAL.rust.side, length / 2, BELT.rail / 2, (side * BELT.width) / 2);
  // Legs stand from the elevator's ground plane up to the bed's underside.
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

  // Sacks one spacing apart, each riding one spacing up the belt per period and starting over, so they stream.
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

// A lean-to whose open side (+X) faces the site's middle, with a sack stack and crates under its roof.
function addShelter(b: SiteBuilder, x: number, z: number): void {
  const yaw = Math.atan2(z, -x);
  b.addModel('lean_to', x, z, yaw).name = 'granary-shelter';
  // The model's +X and +Y in site tiles at this yaw.
  const u = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const v = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const at = (p: { u: number; v: number }) => ({ x: x + u.x * p.u + v.x * p.v, z: z + u.z * p.u + v.z * p.v });
  const sacks = at(SHELTER_SACKS);
  addSackStack(b, sacks.x, sacks.z, yaw, v);
  const crates = at(SHELTER_CRATES);
  b.addModel('crates', crates.x, crates.z, yaw);
}

// Sacks in rows that shrink toward the top, laid along `along`.
function addSackStack(b: SiteBuilder, x: number, z: number, yaw: number, along: { x: number; z: number }): void {
  STACK_ROWS.forEach((count, row) => {
    for (let i = 0; i < count; i++) {
      const t = (i - (count - 1) / 2) * STACK_SACK.d * 1.05;
      b.addBox(x + along.x * t, z + along.z * t, STACK_SACK.w, STACK_SACK.h, STACK_SACK.d, SACK_COLOR, row * STACK_SACK.h, yaw);
    }
  });
}

// An open plank bin filled near the brim with grain.
function addBin(b: SiteBuilder, x: number, z: number): void {
  const half = BINS.size / 2;
  for (const s of [-1, 1]) {
    b.addBox(x + s * (half - BINS.plank / 2), z, BINS.plank, BINS.wall, BINS.size, PAL.trunk);
    b.addBox(x, z + s * (half - BINS.plank / 2), BINS.size, BINS.wall, BINS.plank, PAL.trunk);
  }
  b.addBox(x, z, BINS.size - 2 * BINS.plank, BINS.fill, BINS.size - 2 * BINS.plank, GRAIN, BINS.wall - BINS.fill - 0.03).name = 'granary-bin';
}

// The Salvage Yard's interior (C4): a slewing crane on a round turret at the back, holding a car in its grab, crushed
// wrecks stacked along the walls, a tall tank, a white container, a lit work shed and a stripped jeep.
//
// Offsets are site tiles: x is map x, z is map y. The gate faces north (-z), away from the default camera at +x +y, so
// "back" from the gate is south. The 12 m walls hide everything below about 5 m in the half nearest each camera, so
// the shed and most stacks stand in the west half, which both the default camera and C4's view (from the northeast)
// see.

// The crane at the back center. Its boom rests pointing west-northwest (yaw) and slews +-35 degrees on a 14 s cycle,
// so the grab stays over the yard. The grab hoists 2 m twice per slew.
const CRANE = { x: 0.1, z: 1.3, yaw: (160 * Math.PI) / 180 };
const SLEW = { amplitude: (35 * Math.PI) / 180, period: 14 };
const HOIST = { range: 2, period: 7 };
// Meters from the boom tip down to the hook at rest: crane_upper's 3.2 m fixed lines and crane_grab's 2 m slack lines.
const HANG = 5.2;
// The tank stands in the northwest corner, the back corner from the default camera and the right one in C4's view.
const TANK = { x: -2.0, z: -2.0 };
const CONTAINER = { x: -1.85, z: 2.55, yaw: 0, length: 1.5, width: 0.6, height: 0.65, ribs: 6 };
// The shed's door faces east, which both cameras see. West of the middle and off the diagonals behind the near corner
// towers, it shows from both above about 1 m.
const YARD_SHED = { x: -1.55, z: -0.1, yaw: 0 };
// Crushed wrecks stacked flat along the walls, each slab a car pressed to 0.5 m.
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
  b.addModel('storage_tank', TANK.x, TANK.z).name = 'salvage-tank';
  addContainer(b);
  addShed(b, 'salvage', YARD_SHED);
  for (const stack of STACKS) addScrapStack(b, stack);
  b.addModel('wreck', JEEP.x, JEEP.z, JEEP.yaw).name = 'salvage-jeep';
  for (const w of WRECKS) b.addModel('wreck', w.x, w.z, w.yaw).name = 'salvage-wreck';
  for (const p of YARD_PROPS) b.addModel(p.name, p.x, p.z, p.yaw);
}

// The turret, the upper on the slew socket and the grab hanging from the boom tip, each part on its own motion.
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

// A white shipping container with corrugation ribs down its long sides.
function addContainer(b: SiteBuilder): void {
  const { x, z, yaw, length, width, height, ribs } = CONTAINER;
  b.addBox(x, z, length, height, width, FACTION_COLORS.convoys.top, 0, yaw).name = 'salvage-container';
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  for (let i = 0; i < ribs; i++) {
    const t = ((i + 0.5) / ribs - 0.5) * length;
    b.addBox(x + along.x * t, z + along.z * t, 0.03, height - 0.04, width + 0.03, FACTION_COLORS.convoys.side, 0.02, yaw);
  }
}

// Slabs piled with a little shift and twist each, so the stack reads as crushed cars rather than one block.
function addScrapStack(b: SiteBuilder, stack: { x: number; z: number; yaw: number; layers: number }): void {
  for (let k = 0; k < stack.layers; k++) {
    const jitter = (salt: number) => hash2(k * 7 + salt, Math.round(stack.x * 100 + stack.z * 10)) - 0.5;
    const color = SLAB_COLORS[Math.floor((jitter(3) + 0.5) * SLAB_COLORS.length)];
    const slab = b.addBox(stack.x + jitter(1) * SLAB.shift, stack.z + jitter(2) * SLAB.shift, SLAB.length, SLAB.height, SLAB.width, color, k * SLAB.height, stack.yaw + jitter(4) * SLAB.twist);
    if (k === 0) slab.name = 'salvage-stack';
  }
}
