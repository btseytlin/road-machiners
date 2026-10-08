// Truck chassis. Speeds are tiles per turn. Turn rates are degrees per turn. Masses are kilograms.
// Speed, turn, accel and brake numbers hold for a truck at handlingMass. A lighter truck beats them and a heavier one
// falls short. Past ratedMass it slows hard. See loadFactor() in src/sim/mass.ts.

import type { Tier } from './market';
import { PARTS } from './parts';

export type ChassisDef = {
  id: string;
  name: string;
  maxSpeed: number;
  accel: number;
  brake: number;
  turnSlow: number;
  turnFast: number;
  reverseTurn: number;
  mass: number;
  handlingMass: number;
  ratedMass: number;
  radius: number;
  layout: string[];
  core: { defId: string; x: number; y: number; rot?: 0 | 1 }[];
  fuelCap: number;
  fuelPerTile: number;
  base: number;
  value: number;
  showsCores: boolean;
  tier: Tier;
  look: 'pickup' | 'hauler' | 'buggy' | 'wagon' | 'courier' | 'van' | 'longbed' | 'carrier' | 'tractor' | 'jeep' | 'convertible' | 'bus' | 'loader' | 'niva' | 'bukhanka' | 'lincoln';
};

export const CHASSIS_PRICE_MODIFIERS = { perDeckCell: 60, perArmorCell: 30, perTopSpeed: 80 };

export type ChassisInput = Omit<ChassisDef, 'value' | 'ratedMass'>;

export function chassisModifier(def: ChassisInput): number {
  const cells = def.layout.join('');
  const count = (marks: string) => [...cells].filter((c) => marks.includes(c)).length;
  const m = CHASSIS_PRICE_MODIFIERS;
  return m.perDeckCell * count('D') + m.perArmorCell * count('FBLR') + m.perTopSpeed * def.maxSpeed;
}

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
    name: 'Scout pickup',
    maxSpeed: 7.8,
    accel: 2,
    brake: 3,
    turnSlow: 110,
    turnFast: 40,
    reverseTurn: 60,
    mass: 680,
    handlingMass: 2100,
    radius: 0.6,
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
    name: 'Hauler',
    maxSpeed: 5.2,
    accel: 1,
    brake: 2,
    turnSlow: 80,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2730,
    handlingMass: 5800,
    radius: 0.8,
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
    name: 'Buggy',
    maxSpeed: 9.1,
    accel: 3,
    brake: 3,
    turnSlow: 120,
    turnFast: 45,
    reverseTurn: 90,
    mass: 230,
    handlingMass: 900,
    radius: 0.5,
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
    name: 'Gunwagon',
    maxSpeed: 3.9,
    accel: 1,
    brake: 2,
    turnSlow: 70,
    turnFast: 25,
    reverseTurn: 45,
    mass: 2130,
    handlingMass: 3700,
    radius: 0.8,
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
    id: 'courier', name: 'Courier', maxSpeed: 9.75, accel: 3, brake: 3, turnSlow: 125, turnFast: 42, reverseTurn: 80,
    mass: 280, handlingMass: 1100, radius: 0.5,
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
    id: 'van', name: 'Utility van', maxSpeed: 6.5, accel: 1.5, brake: 3, turnSlow: 100, turnFast: 35, reverseTurn: 65,
    mass: 1100, handlingMass: 3000, radius: 0.7,
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
    id: 'longbed', name: 'Longbed truck', maxSpeed: 4.55, accel: 0.8, brake: 1.8, turnSlow: 70, turnFast: 20, reverseTurn: 40,
    mass: 2900, handlingMass: 7200, radius: 0.95,
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
    id: 'carrier', name: 'Armored carrier', maxSpeed: 5.2, accel: 1, brake: 2.5, turnSlow: 75, turnFast: 28, reverseTurn: 50,
    mass: 3200, handlingMass: 5200, radius: 0.85,
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
    id: 'tractor', name: 'Heavy tractor', maxSpeed: 3.9, accel: 1.8, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 55,
    mass: 3600, handlingMass: 6500, radius: 0.9,
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
  jeep: {
    id: 'jeep', name: 'Jeep', maxSpeed: 8.2, accel: 2.5, brake: 3, turnSlow: 115, turnFast: 42, reverseTurn: 80,
    mass: 450, handlingMass: 1400, radius: 0.55,
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
  convertible: {
    id: 'convertible', name: 'Convertible', maxSpeed: 9.4, accel: 2.5, brake: 3, turnSlow: 110, turnFast: 40, reverseTurn: 70,
    mass: 750, handlingMass: 2000, radius: 0.6,
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
  bus: {
    id: 'bus', name: 'Bus', maxSpeed: 5.5, accel: 0.9, brake: 2, turnSlow: 65, turnFast: 22, reverseTurn: 40,
    mass: 3000, handlingMass: 6800, radius: 0.9,
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
  loader: {
    id: 'loader', name: 'Wheel loader', maxSpeed: 3.6, accel: 1.6, brake: 2.5, turnSlow: 85, turnFast: 30, reverseTurn: 60,
    mass: 4200, handlingMass: 7000, radius: 0.9,
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
  niva: {
    id: 'niva', name: 'Niva', maxSpeed: 7.6, accel: 2.2, brake: 3, turnSlow: 115, turnFast: 40, reverseTurn: 80,
    mass: 520, handlingMass: 1700, radius: 0.55,
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
  bukhanka: {
    id: 'bukhanka', name: 'Bukhanka', maxSpeed: 6.0, accel: 1.4, brake: 2.5, turnSlow: 95, turnFast: 30, reverseTurn: 60,
    mass: 1250, handlingMass: 3300, radius: 0.65,
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
  lincoln: {
    id: 'lincoln', name: 'Lincoln', maxSpeed: 8.6, accel: 2.0, brake: 2.2, turnSlow: 80, turnFast: 26, reverseTurn: 45,
    mass: 900, handlingMass: 2400, radius: 0.85,
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

export const PLAYER_CHASSIS = ['scout', 'hauler', 'courier', 'van', 'longbed', 'carrier', 'tractor', 'jeep', 'convertible', 'bus', 'loader', 'niva', 'bukhanka', 'lincoln', 'buggy', 'wagon'];

export function chassisDef(id: string): ChassisDef {
  const def = CHASSIS[id];
  if (!def) throw new Error(`Unknown chassis ${id}`);
  return def;
}
