import { chassisDef } from '../data/chassis';
import { GEAR_THREAT_SPEED, PRIORITY_TOP, type LoadoutPriorities } from '../data/npcs';
import { RULES } from '../data/rules';
import { SIDES } from './armor';
import { gunsBySide, killRate, targetOf, toughness, type Target } from './fight-odds';
import { vehicleMass } from './mass';
import { vehicleStats } from './stats';
import type { Vehicle, World } from './types';

// How a spawning driver judges its gear. It expects a fight with a truck like itself and survives it by winning or by
// getting away. Each side's fighting strength is the kill rate of the guns that can fire toward it times the rounds
// it takes before the truck stops, each raised to the template's priority. Each side wins against the rival with odds
// that top out at certain, so a strong side cannot make up for a bare one. A faster attacker fights from the weakest
// side, any side otherwise, so a slow truck needs every side covered. A truck that loses gets away when it is the
// faster one and its rear holds. For the cargo priority, the free rated mass must hold its biggest load. The damage
// rules come from src/sim/fight-odds.ts.

export type GearBaseline = { rival: number; rear: number; loadKg: number; rivalTarget: Target };

// The rival the driver expects is its own starting truck, main gun and utility part mounted, with its front armored,
// facing it. A gun counts for the share of that truck it stops per turn through the armored front. `rival` is that
// truck's strength from its best side. rear is the starting truck's rear toughness, which a getaway is judged
// against. loadKg is the free mass the driver's biggest load needs.
export function gearBaseline(v: Vehicle, rivalTruck: Vehicle, p: LoadoutPriorities, loadKg: number): GearBaseline {
  const rivalTarget = targetOf(rivalTruck);
  const rival = Math.max(...sideStrength(rivalTruck, p, rivalTarget, toughness(rivalTruck)));
  return { rival, rear: toughness(v)[SIDES.indexOf('rear')], loadKg, rivalTarget };
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
  const loadFits = base.loadKg > 0 ? Math.min(1, freeMass(v) / base.loadKg) : 1;
  return Math.log(survive) + (p.cargo / PRIORITY_TOP) * Math.log(loadFits);
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
