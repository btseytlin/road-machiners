// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at handlingMass. A lighter truck beats them and a heavier one
// falls short. Past ratedMass it slows hard. See loadFactor() in src/sim/mass.ts.
//
// layout is the inventory grid as a top view, nose on row 0. One string per row. Every character except a space is a cell.
//   D           deck mount: weapons, scanners and cargo frames all compete for these cells
//   E           engine bay. The engine is drawn in the model's hood hole wherever these cells lie, see engineAnchor()
//   F, B, L, R  armor mounts on the front, back, left and right edges. Armor works when it lies fully on one of them.
//   X           built-in cells, each filled by a core part listed in core
// The grid is logical. Column 0 is L and the last column is R, on every row but the first and last, which are F and B.
// The projection in src/sim/body.ts stretches the inner cells over the base model and puts the armor ring on its outer
// faces, so a side plate is skin that adds no width. A space is no cell, so the armor columns leave out the corners.
// A part works only when it lies fully on mount cells of its kind. Any item may sit on any free cell, so empty mounts hold cargo too.
//
// core places the built-in parts at fixed cells, unrotated unless it lists rot 1. The four wheels sit one column in from
// the side armor, one in each corner of the truck. The physics wheels come from PHYSICS.bodies, not these cells.
// The transmission takes 2 by 2 cells and a fuel tank 1 by 2, and every engine takes at least 2 by 2, so an E bay is
// 2 by 2. Every chassis but the scout keeps a free 2 by 2 block of D cells for the bigger guns, and tier 2 and 3
// chassis a free 2 across by 3 along block. The scout's cab, clear of its wheels on five columns, leaves only single
// deck columns.
// The cab, the transmission and the engine bay keep clear of the wheel columns, which are the first and last inner
// columns. The transmission covers the middle column, or both middle columns on an even width. A tank keeps clear of
// them too, except on the chassis in TANK_BESIDE_WHEELS in chassis.test.ts. An open seat is 1 by 2 and a closed cab
// 3 by 2, either way round with rot 1. Chassis with four inner columns and those in SEAT_CAB use the seat.
// A grid may have more rows or columns than its model has rows and columns of its own, since the
// projection stretches whatever grid it gets over the model.
//
// showsCores says whether the view draws the transmission and the tank. It is true for the junk-built trucks whose
// parts stick out of the body: the scout, courier and wagon. There the two parts stand on a low surface of
// the model, never on a cab roof. It is false for the others, whose bodies cover them, so the parts take part in the
// grid but are not drawn. Engines show in the hood hole on every chassis.
//
// Critical parts are the engine, the cab and the tank. They stay clear of armor by tier. Tier 1 parts may touch armor
// cells. On tier 2 the engine touches armor cells on one side at most. On tier 3 every critical part has a cell that is
// not armor between it and the armor on every side. The hood hole of a tractor or longbed lies on the row behind the
// front armor row, so their engines cannot keep that gap in front.
//
// Each chassis is drawn from its base model in src/render/partLooks.ts, built by tools/blender/base_<id>.py. The model
// also gives the physics collider, see bodyOf() in src/sim/body.ts.

import type { Tier } from './market';
import { PARTS } from './parts';

export type ChassisDef = {
  id: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number; // turn limit at crawl speed
  turnFast: number; // turn limit at max speed
  reverseTurn: number; // turn limit for one turn of backing up
  mass: number; // bare frame, without core parts, other parts or goods
  handlingMass: number; // loaded mass the speed and handling numbers assume
  ratedMass: number; // load limit, set by ratedMassOf()
  radius: number; // collision radius in tiles
  layout: string[];
  core: { defId: string; x: number; y: number; rot?: 0 | 1 }[];
  fuelCap: number;
  fuelPerTile: number;
  base: number; // hand-set part of the value. See chassisModifier().
  value: number; // money value of a new chassis, base plus a stat modifier
  showsCores: boolean; // true when the view draws the transmission and the fuel tank, see the header
  tier: Tier;
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon' | 'courier' | 'van' | 'longbed' | 'carrier' | 'tractor' | 'jeep' | 'convertible' | 'bus' | 'loader' | 'niva' | 'bukhanka' | 'lincoln';
};

// Money per unit of each priced stat. See partModifier() in src/data/parts.ts for the value rule.
export const CHASSIS_PRICE_MODIFIERS = { perDeckCell: 60, perArmorCell: 30, perTopSpeed: 80 };

// The hand-set fields. value and ratedMass derive from them.
export type ChassisInput = Omit<ChassisDef, 'value' | 'ratedMass'>;

export function chassisModifier(def: ChassisInput): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const m = CHASSIS_PRICE_MODIFIERS;
  return m.perDeckCell * count('D') + m.perArmorCell * count('FBLR') + m.perTopSpeed * def.maxSpeed;
}

// The rated mass is the truck with a full tier 1 fighting kit: its core parts, a stock engine, a scrap sheet on every
// armor cell and a machine gun on half the deck cells. So every truck can armor all its sides with the heaviest
// armor and still mount guns. Cargo and heavier gear go past the rating.
export const RATED_KIT = { engine: 'stockEngine', armorPerCell: 'scrapSheet', gun: 'mg', gunDeckShare: 0.5 };

export function ratedMassOf(def: ChassisInput): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const core = def.core.reduce((sum, c) => sum + PARTS[c.defId].mass, 0);
  const guns = Math.ceil(count('D') * RATED_KIT.gunDeckShare);
  return def.mass + core + PARTS[RATED_KIT.engine].mass + count('FBLR') * PARTS[RATED_KIT.armorPerCell].mass + guns * PARTS[RATED_KIT.gun].mass;
}

function finishChassis(def: ChassisInput): ChassisDef {
  const value = Math.round(def.base + chassisModifier(def));
  if (value <= 0) throw new Error(`Chassis ${def.id} prices at ${value}. Raise its base.`);
  return { ...def, value, ratedMass: ratedMassOf(def) };
}

const CHASSIS_INPUTS: Record<string, ChassisInput> = {
  scout: {
    id: 'scout',
    maxSpeed: 7.8,
    accel: 2,
    brake: 3,
    turnSlow: 110,
    turnFast: 40,
    reverseTurn: 60,
    mass: 680,
    handlingMass: 2100,
    radius: 0.6,
    // The cab sits between the wheel columns, which leaves gun decks beside the engine and on both sides of the cab. The transmission and the tank lie in the bed.
    layout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXXDR', 'LDXXXDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 3 },
      { defId: 'transmission', x: 2, y: 5 },
      { defId: 'tank', x: 4, y: 5 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 5, y: 5 },
    ],
    fuelCap: 40,
    fuelPerTile: 0.25,
    base: 800, showsCores: true, tier: 1,
    look: 'pickup',
  },
  hauler: {
    id: 'hauler',
    maxSpeed: 5.2,
    accel: 1,
    brake: 2,
    turnSlow: 80,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2730,
    handlingMass: 5800,
    radius: 0.8,
    // The cab stands beside the engine hatch, with the transmission behind the hatch and the tank in the cargo area, out of sight under the canvas.
    layout: [' FFFFFFF ', 'LXDEEXXXR', 'LXDEEXXXR', 'LDDXXXXDR', 'LDDXXDDDR', 'LDDDDDDDR', 'LXDDDXDXR', 'LXDDDXDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabPickup', x: 5, y: 1, rot: 1 },
      { defId: 'transmissionMid', x: 3, y: 3 },
      { defId: 'tankMid', x: 5, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 7, y: 1 },
      { defId: 'wheelMid', x: 1, y: 6 },
      { defId: 'wheelMid', x: 7, y: 6 },
    ],
    fuelCap: 80,
    fuelPerTile: 0.4,
    base: 920, showsCores: false, tier: 2,
    look: 'hauler',
  },
  buggy: {
    id: 'buggy',
    maxSpeed: 9.1,
    accel: 3,
    brake: 3,
    turnSlow: 120,
    turnFast: 45,
    reverseTurn: 90,
    mass: 230,
    handlingMass: 900,
    radius: 0.5,
    // A light runabout: four deck cells, one free 2 by 2 block for a missile launcher. The model has room for the engine alone in its low nose, so the seat, the transmission and the tank sit inside the body, the tank in a wheel column.
    layout: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LDDXXR', 'LDDXXR', 'LXXXXR', 'LXXXXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 3, y: 3 },
      { defId: 'transmission', x: 2, y: 5 },
      { defId: 'tank', x: 4, y: 3 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 4, y: 5 },
    ],
    fuelCap: 30,
    fuelPerTile: 0.2,
    base: 360, showsCores: false, tier: 1,
    look: 'buggy',
  },
  wagon: {
    id: 'wagon',
    maxSpeed: 3.9,
    accel: 1,
    brake: 2,
    turnSlow: 70,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2130,
    handlingMass: 3700,
    radius: 0.8,
    // The grid has eight columns. The open seat stands behind the hood and the transmission and the tank in the open seats behind the windshield, with the guns on the hood side.
    layout: [' FFFFFF ', 'LXXXDDXR', 'LXEEDDXR', 'LDEEDDDR', 'LXXXXDXR', 'LXXXXDXR', ' BBBBBB '],
    core: [
      { defId: 'cab', x: 2, y: 1, rot: 1 },
      { defId: 'transmissionHeavy', x: 3, y: 4 },
      { defId: 'tankHeavy', x: 2, y: 4 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 4 },
      { defId: 'wheelHeavy', x: 6, y: 4 },
    ],
    fuelCap: 60,
    fuelPerTile: 0.4,
    base: 1450, showsCores: true, tier: 2,
    look: 'wagon',
  },
  courier: {
    id: 'courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, handlingMass: 1100, radius: 0.5,
    // The grid has nine rows. The transmission stands in the low nose, the seat fills the rear and the tank sits in a wheel column, since the 2 by 2 deck block takes the rest.
    layout: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDEEXR', 'LDEEXR', 'LDXXDR', 'LXDDXR', 'LXDDXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 2, y: 5, rot: 1 },
      { defId: 'transmission', x: 2, y: 1 },
      { defId: 'tank', x: 4, y: 3 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 6 },
      { defId: 'wheel', x: 4, y: 6 },
    ],
    fuelCap: 24, fuelPerTile: 0.18, base: 400, showsCores: true, tier: 1, look: 'courier',
  },
  van: {
    id: 'van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, handlingMass: 3000, radius: 0.7,
    // The closed cab lies behind the engine bay, two across and three along. The transmission and the tank lie in the box, out of sight.
    layout: [' FFFFF ', 'LXEEDXR', 'LXEEDXR', 'LDXXDDR', 'LDXXDDR', 'LDXXDDR', 'LXXXXXR', 'LXXXXXR', ' BBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 3, rot: 1 },
      { defId: 'transmissionMid', x: 2, y: 6 },
      { defId: 'tankMid', x: 4, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 5, y: 1 },
      { defId: 'wheelMid', x: 1, y: 6 },
      { defId: 'wheelMid', x: 5, y: 6 },
    ],
    fuelCap: 55, fuelPerTile: 0.24, base: 1180, showsCores: false, tier: 2, look: 'van',
  },
  longbed: {
    id: 'longbed', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, handlingMass: 7200, radius: 0.95,
    // The cab stands behind the engine bay. The transmission and the tank lie on the flat deck behind it, out of sight in the frame.
    layout: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDDDDDR', 'LDDXXXDDR', 'LDDXXXDDR', 'LXDDDDDXR', 'LXDDDDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabPickup', x: 3, y: 3 },
      { defId: 'transmissionHeavy', x: 3, y: 6 },
      { defId: 'tankHeavy', x: 5, y: 6 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 8 },
      { defId: 'wheelHeavy', x: 7, y: 8 },
    ],
    fuelCap: 100, fuelPerTile: 0.48, base: 1720, showsCores: false, tier: 3, look: 'longbed',
  },
  carrier: {
    id: 'carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, handlingMass: 5200, radius: 0.85,
    // The closed cab lies beside the engine bay, the transmission in the front hull and the tank in the rear hull, out of sight.
    layout: [' FFFFFF ', 'LXDXXDXR', 'LXDXXDXR', 'LDEEXXDR', 'LDEEXXDR', 'LDDDXXDR', 'LXDDXXXR', 'LXDDDDXR', ' BBBBBB '],
    core: [
      { defId: 'cabPickup', x: 4, y: 3, rot: 1 },
      { defId: 'transmissionHeavy', x: 3, y: 1 },
      { defId: 'tankHeavy', x: 4, y: 6, rot: 1 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 6, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 6 },
      { defId: 'wheelHeavy', x: 6, y: 6 },
    ],
    fuelCap: 70, fuelPerTile: 0.5, base: 2600, showsCores: false, tier: 3, look: 'carrier',
  },
  tractor: {
    id: 'tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, handlingMass: 6500, radius: 0.9,
    // The cab stands behind the engine bay. The transmission and the tank lie behind it, out of sight.
    layout: [' FFFFFFF ', 'LXDEEDDXR', 'LXDEEDDXR', 'LDDXXXDDR', 'LDDXXXDDR', 'LDDDDXDDR', 'LXDXXXDXR', 'LXDXXDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabPickup', x: 3, y: 3 },
      { defId: 'transmissionHeavy', x: 3, y: 6 },
      { defId: 'tankHeavy', x: 5, y: 5 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 6 },
      { defId: 'wheelHeavy', x: 7, y: 6 },
    ],
    fuelCap: 120, fuelPerTile: 0.6, base: 1730, showsCores: false, tier: 3, look: 'tractor',
  },
  // A VW Kübelwagen: open seats, a flat hood over the tank and the air-cooled engine under a rear lid.
  jeep: {
    id: 'jeep', maxSpeed: 8.2, accel: 2.5, brake: 3, turnSlow: 115, turnFast: 42, reverseTurn: 80,
    mass: 450, handlingMass: 1400, radius: 0.55,
    // The engine bay is on the rear deck and the cabin roof is a gun deck. The model has no low place for the transmission and the tank, so they sit inside the body.
    layout: [' FFFF ', 'LXXXXR', 'LXXXXR', 'LDXDDR', 'LDXDDR', 'LXEEXR', 'LXEEXR', 'LDXXDR', ' BBBB '],
    core: [
      { defId: 'cab', x: 2, y: 3 },
      { defId: 'transmission', x: 2, y: 1 },
      { defId: 'tank', x: 2, y: 7, rot: 1 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 5 },
      { defId: 'wheel', x: 4, y: 5 },
    ],
    fuelCap: 35, fuelPerTile: 0.2, base: 390, showsCores: false, tier: 1, look: 'jeep',
  },
  // A 1964 Corvair Monza convertible: a front trunk, open seats and a flat-six under the rear deck lid.
  convertible: {
    id: 'convertible', maxSpeed: 9.4, accel: 2.5, brake: 3, turnSlow: 110, turnFast: 40, reverseTurn: 70,
    mass: 750, handlingMass: 2000, radius: 0.6,
    // The engine bay lies under the rear deck lid. The transmission and the tank lie in the front trunk, out of sight, and the hardtop cab stands two across between the seats.
    layout: [' FFFFF ', 'LXXXXXR', 'LXXXXXR', 'LDXXDDR', 'LDXXDDR', 'LDXXDDR', 'LXEEDXR', 'LXEEDXR', ' BBBBB '],
    core: [
      { defId: 'cabHardtop', x: 2, y: 3, rot: 1 },
      { defId: 'transmission', x: 2, y: 1 },
      { defId: 'tankLong', x: 4, y: 1 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 1, y: 6 },
      { defId: 'wheel', x: 5, y: 6 },
    ],
    fuelCap: 45, fuelPerTile: 0.26, base: 860, showsCores: false, tier: 2, look: 'convertible',
  },
  // A LAZ-695 city bus: guns and frames ride on the roof.
  bus: {
    id: 'bus', maxSpeed: 5.5, accel: 0.9, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 40,
    mass: 3000, handlingMass: 6800, radius: 0.9,
    // The engine hatch is on the roof. The cab is at the front, and the transmission and the tank lie inside the body, out of sight.
    layout: [' FFFFFF ', 'LXXXXDXR', 'LXXXXDXR', 'LDDDDDDR', 'LDDDDDDR', 'LDDDDDDR', 'LDDXXXDR', 'LDDXXXDR', 'LDDEEDDR', 'LXDEEDXR', 'LXDDDDXR', ' BBBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 1 },
      { defId: 'transmissionMid', x: 3, y: 6 },
      { defId: 'tankMid', x: 5, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 6, y: 1 },
      { defId: 'wheelMid', x: 1, y: 9 },
      { defId: 'wheelMid', x: 6, y: 9 },
    ],
    fuelCap: 110, fuelPerTile: 0.45, base: 240, showsCores: false, tier: 2, look: 'bus',
  },
  // A Caterpillar 950 wheel loader: the bucket on the front row, the cab in the middle and the engine over the counterweight.
  loader: {
    id: 'loader', maxSpeed: 3.6, accel: 1.6, brake: 2.5, turnSlow: 85, turnFast: 30, reverseTurn: 60,
    mass: 4200, handlingMass: 7000, radius: 0.9,
    // The cab stands two across on the left, over the hood, and the transmission and the tank lie under it, out of sight.
    layout: [' FFFFFFF ', 'LXDDDDDXR', 'LXXXDDDXR', 'LDXXXXDDR', 'LDXXXXDDR', 'LDXEEDDDR', 'LXXEEDDXR', 'LXDDDDDXR', ' BBBBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 2, rot: 1 },
      { defId: 'transmissionHeavy', x: 4, y: 3 },
      { defId: 'tankHeavy', x: 2, y: 5 },
      { defId: 'wheelHeavy', x: 1, y: 1 },
      { defId: 'wheelHeavy', x: 7, y: 1 },
      { defId: 'wheelHeavy', x: 1, y: 6 },
      { defId: 'wheelHeavy', x: 7, y: 6 },
    ],
    fuelCap: 130, fuelPerTile: 0.65, base: 2460, showsCores: false, tier: 3, look: 'loader',
  },
  // A Lada Niva 4x4: a nimble, frugal two-box off-roader with a small deck and tank.
  niva: {
    id: 'niva', maxSpeed: 7.6, accel: 2.2, brake: 3, turnSlow: 115, turnFast: 40, reverseTurn: 80,
    mass: 520, handlingMass: 1700, radius: 0.55,
    // The engine sits under the front hood. The transmission and the tank lie inside the body, and the open seat takes the cab cells.
    layout: [' FFFF ', 'LXEEXR', 'LXEEXR', 'LDXDDR', 'LDXDDR', 'LDXDDR', 'LDXDDR', 'LXXXXR', 'LXXXXR', ' BBBB '],
    core: [
      { defId: 'cab', x: 2, y: 3 },
      { defId: 'transmissionMid', x: 2, y: 7 },
      { defId: 'tank', x: 2, y: 5 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 4, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 4, y: 7 },
    ],
    fuelCap: 42, fuelPerTile: 0.21, base: 1100, showsCores: false, tier: 2, look: 'niva',
  },
  // A UAZ-452 Bukhanka: a cab-over loaf van with a big roof deck. The cab sits right behind the front armor row.
  bukhanka: {
    id: 'bukhanka', maxSpeed: 6.0, accel: 1.4, brake: 2.5, turnSlow: 95, turnFast: 30, reverseTurn: 60,
    mass: 1250, handlingMass: 3300, radius: 0.65,
    // The engine bay lies behind the cab, in a hatch in the roof. The transmission and the tank lie under the rear box.
    layout: [' FFFFF ', 'LXXXXXR', 'LXXXXXR', 'LDEEDDR', 'LDEEDDR', 'LDDDDDR', 'LDXXXDR', 'LXXXXXR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabPickup', x: 2, y: 1 },
      { defId: 'transmissionMid', x: 2, y: 6 },
      { defId: 'tankMid', x: 4, y: 6 },
      { defId: 'wheelMid', x: 1, y: 1 },
      { defId: 'wheelMid', x: 5, y: 1 },
      { defId: 'wheelMid', x: 1, y: 7 },
      { defId: 'wheelMid', x: 5, y: 7 },
    ],
    fuelCap: 78, fuelPerTile: 0.30, base: 1230, showsCores: false, tier: 2, look: 'bukhanka',
  },
  // A Lincoln Continental Mark III: the fast, light tier 3 gunboat with a long hood and a long thirsty body.
  lincoln: {
    id: 'lincoln', maxSpeed: 8.6, accel: 2.0, brake: 2.2, turnSlow: 80, turnFast: 26, reverseTurn: 45,
    mass: 900, handlingMass: 2400, radius: 0.85,
    // The engine sits under the long hood. The hardtop cab stands two across between the seats, and the transmission and the tank lie in the trunk.
    layout: [' FFFFF ', 'LXDDDXR', 'LXEEDXR', 'LDEEDDR', 'LDXXDDR', 'LDXXDDR', 'LDXXDDR', 'LDXXXDR', 'LXXXXXR', 'LXDDDXR', ' BBBBB '],
    core: [
      { defId: 'cabHardtop', x: 2, y: 4, rot: 1 },
      { defId: 'transmission', x: 2, y: 7 },
      { defId: 'tankLong', x: 4, y: 7 },
      { defId: 'wheel', x: 1, y: 1 },
      { defId: 'wheel', x: 5, y: 1 },
      { defId: 'wheel', x: 1, y: 8 },
      { defId: 'wheel', x: 5, y: 8 },
    ],
    fuelCap: 85, fuelPerTile: 0.36, base: 1500, showsCores: false, tier: 3, look: 'lincoln',
  },
};

export const CHASSIS: Record<string, ChassisDef> = Object.fromEntries(
  Object.entries(CHASSIS_INPUTS).map(([id, def]) => [id, finishChassis(def)]),
);

// Chassis the player can buy in towns.
export const PLAYER_CHASSIS = ['scout', 'hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader', 'niva', 'bukhanka', 'lincoln', 'buggy', 'wagon'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
