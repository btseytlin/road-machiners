import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { nearestFreeCell, stampOverlay, startComponent } from './nav/astar';
import { CELL, componentOf, navLayer } from './nav/layer';
import { salvageInRange } from './salvage';
import { defaultSetup } from './settings';
import { siteGap } from './sites';
import { spotLookOf, territoryEntries, territorySpots } from './territory';
import { dist, type Vec } from './vec';
import { newWorld } from './world';

const MAX_STOCKS_IN_REACH = 2;
const MARGIN = 3;

const radius = Math.min(...Object.values(CHASSIS).map((c) => c.radius));
const world = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
const layer = navLayer(world.terrain, world.obstacles, radius);
const overlay = stampOverlay(layer, [], radius);
const player = playerVehicle(world);
const territory = (id: string): TerritoryDef => REGION.locations.find((l) => l.id === id) as TerritoryDef;
const cellOf = (p: Vec): number => Math.floor(p.y / CELL) * layer.n + Math.floor(p.x / CELL);
const centreOf = (cell: number): Vec => ({ x: ((cell % layer.n) + 0.5) * CELL, y: (Math.floor(cell / layer.n) + 0.5) * CELL });

function worstCrowd(t: TerritoryDef): { worst: number; at: Vec; ids: string[]; histogram: number[] } {
  const stocks = territorySpots(world, t.id);
  const entry = territoryEntries(t).map((p) => nearestFreeCell(layer, overlay, cellOf(p), null, 4 / CELL)).find((c) => c !== null);
  const component = startComponent(layer, entry!);
  const histogram: number[] = [];
  let best = { worst: 0, at: t.pos, ids: [] as string[] };
  for (let cell = 0; cell < layer.n * layer.n; cell++) {
    if (componentOf(layer, cell) !== component) continue;
    const at = centreOf(cell);
    if (dist(at, t.pos) > t.radius + MARGIN || siteGap(t, at) > MARGIN) continue;
    const truck = { ...player, pos: at };
    const ids = stocks.filter((s) => salvageInRange(truck, s)).map((s) => s.id);
    histogram[ids.length] = (histogram[ids.length] ?? 0) + 1;
    if (ids.length > best.worst) best = { worst: ids.length, at, ids };
  }
  return { ...best, histogram: Array.from(histogram, (n) => n ?? 0) };
}

describe('crowded loot spots', () => {
  it.each(['orchard', 'fallen-sun', 'glass-flats'])('%s lets a parked truck reach at most two stocks', (id) => {
    const { worst, at, ids, histogram } = worstCrowd(territory(id));
    expect(worst, `${worst} stocks from ${at.x.toFixed(1)},${at.y.toFixed(1)}: ${ids.join(', ')}; cells by stocks in reach ${histogram.join('/')}`).toBeLessThanOrEqual(MAX_STOCKS_IN_REACH);
  });

  it('keeps every stock of each territory', () => {
    const looks = (id: string): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const s of territorySpots(world, id)) counts[spotLookOf(s)!] = (counts[spotLookOf(s)!] ?? 0) + 1;
      return counts;
    };
    expect(territorySpots(world, 'orchard')).toHaveLength(28);
    expect(looks('orchard')).toEqual({ farmhouse: 1, barn: 3, quonset: 4, bunker: 1, guardPost: 5, armyTruck: 10, armyCache: 4 });
    expect(territorySpots(world, 'fallen-sun')).toHaveLength(24);
    expect(territorySpots(world, 'glass-flats')).toHaveLength(21);
  });
});
