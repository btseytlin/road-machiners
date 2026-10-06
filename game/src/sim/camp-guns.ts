// Raider camp gate guns as a danger to every driver outside the raiders. src/sim/guards.ts fires them. Drivers read
// them here, to run from a shot and to never park inside the range.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { siteGates, type Site } from './sites';
import type { Vehicle } from './types';
import { dist, type Vec } from './vec';

export function campById(id: string | null): Site | null {
  return REGION.locations.find((l) => l.kind === 'camp' && l.id === id) ?? null;
}

// The gate of `camp` nearest to `pos`.
export function nearestGate(camp: Site, pos: Vec): Vec {
  return siteGates(camp).reduce((a, b) => (dist(a, pos) <= dist(b, pos) ? a : b));
}

// The camp whose gate gun reaches `pos` plus `margin` tiles, when its guns fire on this driver. A raider is safe.
export function campGunning(vehicle: Vehicle, pos: Vec, margin = 0): Site | null {
  if (vehicle.faction === 'raiders') return null;
  const camp = REGION.locations.find((l) => l.kind === 'camp' && dist(nearestGate(l, pos), pos) <= RULES.guards.range + margin);
  return camp ?? null;
}
