import { describe, expect, it } from 'vitest';
import { onOrchardRoad, REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { PHYSICS } from '../data/physics';
import { START_KITS } from '../data/start';
import { cloneWorld, newWorld, setMoveOrder } from './world';
import { dist, polylineDist, type Vec } from './vec';
import { siteGap } from './sites';
import { discoverSites } from './locations';
import { refreshVision } from './vision';
import { bodyOf } from './body';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';

// Old Orchard stands at (22.8, 56.8), north of its first place.
const original = [
  [16, 94], [102, 35], [22.8, 56.8], [33.8, 32], [50, 32.8], [60, 18.8], [78.2, 21],
  [106.2, 70], [90.3, 86.3], [71.8, 89], [56.8, 94], [41, 90.2], [40.7, 51.7], [64, 54], [82, 52.2],
  [22, 14], [66, 76],
];

describe('Icarus exploration distances', () => {
  it('multiplies every pairwise destination distance by five', () => {
    // Broken Wing is newer than the five-fold scaling, so it has no original position.
    const sites = [...REGION.towns, ...REGION.locations].filter((s) => s.id !== 'broken-wing');
    expect(sites).toHaveLength(original.length);
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      expect(dist(sites[i].pos, sites[j].pos)).toBeCloseTo(Math.hypot(original[i][0] - original[j][0], original[i][1] - original[j][1]) * 5);
    }
  });

  it('starts off the trunk road facing it, the road in grey vision past clear sight, out of clear sight of every site', () => {
    const world = cloneWorld(newWorld(1337, START_KITS.standard, TEST_MAP));
    const player = world.vehicles.find((v) => v.id === world.player.vehicleId)!;
    refreshVision(world);
    discoverSites(world);
    expect(world.player.discovered).toEqual([]);
    const gray = TERRAIN.vision.radius * TERRAIN.vision.grayFactor;
    const toRoad = polylineDist(player.pos, REGION.roads[REGION.playerStart.road]);
    expect(toRoad).toBeLessThan(gray);
    expect(toRoad).toBeGreaterThan(TERRAIN.vision.radius * 2);
    // Driving straight ahead crosses the road.
    const ahead = { x: player.pos.x + Math.cos(player.heading) * gray, y: player.pos.y + Math.sin(player.heading) * gray };
    expect(polylineDist(ahead, REGION.roads[REGION.playerStart.road])).toBeLessThan(gray - toRoad + REGION.roadWidth);
    for (const site of [...REGION.towns, ...REGION.locations]) expect(siteGap(site, player.pos)).toBeGreaterThan(TERRAIN.vision.radius);
  }, budget(15_000));

  it('gives settlements human-scale footprints and an outside starting point', () => {
    const truckLength = bodyOf('scout').half.x * 2;
    for (const town of REGION.towns) {
      expect(town.radius * 2 * PHYSICS.metersPerTile / truckLength).toBeGreaterThan(40);
      for (const site of REGION.locations) expect(dist(town.pos, site.pos)).toBeGreaterThan(town.radius + site.radius);
    }
    const bowl = REGION.towns.find((town) => town.id === 'bowl')!;
    expect(TERRAIN.features.craters[0].radius).toBeGreaterThan(bowl.radius);
  });

  it('shares immutable terrain between turns without sharing mutable state', () => {
    const world = newWorld(1337, START_KITS.standard, TEST_MAP);
    const next = setMoveOrder(world, { kind: 'stopAt', dest: { x: 100, y: 440 } });
    expect(next.terrain).toBe(world.terrain);
    expect(Object.isFrozen(next.terrain.heights)).toBe(true);
    expect(next.player).not.toBe(world.player);
    expect(next.vehicles).not.toBe(world.vehicles);
    expect(world.vehicles[0].order).toBeNull();
  }, budget(60_000)); // a new 600-tile world takes about 9 s alone on a loaded machine and longer beside the suite
});

describe('discovering an outlined territory', () => {
  const orchard = REGION.locations.find((l) => l.id === 'orchard')!;
  const tileAt = (size: number, p: Vec): number => Math.floor(p.y) * size + Math.floor(p.x);
  const at = (s: number, c: number): Vec => ({ x: orchard.pos.x + onOrchardRoad(s, c).x, y: orchard.pos.y + onOrchardRoad(s, c).y });

  it('discovers the orchard from one seen tile of its north-west pocket', () => {
    const world = cloneWorld(newWorld(1337, START_KITS.standard, TEST_MAP));
    world.player.visible = [tileAt(world.terrain.size, at(60, 30))];
    discoverSites(world);
    expect(world.player.discovered).toEqual(['orchard']);
  }, budget(15_000));

  it('does not discover it from a tile inside its bounding radius but past its outline', () => {
    const world = cloneWorld(newWorld(1337, START_KITS.standard, TEST_MAP));
    const beyond = at(-30, 44);
    expect(dist(beyond, orchard.pos)).toBeLessThan(orchard.radius);
    world.player.visible = [tileAt(world.terrain.size, beyond)];
    discoverSites(world);
    expect(world.player.discovered).toEqual([]);
  }, budget(15_000));
});
