import { chassisDef } from '../data/chassis';
import { GEAR_THREAT_SPEED, PRIORITY_TOP, type LoadoutPriorities } from '../data/npcs';
import type { WeaponDef } from '../data/parts';
import { RULES } from '../data/rules';
import { SIDES } from './armor';
import { gunsBySide, killRate, targetOf, toughness, type Target } from './fight-odds';
import { freeCells } from './grid';
import { vehicleMass } from './mass';
import { vehicleStats } from './stats';
import type { Vehicle, World } from './types';

export type Load = { kg: number; cells: number };

export type GearBaseline = { rival: number; rear: number; load: Load; rivalTarget: Target; rivalKills: Map<string, number> };

export function gearBaseline(v: Vehicle, rivalTruck: Vehicle, p: LoadoutPriorities, load: Load): GearBaseline {
  const rivalTarget = targetOf(rivalTruck);
  const rivalKills = new Map<string, number>();
  const rival = Math.max(...sideStrength(rivalTruck, p, { rivalTarget, rivalKills }, toughness(rivalTruck)));
  return { rival, rear: toughness(v)[SIDES.indexOf('rear')], load, rivalTarget, rivalKills };
}

export function gearScore(world: World, v: Vehicle, p: LoadoutPriorities, base: GearBaseline): number {
  const edge = attackerEdge(world, v);
  const tough = toughness(v);
  const wins = sideStrength(v, p, base, tough).map((s) => s / (s + base.rival));
  const win = edge * Math.min(...wins) + (1 - edge) * (wins.reduce((a, b) => a + b, 0) / wins.length);
  const rear = tough[SIDES.indexOf('rear')];
  const survive = win + (1 - win) * (1 - edge) * (rear / (rear + base.rear));
  return Math.log(survive) + (p.cargo / PRIORITY_TOP) * Math.log(loadFits(v, base.load));
}

function loadFits(v: Vehicle, load: Load): number {
  const byMass = load.kg > 0 ? freeMass(v) / load.kg : 1;
  const byCells = load.cells > 0 ? Math.max(1, freeCells(v)) / load.cells : 1;
  return Math.min(1, byMass, byCells);
}

function attackerEdge(world: World, v: Vehicle): number {
  const speed = vehicleStats(world, v).maxSpeed / RULES.limpSpeed;
  return 1 / (1 + (speed / GEAR_THREAT_SPEED) ** 2);
}

function freeMass(v: Vehicle): number {
  return Math.max(1, chassisDef(v.chassisId).ratedMass - vehicleMass(v));
}

function rivalKill(base: Pick<GearBaseline, 'rivalTarget' | 'rivalKills'>, def: WeaponDef): number {
  let rate = base.rivalKills.get(def.id);
  if (rate === undefined) base.rivalKills.set(def.id, (rate = killRate(def, base.rivalTarget, 'front')));
  return rate;
}

function sideStrength(v: Vehicle, p: LoadoutPriorities, base: Pick<GearBaseline, 'rivalTarget' | 'rivalKills'>, tough: number[]): number[] {
  const guns = gunsBySide(v);
  return SIDES.map((side, i) => {
    const fire = guns[side].reduce((sum, def) => sum + rivalKill(base, def), 0);
    return fire ** (p.firepower / PRIORITY_TOP) * tough[i] ** (p.armor / PRIORITY_TOP);
  });
}
