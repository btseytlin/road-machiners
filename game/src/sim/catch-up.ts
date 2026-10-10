import type { Vehicle, World } from './types';

export function catchingUp(world: World, v: Vehicle): boolean {
  const run = world.furyRoad;
  return run !== null && run.groups.some((g) => g.vehicles.includes(v.id) && !g.engaged.includes(v.id));
}
