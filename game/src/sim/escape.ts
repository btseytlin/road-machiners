// Escapes: the player gets away from hostile trucks. At each turn's end the player keeps the ids of the hostile
// trucks in sight. A turn that ends with none of them in sight and no hostile seen practices driving, unless one
// of them was destroyed, which is a win and not an escape. Only a truck in combat with the player or hunting it
// counts, since a raider in sight is only a warning. The strongest such truck is the target, so slipping in and out of
// sight of the same truck soon stops paying.

import { engagedWith, isHostile } from './combat';
import { playerVehicle } from './damage';
import { vehicleDanger } from './npc-decisions';
import { practice } from './progress';
import type { Vehicle, World } from './types';
import { playerSees } from './vision';

// Runs after the turn's last refreshVision, so sight is current.
export function noteEscape(world: World): void {
  const p = world.player;
  const me = playerVehicle(world);
  const before = p.hostilesSeen;
  p.hostilesSeen = p.state === 'active' ? hostilesInSight(world, me) : [];
  if (p.state !== 'active' || p.hostilesSeen.length > 0) return;
  const escaped = escapedFrom(world, me, before);
  if (!escaped) return;
  const strongest = escaped.reduce((a, b) => (vehicleDanger(world, b) > vehicleDanger(world, a) ? b : a));
  practice(world, 'escape', 1, escapeDifficulty(world, me, strongest), strongest.id);
}

// The trucks seen last turn that fought or hunted the player, when all seen trucks still exist and are out of sight.
// Null when there are none.
function escapedFrom(world: World, me: Vehicle, seen: string[]): Vehicle[] | null {
  if (seen.length === 0) return null;
  const escaped = world.vehicles.filter((v) => seen.includes(v.id));
  if (escaped.length < seen.length || escaped.some((v) => playerSees(world, v.pos))) return null;
  const engaged = escaped.filter((v) => engagedWith(world, v, me));
  return engaged.length > 0 ? engaged : null;
}

function hostilesInSight(world: World, me: Vehicle): string[] {
  return world.vehicles.filter((v) => v.id !== me.id && isHostile(world, v, me) && playerSees(world, v.pos)).map((v) => v.id);
}

// The strongest escaped truck's danger against the player's own, from 0 for a harmless one toward 1.
function escapeDifficulty(world: World, me: Vehicle, strongest: Vehicle): number {
  const theirs = vehicleDanger(world, strongest);
  if (theirs === 0) return 0;
  return theirs / (theirs + vehicleDanger(world, me));
}
