// How the bot aims. A player shoots the part of the foe that a round reaches and breaks soonest, and goes for the cab
// once the foe has refused to give up, since a broken cab knocks the driver out.

import { partLane, passShare, planLane, SIDES, sideToward, type Round } from '../armor';
import { playerVehicle } from '../damage';
import { corePart, mountedParts } from '../grid';
import { vehicleStats, type MountedWeapon } from '../stats';
import type { Aim, PartInstance, Vehicle, World } from '../types';
import { setWeaponOrder } from '../world';
import type { Orders } from './orders';

// Parts whose loss stops a truck or its driver: the built-in parts and the engine.
function criticalParts(foe: Vehicle): PartInstance[] {
  return [...mountedParts(foe, 'core'), ...mountedParts(foe, 'engine')].filter((p) => p.hp > 0);
}

// The share of the part's remaining HP one round of the weapon takes off it, shot from the side the bot stands on.
function bite(foe: Vehicle, part: PartInstance, side: ReturnType<typeof sideToward>, round: Round): number {
  const hit = planLane(foe, side, partLane(foe, part.id, side), round).find((h) => h.part.id === part.id);
  return hit ? hit.amount / part.hp : 0;
}

function refusedToYield(world: World, foe: Vehicle): boolean {
  return world.player.talked[foe.id]?.yieldDemand === 'refused';
}

// The part the weapon should aim at, or body when no critical part is within reach of its rounds. A foe that refused
// to give up is aimed at through its cab when a round reaches it.
export function aimFor(world: World, foe: Vehicle, weapon: MountedWeapon): Aim {
  const me = playerVehicle(world);
  const side = sideToward(foe, me.pos);
  const round = weapon.def.round;
  const scored = criticalParts(foe).map((part) => ({ part, bite: bite(foe, part, side, round) })).filter((s) => s.bite > 0);
  const cab = scored.find((s) => s.part.id === corePart(foe, 'cab').id);
  if (cab && refusedToYield(world, foe)) return cab.part.id;
  const best = scored.reduce<{ part: PartInstance; bite: number } | null>((top, s) => (!top || s.bite > top.bite ? s : top), null);
  return best ? best.part.id : 'body';
}

// A player attacks a foe that is not armored: the bot's heaviest round gets at least this share of its damage through
// the foe's armor, on the side that lets most through. Armor that stops more than half of it makes a long fight.
const MIN_PASS = 0.5;

export function isSoftTarget(world: World, foe: Vehicle): boolean {
  const weapons = vehicleStats(world, playerVehicle(world)).weapons;
  if (weapons.length === 0) return false;
  const heaviest = weapons.reduce((top, w) => (w.def.round.damage > top.def.round.damage ? w : top));
  return SIDES.some((side) => passShare(foe, side, heaviest.def.round) >= MIN_PASS);
}

// Points every gun at the foe's part chosen for it. A gun whose aim holds keeps its order.
export function aimGuns(o: Orders, foe: Vehicle): void {
  for (const weapon of vehicleStats(o.world, o.me).weapons) {
    const aim = aimFor(o.world, foe, weapon);
    const current = o.me.weaponOrders[weapon.part.id];
    if (current?.targetId === foe.id && current.aim === aim) continue;
    o.run((w) => setWeaponOrder(w, weapon.part.id, { targetId: foe.id, aim }));
  }
}
