// Town guards keep the peace. The gun at each town gate shoots the nearest vehicle in range that fired this turn
// at anyone but a raider. Raiders also trade in towns, so guards judge by action, not faction. Guards cannot be hit, so a town is a
// safe place to run to. Raider camp guns judge by faction: they shoot the nearest outsider in range.

import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { laneCount, sideToward, walkLane } from './armor';
import { isKnockedOut } from './defeat';
import { corePart } from './grid';
import { chance, randInt, randRange } from './rng';
import { siteGates, type Site } from './sites';
import type { ShotRound, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

export function isTownGuarded(pos: Vec): boolean {
  return REGION.towns.some((town) => siteGates(town).some((gate) => dist(gate, pos) <= RULES.guards.range));
}

export function fireGuards(world: World): void {
  // A raider destroyed by this turn's shots is already off the map.
  const raider = (id: string) => {
    const target = world.vehicles.find((v) => v.id === id) ?? world.removed.find((v) => v.id === id);
    if (!target) throw new Error(`Shot at unknown vehicle ${id}`);
    return target.faction === 'raiders';
  };
  const fired = new Set(world.events.flatMap((e) => (e.t === 'shot' && !raider(e.target) ? [e.shooter] : [])));
  for (const site of guardedSites()) {
    if ('kind' in site) fireSite(world, site, (v) => v.faction !== 'raiders');
    else fireSite(world, site, (v) => fired.has(v.id));
  }
}

// The sites whose gates carry a gun: every town and every raider camp. The render draws the guns from this list too.
export function guardedSites(): Site[] {
  return [...REGION.towns, ...REGION.locations.filter((l) => l.kind === 'camp')];
}

// Guards spare a knocked-out driver, whatever its cab. A player fighting through on a broken cab is still awake.
function isAwake(world: World, v: Vehicle): boolean {
  if (v.id === world.player.vehicleId) return world.player.state === 'active';
  return !isKnockedOut(v) && corePart(v, 'cab').hp > 0;
}

function fireSite(world: World, site: Site, isTarget: (v: Vehicle) => boolean): void {
  const G = RULES.guards;
  for (const gate of siteGates(site)) {
    const target = world.vehicles
      .filter((v) => isTarget(v) && isAwake(world, v) && dist(v.pos, gate) <= G.range)
      .sort((a, b) => dist(a.pos, gate) - dist(b.pos, gate))[0];
    if (!target) continue;
    const side = sideToward(target, gate);
    const lanes = laneCount(target, side);
    const rounds: ShotRound[] = Array.from({ length: G.rounds }, () =>
      chance(world, G.hitChance)
        ? { hit: true, crit: false, offset: 0, struck: target.id, hits: walkLane(world, target, side, randInt(world, 0, lanes - 1), { ...G.round, damage: G.round.damage * RULES.weaponDamage }), blast: [] }
        : { hit: false, crit: false, offset: randRange(world, -G.missOffset, G.missOffset), struck: null, hits: [], blast: [] },
    );
    if (rounds.some((r) => r.hits.length > 0)) target.lastHitBy = `guard-${site.id}`;
    world.events.push({ t: 'guardShot', site: site.id, from: { ...gate }, target: target.id, rounds });
  }
}
