import { CONFIG } from "../config";
import { PAL } from "../render/palette";
import { GROUND, type TurnResult } from "../phys/drive";
import { missPoint } from "../sim/combat";
import { carriedPart } from "../sim/salvage";
import type { Vec } from "../sim/vec";
import type { GameEvent, ShotRound, Vehicle, World } from "../sim/types";
import type { BreakCues, PartBreak, ShotLike } from "./breakCues";
import { roundLabel } from "../ui/format";
import { groundPoint, toMap, type V3 } from "../phys/frames";
import type { Fx3D } from "./render/fx";
import { blastRadiusOf, planVolley, projectileOf, roundAims, roundSpec, type Muzzle, type RoundPlan } from "./render/projectiles";
import { viewOf, type VehicleView } from "./render/vehicle";
import type { SoundDirector } from "./sound";

export type VolleyHost = {
  world: World;
  fx: Fx3D;
  sound: SoundDirector;
  eventPoint: (vehicleId: string) => V3 | null;
  onBurst: (point: Vec) => void;
  breakPart: (brk: PartBreak) => void;
};

export function playVolley(
  host: VolleyHost,
  a: V3,
  muzzle: () => Muzzle,
  b: V3,
  missAt: (offset: number) => V3,
  event: ShotLike,
  breaks: BreakCues,
  weapon: string,
  targetId: string,
  rows: Map<string, number>,
  dry: boolean,
): number {
  const rounds = event.rounds;
  const spec = projectileOf(weapon);
  const ground = (p: V3) => groundPoint(host.world.terrain, toMap(p)).y;
  const timing = { startMs: Math.random() * CONFIG.combatFireSpreadMs, windowMs: CONFIG.combatShotMs, burstMaxMs: CONFIG.combatBurstMaxMs };
  const plans = planVolley(spec, a, roundAims(b, targetId, rounds, host.eventPoint, missAt), timing, ground, blastRadiusOf(weapon));
  const fireCue = spec.look === "tracer" ? "mg-fire" : "cannon-fire";
  plans.forEach((plan, k) => {
    const last = dry && k === plans.length - 1;
    const burst = rounds[k].burst;
    const cues = {
      fired: (m: Muzzle) => host.sound.at(fireCue, m.pos, 0),
      landed: () => {
        landSound(host, plan, rounds[k]);
        if (last) host.sound.at("gun-empty", a, 0);
        if (burst) host.onBurst(burst);
        for (const brk of breaks.ofRound(event, k)) host.breakPart(brk);
      },
    };
    host.fx.shot(roundSpec(spec, k), muzzle, plan, blastRadiusOf(weapon), cues, host.world.turn);
    showDamage(host, rounds[k], plan.delayMs + plan.flightMs, rows);
  });
  return Math.min(...plans.map((plan) => plan.delayMs + plan.flightMs));
}

function landSound(host: VolleyHost, plan: RoundPlan, r: ShotRound): void {
  if (plan.impact !== "none") host.sound.at(r.struck !== null || r.blast.length > 0 ? "hit-metal" : "miss", plan.land, 0);
}

function showDamage(host: VolleyHost, r: ShotRound, landMs: number, rows: Map<string, number>): void {
  const struck = r.struck === null ? [] : [{ vehicle: r.struck, hits: r.hits }];
  for (const dealt of [...struck, ...r.blast]) damageLabel(host, dealt.vehicle, roundLabel(host.world, dealt.vehicle, dealt.hits, r.crit), rows, landMs);
}

function damageLabel(host: VolleyHost, vehicleId: string, label: string | null, rows: Map<string, number>, atMs: number): void {
  const p = host.eventPoint(vehicleId);
  if (!label || !p) return;
  const row = rows.get(vehicleId) ?? 0;
  rows.set(vehicleId, row + 1);
  host.fx.label(p, label, PAL.damageText, row, atMs, CONFIG.combatReadMs);
}

export type CombatHost = VolleyHost & { views: Map<string, VehicleView> };

export function playCrashes(host: CombatHost, cues: CollisionCues | null, step: number | null): void {
  for (const e of cues?.due(step) ?? []) {
    const p = host.eventPoint(e.a);
    if (p) host.fx.crash(p);
    if (p) host.sound.at("crash", p, 0);
  }
}

export function playDryGuns(host: CombatHost, played: Set<string>): void {
  for (const e of host.world.events) {
    const p = e.t === "empty" && !played.has(gunKey(e.vehicle, e.weapon)) ? host.eventPoint(e.vehicle) : null;
    if (p) host.sound.at("gun-empty", p, CONFIG.combatShotMs);
  }
}

const gunKey = (vehicle: string, weapon: string) => `${vehicle}|${weapon}`;

export function playShotFx(host: CombatHost, breaks: BreakCues): Set<string> {
  const rows = new Map<string, number>();
  const played = new Set<string>();
  for (const e of host.world.events) {
    const landMs = e.t === "shot" ? playTruckShot(host, e, rows, breaks) : null;
    if (landMs === null) continue;
    host.sound.accents([e], host.world.player.vehicleId, () => landMs);
    if (e.t === "shot") played.add(gunKey(e.shooter, e.weapon));
  }
  return played;
}

function vehicleOf(w: World, id: string): Vehicle {
  const v = w.vehicles.find((x) => x.id === id) ?? w.removed.find((x) => x.id === id);
  if (!v) throw new Error(`Shot names unknown vehicle ${id}`);
  return v;
}

function missAt(w: World, from: Vec, target: Vec): (offset: number) => V3 {
  return (offset) => groundPoint(w.terrain, missPoint(from, target, offset));
}

function playTruckShot(host: CombatHost, e: Extract<GameEvent, { t: "shot" }>, rows: Map<string, number>, breaks: BreakCues): number | null {
  const a = host.eventPoint(e.shooter);
  const b = host.eventPoint(e.target);
  if (!a || !b) return null;
  const w = host.world;
  const shooter = vehicleOf(w, e.shooter);
  const target = vehicleOf(w, e.target);
  const gun = carriedPart(w, e.shooter, e.weapon);
  if (!gun) throw new Error(`Shot from ${e.shooter} names no mounted weapon ${e.weapon}`);
  const view = viewOf(host.views, e.shooter);
  const dry = host.world.events.some((x) => x.t === "empty" && x.vehicle === e.shooter && x.weapon === e.weapon);
  return playVolley(host, a, () => view.muzzle(e.weapon), b, missAt(host.world, shooter.pos, target.pos), e, breaks, gun.defId, e.target, rows, dry);
}

export type CollisionEvent = Extract<GameEvent, { t: "collision" }>;
export type TimedCollision = { event: CollisionEvent; step: number | null };

type Steps = Pick<TurnResult, "crashes" | "breaks" | "landings">;

export function collisionSteps(events: GameEvent[], result: Steps): TimedCollision[] {
  const used = new Set<object>();
  const take = <T extends { step: number }>(list: T[], fits: (c: T) => boolean): number | null => {
    const found = list.find((c) => !used.has(c) && fits(c));
    if (!found) return null;
    used.add(found);
    return found.step;
  };
  const timed: TimedCollision[] = [];
  for (const event of events) {
    if (event.t !== "collision") continue;
    const step =
      take(result.breaks, (b) => b.vehicle === event.a && b.prop === event.b) ??
      take(result.crashes, (c) => samePair(c, event)) ??
      take(result.landings, (l) => l.vehicle === event.a && event.b === GROUND);
    timed.push({ event, step });
  }
  return timed;
}

function samePair(c: { a: string; b: string }, e: CollisionEvent): boolean {
  return (c.a === e.a && c.b === e.b) || (c.a === e.b && c.b === e.a);
}

export class CollisionCues {
  private pending: TimedCollision[];

  constructor(timed: TimedCollision[]) {
    this.pending = timed.slice();
  }

  due(step: number | null): CollisionEvent[] {
    const out = this.pending.filter((t) => step === null || (t.step !== null && t.step <= step));
    this.pending = this.pending.filter((t) => !out.includes(t));
    return out.map((t) => t.event);
  }
}
