// Escapes: the player gets away from hostile trucks. At each turn's end the player keeps the ids of the hostile
// trucks in sight. A turn that ends with none of them in sight and no hostile seen practices driving, unless one
// of them was destroyed, which is a win and not an escape. The strongest escaped truck is the target, so slipping in

import { isHostile } from './combat';
import { playerVehicle } from './damage';
import { vehicleDanger } from './npc-decisions';
import { practice } from './progress';
import type { Vehicle, World } from './types';
import { playerSees } from './vision';

export function noteEscape(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  const before = p.hostilesSeen;
  p.hostilesSeen = p.state === 'active' ? hostilesInSight(world, me) : [];
  if (p.state !== 'active' || p.hostilesSeen.length > 0) return;
  const escaped = escapedFrom(world, before);
  if (!escaped) return;
  const strongest = escaped.reduce((a, b) => (vehicleDanger(world, b) > vehicleDanger(world, a) ? b : a));
  practice(world, 'escape', 1, escapeDifficulty(world, me, strongest), strongest.id);
}

function escapedFrom(world: World, seen: string[]): Vehicle[] | null {
  if (seen.length === 0) return null;
  const escaped = world.vehicles.filter((v) => seen.includes(v.id));
  if (escaped.length < seen.length || escaped.some((v) => playerSees(world, v.pos))) return null;
  return escaped;
}

function hostilesInSight(world: World, me: Vehicle): string[] {
  return world.vehicles.filter((v) => v.id !== me.id && isHostile(world, v, me) && playerSees(world, v.pos)).map((v) => v.id);
}

function escapeDifficulty(world: World, me: Vehicle, strongest: Vehicle): number {
  const theirs = vehicleDanger(world, strongest);
  if (theirs === 0) return 0;
  return theirs / (theirs + vehicleDanger(world, me));
}
