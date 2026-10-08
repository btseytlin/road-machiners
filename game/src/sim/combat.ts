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

export function isHostile(world: World, a: Vehicle, b: Vehicle): boolean {
  if (!isFoe(world, a, b)) return false;
  if (inFeud(world, a, b) || isLawPair(a, b)) return true;
  return hasLoot(a.faction === "raiders" ? b : a);
}

export function huntsForLoot(world: World, raider: Vehicle, target: Vehicle): boolean {
  return raider.faction === "raiders" && target.faction !== "raiders" && !inFeud(world, raider, target) && !isLawPair(raider, target);
}

function isLawPair(a: Vehicle, b: Vehicle): boolean {
  return (isLawman(a) && b.faction === "raiders") || (isLawman(b) && a.faction === "raiders");
}

function isLawman(v: Vehicle): boolean {
  return v.brain?.traits.includes("lawman") === true;
}

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

export function gunOf(part: PartInstance): GunState {
  if (!part.gun) throw new Error(`Weapon part ${part.id} has no gun state`);
  return part.gun;
}

export function dropMagazine(part: PartInstance): void {
  const gun = gunOf(part);
  gun.ammo = 0;
  gun.reloadWork = 0;
}

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
  chance: number;
  bodyChance: number;
  damageChance: number;
  distance: number;
  width: number;
  halfAngle: number;
  spread: number;
  causes: {
    weapon: number;
    range: number;
    crossing: number;
    own: number;
    recoil: number;
    skill: number;
    weather: number;
    still: number;
  };
};

const M = PHYSICS.metersPerTile;
const KG_PER_TONNE = 1000;

function mps(tilesPerTurn: number): number {
  return (tilesPerTurn * M) / PHYSICS.turnSeconds;
}

function across(shooter: Vehicle, target: Vehicle): Vec {
  const b = bearing(shooter.pos, target.pos);
  return { x: -Math.sin(b), y: Math.cos(b) };
}

export function presentedWidth(shooter: Vehicle, target: Vehicle): number {
  const half = bodyOf(target.chassisId).half;
  const a = angleDiff(target.heading, bearing(shooter.pos, target.pos));
  return 2 * (Math.abs(half.x * Math.sin(a)) + Math.abs(half.z * Math.cos(a)));
}

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

function clampShares(o: Spread): { raw: number; promoted: number; keep: number } {
  const raw = rawChance(o);
  return {
    raw,
    promoted: raw < o.chance ? (o.chance - raw) / (1 - raw) : 0,
    keep: raw > o.chance ? o.chance / raw : 1,
  };
}

function laneSpan(a: Aiming, lane: number): [number, number] {
  const c = laneCenter(a.side, a.body, a.lanes, lane);
  const half = a.body / a.lanes / 2;
  return [c - half, c + half];
}

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

function laneReach(c: Reach, lane: number): number {
  if (splashReaches(c, lanePoint(c.target, c.a.side, lane), lane)) return 1;
  const walks = (crit: boolean) => Number(reachesAim(c, planLane(c.target, c.a.side, lane, directRound(c.round, crit))));
  return (1 - RULES.critChance) * walks(false) + RULES.critChance * walks(true);
}

function splashReaches(c: Reach, point: Vec, skip: number | null): boolean {
  if (c.round.splashRadius <= 0) return false;
  const { side, lanes } = blastLanes(c.target, point, c.round.splashRadius);
  return lanes.some((lane) => lane !== skip && reachesAim(c, planLane(c.target, side, lane, splashRound(c.round))));
}

const OFF_TRUCK_STEPS = 64;

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

function missReach(c: Reach, offset: number): number {
  const miss = missPoint(c.shooter, c.target, offset);
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
  tickGuns(world, new Set(shots.map((s) => s.mw.part.id)));
}

function spendShot(world: World, s: Shot): void {
  const gun = gunOf(s.mw.part);
  gun.cooldown = s.mw.def.cooldown;
  gun.ammo--;
  gun.reloadWork = 0;
  if (gun.ammo === 0) world.events.push({ t: "empty", vehicle: s.shooter.id, weapon: s.mw.part.id });
}

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

export function shotDamage(e: { rounds: ShotRound[] }): Map<string, PartHit[]> {
  const out = new Map<string, PartHit[]>();
  const add = (id: string, hits: PartHit[]) => { if (hits.length > 0) out.set(id, [...(out.get(id) ?? []), ...hits]); };
  for (const r of e.rounds) {
    if (r.struck) add(r.struck, r.hits);
    for (const b of r.blast) add(b.vehicle, b.hits);
  }
  return out;
}

function vehicleById(world: World, id: string): Vehicle {
  const v = world.vehicles.find((x) => x.id === id);
  if (!v) throw new Error(`No vehicle ${id}`);
  return v;
}

type Landing = { struck: Vehicle | null; lane: number | null; hits: PartHit[]; point: Vec };

function resolveRound(world: World, s: Shot, roll: Roll): ShotRound {
  const offset = s.aiming.center + roll.error * s.odds.distance;
  const landing = landRound(world, s, roll, offset);
  const hit = landing.struck?.id === s.target.id;
  const blast = explode(world, s.mw.def.round, landing);
  return { hit, crit: hit && roll.crit, offset, struck: landing.struck?.id ?? null, hits: landing.hits, blast };
}

function landRound(world: World, s: Shot, roll: Roll, offset: number): Landing {
  const { side, lanes, body } = s.aiming;
  if (!roll.hit && Math.abs(offset) >= body / 2) return strayRound(world, s, missPoint(s.shooter, s.target, offset));
  const lane = roll.hit && s.aiming.lane !== null ? s.aiming.lane : laneOfOffset(side, body, lanes, offset);
  const hits = walkLane(world, s.target, side, lane, directRound(s.mw.def.round, roll.crit));
  return { struck: s.target, lane, hits, point: lanePoint(s.target, side, lane) };
}

function directRound(r: WeaponDef["round"], crit: boolean): Round {
  const k = crit ? { damage: RULES.critDamage, pen: RULES.critPen } : { damage: 1, pen: 1 };
  return { damage: r.damage * k.damage * RULES.weaponDamage, pen: r.pen * k.pen, blast: r.blast, armorShare: r.armorShare };
}

function splashRound(r: WeaponDef["round"]): Round {
  return { damage: r.splashDamage * RULES.weaponDamage, pen: r.splashPen, blast: true, armorShare: r.armorShare };
}

function strayRound(world: World, s: Shot, miss: Vec): Landing {
  const victim = strayVictim(world, s, miss);
  if (!victim) return { struck: null, lane: null, hits: [], point: miss };
  const side = sideToward(victim, s.shooter.pos);
  const lane = randInt(world, 0, laneCount(victim, side) - 1);
  const r = s.mw.def.round;
  const hits = walkLane(world, victim, side, lane, directRound(r, false));
  return { struck: victim, lane, hits, point: lanePoint(victim, side, lane) };
}

function missPoint(shooter: Vehicle, target: Vehicle, offset: number): Vec {
  const n = across(shooter, target);
  return { x: target.pos.x + (n.x * offset) / M, y: target.pos.y + (n.y * offset) / M };
}

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

function lineOffset(a: Vec, dir: Vec, len: number, p: Vec): number {
  const rel = { x: p.x - a.x, y: p.y - a.y };
  const along = rel.x * dir.x + rel.y * dir.y;
  if (along < 0 || along > len) return Infinity;
  return Math.abs(rel.x * dir.y - rel.y * dir.x);
}

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

function escortSees(world: World, v: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  return stateOf(world, "escort", v.id, target.id) !== null && canVehicleSee(world, v, shooter.pos);
}

function engage(world: World, aggressor: Vehicle, target: Vehicle): void {
  const held = stateOf(world, "combat", aggressor.id, target.id);
  if (held) held.turnsLeft = STATE_TURNS.combat;
  else addState(world, "combat", aggressor.id, target.id, { kind: "none" });
}

export function inCombat(world: World, v: Vehicle): boolean {
  return world.states.some((s) => s.kind === "combat" && (s.holder === v.id || s.other === v.id));
}

export function inCombatWithOther(world: World, v: Vehicle, otherId: string): boolean {
  return world.states.some((s) => s.kind === "combat" && ((s.holder === v.id && s.other !== otherId) || (s.other === v.id && s.holder !== otherId)));
}

export function combatTurnsLeft(world: World, v: Vehicle): number | null {
  const left = world.states.filter((s) => s.kind === "combat" && (s.holder === v.id || s.other === v.id)).map((s) => s.turnsLeft ?? 0);
  return left.length > 0 ? Math.max(...left) : null;
}

export function noteEngagements(world: World): void {
  for (const v of world.vehicles) {
    const target = huntedTarget(world, v);
    if (target) engage(world, v, target);
  }
}

function fightTargetId(v: Vehicle): string | null {
  const top = v.brain?.goals.at(-1);
  return top?.kind === "fight" && !isKnockedOut(v) ? top.targetId ?? null : null;
}

function huntedTarget(world: World, v: Vehicle): Vehicle | null {
  const id = fightTargetId(v);
  const target = id ? world.vehicles.find((t) => t.id === id) : undefined;
  return target && isHostile(world, v, target) && canVehicleSee(world, v, target.pos) ? target : null;
}

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

export function noteAttack(world: World, attacker: Vehicle, victim: Vehicle, calm: boolean): void {
  recordAttack(world, attacker, victim);
  if (!calm) return;
  if (victim.brain && boundTo(world, attacker.id, victim.id)) addState(world, "revenge", victim.id, attacker.id, { kind: "none" });
  startFeuds(world, attacker, victim);
  callLawmen(world, attacker, victim);
}

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

export function startFeuds(world: World, shooter: Vehicle, target: Vehicle): void {
  for (const v of world.vehicles) {
    if (!joinsFeud(world, v, shooter, target) || stateOf(world, "feud", v.id, shooter.id)) continue;
    addState(world, "feud", v.id, shooter.id, { kind: "feud", robbery: false });
    world.events.push({ t: "hostile", vehicle: v.id, against: shooter.id });
  }
}

function joinsFeud(world: World, v: Vehicle, shooter: Vehicle, target: Vehicle): boolean {
  if (v.faction === "player") return false;
  if (v.id === target.id || escortSees(world, v, shooter, target)) return true;
  return v.faction === target.faction && dist(v.pos, target.pos) <= SPAWN.neighborHelp && canVehicleSee(world, v, shooter.pos);
}

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

export function settleAims(world: World): void {
  for (const v of world.vehicles) {
    for (const [wid, order] of Object.entries(v.weaponOrders)) {
      const target = world.vehicles.find((x) => x.id === order.targetId);
      if (!target) delete v.weaponOrders[wid];
      else if (order.aim !== "body" && !mountedItems(target).some((it) => it.part.id === order.aim)) order.aim = "body";
    }
  }
}

function npcFate(world: World, v: Vehicle, shot: Set<string>): "dies" | "knockedOut" | null {
  if (getResources(world, v).health <= 0) return "dies";
  if (isDefeated(v)) return shot.has(v.id) ? "dies" : null;
  if (corePart(v, "cab").hp > 0) return null;
  return chance(world, RULES.npcDeathChance) ? "dies" : "knockedOut";
}

function damagedByShots(world: World): Set<string> {
  const hurt = new Set<string>();
  for (const e of world.events) {
    if (e.t !== "shot" && e.t !== "guardShot") continue;
    if (e.rounds.some((r) => r.hits.some((h) => h.damage > 0))) hurt.add(e.target);
  }
  return hurt;
}

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

function canNpcEngage(v: Vehicle, target: Vehicle): boolean {
  if (!v.brain) return true;
  return target.id in v.brain.attackers || opensFireOn(v, v.brain.goals, target);
}

function opensFireOn(v: Vehicle, goals: NpcActivity[], target: Vehicle): boolean {
  const top = goals[goals.length - 1];
  if (top?.kind !== 'fight' || top.targetId !== target.id) return false;
  return !isTownGuarded(v.pos) && !isTownGuarded(target.pos);
}

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
