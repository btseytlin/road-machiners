// The stall watchdog: no driver stays stuck for good, whatever bug stranded it.

import { NPC_BEHAVIOR, SPAWN } from '../data/npcs';
import { RULES } from '../data/rules';
import { vehicleById } from './damage';
import { isKnockedOut } from './defeat';
import { awaitsTower, exploreGoal, idleGoal, logChange, pushGoal, saleGoal, topGoal } from './npc-activities';
import { hasSaleCargo, npcProfile } from './npc-decisions';
import { liesUp } from './npc-service';
import { isShutDown } from './utility';
import { route } from './path';
import { randRange } from './rng';
import { nearestPad } from './sites';
import { isFree } from './spawn';
import { vehicleStats } from './stats';
import { isOnRope, npcHomeSite } from './tow';
import type { Vehicle, World } from './types';
import { canVehicleSee } from './vision';
import { dist, type Vec } from './vec';

export function watchStalls(world: World): void {
  for (const v of world.vehicles) {
    if (!v.brain) continue;
    if (madeProgress(world, v)) v.brain.progress = { key: progressKey(v), since: world.turn };
    else if (world.turn - v.brain.progress!.since >= NPC_BEHAVIOR.stallTurns) giveUp(world, v);
  }
}

function madeProgress(world: World, v: Vehicle): boolean {
  if (isKnockedOut(v) || waits(world, v)) return true;
  return v.brain!.progress?.key !== progressKey(v);
}

function waits(world: World, v: Vehicle): boolean {
  return isShutDown(world, v) || isOnRope(world, v.id) || awaitsTower(world, v) || liesUp(v) || waitsOnLeader(v);
}

function waitsOnLeader(v: Vehicle): boolean {
  const top = topGoal(v);
  return top?.kind === 'follow' && top.destination !== null && dist(v.pos, top.destination) <= RULES.arriveRadius;
}

function progressKey(v: Vehicle): string {
  const top = topGoal(v);
  const goal = top ? `${top.kind}:${top.targetId}:${top.reason}` : 'idle';
  return `${Math.round(v.pos.x)},${Math.round(v.pos.y)} ${goal} ${v.job ? `${v.job.kind}:${v.job.turnsLeft}` : '-'}`;
}

function giveUp(world: World, v: Vehicle): void {
  const top = topGoal(v);
  world.events.push({ t: 'stall', vehicle: v.id, goal: top?.kind ?? null, reason: top?.reason ?? 'idle' });
  v.brain!.goals = [];
  logChange(world, v, top, 'no progress for too long');
  jumpClear(world, v);
  freshGoal(world, v);
  v.brain!.progress = { key: progressKey(v), since: world.turn };
}

function freshGoal(world: World, v: Vehicle): void {
  const next = hasSaleCargo(v) ? saleGoal(world, v, npcProfile(v)) : idleGoal(world, v);
  const goal = next.kind === 'wait' ? exploreGoal(world, v) : next;
  if (goal.kind !== 'wait') pushGoal(world, v, goal);
}

function jumpClear(world: World, v: Vehicle): void {
  const player = vehicleById(world, world.player.vehicleId);
  const home = npcHomeSite(v);
  if (!home || canVehicleSee(world, player, v.pos)) return;
  const spot = jumpSpot(world, v, player, nearestPad(home, v.pos));
  if (!spot) return;
  v.pos = spot;
  v.speed = 0;
  v.order = null;
  v.trail = [];
  delete v.brain!.farRoute;
}

function jumpSpot(world: World, v: Vehicle, player: Vehicle, pad: Vec): Vec | null {
  const radius = vehicleStats(world, v).radius;
  for (let i = 0; i < SPAWN.tries; i++) {
    const angle = randRange(world, 0, Math.PI * 2);
    const d = randRange(world, radius * 2, NPC_BEHAVIOR.stallJump);
    const spot = { x: v.pos.x + Math.cos(angle) * d, y: v.pos.y + Math.sin(angle) * d };
    if (!isFree(world, spot, radius, v.id) || canVehicleSee(world, player, spot)) continue;
    const end = route(world, spot, pad, radius, [], v).at(-1) ?? spot;
    if (dist(end, pad) <= RULES.arriveRadius * 2) return spot;
  }
  return null;
}
