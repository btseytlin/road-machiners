// Where a driver parks beside a salvage stock or another truck it tows, patches, trades with or loots.

import { chassisDef } from '../data/chassis';
import { RULES } from '../data/rules';
import { isFree } from './spawn';
import { vehicleStats } from './stats';
import type { NpcActivity, Vehicle, World } from './types';
import type { Vec } from './vec';

function stockRadius(world: World, activity: NpcActivity): number | undefined {
  if (activity.kind !== 'scavenge' && activity.kind !== 'loot') return undefined;
  return world.salvage.find((entry) => entry.id === activity.targetId)?.radius;
}

function towedRadius(world: World, activity: NpcActivity): number | undefined {
  if (!['tow', 'patch', 'meet', 'loot'].includes(activity.kind)) return undefined;
  const towed = world.vehicles.find((entry) => entry.id === activity.targetId);
  return towed && chassisDef(towed.chassisId).radius;
}

export function bodyStop(world: World, vehicle: Vehicle, activity: NpcActivity, destination: Vec, out: number): Vec {
  const stock = stockRadius(world, activity);
  const radius = stock ?? towedRadius(world, activity);
  if (radius === undefined) throw new Error(`Missing activity destination ${activity.targetId}`);
  const angle = Math.atan2(vehicle.pos.y - destination.y, vehicle.pos.x - destination.x);
  return stock === undefined ? meetSpot(world, vehicle, destination, radius + out, angle) : pointAround(destination, radius + out, angle);
}

function pointAround(center: Vec, reach: number, angle: number): Vec {
  return { x: center.x + Math.cos(angle) * reach, y: center.y + Math.sin(angle) * reach };
}

function meetSpot(world: World, vehicle: Vehicle, center: Vec, reach: number, approach: number): Vec {
  const radius = vehicleStats(world, vehicle).radius;
  for (let k = 0; k * RULES.meetStep <= Math.PI; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const spot = pointAround(center, reach, approach + sign * k * RULES.meetStep);
      if (isFree(world, spot, radius, vehicle.id)) return spot;
    }
  }
  return pointAround(center, reach, approach);
}

