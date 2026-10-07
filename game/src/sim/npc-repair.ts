// NPC field repairs: which part to patch, where to park for it, and the repair jobs. Shared jobs complete repairs
// and spend parts. src/sim/npc-activities.ts decides when a repair goal goes on the stack.

import { NPC_BEHAVIOR, NPC_UPKEEP } from '../data/npcs';
import { isJunk, maxHp } from './wear';
import { mountedParts } from './grid';
import { inCombat } from './combat';
import { bodyCondition } from './npc-decisions';
import { startJob } from './jobs';
import { withinReach } from './npc-activities';
import { straightClear } from './path';
import { repairPlan } from './repair';
import { getResources } from './resources';
import { vehicleStats } from './stats';
import { inShade, shadeCasters, shadeMatters, sunAt } from './sun';
import type { NpcActivity, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

// A truck with no engine or a junk one stays stranded for good. No patch fixes it, only a refit. See serveStranded.
export function isStrandedForGood(vehicle: Vehicle): boolean {
  const engine = mountedParts(vehicle, 'engine')[0];
  return !engine || isJunk(engine);
}

// A part that keeps the truck driving, or a truck broken up all around, needs service. Worn armor, guns and cargo do
// not. Junk parts do not count, since no service rebuilds them.
export function isDamaged(vehicle: Vehicle): boolean {
  const drivingPartWorn = [...mountedParts(vehicle, 'core'), ...mountedParts(vehicle, 'engine')]
    .some((part) => !isJunk(part) && part.hp / maxHp(part) <= NPC_BEHAVIOR.fleeCondition);
  return isStrandedForGood(vehicle) || drivingPartWorn || bodyCondition(vehicle) <= NPC_BEHAVIOR.fleeCondition;
}

function chooseRepairPart(world: World, vehicle: Vehicle) {
  return mountedParts(vehicle)
    .filter((part) => !isJunk(part) && repairPlan(world, vehicle, part.id).parts > 0)
    .sort((a, b) => a.hp / maxHp(a) - b.hp / maxHp(b))[0];
}

function canSearchForShade(world: World, vehicle: Vehicle): boolean {
  const sun = sunAt(world.turn);
  if (!sun || !shadeMatters(world, vehicle.pos)) return false;
  if (getResources(world, vehicle).fuel === 0) return false;
  return !inShade(world, vehicle.pos, sun);
}

function isRepairCandidate(world: World, vehicle: Vehicle, point: Vec): boolean {
  if (point.x < 1 || point.y < 1) return false;
  if (point.x >= world.size - 1 || point.y >= world.size - 1) return false;
  return dist(vehicle.pos, point) <= NPC_UPKEEP.shadeSearchRadius;
}

function getRepairCandidates(world: World, vehicle: Vehicle): Vec[] {
  const radius = NPC_UPKEEP.shadeSearchRadius;
  const candidates: Vec[] = [];
  for (let y = Math.floor(vehicle.pos.y - radius); y <= vehicle.pos.y + radius; y++) {
    for (let x = Math.floor(vehicle.pos.x - radius); x <= vehicle.pos.x + radius; x++) {
      const point = { x: x + 0.5, y: y + 0.5 };
      if (isRepairCandidate(world, vehicle, point)) candidates.push(point);
    }
  }
  return candidates.sort((a, b) => dist(vehicle.pos, a) - dist(vehicle.pos, b));
}

// Reachable shade nearby, or null to repair wherever the driver stops.
function chooseRepairSpot(world: World, vehicle: Vehicle): Vec | null {
  if (!canSearchForShade(world, vehicle)) return null;
  const sun = sunAt(world.turn);
  if (!sun) throw new Error('Shade search requires sunlight');
  const radius = vehicleStats(world, vehicle).radius;
  const blockers = world.vehicles
    .filter((other) => other.id !== vehicle.id)
    .map((other) => ({ pos: other.pos, r: vehicleStats(world, other).radius }));
  const casters = shadeCasters(world, vehicle.pos, NPC_UPKEEP.shadeSearchRadius);
  const shaded = getRepairCandidates(world, vehicle)
    .find((point) => inShade(world, point, sun, casters) && straightClear(world, vehicle.pos, point, radius, blockers));
  return shaded ?? null;
}

// A repair goal when the most damaged part carried parts can patch is at or below `condition`. Null otherwise.
export function chooseNpcRepair(world: World, vehicle: Vehicle, condition: number): NpcActivity | null {
  const part = chooseRepairPart(world, vehicle);
  if (!part) return null;
  if (part.hp / maxHp(part) > condition) return null;
  const destination = chooseRepairSpot(world, vehicle);
  return {
    kind: 'repair',
    targetId: null,
    destination,
    phase: destination ? 'travel' : 'act',
    reason: 'patchParts',
  };
}

// A driver out of fuel repairs where it stopped.
export function continueNpcRepair(world: World, vehicle: Vehicle, activity: NpcActivity): void {
  if (getResources(world, vehicle).fuel === 0) activity.destination = null;
}

// A driver repairs where it stands with no spot, or within the goal reach rule of its spot, so a drift after a
// patch does not send it circling back.
export function repairsHere(vehicle: Vehicle, activity: NpcActivity): boolean {
  return activity.destination === null || withinReach(vehicle, activity);
}

// Starts the next repair job once parked where it repairs. True when nothing is left to patch.
export function resolveNpcRepair(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  if (!repairsHere(vehicle, activity)) return false;
  activity.phase = 'act';
  if (vehicle.job) return false;
  return startNpcRepair(world, vehicle);
}

function startNpcRepair(world: World, vehicle: Vehicle): boolean {
  if (inCombat(world, vehicle)) return false;
  const part = chooseRepairPart(world, vehicle);
  if (!part) return true;
  const plan = repairPlan(world, vehicle, part.id, 1);
  startJob(world, vehicle, {
    kind: 'repair',
    partId: part.id,
    parts: plan.parts,
    turnsLeft: plan.turns,
    total: plan.turns,
  });
  return false;
}
