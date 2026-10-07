// The one owner of which drivers keep off roads. A raider that retreats, flees or is stranded hides beside the
// roads and only crosses them. route() asks this for every plan, so ambush tactics can extend it here.

import { topGoal } from './npc-activities';
import { isStranded } from './stats';
import type { Vehicle, World } from './types';

export function keepsOffRoads(world: World, v: Vehicle): boolean {
  if (!v.brain || v.faction !== 'raiders') return false;
  const goal = topGoal(v)?.kind;
  return goal === 'retreat' || goal === 'flee' || isStranded(world, v);
}
