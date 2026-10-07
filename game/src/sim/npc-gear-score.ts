import { chassisDef } from '../data/chassis';
import { GEAR_THREAT_SPEED, PRIORITY_TOP, type LoadoutPriorities } from '../data/npcs';
import { RULES } from '../data/rules';
import { SIDES } from './armor';
import { gunsBySide, killRate, targetOf, toughness, type Target } from './fight-odds';
import { freeCells } from './grid';
import { vehicleMass } from './mass';
import { vehicleStats } from './stats';
import type { Vehicle, World } from './types';

// How a spawning driver judges its gear. It expects a fight with a truck like itself and survives it by winning or by
// getting away. Each side's fighting strength is the kill rate of the guns that can fire toward it times the rounds
// it takes before the truck stops, each raised to the template's priority. Each side wins against the rival with odds
// that top out at certain, so a strong side cannot make up for a bare one. A faster attacker fights from the weakest
// side, any side otherwise, so a slow truck needs every side covered. A truck that loses gets away when it is the
// faster one and its rear holds. For the cargo priority, the free rated mass and the free cells must hold its
// biggest load. The damage rules come from src/sim/fight-odds.ts.

// The free mass and grid cells a load needs.
export type Load = { kg: number; cells: number };

export type GearBaseline = { rival: number; rear: number; load: Load; rivalTarget: Target };

// The rival the driver expects is its own starting truck, main gun and utility part mounted, with its front armored,
// facing it. A gun counts for the share of that truck it stops per turn through the armored front. `rival` is that
// truck's strength from its best side. rear is the starting truck's rear toughness, which a getaway is judged
// against. load is what the driver's biggest load needs.
export function gearBaseline(v: Vehicle, rivalTruck: Vehicle, p: LoadoutPriorities, load: Load): GearBaseline {
  const rivalTarget = targetOf(rivalTruck);
  const rival = Math.max(...sideStrength(rivalTruck, p, rivalTarget, toughness(rivalTruck)));
  return { rival, rear: toughness(v)[SIDES.indexOf('rear')], load, rivalTarget };
}

// The driver survives by winning, or by getting away when it loses. A getaway needs the truck to be the faster one,
// and its rear to hold under the attacker's fire while it breaks off.
export function gearScore(world: World, v: Vehicle, p: LoadoutPriorities, base: GearBaseline): number {
  const edge = attackerEdge(world, v);
  const tough = toughness(v);
  const wins = sideStrength(v, p, base.rivalTarget, tough).map((s) => s / (s + base.rival));
  const win = edge * Math.min(...wins) + (1 - edge) * (wins.reduce((a, b) => a + b, 0) / wins.length);
  const rear = tough[SIDES.indexOf('rear')];
  const survive = win + (1 - win) * (1 - edge) * (rear / (rear + base.rear));
  return Math.log(survive) + (p.cargo / PRIORITY_TOP) * Math.log(loadFits(v, base.load));
}

// The share of the load the truck holds, by whichever of mass and cells runs out first.
function loadFits(v: Vehicle, load: Load): number {
  const byMass = load.kg > 0 ? freeMass(v) / load.kg : 1;
  const byCells = load.cells > 0 ? Math.max(1, freeCells(v)) / load.cells : 1;
  return Math.min(1, byMass, byCells);
}

// The odds an attacker is faster than the truck, so it picks the side to hit and the truck cannot get away.
function attackerEdge(world: World, v: Vehicle): number {
  const speed = vehicleStats(world, v).maxSpeed / RULES.limpSpeed;
  return 1 / (1 + (speed / GEAR_THREAT_SPEED) ** 2);
}

function freeMass(v: Vehicle): number {
  return Math.max(1, chassisDef(v.chassisId).ratedMass - vehicleMass(v));
}

// Each side's fighting strength: the kill rate of the guns that can fire toward it into the rival's front, times the
// rounds it takes before the truck stops, each raised to the template's priority over PRIORITY_TOP.
function sideStrength(v: Vehicle, p: LoadoutPriorities, rival: Target, tough: number[]): number[] {
  const guns = gunsBySide(v);
  return SIDES.map((side, i) => {
    const fire = guns[side].reduce((sum, def) => sum + killRate(def, rival, 'front'), 0);
    return fire ** (p.firepower / PRIORITY_TOP) * tough[i] ** (p.armor / PRIORITY_TOP);
  });
}
