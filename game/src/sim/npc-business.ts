// An NPC's time at a site deal: resupply, sell, trade and haul goals wait out a parked business job on the pad, and
// the goal's resolver runs the deal on the turn the job ends done.

import { NPC_UPKEEP } from '../data/npcs';
import { inCombat } from './combat';
import { startJob } from './jobs';
import type { BusinessDeal, Job, NpcActivity, Vehicle, World } from './types';

type BusinessJob = Extract<Job, { kind: 'business' }>;

const DEALS: readonly string[] = ['resupply', 'sell', 'trade', 'haul'] satisfies BusinessDeal[];

// A business job belongs to its deal's goal on its site on top.
export function businessBelongs(job: BusinessJob, goal: NpcActivity | null): boolean {
  return goal?.kind === job.deal && goal.targetId === job.siteId;
}

function isBusinessDone(e: World['events'][number], vehicle: Vehicle): e is { t: 'job'; vehicle: string; job: BusinessJob; outcome: 'done' } {
  return e.t === 'job' && e.vehicle === vehicle.id && e.outcome === 'done' && e.job.kind === 'business';
}

// True on the turn this vehicle's business job for the goal's deal and site ended done. A done business job for
// another deal or site means the job outlived its goal, which businessBelongs() rules out.
function businessDone(world: World, vehicle: Vehicle, activity: NpcActivity): boolean {
  const done = world.events.find((e) => isBusinessDone(e, vehicle));
  if (!done || !isBusinessDone(done, vehicle)) return false;
  if (done.job.deal !== activity.kind || done.job.siteId !== activity.targetId) {
    throw new Error(`${vehicle.id} finished business for ${done.job.deal} at ${done.job.siteId}, not ${activity.kind} at ${activity.targetId}`);
  }
  return true;
}

// Starts the wait before a deal. In combat the driver waits parked and keeps its goal.
function startBusiness(world: World, vehicle: Vehicle, activity: NpcActivity, siteId: string): void {
  if (!vehicle.brain) throw new Error(`${vehicle.id} has no brain for business`);
  if (!DEALS.includes(activity.kind)) throw new Error(`No business for a ${activity.kind} goal`);
  if (vehicle.job || inCombat(world, vehicle)) return;
  const turns = NPC_UPKEEP.businessTurns;
  startJob(world, vehicle, { kind: 'business', siteId, deal: activity.kind as BusinessDeal, turnsLeft: turns, total: turns });
}

// True on the turn a business goal's deal is due, at a site the driver can use. Before that the driver starts or waits
// out its business job.
export function dealDue(world: World, vehicle: Vehicle, activity: NpcActivity, site: { id: string } | null): site is { id: string } {
  if (!site) return false;
  if (businessDone(world, vehicle, activity)) return true;
  startBusiness(world, vehicle, activity, site.id);
  return false;
}
