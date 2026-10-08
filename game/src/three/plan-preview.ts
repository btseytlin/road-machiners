// The path preview: the next turns of the player's truck, run through the same physics the turn will run.

import { freeDrive, simulateTurn, type Drive } from "../phys/drive";
import type { VehicleFrame } from "../phys/frames";
import { applyTurn } from "../phys/turn";
import { PAL } from "../render/palette";
import { routeBlockers } from "../sim/ai";
import { route } from "../sim/path";
import { vehicleStats } from "../sim/stats";
import { throttleFor } from "../sim/steering";
import type { Vehicle, World } from "../sim/types";
import type { Vec } from "../sim/vec";
import { cloneWorld } from "../sim/world";

const PLAN_TURNS = 3; // turns of path preview

export type PlanPreview = { turns: VehicleFrame[][]; first: number; course: Vec[] | null; waypoint: boolean };

// Simulates up to PLAN_TURNS turns of me on a clone of the world. The live drive is never freed or stepped.
export function previewPlan(drive: Drive, world: World, me: Vehicle): PlanPreview {
  const w = cloneWorld(world);
  const { turns, v } = simulate(drive, w, me);
  const first = me.order?.kind === "through" ? throttleColor(me, me.order.dest) : PAL.plan;
  return { turns, first, course: courseAfter(w, v), waypoint: !v.direct };
}

function simulate(drive: Drive, w: World, me: Vehicle): { turns: VehicleFrame[][]; v: Vehicle } {
  const turns: VehicleFrame[][] = [];
  let d = drive;
  let v = me;
  for (let i = 0; i < PLAN_TURNS; i++) {
    const r = simulateTurn(d, w);
    turns.push(r.frames[me.id]);
    w.events = [];
    applyTurn(w, r);
    if (d !== drive) freeDrive(d);
    d = r.next;
    v = w.vehicles.find((x) => x.id === me.id)!;
    if (!v.order && v.speed < 0.05) break;
  }
  if (d !== drive) freeDrive(d);
  return { turns, v };
}

// A course longer than the simulated turns continues as the route the driver will take.
function courseAfter(w: World, v: Vehicle): Vec[] | null {
  const order = v.order?.kind === "brake" ? null : v.order;
  if (!order) return null;
  if (v.direct) return [v.pos, order.dest];
  return [v.pos, ...route(w, v.pos, order.dest, vehicleStats(w, v).radius, routeBlockers(w, v), v)];
}

// The throttle color for driving me toward p.
export function throttleColor(me: Vehicle, p: Vec): number {
  return PAL.throttle[throttleFor(Math.hypot(p.x - me.pos.x, p.y - me.pos.y), me.speed)];
}
