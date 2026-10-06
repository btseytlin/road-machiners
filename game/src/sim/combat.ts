// Weapons fire after movement. All shots of a turn are rolled first, then applied,
// so fire is simultaneous: a vehicle killed this turn still gets its shots off.

import { onCall } from "./dialogue";
import { aimAt } from "./parley";
import { SPAWN } from '../data/npcs';
import { isDefeated, isKnockedOut, knockOutNpc } from './defeat';
import { RULES } from '../data/rules';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { blastLanes, laneCount, lanePoint, partLane, planLane, sideToward, walkLane, type PartHit, type Round, type Side } from './armor';
import { wholeDamage } from './damage';
import { bodyOf } from './body';
import { rollCabKnock } from "./cab-knock";
import { corePart, hasLoot, itemSize, mountedItems, mountedParts } from './grid';
import { practice, skillEffect, vehicleHasPerk } from './progress';
import { canVehicleSee, hasLineOfFire } from './vision';
import { createWreckSalvage, removeStocks } from './salvage';
import { STATE_TURNS } from '../data/npcs';
import { addState, boundTo, endState, stateOf, strayData } from './states';
import { isOnRope, towHeldBy } from './tow';
import { isTownGuarded } from './guards';
import { getResources } from './resources';
import { chance, gauss, randInt, randRange } from './rng';
import { sampleWeighted } from './npc-loadout';
import { vehicleMass } from './mass';
import { vehicleStats, type MountedWeapon } from './stats';
import { partDef, type WeaponDef } from '../data/parts';
import type { Aim, GunState, NpcActivity, PartInstance, ShotRound, Vehicle, VehicleHits, World } from './types';
import { weatherAt } from './weather';
import { angleDiff, bearing, clamp, dist, DEG, type Vec } from './vec';

export type FireBlock =
  | "disabled"
  | "cooldown"
  | "empty"
  | "range"
  | "arc"
  | "blocked"
  | "noTarget"
  | "unseen"
  | "covered"
  | "talking"
  | "out";

export function inFeud(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, "feud", a.id, b.id) !== null || stateOf(world, "feud", b.id, a.id) !== null;
}

// Sides at odds: a feud either way, or a raider against anyone else outside a truce.
// A defeated NPC is nobody's foe until it refits at home. A truck on a tow rope is a foe only to its own tower.
export function isFoe(world: World, a: Vehicle, b: Vehicle): boolean {
  if (a.id === b.id || isOutOfFight(world, a, b)) return false;
  if (inFeud(world, a, b)) return true;
  if (inTruce(world, a, b)) return false;
  return (a.faction === "raiders") !== (b.faction === "raiders");
}

function isOutOfFight(world: World, a: Vehicle, b: Vehicle): boolean {
  return isDefeated(a) || isDefeated(b) || isRopeShielded(world, a, b);
}

function isRopeShielded(world: World, a: Vehicle, b: Vehicle): boolean {
  if (!isOnRope(world, a.id) && !isOnRope(world, b.id)) return false;
  return towHeldBy(world, a.id)?.other !== b.id && towHeldBy(world, b.id)?.other !== a.id;
}

function inTruce(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, "truce", a.id, b.id) !== null || stateOf(world, "truce", b.id, a.id) !== null;
}

// Foes fight, but a raider leaves a vehicle with nothing to take unless a feud is held or the vehicle is a lawman.
export function isHostile(world: World, a: Vehicle, b: Vehicle): boolean {
  if (!isFoe(world, a, b)) return false;
  if (inFeud(world, a, b) || isLawPair(a, b)) return true;
  return hasLoot(a.faction === "raiders" ? b : a);
}

// A raider sees a non-raider only for its loot: no feud and no lawman pair makes them foes.
export function huntsForLoot(world: World, raider: Vehicle, target: Vehicle): boolean {
  return raider.faction === "raiders" && target.faction !== "raiders" && !inFeud(world, raider, target) && !isLawPair(raider, target);
}

// A lawman and a raider, either way round.
function isLawPair(a: Vehicle, b: Vehicle): boolean {
  return (isLawman(a) && b.faction === "raiders") || (isLawman(b) && a.faction === "raiders");
}

function isLawman(v: Vehicle): boolean {
  return v.brain?.traits.includes("lawman") === true;
}

// The target lies in the gun's own arc and on a side that no tall part blocks.
export function inArc(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): boolean {
  return inGunArc(shooter, mw, target) && sideOpen(shooter, mw, target);
}

function inGunArc(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): boolean {
  if (mw.def.arc >= 360) return true;
  return Math.abs(angleDiff(shooter.heading, bearing(shooter.pos, target.pos))) <= (mw.def.arc / 2) * DEG;
}

function sideOpen(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): boolean {
  return mw.sides.includes(sideToward(shooter, target.pos));
}

// Why a weapon cannot fire at a target right now, or null if it can. A knocked-out driver fires nothing. The player only shoots what it sees.
export function fireBlock(
  world: World,
  shooter: Vehicle,
  mw: MountedWeapon,
  target: Vehicle | null,
): FireBlock | null {
  if (isKnockedOut(shooter)) return "out";
  return weaponBlock(mw) ?? (target ? targetBlock(world, shooter, mw, target) : "noTarget");
}

function weaponBlock(mw: MountedWeapon): FireBlock | null {
  if (mw.part.hp <= 0) return "disabled";
  const gun = gunOf(mw.part);
  if (gun.ammo <= 0) return "empty";
  if (gun.cooldown > 0) return "cooldown";
  return null;
}

// The fire state of a weapon part. Every weapon part has one.
export function gunOf(part: PartInstance): GunState {
  if (!part.gun) throw new Error(`Weapon part ${part.id} has no gun state`);
  return part.gun;
}

// Drops the rest of the magazine, so the gun reloads from empty.
export function dropMagazine(part: PartInstance): void {
  const gun = gunOf(part);
  gun.ammo = 0;
  gun.reloadWork = 0;
}

// After the fire phase. Cooldown counts down. A gun that did not fire works one turn on its reload when it is empty
// or was not cooling down this turn, and a full reload fills the magazine.
function tickGuns(world: World, fired: Set<string>): void {
  for (const v of world.vehicles)
    for (const part of mountedParts(v, "weapon")) tickGun(part, fired.has(part.id));
}

function worksReload(gun: GunState, def: WeaponDef, fired: boolean, cooling: boolean): boolean {
  if (fired || gun.ammo >= def.magazine) return false;
  return gun.ammo === 0 || !cooling;
}

function tickGun(part: PartInstance, fired: boolean): void {
  const def = partDef(part.defId) as WeaponDef;
  const gun = gunOf(part);
  const cooling = gun.cooldown > 0;
  if (cooling) gun.cooldown--;
  if (!worksReload(gun, def, fired, cooling)) return;
  gun.reloadWork++;
  if (gun.reloadWork < def.reload) return;
  gun.ammo = def.magazine;
  gun.reloadWork = 0;
}

// Two trucks on a radio call hold fire at each other.
function targetBlock(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle): FireBlock | null {
  if (onCall(world, shooter, target)) return "talking";
  if (!canVehicleSee(world, shooter, target.pos)) return "unseen";
  if (!hasLineOfFire(world, shooter.pos, target.pos)) return "covered";
  if (dist(shooter.pos, target.pos) > mw.def.range) return "range";
  return arcBlock(shooter, mw, target);
}

function arcBlock(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): FireBlock | null {
  if (!inGunArc(shooter, mw, target)) return "arc";
  return sideOpen(shooter, mw, target) ? null : "blocked";
}

export type HitOdds = {
  chance: number; // per round, to hit the aimed part or, for a body shot, the truck; clamped to RULES.minHit and RULES.maxHit
  bodyChance: number; // per round, to hit the truck anywhere; an aimed miss that lands on the truck hits where it lands
  damageChance: number; // per round, to damage the aimed part, or for a body shot any part; the chance the player sees
  distance: number; // meters
  width: number; // meters the target, or the aimed part, shows across the line of fire
  halfAngle: number; // radians
  spread: number; // radians; standard deviation of a round's angular error, the sum of the causes
  causes: {
    weapon: number;
    range: number;
    crossing: number;
    own: number;
    recoil: number; // the gun's kick, smaller on a heavier truck
    skill: number;
    weather: number;
    still: number; // negative: a target standing still is easy to aim at
  }; // radians
};

const M = PHYSICS.metersPerTile;
const KG_PER_TONNE = 1000;

// Tiles per turn to m/s.
function mps(tilesPerTurn: number): number {
  return (tilesPerTurn * M) / PHYSICS.turnSeconds;
}

// Unit vector across the line of fire, to the shooter's right. Map heading grows toward +y, a right turn.
function across(shooter: Vehicle, target: Vehicle): Vec {
  const b = bearing(shooter.pos, target.pos);
  return { x: -Math.sin(b), y: Math.cos(b) };
}

// Width in meters the body shows to the shooter: its length seen broadside, its width seen head-on.
export function presentedWidth(shooter: Vehicle, target: Vehicle): number {
  const half = bodyOf(target.chassisId).half;
  const a = angleDiff(target.heading, bearing(shooter.pos, target.pos));
  return 2 * (Math.abs(half.x * Math.sin(a)) + Math.abs(half.z * Math.cos(a)));
}

// The lanes of a side spread evenly over the presented width. From the front and the right side, the shooter's
// right falls on the low lanes: column 0 is the target's left, row 0 its nose. From the rear and left, on the high lanes.
function laneSign(side: Side): number {
  return side === "front" || side === "right" ? -1 : 1;
}

export function laneOfOffset(
  side: Side,
  width: number,
  lanes: number,
  offset: number,
): number {
  const f = 0.5 + (laneSign(side) * offset) / width;
  return clamp(Math.floor(f * lanes), 0, lanes - 1);
}

function laneCenter(
  side: Side,
  width: number,
  lanes: number,
  lane: number,
): number {
  return laneSign(side) * ((lane + 0.5) / lanes - 0.5) * width;
}

// Where a shot aims. A body shot aims at the center of the presented width. An aimed shot aims at the center
// of its part's lane and has the part's width, from its cells across the struck side.
type Aiming = {
  side: Side;
  lanes: number;
  body: number;
  width: number;
  center: number;
  lane: number | null;
};

function aiming(shooter: Vehicle, target: Vehicle, aim: Aim): Aiming {
  const side = sideToward(target, shooter.pos);
  const lanes = laneCount(target, side);
  const body = presentedWidth(shooter, target);
  if (aim === "body")
    return { side, lanes, body, width: body, center: 0, lane: null };
  const item = mountedItems(target).find((it) => it.part.id === aim);
  if (!item) throw new Error(`${target.id} has no mounted part ${aim}`);
  const size = itemSize(item);
  const cells = side === "front" || side === "rear" ? size.w : size.h;
  const lane = partLane(target, aim, side);
  return {
    side,
    lanes,
    body,
    width: cells * RULES.cellMeters,
    center: laneCenter(side, body, lanes, lane),
    lane,
  };
}

// Abramowitz and Stegun 7.1.26, error below 1.5e-7.
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x < 0 ? -y : y;
}

function rawChance(o: Pick<HitOdds, "halfAngle" | "spread">): number {
  return erf(o.halfAngle / (o.spread * Math.SQRT2));
}

// Chance a round aimed at center, with offset error sd in meters, lands between lo and hi.
function landChance(
  center: number,
  sd: number,
  lo: number,
  hi: number,
): number {
  if (hi <= lo) return 0;
  return (
    (erf((hi - center) / (sd * Math.SQRT2)) -
      erf((lo - center) / (sd * Math.SQRT2))) /
    2
  );
}

// Chance to hit the truck anywhere. A round that misses the part by the Gaussian draw still hits when it lands on
// the body, unless the clamp roll turned that miss into a part hit. Rounds the clamp turns into misses land off the truck.
function bodyChanceOf(
  a: Aiming,
  o: Pick<HitOdds, "chance" | "halfAngle" | "spread" | "distance">,
): number {
  const sd = o.spread * o.distance;
  const half = o.halfAngle * o.distance;
  const onBody = landChance(a.center, sd, -a.body / 2, a.body / 2);
  const onBoth = landChance(
    a.center,
    sd,
    Math.max(-a.body / 2, a.center - half),
    Math.min(a.body / 2, a.center + half),
  );
  const raw = rawChance(o);
  const promoted = raw < o.chance ? (o.chance - raw) / (1 - raw) : 0;
  return o.chance + (1 - promoted) * (onBody - onBoth);
}

// F2. A round hits when its angular error is smaller than the target's half-angle as seen from the gun.
export function hitOdds(
  world: World,
  shooter: Vehicle,
  mw: MountedWeapon,
  target: Vehicle,
  aim: Aim,
): HitOdds {
  const distance = dist(shooter.pos, target.pos) * M;
  if (!(distance > 0))
    throw new Error(`${shooter.id} and ${target.id} share a point`);
  const a = aiming(shooter, target, aim);
  const width = a.width;
  const halfAngle = width / (2 * distance);
  const causes = spreadCauses(world, shooter, mw, target);
  const spread = Object.values(causes).reduce((sum, cause) => sum + cause, 0);
  if (!(spread > 0))
    throw new Error(`Spread ${spread} of ${mw.def.id} is not positive`);
  const chance = clamp(
    rawChance({ halfAngle, spread }),
    RULES.minHit,
    RULES.maxHit,
  );
  const bodyChance = bodyChanceOf(a, { chance, halfAngle, spread, distance });
  const odds = { chance, bodyChance, distance, width, halfAngle, spread, causes };
  const damageChance = damageChanceOf({ world, shooter, target, round: mw.def.round, stray: mw.def.stray, aim, a }, odds);
  return { ...odds, damageChance };
}

// F3. The chance one round damages what it aims at: the aimed part, or for a body shot any part of the target.
// It follows the fire phase exactly. Rounds enter lanes as rollAim() and landRound() send them, each lane walks as
// walkLane() does, and splash lands as explode() does. So parts in the way and lost pen lower the chance.
type Reach = {
  world: World;
  shooter: Vehicle;
  target: Vehicle;
  round: WeaponDef["round"];
  stray: number;
  aim: Aim;
  a: Aiming;
};
type Spread = Omit<HitOdds, "damageChance">;

function damageChanceOf(c: Reach, o: Spread): number {
  const onTruck = laneEntries(o, c.a).reduce((sum, p, lane) => sum + p * laneReach(c, lane), 0);
  return onTruck + offTruckReach(c, o);
}

function reachesAim(c: Reach, hits: { part: PartInstance; amount: number }[]): boolean {
  return hits.some((h) => wholeDamage(h.amount) > 0 && (c.aim === "body" || h.part.id === c.aim));
}

// Gaussian odds and the clamp's two corrections: promoted misses become hits, and kept hits stay hits.
function clampShares(o: Spread): { raw: number; promoted: number; keep: number } {
  const raw = rawChance(o);
  return {
    raw,
    promoted: raw < o.chance ? (o.chance - raw) / (1 - raw) : 0,
    keep: raw > o.chance ? o.chance / raw : 1,
  };
}

// Offsets across the line of fire, in meters, that fall in a lane.
function laneSpan(a: Aiming, lane: number): [number, number] {
  const c = laneCenter(a.side, a.body, a.lanes, lane);
  const half = a.body / a.lanes / 2;
  return [c - half, c + half];
}

// The chance a round enters each lane of the target. An aimed hit enters the aimed lane, and an aimed miss that
// lands on the truck enters the lane under it. A body hit enters the lane under it, and a promoted body hit lands
// anywhere on the truck with even odds.
function laneEntries(o: Spread, a: Aiming): number[] {
  const sd = o.spread * o.distance;
  const half = o.halfAngle * o.distance;
  const { raw, promoted, keep } = clampShares(o);
  const entries = Array.from({ length: a.lanes }, (_, lane) => {
    const [lo, hi] = laneSpan(a, lane);
    const inAim = landChance(a.center, sd, Math.max(lo, a.center - half), Math.min(hi, a.center + half));
    if (a.lane !== null) return (1 - promoted) * (landChance(a.center, sd, lo, hi) - inAim);
    return inAim * keep + Math.max(0, o.chance - raw) / a.lanes;
  });
  if (a.lane !== null) entries[a.lane] += o.chance;
  return entries;
}

// A round that enters a lane walks it, as a crit or not, and its splash lands on the lane's face.
function laneReach(c: Reach, lane: number): number {
  if (splashReaches(c, lanePoint(c.target, c.a.side, lane), lane)) return 1;
  const walks = (crit: boolean) => Number(reachesAim(c, planLane(c.target, c.a.side, lane, directRound(c.round, crit))));
  return (1 - RULES.critChance) * walks(false) + RULES.critChance * walks(true);
}

// Whether a round exploding at this point splashes the aim. skip is the lane the round itself entered.
function splashReaches(c: Reach, point: Vec, skip: number | null): boolean {
  if (c.round.splashRadius <= 0) return false;
  const { side, lanes } = blastLanes(c.target, point, c.round.splashRadius);
  return lanes.some((lane) => lane !== skip && reachesAim(c, planLane(c.target, side, lane, splashRound(c.round))));
}

// Splash reach changes only where a lane face enters the blast radius. This many steps per side keeps each step a
// few centimeters wide, far under a lane, so the sum is exact to well under a percent.
const OFF_TRUCK_STEPS = 64;

// A round that misses the truck can still splash it. Beyond the truck's corners plus the blast radius it cannot.
function offTruckReach(c: Reach, o: Spread): number {
  if (c.round.splashRadius <= 0) return 0;
  const half = bodyOf(c.target.chassisId).half;
  const edge = c.a.body / 2;
  const step = (Math.hypot(half.x, half.z) + c.round.splashRadius - edge) / OFF_TRUCK_STEPS;
  let sum = 0;
  for (const sign of [-1, 1])
    for (let i = 0; i < OFF_TRUCK_STEPS; i++) {
      const x0 = edge + i * step;
      sum += offTruckChance(o, c.a, sign, x0, x0 + step) * missReach(c, sign * (x0 + step / 2));
    }
  return sum;
}

// The chance a round lands off the truck at an offset between x0 and x1 on one side. Misses land where they strayed.
// A clamped-away hit lands past the edge by its distance from the aim point, as rollAim() pushes it.
function offTruckChance(o: Spread, a: Aiming, sign: number, x0: number, x1: number): number {
  const sd = o.spread * o.distance;
  const half = o.halfAngle * o.distance;
  const { promoted, keep } = clampShares(o);
  const [lo, hi] = sign > 0 ? [x0, x1] : [-x1, -x0];
  const inAim = landChance(a.center, sd, Math.max(lo, a.center - half), Math.min(hi, a.center + half));
  const missed = (1 - promoted) * (landChance(a.center, sd, lo, hi) - inAim);
  const edge = a.body / 2;
  const [dLo, dHi] = sign > 0 ? [a.center + x0 - edge, a.center + x1 - edge] : [a.center - (x1 - edge), a.center - (x0 - edge)];
  const pushed = (1 - keep) * landChance(a.center, sd, Math.max(dLo, a.center - half), Math.min(dHi, a.center + half));
  return missed + pushed;
}

// A miss off the truck explodes where it lands, or strays into another truck and explodes on one of its lanes.
function missReach(c: Reach, offset: number): number {
  const miss = missPoint(c.shooter.pos, c.target.pos, offset);
  const own = Number(splashReaches(c, miss, null));
  const candidates = strayCandidates(c.world, c.shooter, c.target, miss);
  if (candidates.length === 0) return own;
  return (1 - c.stray) * own + c.stray * strayReach(c, candidates);
}

function strayReach(c: Reach, candidates: { value: Vehicle; weight: number }[]): number {
  const total = candidates.reduce((sum, x) => sum + x.weight, 0);
  return candidates.reduce((sum, { value: victim, weight }) => {
    const side = sideToward(victim, c.shooter.pos);
    const n = laneCount(victim, side);
    const lanes = Array.from({ length: n }, (_, lane) => Number(splashReaches(c, lanePoint(victim, side, lane), null)));
    return sum + (weight / total) * (lanes.reduce((a, b) => a + b, 0) / n);
  }, 0);
}

// Each cause of a shot's spread. The steady aim perk takes the shake of the player's own speed away. A target that
// stands still takes a share off the whole spread, so a stuck or parked truck is easy to hit.
function spreadCauses(world: World, shooter: Vehicle, mw: MountedWeapon, target: Vehicle): HitOdds["causes"] {
  const weapon = mw.def.spread * DEG;
  const n = across(shooter, target);
  const rel = {
    x: mps(target.speed) * Math.cos(target.heading) - mps(shooter.speed) * Math.cos(shooter.heading),
    y: mps(target.speed) * Math.sin(target.heading) - mps(shooter.speed) * Math.sin(shooter.heading),
  };
  const steady = vehicleHasPerk(world, shooter, "steadyAim");
  const base = {
    weapon,
    range: weapon * RULES.rangeFalloff[mw.def.tier] * (dist(shooter.pos, target.pos) / mw.def.range) ** 2,
    skill: -weapon * skillEffect(world, shooter, "perception", "spread"),
    crossing: (RULES.leadError * Math.abs(rel.x * n.x + rel.y * n.y)) / mw.def.round.speed,
    own: steady ? 0 : RULES.shake * mw.def.shake * mps(Math.abs(shooter.speed)),
    recoil: (mw.def.recoil * DEG) / (vehicleMass(shooter) / KG_PER_TONNE),
    weather: vehicleHasPerk(world, shooter, "stormRider") ? 0 : weatherAt(world, shooter.pos).spread,
  };
  const sum = Object.values(base).reduce((a, cause) => a + cause, 0);
  const still = Math.abs(target.speed) < RULES.stillSpeed ? -sum * (1 - RULES.stillSpread) : 0;
  return { ...base, still };
}

// One round's angular error in radians and whether it hit the aimed part or, for a body shot, the truck. The
// Gaussian draw decides, so a miss lands where it strayed. When the clamp moved the chance, an extra roll turns some
// hits into misses that land off the truck, or some misses into hits, so rounds hit exactly as often as hitOdds says.
function rollRound(world: World, o: HitOdds, a: Aiming): Roll {
  return { ...rollAim(world, o, a), crit: chance(world, RULES.critChance) };
}

function rollAim(
  world: World,
  o: HitOdds,
  a: Aiming,
): { hit: boolean; error: number } {
  const raw = rawChance(o);
  const error = gauss(world) * o.spread;
  const hit = Math.abs(error) < o.halfAngle;
  if (raw > o.chance && hit && !chance(world, o.chance / raw)) {
    const sign = error < 0 ? -1 : 1;
    return {
      hit: false,
      error:
        sign * (Math.abs(error) + (a.body / 2 - sign * a.center) / o.distance),
    };
  }
  if (raw < o.chance && !hit && chance(world, (o.chance - raw) / (1 - raw)))
    return { hit: true, error: randRange(world, -o.halfAngle, o.halfAngle) };
  return { hit, error };
}

// crit applies only when the round lands on the truck: it multiplies damage and pen by the crit rules.
type Roll = { hit: boolean; error: number; crit: boolean };
type Shot = {
  shooter: Vehicle;
  mw: MountedWeapon;
  target: Vehicle;
  aim: Aim;
  odds: HitOdds;
  aiming: Aiming;
  rolls: Roll[];
};

// All rounds of the turn are rolled before any damage lands, so fire is simultaneous.
export function fireWeapons(world: World): void {
  const shots: Shot[] = [];
  for (const shooter of world.vehicles) {
    for (const mw of vehicleStats(world, shooter).weapons) {
      const order = shooter.weaponOrders[mw.part.id];
      if (!order) continue;
      const target =
        world.vehicles.find((x) => x.id === order.targetId) ?? null;
      if (fireBlock(world, shooter, mw, target) !== null) continue;
      const odds = hitOdds(world, shooter, mw, target!, order.aim);
      const a = aiming(shooter, target!, order.aim);
      const rolls = Array.from({ length: mw.def.rounds }, () =>
        rollRound(world, odds, a),
      );
      shots.push({
        shooter,
        mw,
        target: target!,
        aim: order.aim,
        odds,
        aiming: a,
        rolls,
      });
    }
  }
  for (const s of shots) applyShot(world, s);
  // Cooldown counts down at the end of the fire phase, so cooldown 1 means ready every turn.
  tickGuns(world, new Set(shots.map((s) => s.mw.part.id)));
}

// A shot takes one round from the magazine and starts the cooldown. The last round pushes an empty event.
function spendShot(world: World, s: Shot): void {
  const gun = gunOf(s.mw.part);
  gun.cooldown = s.mw.def.cooldown;
  gun.ammo--;
  gun.reloadWork = 0;
  if (gun.ammo === 0) world.events.push({ t: "empty", vehicle: s.shooter.id, weapon: s.mw.part.id });
}

// A shot counts as an attack on its target even when it misses: the target and witnesses saw it fired at them.
// Every other truck its rounds damage takes unintended damage, which noteStray() judges.
function applyShot(world: World, s: Shot): void {
  spendShot(world, s);
  noteAttack(world, s.shooter, s.target, !isHostile(world, s.target, s.shooter));
  const rounds = s.rolls.map((roll) => resolveRound(world, s, roll));
  const event = { t: "shot" as const, shooter: s.shooter.id, weapon: s.mw.part.id, target: s.target.id, aim: s.aim, chance: s.odds.chance, damageChance: s.odds.damageChance, side: s.aiming.side, rounds };
  for (const id of shotDamage(event).keys()) vehicleById(world, id).lastHitBy = s.shooter.id;
  noteStray(world, s, event);
  practiceHits(world, s);
  world.events.push(event);
}

// Part hits of a shot per truck, direct and blast.
export function shotDamage(e: { rounds: ShotRound[] }): Map<string, PartHit[]> {
  const out = new Map<string, PartHit[]>();
  const add = (id: string, hits: PartHit[]) => { if (hits.length > 0) out.set(id, [...(out.get(id) ?? []), ...hits]); };
  for (const r of e.rounds) {
    if (r.struck) add(r.struck, r.hits);
    for (const b of r.blast) add(b.vehicle, b.hits);
  }
  return out;
}

// Every part hit of this turn per truck, from shots, guard shots and collisions.
export function turnPartHits(world: World): Map<string, PartHit[]> {
  const out = new Map<string, PartHit[]>();
  const add = (id: string, hits: PartHit[]) => { if (hits.length > 0) out.set(id, [...(out.get(id) ?? []), ...hits]); };
  for (const e of world.events) {
    if (e.t === "shot" || e.t === "guardShot") for (const [id, hits] of shotDamage(e)) add(id, hits);
    else if (e.t === "collision") {
      add(e.a, e.hitsA);
      add(e.b, e.hitsB);
    }
  }
  return out;
}

function vehicleById(world: World, id: string): Vehicle {
  const v = world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id}`);
  return v;
}

// Where a round landed: the truck it struck and the lane it entered, or the ground.
type Landing = { struck: Vehicle | null; lane: number | null; hits: PartHit[]; point: Vec };

function resolveRound(world: World, s: Shot, roll: Roll): ShotRound {
  const offset = s.aiming.center + roll.error * s.odds.distance;
  const landing = landRound(world, s, roll, offset);
  const hit = landing.struck?.id === s.target.id;
  const blast = explode(world, s.mw.def.round, landing);
  return { hit, crit: hit && roll.crit, offset, struck: landing.struck?.id ?? null, hits: landing.hits, blast };
}

// A hit enters the lane under its offset, or the aimed part's lane. An aimed miss that lands on the truck enters
// the lane under its offset. A miss off the truck may stray into another truck near the line of fire.
function landRound(world: World, s: Shot, roll: Roll, offset: number): Landing {
  const { side, lanes, body } = s.aiming;
  if (!roll.hit && Math.abs(offset) >= body / 2) return strayRound(world, s, missPoint(s.shooter.pos, s.target.pos, offset));
  const lane = roll.hit && s.aiming.lane !== null ? s.aiming.lane : laneOfOffset(side, body, lanes, offset);
  const hits = walkLane(world, s.target, side, lane, directRound(s.mw.def.round, roll.crit));
  return { struck: s.target, lane, hits, point: lanePoint(s.target, side, lane) };
}

// The round that walks the lane it landed in. A crit multiplies its damage and pen.
function directRound(r: WeaponDef["round"], crit: boolean): Round {
  const k = crit ? { damage: RULES.critDamage, pen: RULES.critPen } : { damage: 1, pen: 1 };
  return { damage: r.damage * k.damage * RULES.weaponDamage, pen: r.pen * k.pen, blast: r.blast, armorShare: r.armorShare };
}

function splashRound(r: WeaponDef["round"]): Round {
  return { damage: r.splashDamage * RULES.weaponDamage, pen: r.splashPen, blast: true, armorShare: r.armorShare };
}

// A stray round enters a random lane of the side facing the shooter, with its full damage and pen.
function strayRound(world: World, s: Shot, miss: Vec): Landing {
  const victim = strayVictim(world, s, miss);
  if (!victim) return { struck: null, lane: null, hits: [], point: miss };
  const side = sideToward(victim, s.shooter.pos);
  const lane = randInt(world, 0, laneCount(victim, side) - 1);
  const r = s.mw.def.round;
  const hits = walkLane(world, victim, side, lane, directRound(r, false));
  return { struck: victim, lane, hits, point: lanePoint(victim, side, lane) };
}

// Where a round that missed the truck lands: beside the target, at its offset across the line of fire.
export function missPoint(from: Vec, target: Vec, offset: number): Vec {
  if (from.x === target.x && from.y === target.y) throw new Error('missPoint needs a shooter apart from its target');
  const b = bearing(from, target);
  return { x: target.x - (Math.sin(b) * offset) / M, y: target.y + (Math.cos(b) * offset) / M };
}

// Trucks other than shooter and target whose center lies within reach of the line of fire, which runs from the
// shooter through the miss point and on by reach. The stray chance is rolled only when one exists, and nearer
// trucks to the line weigh more.
function strayVictim(world: World, s: Shot, miss: Vec): Vehicle | null {
  const candidates = strayCandidates(world, s.shooter, s.target, miss);
  if (candidates.length === 0 || !chance(world, s.mw.def.stray)) return null;
  return sampleWeighted(world, candidates);
}

function strayCandidates(world: World, shooter: Vehicle, target: Vehicle, miss: Vec): { value: Vehicle; weight: number }[] {
  const reach = RULES.stray.reach;
  const len = dist(shooter.pos, miss);
  const dir = { x: (miss.x - shooter.pos.x) / len, y: (miss.y - shooter.pos.y) / len };
  return world.vehicles
    .filter((v) => v.id !== shooter.id && v.id !== target.id)
    .map((v) => ({ value: v, weight: reach - lineOffset(shooter.pos, dir, len + reach, v.pos) }))
    .filter((c) => c.weight > 0);
}

// How far a point lies from the line from a along dir for len tiles, or Infinity past either end.
function lineOffset(a: Vec, dir: Vec, len: number, p: Vec): number {
  const rel = { x: p.x - a.x, y: p.y - a.y };
  const along = rel.x * dir.x + rel.y * dir.y;
  if (along < 0 || along > len) return Infinity;
  return Math.abs(rel.x * dir.y - rel.y * dir.x);
}

// A round with a splash radius explodes where it lands. Every truck with a lane center within the radius takes
// splash in those lanes on the side facing the blast. The lane a direct hit entered takes no extra splash.
function explode(world: World, r: WeaponDef["round"], landing: Landing): VehicleHits[] {
  if (r.splashRadius <= 0) return [];
  const out: VehicleHits[] = [];
  for (const v of world.vehicles) {
    const { side, lanes } = blastLanes(v, landing.point, r.splashRadius);
    const skip = v.id === landing.struck?.id ? landing.lane : null;
    const hits = lanes
      .filter((lane) => lane !== skip)
      .flatMap((lane) => walkLane(world, v, side, lane, splashRound(r)));
    if (hits.length > 0) out.push({ vehicle: v.id, hits });
  }
  return out;
}

// The player practices perception from each round that hits as rolled, harder at a lower hit chance. A miss
// that lands on the truck anyway does not count.
function practiceHits(world: World, s: Shot): void {
  if (s.shooter.id !== world.player.vehicleId) return;
  const hits = s.rolls.filter((roll) => roll.hit).length;
  if (hits > 0) practice(world, 'hit', hits, 1 - s.odds.chance, s.target.id);
}

function witnessesAttack(world: World, observer: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  if (observer.faction !== target.faction) return false;
  if (dist(observer.pos, target.pos) > SPAWN.neighborHelp) return false;
  return (
    canVehicleSee(world, observer, target.pos) &&
    canVehicleSee(world, observer, shooter.pos)
  );
}

// An escort of the target that sees the shooter defends the target wherever it is.
function escortSees(world: World, v: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  return stateOf(world, "escort", v.id, target.id) !== null && canVehicleSee(world, v, shooter.pos);
}

// Starts the combat state from aggressor to target, or sets its timer back to full. A refresh keeps the state's id and
// born, so its end check still runs every turn.
function engage(world: World, aggressor: Vehicle, target: Vehicle): void {
  const held = stateOf(world, "combat", aggressor.id, target.id);
  if (held) held.turnsLeft = STATE_TURNS.combat;
  else addState(world, "combat", aggressor.id, target.id, { kind: "none" });
}

// True while the aggressor holds a combat state toward the target: the holder of a combat state is the aggressor.
export function fightsAgainst(world: World, aggressor: Vehicle, target: Vehicle): boolean {
  return stateOf(world, "combat", aggressor.id, target.id) !== null;
}

// True while v is on either side of a combat state. The one combat test: a hostile in sight is only a warning.
export function inCombat(world: World, v: Vehicle): boolean {
  return world.states.some((s) => s.kind === "combat" && (s.holder === v.id || s.other === v.id));
}

// True when v is in combat with some truck other than otherId.
export function inCombatWithOther(world: World, v: Vehicle, otherId: string): boolean {
  return world.states.some((s) => s.kind === "combat" && ((s.holder === v.id && s.other !== otherId) || (s.other === v.id && s.holder !== otherId)));
}

// The most turns any of v's combat states has left, or null when v is not in combat.
export function combatTurnsLeft(world: World, v: Vehicle): number | null {
  const left = world.states.filter((s) => s.kind === "combat" && (s.holder === v.id || s.other === v.id)).map((s) => s.turnsLeft ?? 0);
  return left.length > 0 ? Math.max(...left) : null;
}

// An NPC on a top fight goal that sees a hostile target is hunting it, even before its first shot. It runs after the
// goals resolve, so the calls at the end of the turn see it.
export function noteEngagements(world: World): void {
  for (const v of world.vehicles) {
    const target = huntedTarget(world, v);
    if (target) engage(world, v, target);
  }
}

// The target of v's top fight goal, if v is a live NPC on one.
function fightTargetId(v: Vehicle): string | null {
  const top = v.brain?.goals.at(-1);
  return top?.kind === "fight" && !isKnockedOut(v) ? top.targetId ?? null : null;
}

// The hostile truck v hunts on a top fight goal and sees, if any.
function huntedTarget(world: World, v: Vehicle): Vehicle | null {
  const id = fightTargetId(v);
  const target = id ? world.vehicles.find((t) => t.id === id) : undefined;
  return target && isHostile(world, v, target) && canVehicleSee(world, v, target.pos) ? target : null;
}

// A shot, hit or miss, marks its shooter as an attacker of the target, of faction mates nearby that see both, and of
// escorts of the target that see the shooter. Each NPC decides once on the latest shots. Hidden targets are not
// broadcast.
function recordAttack(world: World, shooter: Vehicle, target: Vehicle): void {
  engage(world, shooter, target);
  for (const observer of world.vehicles) {
    if (!observer.brain || observer.id === shooter.id) continue;
    if (learnsAttack(world, observer, shooter, target)) observer.brain.attackers[shooter.id] = false;
  }
}

function learnsAttack(world: World, observer: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  return observer.id === target.id || witnessesAttack(world, observer, shooter, target) || escortSees(world, observer, shooter, target);
}

// The one attack rule: a vehicle that damages another attacks it. The victim and witnesses learn the attacker,
// and a feud starts when the two were at peace before the blow. calm is that peace, read before any damage lands.
// An NPC attacked by a truck it had a deal with wants revenge on it.
export function noteAttack(world: World, attacker: Vehicle, victim: Vehicle, calm: boolean): void {
  recordAttack(world, attacker, victim);
  if (!calm) return;
  if (victim.brain && boundTo(world, attacker.id, victim.id)) addState(world, "revenge", victim.id, attacker.id, { kind: "none" });
  startFeuds(world, attacker, victim);
  callLawmen(world, attacker, victim);
}

// Damage a shot dealt to trucks other than its target. A foe of the shooter was attacked and fights back. Any other
// NPC sums the unintended damage in a strayFire state, and past RULES.stray.feudDamage takes it as an attack. The
// player decides its own hostility, and a shooter caught in its own blast blames nobody.
function noteStray(world: World, s: Shot, e: { rounds: ShotRound[] }): void {
  for (const [id, hits] of shotDamage(e)) {
    if (id === s.target.id || id === s.shooter.id) continue;
    const damage = hits.reduce((sum, h) => sum + h.damage, 0);
    if (damage > 0) judgeStray(world, s.shooter, vehicleById(world, id), damage);
  }
}

function judgeStray(world: World, shooter: Vehicle, victim: Vehicle, damage: number): void {
  if (isHostile(world, victim, shooter)) recordAttack(world, shooter, victim);
  else if (victim.brain) sumStray(world, shooter, victim, damage);
}

function sumStray(world: World, shooter: Vehicle, victim: Vehicle, damage: number): void {
  const held = stateOf(world, "strayFire", victim.id, shooter.id);
  const total = (held ? strayData(held).damage : 0) + damage;
  if (total < RULES.stray.feudDamage) {
    addState(world, "strayFire", victim.id, shooter.id, { kind: "strayFire", damage: total });
    return;
  }
  if (held) endState(world, held, "fulfilled");
  noteAttack(world, shooter, victim, true);
}

// Aggression against a neutral NPC, one outside the raiders, calls every lawman that sees both trucks. Each starts
// a feud with the aggressor. Lawmen do not protect the player.
export function callLawmen(world: World, aggressor: Vehicle, victim: Vehicle): void {
  if (!victim.brain || victim.faction === "raiders") return;
  for (const v of world.vehicles) {
    if (!answersCall(world, v, aggressor, victim) || stateOf(world, "feud", v.id, aggressor.id)) continue;
    addState(world, "feud", v.id, aggressor.id, { kind: "feud", robbery: false });
    world.events.push({ t: "hostile", vehicle: v.id, against: aggressor.id });
  }
}

function answersCall(world: World, v: Vehicle, aggressor: Vehicle, victim: Vehicle): boolean {
  if (v.id === aggressor.id || !isLawman(v)) return false;
  return canVehicleSee(world, v, aggressor.pos) && canVehicleSee(world, v, victim.pos);
}

// A crash damages both sides, and the event does not name a striker. A slow bump deals no damage and counts for
// nothing. Between hostiles, each damaged side was attacked by the other. Between trucks at peace, a crash is
// most likely an accident: each damaged NPC holds a grievance and decides later whether to forgive it. A tower and
// the truck it tows or offers to tow never attack each other by contact.
export function noteCollision(world: World, a: Vehicle, b: Vehicle, hitsA: PartHit[], hitsB: PartHit[]): void {
  if (towPair(world, a, b)) return;
  const calm = !isHostile(world, a, b);
  const attacks = ([[b, a, hitsA], [a, b, hitsB]] as const).filter(([, , hits]) => hits.some((h) => h.damage > 0));
  for (const [attacker, victim] of attacks) {
    victim.lastHitBy = attacker.id;
    if (!calm) recordAttack(world, attacker, victim);
    else if (victim.brain) addState(world, 'grievance', victim.id, attacker.id, { kind: 'none' });
  }
}

function towPair(world: World, a: Vehicle, b: Vehicle): boolean {
  return stateOf(world, 'tow', a.id, b.id) !== null || stateOf(world, 'tow', b.id, a.id) !== null;
}

// The target and the drivers that stand by it start a feud with the shooter.
export function startFeuds(world: World, shooter: Vehicle, target: Vehicle): void {
  for (const v of world.vehicles) {
    if (!joinsFeud(world, v, shooter, target) || stateOf(world, "feud", v.id, shooter.id)) continue;
    addState(world, "feud", v.id, shooter.id, { kind: "feud", robbery: false });
    world.events.push({ t: "hostile", vehicle: v.id, against: shooter.id });
  }
}

// The target, its faction mates nearby that see the shooter, and its escorts that see the shooter. The player
// decides its own hostility.
function joinsFeud(world: World, v: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  if (v.faction === "player") return false;
  if (v.id === target.id || escortSees(world, v, shooter, target)) return true;
  return v.faction === target.faction && dist(v.pos, target.pos) <= SPAWN.neighborHelp && canVehicleSee(world, v, shooter.pos);
}

// An NPC whose cab breaks is knocked out, or dies into a wreck at the death chance. A cab below half may knock the
// driver out first, and that never kills. Health at 0 kills it, and so
// does a shot that damages it while it is defeated. The player's broken cab is a knockout in src/sim/defeat.ts.
export function resolveDestroyed(world: World): void {
  const shot = damagedByShots(world);
  for (const v of world.vehicles.filter((x) => x.faction !== "player")) {
    const fate = npcFate(world, v, shot);
    if (fate === "dies") wreckVehicle(world, v);
    else if (fate === "knockedOut") knockOutNpc(world, v);
  }
  clearOldWrecks(world);
  settleAims(world);
}

// Keeps every weapon order readable. An order whose target is gone ends. An aim at a part that left its target is a
// body shot, since the truck the order chose is still there. Readers stay strict and throw on a missing part.
export function settleAims(world: World): void {
  for (const v of world.vehicles) {
    for (const [wid, order] of Object.entries(v.weaponOrders)) {
      const target = world.vehicles.find((x) => x.id === order.targetId);
      if (!target) delete v.weaponOrders[wid];
      else if (order.aim !== "body" && !mountedItems(target).some((it) => it.part.id === order.aim)) order.aim = "body";
    }
  }
}

// The defeated state is checked before the cab, since a knocked-out truck lies with a broken cab.
function npcFate(world: World, v: Vehicle, shot: Set<string>): "dies" | "knockedOut" | null {
  if (getResources(world, v).health <= 0) return "dies";
  if (isDefeated(v)) return shot.has(v.id) ? "dies" : null;
  return corePart(v, "cab").hp > 0 ? cabKnockFate(world, v) : brokenCabFate(world);
}

function cabKnockFate(world: World, v: Vehicle): "knockedOut" | null {
  return rollCabKnock(world, v) ? "knockedOut" : null;
}

function brokenCabFate(world: World): "dies" | "knockedOut" {
  return chance(world, RULES.npcDeathChance) ? "dies" : "knockedOut";
}

// Vehicles that took damage from a gun this turn.
function damagedByShots(world: World): Set<string> {
  const hurt = new Set<string>();
  for (const e of world.events) {
    if (e.t !== "shot" && e.t !== "guardShot") continue;
    if (e.rounds.some((r) => r.hits.some((h) => h.damage > 0))) hurt.add(e.target);
  }
  return hurt;
}

// The truck leaves the world as a wreck obstacle with a stock of what it carried.
export function wreckVehicle(world: World, v: Vehicle): void {
  createWreckSalvage(world, v);
  world.vehicles = world.vehicles.filter((x) => x.id !== v.id);
  world.removed.push(v);
  world.obstacles.push({
    id: `wreck-${v.id}`,
    pos: { ...v.pos },
    r: vehicleStats(world, v).radius * RULES.wreckRadiusScale,
    kind: "wreck",
  });
  world.events.push({
    t: "destroyed",
    vehicle: v.id,
    by: v.lastHitBy ?? "unknown",
  });
}

// Kill wrecks are pushed in order, so the first ones found are the oldest.
function clearOldWrecks(world: World): void {
  const kills = world.obstacles.filter((o) => o.id.startsWith("wreck-"));
  const drop = new Set(
    kills
      .slice(0, Math.max(0, kills.length - RULES.maxKillWrecks))
      .map((o) => o.id),
  );
  if (drop.size > 0) {
    world.obstacles = world.obstacles.filter((o) => !drop.has(o.id));
    removeStocks(world, drop);
  }
}

// An NPC fires back at any attacker, fleeing or not. It opens fire only on the target of the fight on top of its
// goals, and not while either stands in guard range of a town gate.
function canNpcEngage(v: Vehicle, target: Vehicle): boolean {
  if (!v.brain) return true;
  return target.id in v.brain.attackers || opensFireOn(v, v.brain.goals, target);
}

function opensFireOn(v: Vehicle, goals: NpcActivity[], target: Vehicle): boolean {
  const top = goals[goals.length - 1];
  if (top?.kind !== 'fight' || top.targetId !== target.id) return false;
  return !isTownGuarded(v.pos) && !isTownGuarded(target.pos);
}

// Auto mode: every weapon gets a body shot at the nearest hostile it can hit, in range, arc and line of fire. The player's auto fire
// only picks targets the player sees.
export function autoOrders(world: World, v: Vehicle): void {
  v.weaponOrders = {};
  const seen = (x: Vehicle) => canVehicleSee(world, v, x.pos);
  const hostiles = world.vehicles
    .filter((x) => isHostile(world, v, x) && seen(x) && canNpcEngage(v, x))
    .sort((a, b) => dist(v.pos, a.pos) - dist(v.pos, b.pos));
  for (const mw of vehicleStats(world, v).weapons) {
    const target =
      hostiles.find(
        (h) =>
          dist(v.pos, h.pos) <= mw.def.range &&
          inArc(v, mw, h) &&
          hasLineOfFire(world, v.pos, h.pos),
      ) ?? hostiles[0];
    if (target)
      v.weaponOrders[mw.part.id] = { targetId: target.id, aim: aimAt(world, v, target) };
  }
}

export function assignAutoOrders(world: World): void {
  for (const v of world.vehicles) {
    if (v.faction !== "player" || world.player.autoFire) autoOrders(world, v);
  }
}
