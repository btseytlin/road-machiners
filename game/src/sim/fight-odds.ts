import { PARTS, type WeaponDef } from '../data/parts';
import { openSides, reachedSides, sidePlanner, SIDES, type Round, type Side } from './armor';
import { corePart, mountedItems, mountedParts, sideOf } from './grid';
import { vehicleStats } from './stats';
import type { PartInstance, Vehicle, World } from './types';
import { dist } from './vec';
import { wornDef } from './wear';

// How a fight between two trucks or groups goes, by the real damage rules. Each side of a truck takes some number of
// rounds of a gun before the truck stops: its cab breaks, or its engine or transmission, which strands it. A gun stops
// a truck at its shots per turn over that number. A fight is fought from one side of each truck, and the faster truck
// picks the pair of sides that suits it best. The loser gets away when it is the faster one and its rear outlasts the
// fire it takes while it drives out of the winner's range. See docs/wiki/mechanics/npcs.md.

const LETTER_SIDE: Record<string, Side> = { F: 'front', B: 'rear', L: 'left', R: 'right' };

// The threats a driver gears against when it does not know its foe: the average round of the weakest, middle and
// strongest third of all weapons by penetration. Light armor stops the first, and only the last reaches deep into a
// big truck.
export const THREATS: Round[] = threatRounds(Object.values(PARTS).filter((d): d is WeaponDef => d.kind === 'weapon'), 3);

function threatRounds(weapons: WeaponDef[], groups: number): Round[] {
  const sorted = [...weapons].sort((a, b) => a.round.pen - b.round.pen);
  return Array.from({ length: groups }, (_, i) => {
    const group = sorted.slice(Math.floor((i * sorted.length) / groups), Math.floor(((i + 1) * sorted.length) / groups));
    const mean = (f: (d: WeaponDef) => number) => group.reduce((sum, d) => sum + f(d), 0) / group.length;
    return { damage: mean((d) => d.round.damage), pen: mean((d) => d.round.pen), armorShare: mean((d) => d.round.armorShare), blast: false };
  });
}

type Planner = ReturnType<typeof sidePlanner>;
// A truck as rounds meet it from one side: its lanes with and without that side's armor, that armor, and the parts
// that stop it.
type SideTarget = { armored: Planner; bare: Planner; armor: PartInstance[]; vital: PartInstance[] };

// A truck as rounds meet it from each side, built once and read for any number of rounds.
export type Target = { sides: Record<Side, SideTarget> };

export function targetOf(v: Vehicle): Target {
  const armored = sidePlanner(v);
  const vital = vitalParts(v);
  const sides = Object.fromEntries(SIDES.map((side) => [side, sideTarget(v, side, armored, vital)])) as Record<Side, SideTarget>;
  return { sides };
}

// The working parts whose loss stops the truck. A stranded truck still fights, so then only its cab counts. None when
// the cab is wrecked, and the truck is stopped already.
function vitalParts(v: Vehicle): PartInstance[] {
  const cab = corePart(v, 'cab');
  if (cab.hp <= 0) return [];
  const drive = [corePart(v, 'transmission'), ...mountedParts(v, 'engine')];
  return drive.every((part) => part.hp > 0) ? [cab, ...drive] : [cab];
}

function sideTarget(v: Vehicle, side: Side, armored: Planner, vital: PartInstance[]): SideTarget {
  const armor = mountedParts(v, 'armor').filter((part) => part.hp > 0 && LETTER_SIDE[sideOf(v, part) ?? ''] === side);
  return { armored, bare: armor.length ? sidePlanner(withoutParts(v, armor)) : armored, armor, vital };
}

// How many rounds landing on random lanes of `side` it takes to stop the truck. While the side's armor stands it
// takes part of each round. Once the armor has taken its HP, the rounds meet the side without it.
export function roundsToStop(target: Target, side: Side, round: Round): number {
  const t = target.sides[side];
  if (t.vital.length === 0) return 0;
  const armored = damageByPart(t.armored(side, round));
  const bare = t.bare === t.armored ? armored : damageByPart(t.bare(side, round));
  const armorHit = t.armor.reduce((sum, part) => sum + (armored.get(part.id) ?? 0), 0);
  const armorRounds = armorHit > 0 ? t.armor.reduce((sum, part) => sum + part.hp, 0) / armorHit : 0;
  return Math.min(...t.vital.map((part) => roundsToWreck(part.hp, armored.get(part.id) ?? 0, bare.get(part.id) ?? 0, armorRounds)));
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

// Rounds to stop the truck from each side, against the THREATS a driver expects when it does not know its foe. Each
// side's value is the inverse of the threats' mean rate of stopping it. A threat that cannot stop it from a side adds
// no rate. In SIDES order.
export function toughness(v: Vehicle): number[] {
  const target = targetOf(v);
  return SIDES.map((side) => {
    const rate = THREATS.reduce((sum, round) => sum + 1 / roundsToStop(target, side, round), 0) / THREATS.length;
    if (rate === 0) throw new Error(`No threat round stops ${v.chassisId} from the ${side}`);
    return 1 / rate;
  });
}

// Shots a gun fires per turn over a full magazine: the shots, then the reload.
export function shotsPerTurn(def: WeaponDef): number {
  return def.magazine / (def.magazine * def.cooldown + def.reload);
}

// The share of a truck a gun stops per turn when it fires into `side`.
export function killRate(def: WeaponDef, target: Target, side: Side): number {
  return (def.rounds * shotsPerTurn(def)) / roundsToStop(target, side, def.round);
}

// The working guns that can fire toward each side of the truck.
export function gunsBySide(v: Vehicle): Record<Side, WeaponDef[]> {
  const out: Record<Side, WeaponDef[]> = { front: [], rear: [], left: [], right: [] };
  for (const item of mountedItems(v, 'weapon')) {
    if (item.part.hp <= 0) continue;
    const def = wornDef<WeaponDef>(item.part);
    for (const side of openSides(v, item)) if (reachedSides(item).includes(side)) out[side].push(def);
  }
  return out;
}

// The odds the faster truck is `v` against `other`: even at equal speed, near certain when it is much faster.
export function speedEdge(world: World, v: Vehicle, other: Vehicle): number {
  const mine = vehicleStats(world, v).maxSpeed;
  const theirs = vehicleStats(world, other).maxSpeed;
  return mine ** 2 / (mine ** 2 + theirs ** 2);
}

// One truck against another: the share of each it stops per turn, `v` facing with `mySide` and hitting the other's
// `theirSide`, the other facing back with `theirSide`.
type Duel = { a: Vehicle; b: Vehicle; ta: Target; tb: Target; ga: Record<Side, WeaponDef[]>; gb: Record<Side, WeaponDef[]> };

function rates(d: Duel, mySide: Side, theirSide: Side): { mine: number; theirs: number } {
  const mine = d.ga[mySide].reduce((sum, def) => sum + killRate(def, d.tb, theirSide), 0);
  const theirs = d.gb[theirSide].reduce((sum, def) => sum + killRate(def, d.ta, mySide), 0);
  return { mine, theirs };
}

// The rates at the pair of sides each truck would pick, weighted by its odds of being the faster one.
function duelRates(world: World, d: Duel): { mine: number; theirs: number } {
  const pairs = SIDES.flatMap((mySide) => SIDES.map((theirSide) => rates(d, mySide, theirSide)));
  const edge = (r: { mine: number; theirs: number }) => firstShare(1 / r.mine, 1 / r.theirs);
  const best = pairs.reduce((x, y) => (edge(y) > edge(x) ? y : x));
  const worst = pairs.reduce((x, y) => (edge(y) < edge(x) ? y : x));
  const e = speedEdge(world, d.a, d.b);
  return { mine: mix(e, best.mine, worst.mine), theirs: mix(e, best.theirs, worst.theirs) };
}

// x with odds e, else y, as a mean that keeps an endless rate endless.
function mix(e: number, x: number, y: number): number {
  if (e === 0) return y;
  return e === 1 ? x : e * x + (1 - e) * y;
}

// The odds the side that needs `mine` turns finishes before the side that needs `theirs`. Each may be endless.
function firstShare(mine: number, theirs: number): number {
  if (mine === theirs) return 0.5;
  if (mine === Infinity) return 0;
  return theirs === Infinity ? 1 : theirs / (mine + theirs);
}

export type FightOdds = { win: number; getaway: number };

// Our group against theirs. Each group stops the other's trucks one at a time, every member firing at each, so a
// group's time to win is the sum over the foes of one over the rate it stops that foe. `win` is our odds to stop them
// first, and certain when they can never stop us, even when we cannot stop them either. `getaway` is the lead's odds
// to get away when it loses.
export function fightOdds(world: World, ours: Vehicle[], theirs: Vehicle[]): FightOdds {
  const targets = new Map([...ours, ...theirs].map((v) => [v.id, targetOf(v)]));
  const guns = new Map([...ours, ...theirs].map((v) => [v.id, gunsBySide(v)]));
  const duel = (a: Vehicle, b: Vehicle): Duel => ({ a, b, ta: targets.get(a.id)!, tb: targets.get(b.id)!, ga: guns.get(a.id)!, gb: guns.get(b.id)! });
  const table = ours.map((a) => theirs.map((b) => duelRates(world, duel(a, b))));
  const toWin = theirs.reduce((sum, _b, j) => sum + 1 / ours.reduce((r, _a, i) => r + table[i][j].mine, 0), 0);
  const toLose = ours.reduce((sum, _a, i) => sum + 1 / theirs.reduce((r, _b, j) => r + table[i][j].theirs, 0), 0);
  return { win: toLose === Infinity ? 1 : firstShare(toWin, toLose), getaway: getaway(world, ours[0], theirs, targets.get(ours[0].id)!, guns) };
}

// The lead gets away when no foe catches it and its rear outlasts their fire while it drives out of their range. A
// foe's chasing guns fire into the rear only while the lead is inside their range. A slower lead inside a gun's range
// is caught. One out of every range stays out as long as it is the faster one.
function getaway(world: World, lead: Vehicle, theirs: Vehicle[], target: Target, guns: Map<string, Record<Side, WeaponDef[]>>): number {
  let odds = 1;
  let taken = 0;
  for (const foe of theirs) {
    const gap = vehicleStats(world, lead).maxSpeed - vehicleStats(world, foe).maxSpeed;
    const d = dist(lead.pos, foe.pos);
    const chasing = guns.get(foe.id)!.front;
    if (chasing.every((def) => d >= def.range)) {
      if (gap <= 0) odds *= speedEdge(world, lead, foe);
      continue;
    }
    if (gap <= 0) return 0;
    for (const def of chasing) taken += killRate(def, target, 'rear') * (Math.max(0, def.range - d) / gap);
  }
  return odds * Math.max(0, 1 - taken);
}
