// Test helpers for site edges.

import { REGION } from '../data/region';
import { isTerritory, type Site } from '../sim/sites';

export function padReach(site: Site): number {
  return isTerritory(site) ? 0 : Math.hypot(site.radius + REGION.sites.pad.length, REGION.sites.pad.width / 2) - site.radius;
}
