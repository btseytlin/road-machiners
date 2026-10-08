import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { GEOLOGY, OLD_WORLD, TERRAIN } from '../data/terrain';
import { deckAt, deckById } from '../sim/bridge';
import { ROAD_INDEX } from '../sim/road-index';
import { hashRandom } from '../sim/rng';
import type { BakedProp } from '../sim/terrain';
import { siteGap } from '../sim/sites';
import { padReach } from '../test/sites';
import { bearing, dist, polylineDist, segmentDist, type Vec } from '../sim/vec';
import { newDraft, tileSteepness, type MapDraft } from './bake';
import {
  BUILT_FIELD,
  BUILT_NONE,
  BUILT_OLD_ROAD,
  RoadLine,
  billboards,
  bendBuildings,
  fields,
  highway,
  oldRoads,
  oldWorldLayer,
  overlooks,
  powerLines,
  settlements,
  tankHulks,
  type OldSettlement,
} from './oldworld';

const SIZE = REGION.size;
const HALF = REGION.roadWidth / 2;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];
const WET = GEOLOGY.ground.washFlow * 2;
const SEED = 1337;

function expectOffBuilt(p: BakedProp): void {
  const bridge = deckById('canyon-bridge');
  expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, Infinity)).toBeGreaterThanOrEqual(HALF + p.r);
  for (const site of SITES) expect(siteGap(site, p.pos)).toBeGreaterThan(O.siteClearance + p.r);
  expect(segmentDist(p.pos, bridge.from, bridge.to)).toBeGreaterThanOrEqual(bridge.width / 2 + p.r);
}

function setCorners(d: MapDraft, what: 'heights' | 'flow', value: (i: number, j: number) => number): void {
  const n = d.size + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d[what][j * n + i] = value(i, j);
}

function tilesMarked(d: MapDraft, code: number): Vec[] {
  const out: Vec[] = [];
  d.built.forEach((b, tile) => {
    if (b === code) out.push({ x: (tile % d.size) + 0.5, y: Math.floor(tile / d.size) + 0.5 });
  });
  return out;
}

function nearestOnRoads(p: Vec): { line: RoadLine; s: number; road: number } {
  let best = { line: new RoadLine(REGION.roads[0]), s: 0, road: 0, d: Infinity };
  REGION.roads.forEach((points, road) => {
    const line = new RoadLine(points);
    for (let s = 0; s <= line.length; s += 0.5) {
      const d = dist(line.pointAt(s), p);
      if (d < best.d) best = { line, s, road, d };
    }
  });
  return best;
}

describe('settlements', () => {
  it('stand on flat, dry ground and keep their spacing', () => {
    const d = newDraft(SIZE);
    setCorners(d, 'heights', (i, j) => (i < 300 ? hashRandom(3, i, j) * 2 : 0));
    setCorners(d, 'flow', (i, j) => (i >= 300 && j >= 400 && j <= 420 ? WET : 0));
    const rules = OLD_WORLD.settlements;

    const towns = settlements(SEED, d, rules);

    expect(towns.length).toBeGreaterThan(3);
    for (const t of towns) {
      expect(t.pos.x - t.radius).toBeGreaterThanOrEqual(300);
      expect(Math.abs(t.pos.y - 410)).toBeGreaterThan(10 + t.radius);
    }
    for (let a = 0; a < towns.length; a++) for (let b = a + 1; b < towns.length; b++) expect(dist(towns[a].pos, towns[b].pos)).toBeGreaterThanOrEqual(rules.spacing);
  });

  it('puts houses inside each settlement and a silo or water tower on each farm', () => {
    const d = newDraft(SIZE);
    const rules = { ...OLD_WORLD.settlements, farmShare: 1 };

    const towns = settlements(SEED, d, rules);

    for (const p of d.props) {
      expect(['ruin', 'house', 'silo', 'waterTower']).toContain(p.kind);
      expect(towns.some((t) => dist(t.pos, p.pos) + p.r <= t.radius + 1e-9)).toBe(true);
      expectOffBuilt(p);
    }
    for (const t of towns) {
      const inside = d.props.filter((p) => dist(p.pos, t.pos) <= t.radius);
      expect(inside.filter((p) => p.kind === 'silo' || p.kind === 'waterTower')).toHaveLength(1);
      expect(inside.length).toBeGreaterThan(1);
    }
  });
});

describe('overlooks', () => {
  const MESA = { x: 60, y: 200 };
  const MESA_RADIUS = 25;

  it('puts lone buildings on the mesa edge, facing out over the drop', () => {
    const d = newDraft(SIZE);
    setCorners(d, 'heights', (i, j) => 4 * Math.min(1, Math.max(0, (MESA_RADIUS + 3 - dist({ x: i, y: j }, MESA)) / 3)));
    const rules = OLD_WORLD.overlooks;

    overlooks(SEED, d, rules);

    const near = d.props.filter((p) => dist(p.pos, MESA) < 100);
    expect(near.length).toBeGreaterThan(0);
    for (const p of near) {
      expect(['house', 'ruin']).toContain(p.kind);
      expect(dist(p.pos, MESA)).toBeLessThanOrEqual(MESA_RADIUS);
      expect(dist(p.pos, MESA)).toBeGreaterThanOrEqual(MESA_RADIUS - rules.reach);
      expect(Math.cos(p.yaw - bearing(MESA, p.pos))).toBeGreaterThan(0.7);
    }
  });

  it('puts nothing on flat ground', () => {
    const d = newDraft(SIZE);

    overlooks(SEED, d, OLD_WORLD.overlooks);

    expect(d.props).toEqual([]);
  });
});

describe('bend buildings', () => {
  it('stand on the outer side of sharp bends, facing the road', () => {
    const d = newDraft(SIZE);
    const rules = { ...OLD_WORLD.bends, chance: 1 };

    bendBuildings(SEED, d, rules);

    expect(d.props.length).toBeGreaterThan(0);
    for (const p of d.props) {
      expect(['house', 'gasStation']).toContain(p.kind);
      expectOffBuilt(p);
      const { line, s } = nearestOnRoads(p.pos);
      const back = line.pointAt(s - rules.reach);
      const ahead = line.pointAt(s + rules.reach);
      const chordMiddle = { x: (back.x + ahead.x) / 2, y: (back.y + ahead.y) / 2 };
      expect(dist(p.pos, chordMiddle)).toBeGreaterThan(dist(line.pointAt(s), chordMiddle));
      expect(Math.cos(p.yaw - bearing(p.pos, line.pointAt(s)))).toBeGreaterThan(0.95);
    }
  });
});

describe('old roads', () => {
  function washDraft(depth = 4): { d: MapDraft; towns: OldSettlement[] } {
    const d = newDraft(80);
    setCorners(d, 'flow', (i) => (i >= 34 && i <= 46 ? WET : 0));
    setCorners(d, 'heights', (i) => -depth * Math.max(0, Math.min(1, (4 - Math.max(38 - i, i - 42, 0)) / 4)) * (i >= 34 && i <= 46 ? 1 : 0));
    const town = (x: number): OldSettlement => ({ pos: { x, y: 40 }, radius: 5, farm: false, ground: 0 });
    return { d, towns: [town(14), town(66)] };
  }

  it('lays cracked asphalt on both sides of a wash and none across it', () => {
    const { d, towns } = washDraft();

    const roads = oldRoads(d, towns, OLD_WORLD.oldRoads);

    expect(roads).toHaveLength(1);
    const tiles = tilesMarked(d, BUILT_OLD_ROAD);
    expect(tiles.filter((t) => t.x < 37).length).toBeGreaterThan(10);
    expect(tiles.filter((t) => t.x > 43).length).toBeGreaterThan(10);
    expect(tiles.filter((t) => t.x >= 35 && t.x <= 45)).toEqual([]);
  });

  it('stands a broken span on each bank, facing across', () => {
    const { d, towns } = washDraft();

    oldRoads(d, towns, OLD_WORLD.oldRoads);

    const spans = d.props.filter((p) => p.kind === 'bridgeSpan');
    expect(spans).toHaveLength(2);
    const [west, east] = [...spans].sort((a, b) => a.pos.x - b.pos.x);
    expect(west.pos.x).toBeLessThanOrEqual(35);
    expect(east.pos.x).toBeGreaterThanOrEqual(45);
    expect(Math.cos(west.yaw)).toBeGreaterThan(0.9);
    expect(Math.cos(east.yaw)).toBeLessThan(-0.9);
  });

  it('bridges a steep gully that no road could drive through, with a span on each bank', () => {
    const { d, towns } = washDraft();
    setCorners(d, 'heights', (i) => (i >= 36 && i <= 44 ? -3 : 0));

    expect(oldRoads(d, towns, OLD_WORLD.oldRoads)).toHaveLength(1);

    const spans = d.props.filter((p) => p.kind === 'bridgeSpan');
    expect(spans).toHaveLength(2);
    expect(spans.every((p) => p.pos.x < 36 || p.pos.x > 44)).toBe(true);
  });

  it('stands no span over a shallow wash, which only cuts the asphalt', () => {
    const { d, towns } = washDraft(OLD_WORLD.oldRoads.minDrop / 2);

    oldRoads(d, towns, OLD_WORLD.oldRoads);

    expect(tilesMarked(d, BUILT_OLD_ROAD).length).toBeGreaterThan(20);
    expect(d.props).toEqual([]);
  });

  it('lays an unbroken road with no spans over dry, flat ground', () => {
    const { d, towns } = washDraft();
    d.flow.fill(0);
    d.heights.fill(0);

    oldRoads(d, towns, OLD_WORLD.oldRoads);

    expect(d.props).toEqual([]);
    const columns = new Set(tilesMarked(d, BUILT_OLD_ROAD).map((t) => Math.floor(t.x)));
    for (let x = 14; x < 66; x++) expect(columns.has(x)).toBe(true);
  });
});

describe('old highway', () => {
  function riverDraft(): { d: MapDraft; towns: OldSettlement[] } {
    const d = newDraft(REGION.size);
    const river = TERRAIN.features.dryRiver.path;
    setCorners(d, 'heights', (i, j) => (polylineDist({ x: i, y: j }, river) < 8 ? -3 : 0));
    const [a, b] = [river[2], river[3]];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const town = (dy: number): OldSettlement => ({ pos: { x: mid.x, y: mid.y + dy }, radius: 5, farm: false, ground: 0 });
    return { d, towns: [town(-40), town(40)] };
  }

  it('bridges the deepest gap between settlements, with a span on each bank', () => {
    const { d, towns } = riverDraft();

    const [road] = highway(d, towns, OLD_WORLD.oldRoads, OLD_WORLD.highway);

    expect(road.bridges.length).toBeGreaterThan(0);
    const spans = d.props.filter((p) => p.kind === 'bridgeSpan');
    expect(spans).toHaveLength(2);
    for (const p of spans) expect(polylineDist(p.pos, TERRAIN.features.dryRiver.path)).toBeGreaterThanOrEqual(8);
  });

  it('builds no highway when no route between settlements bridges a deep gap', () => {
    const { d, towns } = riverDraft();
    d.heights.fill(0);

    expect(highway(d, towns, OLD_WORLD.oldRoads, OLD_WORLD.highway)).toEqual([]);
  });
});

describe('power lines', () => {
  it('keep one side of their road and the pole spacing', () => {
    const d = newDraft(SIZE);
    const rules = { ...OLD_WORLD.powerLines, roadShare: 1, missingShare: 0 };

    powerLines(SEED, d, rules);

    const groups = new Set(d.props.map((p) => p.group));
    expect(groups.size).toBeGreaterThan(3);
    for (const group of groups) {
      const road = REGION.roads[group - 1];
      const poles = d.props.filter((p) => p.group === group).sort((a, b) => a.step - b.step);
      const sides = new Set(poles.map((p) => sideOfRoad(road, p.pos)));
      expect(sides.size).toBe(1);
      for (let k = 1; k < poles.length; k++) {
        if (poles[k].step !== poles[k - 1].step + 1) continue;
        expect(Math.abs(dist(poles[k].pos, poles[k - 1].pos) - rules.spacing)).toBeLessThanOrEqual(2 * (HALF + rules.gap + rules.radius));
      }
    }
    for (const p of d.props) {
      expect(p.kind).toBe('pole');
      expectOffBuilt(p);
    }
  });

  it('leaves gaps in the steps where poles are missing', () => {
    const d = newDraft(SIZE);

    powerLines(SEED, d, { ...OLD_WORLD.powerLines, roadShare: 1, missingShare: 0.5 });

    const gaps = d.props.filter((p, k) => k > 0 && p.group === d.props[k - 1].group && p.step > d.props[k - 1].step + 1);
    expect(gaps.length).toBeGreaterThan(0);
  });
});

function sideOfRoad(road: readonly Vec[], p: Vec): number {
  let best = 0;
  for (let k = 1; k < road.length; k++) if (segmentDist(p, road[k - 1], road[k]) < segmentDist(p, road[best], road[best + 1])) best = k - 1;
  const a = road[best];
  const b = road[best + 1];
  return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

describe('billboards', () => {
  it('stand spaced apart beside the roads, facing them', () => {
    const d = newDraft(SIZE);
    const rules = { ...OLD_WORLD.billboards, straightChance: 1 };

    billboards(SEED, d, rules);

    expect(d.props.length).toBeGreaterThan(3);
    for (const p of d.props) {
      expect(p.kind).toBe('billboard');
      expectOffBuilt(p);
      const { line, s } = nearestOnRoads(p.pos);
      expect(Math.cos(p.yaw - bearing(p.pos, line.pointAt(s)))).toBeGreaterThan(0.95);
    }
    for (let a = 0; a < d.props.length; a++) for (let b = a + 1; b < d.props.length; b++) {
      expect(dist(d.props[a].pos, d.props[b].pos)).toBeGreaterThanOrEqual(rules.spacing - 2 * (HALF + rules.gap + rules.radius));
    }
  });

  it('stand on the approaches to both towns', () => {
    const d = newDraft(SIZE);

    billboards(SEED, d, OLD_WORLD.billboards);

    for (const town of REGION.towns) {
      const reach = town.radius + Math.max(...OLD_WORLD.billboards.approach) + HALF + OLD_WORLD.billboards.gap + OLD_WORLD.billboards.radius;
      expect(d.props.some((p) => dist(p.pos, town.pos) <= reach)).toBe(true);
    }
  });
});

describe('tank hulks', () => {
  it('lie in a small group beside an old road near the settlement it leaves', () => {
    const d = newDraft(80);
    const road = { line: new RoadLine([{ x: 12, y: 40 }, { x: 70, y: 40 }]), width: OLD_WORLD.oldRoads.width, bridges: [] };
    const rules = { ...OLD_WORLD.tanks, chance: 1 };

    tankHulks(SEED, d, [road], rules);

    expect(d.props.length).toBeGreaterThanOrEqual(rules.group[0]);
    expect(d.props.length).toBeLessThanOrEqual(rules.group[1]);
    for (const p of d.props) {
      expect(p.kind).toBe('tank');
      expect(p.pos.x).toBeGreaterThanOrEqual(12 + rules.along[0] - rules.spread);
      expect(p.pos.x).toBeLessThanOrEqual(12 + rules.along[1] + rules.spread);
      expect(Math.abs(p.pos.y - 40)).toBeGreaterThanOrEqual(road.width / 2 + rules.gap + rules.radius);
      expect(Math.abs(p.pos.y - 40)).toBeLessThanOrEqual(road.width / 2 + rules.gap + rules.radius + rules.spread);
    }
  });
});

describe('fields', () => {
  function farmDraft(): MapDraft {
    const d = newDraft(80);
    setCorners(d, 'heights', (i) => (i >= 60 ? 3 : 0));
    return d;
  }
  const farm: OldSettlement = { pos: { x: 40, y: 40 }, radius: 5, farm: true, ground: 0 };
  const rules = OLD_WORLD.fields;

  it('mark flat low ground beside a farm, outside the settlement', () => {
    const d = farmDraft();

    fields(SEED, d, [farm], rules);

    const tiles = tilesMarked(d, BUILT_FIELD);
    expect(tiles.length).toBeGreaterThan(20);
    for (const t of tiles) {
      expect(dist(t, farm.pos)).toBeGreaterThan(farm.radius + rules.gap);
      expect(t.x).toBeLessThan(59);
      expect(tileSteepness(d.heights, d.size, Math.floor(t.y) * d.size + Math.floor(t.x))).toBeLessThanOrEqual(rules.flatSlope);
    }
  });

  it('leave a settlement that did not farm alone', () => {
    const d = farmDraft();

    fields(SEED, d, [{ ...farm, farm: false }], rules);

    expect(tilesMarked(d, BUILT_FIELD)).toEqual([]);
  });
});

describe('old-world layer', () => {
  function rollingDraft(): MapDraft {
    const d = newDraft(SIZE);
    setCorners(d, 'heights', (i, j) => Math.sin(i / 40) * 1.5 + Math.cos(j / 55) * 1.5);
    setCorners(d, 'flow', (i, j) => (Math.abs(Math.sin(i / 40) + Math.cos(j / 55) + 1.9) < 0.03 ? WET : 0));
    return d;
  }

  it('keeps every prop off roads, sites and the deck, and apart from each other', () => {
    const d = oldWorldLayer(SEED, rollingDraft());

    const standing = d.props;
    expect(new Set(standing.map((p) => p.kind)).size).toBeGreaterThan(5);
    for (const p of standing.filter((q) => q.kind !== 'shipWing')) expectOffBuilt(p);
    for (let a = 0; a < standing.length; a++) for (let b = a + 1; b < standing.length; b++) {
      expect(dist(standing[a].pos, standing[b].pos)).toBeGreaterThanOrEqual(standing[a].r + standing[b].r);
    }
  });

  it('marks old roads and fields only off roads, the deck, sites and pads', () => {
    const d = oldWorldLayer(SEED, rollingDraft());

    const marked = [...tilesMarked(d, BUILT_OLD_ROAD), ...tilesMarked(d, BUILT_FIELD)];
    expect(tilesMarked(d, BUILT_OLD_ROAD).length).toBeGreaterThan(100);
    expect(tilesMarked(d, BUILT_FIELD).length).toBeGreaterThan(0);
    for (const c of marked) {
      expect(ROAD_INDEX.nearestWithin(c.x, c.y, Infinity)).toBeGreaterThanOrEqual(HALF);
      expect(deckAt(c.x, c.y)).toBeNull();
      for (const site of SITES) expect(siteGap(site, c)).toBeGreaterThan(padReach(site));
    }
    expect(d.built.every((b) => b === BUILT_NONE || b === BUILT_OLD_ROAD || b === BUILT_FIELD)).toBe(true);
  });

  it('gives the same props and marks for the same seed', () => {
    const a = oldWorldLayer(SEED, rollingDraft());
    const b = oldWorldLayer(SEED, rollingDraft());

    expect(b.props).toEqual(a.props);
    expect(Array.from(b.built)).toEqual(Array.from(a.built));
  });
});
