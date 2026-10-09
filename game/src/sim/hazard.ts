
import { getResources } from './resources';
import { isKnockedOut } from './defeat';
import { atlasOf } from './atlas';
import type { HazardZone } from './territory';
import type { Vehicle, World } from './types';
import { dist, type Vec } from './vec';

const WARNING = 'A sick heat rolls off the glowing core. Your skin crawls, and the wheel shakes in your hands.';

function inside(zone: HazardZone, pos: Vec): boolean {
  return dist(pos, zone.pos) < zone.radius;
}

export function applyHazards(world: World): void {
  for (const zone of atlasOf(world.terrain).hazards) {
    for (const vehicle of world.vehicles) if (!isKnockedOut(vehicle) && inside(zone, vehicle.pos)) hurt(world, vehicle, zone);
  }
}

function hurt(world: World, vehicle: Vehicle, zone: HazardZone): void {
  const resources = getResources(world, vehicle);
  resources.health -= Math.max(0, Math.min(zone.healthPerTurn, resources.health - zone.floor));
  const wasOutside = !inside(zone, vehicle.trail[0] ?? vehicle.pos);
  if (vehicle.id === world.player.vehicleId && wasOutside) world.events.push({ t: 'info', text: WARNING });
}
