// The player's driver heals while parked with supplies, faster in a town. Toughness raises max health and the
// healing rate. The Long haul perk heals while driving too.

import { RULES } from '../data/rules';
import { playerVehicle } from './damage';
import { skillEffect, vehicleHasPerk } from './progress';
import { townNear } from './sites';
import type { Vehicle, World } from './types';

function restsNow(world: World, me: Vehicle): boolean {
  return me.speed <= RULES.parkedSpeed || vehicleHasPerk(world, me, 'longHaul');
}

export function maxHealthOf(world: World): number {
  return Math.round(RULES.maxHealth * (1 + skillEffect(world, playerVehicle(world), 'toughness', 'maxHealth')));
}

export function healPlayer(world: World): void {
  const p = world.player;
  const max = maxHealthOf(world);
  if (p.state === 'dead' || p.health <= 0 || p.supplies <= 0 || p.health >= max) return;
  const me = playerVehicle(world);
  if (!restsNow(world, me)) return;
  const rate = townNear(world) ? RULES.healPerTurn * RULES.townHealMult : RULES.healPerTurn;
  p.health = Math.min(max, p.health + rate);
  p.supplies = Math.max(0, p.supplies - RULES.healSupplies);
}
