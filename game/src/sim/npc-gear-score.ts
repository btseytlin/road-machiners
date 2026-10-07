import { chassisDef } from '../data/chassis';
import { GEAR_THREAT_SPEED, PRIORITY_TOP, type LoadoutPriorities } from '../data/npcs';
import { PARTS, partDef, type WeaponDef } from '../data/parts';
import { RULES } from '../data/rules';
import { openSides, reachedSides, sidePlanner, SIDES, type Round, type Side } from './armor';
import { corePart, mountedItems, mountedParts, sideOf } from './grid';
import { vehicleMass } from './mass';
import { vehicleStats } from './stats';
import type { PartInstance, Vehicle, World } from './types';

// How a spawning driver judges its gear. It expects a fight with a truck like itself and survives it by winning or by
// getting away. Each side's fighting strength is the kill rate of the guns that can fire toward it times the rounds
// it takes before the truck stops, each raised to the template's priority. Each side wins against the rival with odds
// that top out at certain, so a strong side cannot make up for a bare one. A faster attacker fights from the weakest
// side, any side otherwise, so a slow truck needs every side covered. A truck that loses gets away when it is the
// faster one and its rear holds. For the cargo priority, the free rated mass must hold its biggest load.

// The threats a driver gears against: the average round of the weakest, middle and strongest third of all weapons by
// penetration. Light armor stops the first, and only the last reaches deep into a big truck.
const THREATS: Round[] = threatRounds(Object.values(PARTS).filter((d): d is WeaponDef => d.kind === 'weapon'), 3);

function threatRounds(weapons: WeaponDef[], groups: number): Round[] {
  const sorted = [...weapons].sort((a, b) => a.round.pen - b.round.pen);
  return Array.from({ length: groups }, (_, i) => {
    const group = sorted.slice(Math.floor((i * sorted.length) / groups), Math.floor(((i + 1) * sorted.length) / groups));
    const mean = (f: (d: WeaponDef) => number) => group.reduce((sum, d) => sum + f(d), 0) / group.length;
    return { damage: mean((d) => d.round.damage), pen: mean((d) => d.round.pen), armorShare: mean((d) => d.round.armorShare), blast: false };
  });
}

const LETTER_SIDE: Record<string, Side> = { F: 'front', B: 'rear', L: 'left', R: 'right' };

export type GearBaseline = { rival: number; rear: number; loadKg: number; killRate: KillRate };
// Rival trucks a gun stops per shot.
type KillRate = (weaponId: string) => number;

// The rival the driver expects is its own starting truck, main gun and utility part mounted, with its front armored,
// facing it. A gun counts for the rival trucks it stops per shot. `rival` is that truck's strength from its best
// side. rear is the starting truck's rear toughness, which a getaway is judged against. loadKg is the free mass the
// driver's biggest load needs.
export function gearBaseline(v: Vehicle, rivalTruck: Vehicle, p: LoadoutPriorities, loadKg: number): GearBaseline {
  const killRate = killRateAgainst(rivalTruck);
  const rival = Math.max(...sideStrength(rivalTruck, p, killRate, toughness(rivalTruck)));
  return { rival, rear: toughness(v)[SIDES.indexOf('rear')], loadKg, killRate };
}

function killRateAgainst(rival: Vehicle): KillRate {
  const target = sideTarget(rival, 'front', sidePlanner(rival), vitalParts(rival));
  const cache = new Map<string, number>();
  return (weaponId) => {
    let rate = cache.get(weaponId);
    if (rate === undefined) {
      const def = partDef(weaponId) as WeaponDef;
      rate = def.rounds / roundsToStop(target, 'front', def.round);
      cache.set(weaponId, rate);
    }
    return rate;
  };
}

// The driver survives by winning, or by getting away when it loses. A getaway needs the truck to be the faster one,
// and its rear to hold under the attacker's fire while it breaks off.
export function gearScore(world: World, v: Vehicle, p: LoadoutPriorities, base: GearBaseline): number {
  const edge = attackerEdge(world, v);
  const tough = toughness(v);
  const wins = sideStrength(v, p, base.killRate, tough).map((s) => s / (s + base.rival));
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

// Each side's fighting strength: the kill rate of the guns that can fire toward it times the rounds it takes before
// the truck stops, each raised to the template's priority over PRIORITY_TOP.
function sideStrength(v: Vehicle, p: LoadoutPriorities, killRate: KillRate, tough: number[]): number[] {
  const fire = sideFirepower(v, killRate);
  return SIDES.map((side, i) => fire[side] ** (p.firepower / PRIORITY_TOP) * tough[i] ** (p.armor / PRIORITY_TOP));
}

// The kill rate of the guns that can fire toward each side.
function sideFirepower(v: Vehicle, killRate: KillRate): Record<Side, number> {
  const out: Record<Side, number> = { front: 0, rear: 0, left: 0, right: 0 };
  for (const item of mountedItems(v, 'weapon')) {
    const def = partDef(item.part.defId) as WeaponDef;
    for (const side of openSides(v, item)) if (reachedSides(def).includes(side)) out[side] += killRate(def.id);
  }
  return out;
}

function sideArmor(v: Vehicle, side: Side): PartInstance[] {
  return mountedParts(v, 'armor').filter((part) => LETTER_SIDE[sideOf(v, part) ?? ''] === side);
}

type Planner = ReturnType<typeof sidePlanner>;
// A truck as rounds meet it: its lanes with and without one side's armor, that armor, and the parts that stop it.
type Target = { armored: Planner; bare: Planner; armor: PartInstance[]; vital: PartInstance[] };

// How many rounds landing on random lanes of a side it takes to stop the truck, by planLane(): to wreck the cab, or
// the engine or transmission, which strands it. Each side's value is the threats' average, the inverse of their
// mean rate of stopping the truck. A threat that cannot stop it from a side adds no rate. In SIDES order.
export function toughness(v: Vehicle): number[] {
  const armored = sidePlanner(v);
  const vital = vitalParts(v);
  return SIDES.map((side) => {
    const target = sideTarget(v, side, armored, vital);
    const rate = THREATS.reduce((sum, round) => sum + 1 / roundsToStop(target, side, round), 0) / THREATS.length;
    if (rate === 0) throw new Error(`No threat round stops ${v.chassisId} from the ${side}`);
    return 1 / rate;
  });
}

function vitalParts(v: Vehicle): PartInstance[] {
  return [corePart(v, 'cab'), corePart(v, 'transmission'), ...mountedParts(v, 'engine')];
}

function sideTarget(v: Vehicle, side: Side, armored: Planner, vital: PartInstance[]): Target {
  const armor = sideArmor(v, side);
  return { armored, bare: armor.length ? sidePlanner(withoutParts(v, armor)) : armored, armor, vital };
}

// While the side's armor stands it takes part of each round. Once the armor has taken its HP, the rounds meet the side
// without it.
function roundsToStop(target: Target, side: Side, round: Round): number {
  const armored = damageByPart(target.armored(side, round));
  const bare = target.bare === target.armored ? armored : damageByPart(target.bare(side, round));
  const armorHit = target.armor.reduce((sum, part) => sum + (armored.get(part.id) ?? 0), 0);
  const armorRounds = armorHit > 0 ? target.armor.reduce((sum, part) => sum + part.hp, 0) / armorHit : 0;
  return Math.min(...target.vital.map((part) => roundsToWreck(part.hp, armored.get(part.id) ?? 0, bare.get(part.id) ?? 0, armorRounds)));
}

function roundsToWreck(hp: number, armoredHit: number, bareHit: number, armorRounds: number): number {
  if (armoredHit * armorRounds >= hp) return hp / armoredHit;
  return bareHit > 0 ? armorRounds + (hp - armoredHit * armorRounds) / bareHit : Infinity;
}

// Damage one round deals to each part, averaged over the side's lanes.
function damageByPart(lanes: { part: PartInstance; amount: number }[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const hits of lanes) for (const hit of hits) out.set(hit.part.id, (out.get(hit.part.id) ?? 0) + hit.amount / lanes.length);
  return out;
}

function withoutParts(v: Vehicle, parts: PartInstance[]): Vehicle {
  const gone = new Set(parts.map((part) => part.id));
  return { ...v, items: v.items.filter((item) => item.kind !== 'part' || !gone.has(item.part.id)) };
}
