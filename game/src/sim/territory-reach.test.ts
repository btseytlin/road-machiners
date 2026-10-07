import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { REGION, type TerritoryDef } from '../data/region';
import { START_KITS } from '../data/start';
import { PERIMETER, TERRITORIES, type Run } from '../data/territory';
import { TEST_MAP } from '../test/map';
import { propReach } from './mapgen';
import { findCells, nearestFreeCell, stampOverlay, startComponent } from './nav/astar';
import { CELL, CLEARANCE, componentOf, navLayer } from './nav/layer';
import { siteGap } from './sites';
import { isLootSpot, territoryEntries, territoryGrounds } from './territory';
import type { Obstacle } from './types';
import { dist, lerp, type Vec } from './vec';
import { newWorld } from './world';

// Reach through Old Orchard on the committed map, measured on the same nav layer routes search.
const orchard = REGION.locations.find((l) => l.id === 'orchard') as TerritoryDef;
const farm = TERRITORIES.orchard.farm!;
const abs = (at: Vec): Vec => ({ x: orchard.pos.x + at.x, y: orchard.pos.y + at.y });
// The five main roads come first in the farm's list, each ending on the outline. R1, the old highway, starts at the
// south entry and leaves by the north.
const MAIN_ROADS = farm.roads.slice(0, 5);
const [R1, R2, , R4] = MAIN_ROADS;
const ROUTE_RATIO = 1.5; // longest route from the south entry to a spot's parking ring, per tile of straight line
const NEAR = 2; // tiles past a parking ring, or from a point, where a free cell still counts

const radius = CHASSIS[START_KITS.standard.chassis].radius;
const world = newWorld(1337, START_KITS.standard, TEST_MAP);
const layer = navLayer(world.terrain, world.obstacles, radius);
const overlay = stampOverlay(layer, [], radius);
const cellOf = (p: Vec): number => Math.floor(p.y / CELL) * layer.n + Math.floor(p.x / CELL);
const centreOf = (cell: number): Vec => ({ x: ((cell % layer.n) + 0.5) * CELL, y: (Math.floor(cell / layer.n) + 0.5) * CELL });

const south = nearest(territoryEntries(orchard), abs(R1.points[0]));
const southComponent = startComponent(layer, cellOf(south));
const spots = world.obstacles.filter((o) => isLootSpot(o) && siteGap(orchard, o.pos) < 0);

function nearest(points: readonly Vec[], to: Vec): Vec {
  return points.reduce((a, b) => (dist(b, to) < dist(a, to) ? b : a));
}

// Tiles along a cell path.
function pathLength(cells: Int32Array): number {
  let length = 0;
  for (let i = 1; i < cells.length; i++) length += dist(centreOf(cells[i - 1]), centreOf(cells[i]));
  return length;
}

// The lowest ratio of route length to straight line from `from` to a free cell on the spot's parking ring, where a
// truck's edge meets the spot's, or up to NEAR tiles past it. Infinity when no such cell is reachable.
function bestRingRatio(from: Vec, spot: Obstacle): number {
  const start = cellOf(from);
  const component = startComponent(layer, start);
  const ring = propReach(spot) + radius + CLEARANCE;
  let best = Infinity;
  for (let k = 0; k < 24; k++) {
    for (let past = 0; past <= NEAR; past++) {
      const angle = (k / 24) * 2 * Math.PI;
      const goal = cellOf({ x: spot.pos.x + Math.cos(angle) * (ring + past), y: spot.pos.y + Math.sin(angle) * (ring + past) });
      if (componentOf(layer, goal) !== component) continue;
      const cells = findCells(layer, overlay, start, goal, null);
      if (cells) best = Math.min(best, pathLength(cells) / dist(centreOf(start), centreOf(goal)));
    }
  }
  return best;
}

// Whether a free cell of the south entry's component lies within NEAR tiles of the point.
function reachableNear(p: Vec): boolean {
  return nearestFreeCell(layer, overlay, cellOf(p), southComponent, NEAR / CELL) !== null;
}

// The authored openings of the perimeter: between two polylines of one side, the ends within 15 tiles of each other.
// Each gives a point BREACH tiles outside its middle, toward the outline, and one as far inside.
const BREACH = 2.5;
function breaches(): { outside: Vec; inside: Vec }[] {
  const isPerimeter = (run: Run): boolean => run.look === PERIMETER.look && run.broken === PERIMETER.broken && run.knocked.share === PERIMETER.knocked.share;
  const lines = farm.runs.filter(isPerimeter).map((run) => run.points.map(abs));
  const out: { outside: Vec; inside: Vec }[] = [];
  for (let k = 1; k < lines.length; k++) {
    const [a, b] = [lines[k - 1].at(-1)!, lines[k][0]];
    if (dist(a, b) > 15) continue;
    const mid = { x: lerp(a.x, b.x, 0.5), y: lerp(a.y, b.y, 0.5) };
    const normal = { x: -(b.y - a.y) / dist(a, b), y: (b.x - a.x) / dist(a, b) };
    const [p, q] = [1, -1].map((side) => ({ x: mid.x + normal.x * BREACH * side, y: mid.y + normal.y * BREACH * side }));
    out.push(siteGap(orchard, p) > siteGap(orchard, q) ? { outside: p, inside: q } : { outside: q, inside: p });
  }
  return out;
}

// Where trucks drive into the orchard: both ends of the old highway, the outer ends of the other main roads and the
// perimeter's authored openings.
function entryPoints(): Vec[] {
  return [abs(R1.points[0]), ...MAIN_ROADS.map((road) => abs(road.points.at(-1)!)), ...breaches().map((b) => b.outside)];
}

describe('reach through Old Orchard', () => {
  it('routes from the south entry to every loot spot within 1.5 times the straight line', () => {
    expect(spots.length).toBe(farm.buildings.reduce((n, b) => n + b.poses.length, 0));
    for (const spot of spots) expect(bestRingRatio(south, spot), spot.id).toBeLessThanOrEqual(ROUTE_RATIO);
  });

  it('routes to the north pocket barn from the east entries and the north entry', () => {
    const barns = spots.filter((o) => o.kind === 'landmark' && o.look === 'barn');
    const north = abs(R1.points.at(-1)!);
    const barn = barns.reduce((a, b) => (dist(b.pos, north) < dist(a.pos, north) ? b : a));
    for (const from of [R2, R4, R1].map((road) => abs(road.points.at(-1)!))) {
      expect(bestRingRatio(from, barn), `from ${from.x.toFixed(1)},${from.y.toFixed(1)}`).toBeLessThan(Infinity);
    }
  });

  it('keeps every hunting ground on ground a truck from the south entry can reach', () => {
    for (const p of territoryGrounds(orchard)) expect(reachableNear(p), `${p.x.toFixed(1)},${p.y.toFixed(1)}`).toBe(true);
  });

  it('lets trucks in by at least four entries, and by every authored opening in the perimeter', () => {
    const entries = entryPoints().filter(reachableNear);
    expect(breaches().length).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThanOrEqual(4 + breaches().length);
  });

  it('lets a truck straight through each authored opening in the perimeter, not round it', () => {
    for (const { outside, inside } of breaches()) {
      const [from, to] = [outside, inside].map((p) => nearestFreeCell(layer, overlay, cellOf(p), southComponent, NEAR / CELL));
      const where = `opening at ${outside.x.toFixed(1)},${outside.y.toFixed(1)}`;
      expect(from, where).not.toBeNull();
      expect(to, where).not.toBeNull();
      const cells = findCells(layer, overlay, from!, to!, null);
      expect(cells, where).not.toBeNull();
      expect(pathLength(cells!), where).toBeLessThanOrEqual(2 * BREACH * 2);
    }
  });
});
