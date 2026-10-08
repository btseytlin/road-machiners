// Activity execution uses the same steering and route planner as the player.
import { NPC_BEHAVIOR, NPCS, SPAWN } from "../data/npcs";
import { sustainedDamage } from "../data/parts";
import { RULES } from "../data/rules";
import { isKnockedOut } from "./defeat";
import { isNear } from "./far";
import { getActivityDestination, thinkNpc, topGoal } from "./npc-activities";
import { route, routeLength, type Blocker } from "./path";
import { towData } from "./states";
import { randRange } from "./rng";
import { isFree } from "./spawn";
import { parkedVehicles } from "./steering";
import { vehicleStats, type MountedWeapon } from "./stats";
import { escortsOf, followPace, isOnRope, towHeldBy } from "./tow";
import { ramImpact, ramValue } from "./crash-contact";
import { ramsReadily } from "./npc-decisions";
import type { MoveOrder, NpcActivity, Vehicle, World } from "./types";
import { angleDiff, bearing, dist, type Vec } from "./vec";
import { canVehicleSee } from "./vision";
import { inArc } from "./combat";
import { passShare, sideToward } from "./armor";
import { chance } from "./rng";

function planners(world: World): Vehicle[] {
  return world.vehicles.filter((v) => v.brain && !isOnRope(world, v.id) && !isKnockedOut(v));
}

type Plan = { v: Vehicle; activity: NpcActivity; goal: Vec | null };

export function planNpcOrders(world: World): void {
  const plans = planners(world).map((v) => thinkOrderPoint(world, v));
  plans.sort((a, b) => (a.v.id < b.v.id ? 1 : -1));
  for (const plan of plans) setOrder(world, plan);
}

function thinkOrderPoint(world: World, v: Vehicle): Plan {
  const tpl = NPCS[v.brain!.templateId];
  if (!tpl) throw new Error(`Unknown NPC template ${v.brain!.templateId}`);
  const b = v.brain!;
  delete b.ramTarget;
  if (b.recovery) b.recovery--;
  const activity = thinkNpc(world, v);
  return { v, activity, goal: orderPoint(world, v, activity, tpl.preferredRange) };
}

function setOrder(world: World, { v, activity, goal }: Plan): void {
  noteStuck(world, v, goal);
  const stops = goal !== null && trafficStops(world, v, goal);
  noteStall(v, stops && activity.kind !== "fight" && activity.kind !== "flee");
  v.order = nextOrder(world, v, activity, goal, stops);
  v.direct = false;
}

function noteStuck(world: World, v: Vehicle, goal: Vec | null): void {
  const b = v.brain!;
  b.stuck = heldAway(v, goal) ? (b.stuck ?? 0) + 1 : 0;
  if (b.stuck < RULES.unstick.turns) return;
  const spot = freeSpotNear(world, v);
  if (!spot) return;
  b.recovery = RULES.unstick.driveTurns;
  b.recoveryGoal = spot;
  b.stuck = 0;
}

function heldAway(v: Vehicle, goal: Vec | null): boolean {
  const b = v.brain!;
  if (!goal || !b.lastPos || b.recovery) return false;
  return dist(v.pos, b.lastPos) < RULES.arriveRadius / 2 && dist(v.pos, goal) > RULES.arriveRadius * 2;
}

function freeSpotNear(world: World, v: Vehicle): Vec | null {
  const radius = vehicleStats(world, v).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const angle = randRange(world, 0, Math.PI * 2);
    const d = randRange(world, radius * 2, RULES.unstick.reach);
    const spot = { x: v.pos.x + Math.cos(angle) * d, y: v.pos.y + Math.sin(angle) * d };
    if (isFree(world, spot, radius, v.id)) return spot;
  }
  return null;
}

function noteStall(v: Vehicle, yielding: boolean): void {
  const b = v.brain!;
  b.stalled = !yielding && barelyMoved(v) ? (b.stalled ?? 0) + 1 : 0;
  b.lastPos = { ...v.pos };
  if (b.stalled >= RULES.npcStuckTurns) startRecovery(v);
}

function barelyMoved(v: Vehicle): boolean {
  const last = v.brain!.lastPos;
  return !!last && !!v.order && v.order.kind !== "brake" && dist(v.pos, last) < RULES.arriveRadius / 2;
}

function startRecovery(v: Vehicle): void {
  const b = v.brain!;
  const back = RULES.reverse.distance + RULES.minAimDistance;
  b.recovery = RULES.npcRecoveryTurns;
  b.recoveryGoal = { x: v.pos.x - Math.cos(v.heading) * back, y: v.pos.y - Math.sin(v.heading) * back };
  b.stalled = 0;
}

function nextOrder(world: World, v: Vehicle, activity: NpcActivity, goal: Vec | null, stops: boolean): MoveOrder {
  if (!goal) return { kind: "brake" };
  if (v.brain!.recovery) return { kind: "stopAt", dest: v.brain!.recoveryGoal! };
  if (stops || waitsForEscort(world, v, activity)) return { kind: "brake" };
  return driveOrder(world, v, activity, goal);
}

function orderPoint(world: World, v: Vehicle, activity: NpcActivity, templateRange: number): Vec | null {
  if (activity.kind !== "fight") return getActivityDestination(world, v, activity);
  const target = world.vehicles.find((other) => other.id === activity.targetId);
  if (!target) throw new Error("Fight activity missing its target");
  if (!canVehicleSee(world, v, target.pos)) return getActivityDestination(world, v, activity);
  const preferredRange = templateRange > 0 ? templateRange : shortestRange(world, v) - RULES.arriveRadius;
  const seen = perceivedTarget(world, v, target);
  noteTarget(world, v, target);
  return computeFightGoal(world, v, preferredRange, target, seen);
}

function waitsForEscort(world: World, v: Vehicle, activity: NpcActivity): boolean {
  if (activity.kind === "fight" || activity.kind === "flee") return false;
  return escortsOf(world, v.id).some((e) => topGoal(e)?.kind === "follow" && dist(e.pos, v.pos) > NPC_BEHAVIOR.escortWaitGap);
}

function driveOrder(world: World, v: Vehicle, activity: NpcActivity, dest: Vec): MoveOrder {
  if (v.brain!.ramTarget) return { kind: "through", dest };
  const foe = foeInSight(world, v, activity);
  if (foe) return fightOrder(world, v, foe, dest);
  const leader = activity.kind === "follow" ? world.vehicles.find((x) => x.id === activity.targetId) : undefined;
  if (!leader || leader.speed <= RULES.parkedSpeed) return { kind: "stopAt", dest };
  return { kind: "through", dest, pace: followPace(v, leader, dest) };
}

function foeInSight(world: World, v: Vehicle, activity: NpcActivity): Vehicle | null {
  if (activity.kind !== "fight") return null;
  const foe = world.vehicles.find((x) => x.id === activity.targetId);
  return foe && canVehicleSee(world, v, foe.pos) ? foe : null;
}

function computeFightGoal(world: World, v: Vehicle, preferredRange: number, target: Vehicle, seen: Vehicle): Vec | null {
  const b = v.brain!;
  if (rams(world, v, target)) {
    b.ramTarget = target.id;
    return leadOf(target);
  }
  if (b.whim?.kind === "halt") return null;
  const lead = leadOf(seen);
  const clearance = vehicleStats(world, v).radius + vehicleStats(world, target).radius + RULES.yieldDistance;
  const range = Math.max(preferredRange, clearance);
  if (b.whim?.kind === "veer") return { x: lead.x + Math.cos(b.whim.angle) * range, y: lead.y + Math.sin(b.whim.angle) * range };
  return fightPoint(world, v, seen, range);
}

export function perceivedTarget(world: World, v: Vehicle, target: Vehicle): Vehicle {
  const seen = v.brain!.targetSeen;
  if (!seen || seen.id !== target.id || seen.turn >= world.turn) return target;
  return { ...target, pos: { ...seen.pos }, heading: seen.heading, speed: seen.speed };
}

export function noteTarget(world: World, v: Vehicle, target: Vehicle): void {
  v.brain!.targetSeen = { id: target.id, turn: world.turn, pos: { ...target.pos }, heading: target.heading, speed: target.speed };
}

function rams(world: World, v: Vehicle, target: Vehicle): boolean {
  const b = v.brain!;
  return b.whim?.kind === "rush" || (b.ramChoice === target.id && ramImpact(world, v, target) !== null);
}

function shortestRange(world: World, v: Vehicle): number {
  const weapons = vehicleStats(world, v).weapons;
  if (weapons.length === 0) throw new Error(`${v.name} is fighting without a gun`);
  return Math.min(...weapons.map((weapon) => weapon.def.range));
}

const F = NPC_BEHAVIOR.fight;
const QUARTER = Math.PI / 2;

export function leadOf(target: Vehicle): Vec {
  return { x: target.pos.x + Math.cos(target.heading) * target.speed, y: target.pos.y + Math.sin(target.heading) * target.speed };
}

export function fightPoint(world: World, v: Vehicle, target: Vehicle, range: number): Vec {
  const lead = leadOf(target);
  const turn = circleTurn(world, v);
  let best: { p: Vec; score: number; fires: boolean } | null = null;
  for (let i = 0; i < F.angles; i++) {
    const a = (2 * Math.PI * i) / F.angles;
    const p = { x: lead.x + Math.cos(a) * range, y: lead.y + Math.sin(a) * range };
    const score = scorePoint(world, v, target, lead, range, p, turn);
    const fires = bearingShare(world, v, { ...target, pos: lead }, p) > 0;
    if (!best || beats({ score, fires }, best)) best = { p, score, fires };
  }
  return best!.p;
}

function beats(a: { score: number; fires: boolean }, b: { score: number; fires: boolean }): boolean {
  return a.fires === b.fires ? a.score > b.score : a.fires;
}

function bearingShare(world: World, v: Vehicle, there: Vehicle, p: Vec): number {
  const me = afterTurn(world, v, p);
  return gunShare(vehicleStats(world, v).weapons, (mw) => inReach(me, mw, there));
}

function circleTurn(world: World, v: Vehicle): number {
  if (NPCS[v.brain!.templateId].fightStyle !== 'circle') return 0;
  v.brain!.fightTurn ??= chance(world, 0.5) ? 1 : -1;
  return v.brain!.fightTurn;
}

export function scorePoint(world: World, v: Vehicle, target: Vehicle, lead: Vec, range: number, p: Vec, turn: number): number {
  const sv = vehicleStats(world, v);
  const me = afterTurn(world, v, p);
  const there = { ...target, pos: lead };
  const mine = bearingShare(world, v, there, p);
  const theirs = exposure(world, target, there, me);
  const off = Math.abs(dist(p, lead) - range) / range;
  const travel = Math.max(0, dist(v.pos, p) - sv.maxSpeed) / Math.max(sv.maxSpeed, RULES.arriveRadius);
  const ahead = turn === 0 ? 0 : Math.min(1, (turn * angleDiff(bearing(lead, v.pos), bearing(lead, p))) / QUARTER);
  const rammed = ramValue(world, there, me);
  const seek = ramsReadily(world, v, target.id) ? ramValue(world, me, there) : 0;
  return F.arcWeight * mine - F.threatWeight * theirs - F.rangeWeight * off - F.travelWeight * travel + F.circleWeight * ahead - F.rammedWeight * rammed + F.ramWeight * seek;
}

export function afterTurn(world: World, v: Vehicle, p: Vec): Vehicle {
  const d = dist(v.pos, p);
  if (d <= RULES.arriveRadius) return v;
  const sv = vehicleStats(world, v);
  const heading = bearing(v.pos, p);
  const step = Math.min(d, sv.maxSpeed, v.speed + sv.accel);
  return { ...v, pos: { x: v.pos.x + Math.cos(heading) * step, y: v.pos.y + Math.sin(heading) * step }, heading };
}

export function exposure(world: World, shooter: Vehicle, at: Vehicle, v: Vehicle): number {
  const working = vehicleStats(world, shooter).weapons.filter((mw) => mw.part.hp > 0);
  const total = working.reduce((sum, mw) => sum + sustainedDamage(mw.def), 0);
  if (total === 0) return 0;
  const side = sideToward(v, at.pos);
  const exposed = working.filter((mw) => inReach(at, mw, v)).reduce((sum, mw) => sum + sustainedDamage(mw.def) * passShare(v, side, mw.def.round), 0);
  return exposed / total;
}

function inReach(shooter: Vehicle, mw: MountedWeapon, target: Vehicle): boolean {
  return dist(shooter.pos, target.pos) <= mw.def.range && inArc(shooter, mw, target);
}

function gunShare(weapons: MountedWeapon[], bears: (mw: MountedWeapon) => boolean): number {
  const working = weapons.filter((mw) => mw.part.hp > 0);
  const perTurn = (mw: MountedWeapon) => sustainedDamage(mw.def);
  const total = working.reduce((sum, mw) => sum + perTurn(mw), 0);
  if (total === 0) return 0;
  return working.filter(bears).reduce((sum, mw) => sum + perTurn(mw), 0) / total;
}

export function fightOrder(world: World, v: Vehicle, target: Vehicle, dest: Vec): MoveOrder {
  const circling = NPCS[v.brain!.templateId].fightStyle === 'circle';
  if (!circling && target.speed < RULES.parkedSpeed) return { kind: 'stopAt', dest };
  const keepUp = target.speed + dist(v.pos, dest);
  return { kind: 'through', dest, pace: circling ? Math.max(F.circlePace, keepUp) : keepUp };
}

export function routeBlockers(world: World, v: Vehicle): Blocker[] {
  const parked = parkedVehicles(world, v.id);
  if (!v.brain) return parked;
  return [...parked, ...conflicts(world, v, 1).flatMap((x) => sweptPath(world, v, x))];
}

export function trafficStops(world: World, v: Vehicle, dest: Vec): boolean {
  if (facesParked(world, v)) return true;
  if (!isNear(world, v)) return false;
  if (facesOncoming(world, v)) return true;
  const moving = conflicts(world, v, 0);
  if (moving.length === 0) return false;
  const parked = parkedVehicles(world, v.id);
  const radius = vehicleStats(world, v).radius;
  const open = route(world, v.pos, dest, radius, parked, v);
  const around = route(world, v.pos, dest, radius, [...parked, ...moving.flatMap((x) => sweptPath(world, v, x))], v);
  if (dist(open.at(-1)!, around.at(-1)!) > 0) return true;
  const { vs, t } = horizon(world, v);
  return routeLength(v.pos, around) - routeLength(v.pos, open) > vs * t;
}

function others(world: World, v: Vehicle): Vehicle[] {
  return world.vehicles.filter((x) => x.id !== v.id && x.id !== v.brain?.ramTarget && !onOwnRope(world, v, x));
}

function conflicts(world: World, v: Vehicle, leadTurns: 0 | 1): Vehicle[] {
  return others(world, v).filter((x) => {
    if (x.speed < RULES.parkedSpeed) return false;
    const gap = gapAhead(world, v, x);
    return gap !== null && gap < brakingReach(world, v, x) + leadTurns * (v.speed + x.speed) && pathsMeet(world, v, x);
  });
}

function facesParked(world: World, v: Vehicle): boolean {
  return others(world, v).some((x) => {
    if (x.speed >= RULES.parkedSpeed) return false;
    const gap = gapAhead(world, v, x);
    return gap !== null && v.id < x.id && facesOff(world, v, x, gap);
  });
}

function facesOncoming(world: World, v: Vehicle): boolean {
  if (!givesWay(v)) return false;
  return conflicts(world, v, 0).some(
    (x) => v.id < x.id && givesWay(x) && conflicts(world, x, 0).some((y) => y.id === v.id),
  );
}

function horizon(world: World, v: Vehicle): { vs: number; t: number } {
  const sv = vehicleStats(world, v);
  const vs = Math.min(sv.maxSpeed, v.speed + sv.accel);
  return { vs, t: 1 + vs / sv.brake };
}

function sweptPath(world: World, v: Vehicle, x: Vehicle): Blocker[] {
  const sx = vehicleStats(world, x);
  const r = sx.radius;
  const radii = vehicleStats(world, v).radius + r;
  const { vs, t } = horizon(world, v);
  const xs = Math.min(sx.maxSpeed, x.speed + sx.accel);
  const reach = xs * t;
  const steps = Math.ceil(reach / r);
  const circles: Blocker[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (reach * i) / steps;
    const pos = { x: x.pos.x + Math.cos(x.heading) * d, y: x.pos.y + Math.sin(x.heading) * d };
    if (i === 0 || dist(v.pos, pos) - radii <= (vs * d) / xs) circles.push({ pos, r });
  }
  return circles;
}

function pathsMeet(world: World, v: Vehicle, x: Vehicle): boolean {
  const sv = vehicleStats(world, v);
  const sx = vehicleStats(world, x);
  const { vs, t: h } = horizon(world, v);
  const px = x.pos.x - v.pos.x;
  const py = x.pos.y - v.pos.y;
  const rx = Math.cos(x.heading) * x.speed - Math.cos(v.heading) * vs;
  const ry = Math.sin(x.heading) * x.speed - Math.sin(v.heading) * vs;
  const rr = rx * rx + ry * ry;
  const t = rr === 0 ? 0 : Math.min(h, Math.max(0, -(px * rx + py * ry) / rr));
  return Math.hypot(px + rx * t, py + ry * t) < sv.radius + sx.radius + RULES.yieldDistance;
}

function onOwnRope(world: World, tower: Vehicle, x: Vehicle): boolean {
  const tow = towHeldBy(world, tower.id);
  return tow !== null && towData(tow).hitched && tow.other === x.id;
}

function gapAhead(world: World, v: Vehicle, x: Vehicle): number | null {
  if (Math.abs(angleDiff(v.heading, bearing(v.pos, x.pos))) >= Math.PI / 4) return null;
  return dist(v.pos, x.pos) - vehicleStats(world, v).radius - vehicleStats(world, x).radius;
}

function brakingReach(world: World, v: Vehicle, x: Vehicle): number {
  const sv = vehicleStats(world, v);
  const sx = vehicleStats(world, x);
  const vs = Math.min(sv.maxSpeed, v.speed + sv.accel);
  const toward = Math.cos(angleDiff(x.heading, bearing(x.pos, v.pos)));
  const xs = toward > 0 ? Math.min(sx.maxSpeed, x.speed + sx.accel) * toward : x.speed * toward;
  const xTravel = Math.max(0, xs) + (Math.sign(xs) * xs ** 2) / (2 * sx.brake);
  return RULES.yieldDistance + vs + vs ** 2 / (2 * sv.brake) + xTravel;
}

function facesOff(world: World, v: Vehicle, x: Vehicle, gap: number): boolean {
  if (!givesWay(x) || !wantsToDrive(x) || gapAhead(world, x, v) === null) return false;
  return gap < RULES.yieldDistance + vehicleStats(world, v).accel + vehicleStats(world, x).accel;
}

function wantsToDrive(x: Vehicle): boolean {
  const order = x.order;
  return !!order && order.kind !== "brake" && dist(x.pos, order.dest) > RULES.arriveRadius * 2;
}

function givesWay(x: Vehicle): boolean {
  if (!x.brain) return false;
  const kind = topGoal(x)?.kind;
  return kind !== "fight" && kind !== "flee";
}
