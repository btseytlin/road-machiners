import { beforeAll, describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { GEOLOGY, NEW_WORLD, TERRAIN } from '../data/terrain';
import { deckAt, deckById } from '../sim/bridge';
import { ROAD_INDEX } from '../sim/road-index';
import type { BakedProp } from '../sim/terrain';
import { siteGap } from '../sim/sites';
import { padReach } from '../test/sites';
import { dist, segmentDist, type Vec } from '../sim/vec';
import { baseLayer, finishLayer, newDraft, tileSteepness, type MapDraft } from './bake';
import { dunes, rain, slump, wind } from './geology';
import { BUILT_FIELD, BUILT_NONE, BUILT_OLD_ROAD, oldWorldLayer, roadJunctions } from './oldworld';
import {
  BUILT_DIRTY_WATER,
  BUILT_SCRUB,
  BUILT_TOXIC,
  camps,
  carWrecks,
  fieldFences,
  newWorldLayer,
  pools,
  scrubGrowth,
  type Camp,
} from './newworld';
import { budget } from '../test/budget';

const SIZE = REGION.size;
const HALF = REGION.roadWidth / 2;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];
const WASH = GEOLOGY.ground.washFlow;
const FENCE = NEW_WORLD.fenceLength;
const SEED = 1337;

function expectOffBuilt(p: BakedProp): void {
  const bridge = deckById('canyon-bridge');
  expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, Infinity)).toBeGreaterThanOrEqual(HALF + p.r);
  for (const site of SITES) expect(siteGap(site, p.pos)).toBeGreaterThan(O.siteClearance + p.r);
  expect(segmentDist(p.pos, bridge.from, bridge.to)).toBeGreaterThanOrEqual(bridge.width / 2 + p.r);
}

function onBuilt(c: Vec): boolean {
  if (ROAD_INDEX.nearestWithin(c.x, c.y, HALF) < HALF || deckAt(c.x, c.y) !== null) return true;
  return SITES.some((site) => siteGap(site, c) <= padReach(site));
}

function setCorners(d: MapDraft, what: 'heights' | 'flow' | 'sand', value: (i: number, j: number) => number): void {
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

function markRect(d: MapDraft, x0: number, y0: number, x1: number, y1: number, code: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.built[y * d.size + x] = code;
}

function ofKind(d: MapDraft, kind: string): BakedProp[] {
  return d.props.filter((p) => p.kind === kind);
}

function fenceLines(d: MapDraft): BakedProp[][] {
  const lines = new Map<number, BakedProp[]>();
  for (const p of ofKind(d, 'fence')) lines.set(p.group, [...(lines.get(p.group) ?? []), p]);
  return [...lines.values()].map((line) => line.sort((a, b) => a.step - b.step));
}

function ends(p: BakedProp): [Vec, Vec] {
  const along = { x: Math.cos(p.yaw) * p.r, y: Math.sin(p.yaw) * p.r };
  return [{ x: p.pos.x - along.x, y: p.pos.y - along.y }, { x: p.pos.x + along.x, y: p.pos.y + along.y }];
}

function outerEnd(p: BakedProp, neighbor: BakedProp): Vec {
  const [a, b] = ends(p);
  return dist(a, neighbor.pos) > dist(b, neighbor.pos) ? a : b;
}

function expectOpen(line: BakedProp[]): void {
  if (line.length === 1) return;
  const missing = line.some((p, k) => k > 0 && p.step !== line[k - 1].step + 1);
  const gap = dist(outerEnd(line[0], line[1]), outerEnd(line[line.length - 1], line[line.length - 2]));
  expect(missing || gap >= FENCE - 1e-6).toBe(true);
}

function expectApart(props: BakedProp[]): void {
  for (let a = 0; a < props.length; a++) for (let b = a + 1; b < props.length; b++) {
    const [p, q] = [props[a], props[b]];
    if (p.kind === 'fence' && q.kind === 'fence' && p.group === q.group) continue;
    expect(dist(p.pos, q.pos)).toBeGreaterThanOrEqual(p.r + q.r);
  }
}

describe('pools', () => {
  function bowlDraft(): MapDraft {
    const d = newDraft(80);
    const bowl = (p: Vec, c: Vec, r: number) => -0.5 * Math.max(0, 1 - dist(p, c) / r);
    setCorners(d, 'heights', (i, j) => bowl({ x: i, y: j }, { x: 20, y: 20 }, 2.5) + bowl({ x: i, y: j }, { x: 50, y: 50 }, 12));
    return d;
  }

  it('fills a small basin with dirty water and leaves a lake-sized one alone', () => {
    const d = bowlDraft();

    pools(d, NEW_WORLD.pools);

    const water = tilesMarked(d, BUILT_DIRTY_WATER);
    expect(water.length).toBeGreaterThan(0);
    expect(water.length).toBeLessThanOrEqual(NEW_WORLD.pools.maxTiles);
    for (const t of water) expect(dist(t, { x: 20, y: 20 })).toBeLessThan(3);
    expect(tilesMarked(d, BUILT_TOXIC)).toEqual([]);
  });

  it('turns a basin near a tank hulk toxic', () => {
    const d = bowlDraft();
    d.props.push({ kind: 'tank', pos: { x: 26, y: 20 }, r: 1.5, yaw: 0, group: 0, step: 0 });

    pools(d, NEW_WORLD.pools);

    expect(tilesMarked(d, BUILT_TOXIC).length).toBeGreaterThan(0);
    expect(tilesMarked(d, BUILT_DIRTY_WATER)).toEqual([]);
  });

  it('leaves a basin under an old field unmarked', () => {
    const d = bowlDraft();
    markRect(d, 15, 15, 25, 25, BUILT_FIELD);

    pools(d, NEW_WORLD.pools);

    expect(tilesMarked(d, BUILT_DIRTY_WATER)).toEqual([]);
    expect(tilesMarked(d, BUILT_FIELD)).toHaveLength(100);
  });
});

describe('scrub growth', () => {
  function washDraft(): MapDraft {
    const d = newDraft(80);
    setCorners(d, 'flow', (i) => (i >= 38 && i <= 42 ? WASH * 2 : i >= 36 && i <= 44 ? WASH * NEW_WORLD.scrub.seedFlow * 1.2 : 0));
    return d;
  }
  const rules = NEW_WORLD.scrub;

  it('grows beside a wash bed, never in it, and fades out onto dry ground', () => {
    const d = washDraft();

    scrubGrowth(SEED, d, rules);

    const scrub = tilesMarked(d, BUILT_SCRUB);
    expect(scrub.filter((t) => t.x < 38).length).toBeGreaterThan(20);
    expect(scrub.filter((t) => t.x > 43).length).toBeGreaterThan(20);
    expect(scrub.filter((t) => t.x > 37 && t.x < 43)).toEqual([]);
    for (const t of scrub) expect(Math.abs(t.x - 40)).toBeLessThanOrEqual(5 + rules.steps);
  });

  it('keeps off deep sand and steep ground', () => {
    const d = washDraft();
    setCorners(d, 'sand', (_i, j) => (j < 40 ? GEOLOGY.ground.looseSand * 2 : 0));
    setCorners(d, 'heights', (i, j) => (j >= 40 && i < 38 ? i * TERRAIN.types.screeSlope * 1.5 : 0));

    scrubGrowth(SEED, d, { ...rules, dryShare: 1 });

    const scrub = tilesMarked(d, BUILT_SCRUB);
    expect(scrub.length).toBeGreaterThan(0);
    for (const t of scrub) {
      expect(t.y).toBeGreaterThan(40);
      expect(t.x).toBeGreaterThan(38);
    }
  });

  it('starts around pools on dry ground and leaves bare ground far from water bare', () => {
    const d = newDraft(80);
    markRect(d, 20, 20, 23, 23, BUILT_DIRTY_WATER);

    scrubGrowth(SEED, d, rules);

    const scrub = tilesMarked(d, BUILT_SCRUB);
    expect(scrub.length).toBeGreaterThan(5);
    for (const t of scrub) expect(dist(t, { x: 21.5, y: 21.5 })).toBeLessThanOrEqual(1.5 * Math.SQRT2 + rules.poolReach + rules.steps + 1);
    expect(tilesMarked(d, BUILT_DIRTY_WATER)).toHaveLength(9);
  });

  it('grows around an oasis, off its site and pads', () => {
    const d = newDraft(SIZE);

    scrubGrowth(SEED, d, rules);

    const scrub = tilesMarked(d, BUILT_SCRUB);
    for (const oasis of REGION.locations.filter((l) => l.kind === 'oasis')) {
      const reach = oasis.radius + O.siteClearance + rules.oasisReach + rules.steps + 1;
      expect(scrub.filter((t) => dist(t, oasis.pos) <= reach).length).toBeGreaterThan(20);
    }
    expect(scrub.filter(onBuilt)).toEqual([]);
  });
});

describe('camps', () => {
  const rules = NEW_WORLD.camps;
  const none = { ...rules, siteChance: 0, ruinChance: 0, junctionChance: 0 };

  function expectCamp(d: MapDraft, camp: Camp): void {
    const inside = d.props.filter((p) => dist(p.pos, camp.pos) <= camp.radius + FENCE);
    const shacks = inside.filter((p) => p.kind === 'shack');
    const junk = inside.filter((p) => p.kind === 'junk');
    expect(shacks.length).toBeGreaterThanOrEqual(1);
    expect(shacks.length).toBeLessThanOrEqual(rules.shacks[1]);
    expect(junk.length).toBeLessThanOrEqual(rules.junk[1]);
    for (const p of [...shacks, ...junk]) expect(dist(p.pos, camp.pos) + p.r).toBeLessThanOrEqual(camp.radius - rules.innerGap + 1e-9);
  }

  it('settle just outside towns and oases, past the site clearance', () => {
    const d = newDraft(SIZE);

    const out = camps(SEED, d, { ...none, siteChance: 1 });

    const sites = [...REGION.towns, ...REGION.locations.filter((l) => l.kind === 'oasis')];
    expect(out.length).toBeGreaterThanOrEqual(sites.length - 1);
    for (const camp of out) {
      const site = sites.reduce((a, b) => (dist(b.pos, camp.pos) < dist(a.pos, camp.pos) ? b : a));
      expect(dist(camp.pos, site.pos)).toBeCloseTo(site.radius + O.siteClearance + rules.siteGap + camp.radius, 6);
      expectCamp(d, camp);
    }
    for (const p of d.props) expectOffBuilt(p);
    expectApart(d.props);
  });

  it('settle among the ruins of an old settlement', () => {
    const d = newDraft(SIZE);
    const ruins: Vec[] = [{ x: 60, y: 40 }, { x: 64, y: 43 }, { x: 58, y: 45 }];
    for (const pos of ruins) d.props.push({ kind: 'ruin', pos, r: 1, yaw: 0, group: 0, step: 0 });

    const out = camps(SEED, d, { ...none, ruinChance: 1 });

    expect(out).toHaveLength(1);
    expect(dist(out[0].pos, { x: 182 / 3, y: 128 / 3 })).toBeLessThan(1e-9);
    expect(ofKind(d, 'shack').length).toBeGreaterThanOrEqual(1);
  });

  it('leave a lone ruin alone', () => {
    const d = newDraft(SIZE);
    d.props.push({ kind: 'ruin', pos: { x: 60, y: 40 }, r: 1, yaw: 0, group: 0, step: 0 });

    expect(camps(SEED, d, { ...none, ruinChance: 1 })).toEqual([]);
  });

  it('settle beside road junctions', () => {
    const d = newDraft(SIZE);

    const out = camps(SEED, d, { ...none, junctionChance: 1 });

    expect(out.length).toBeGreaterThan(0);
    for (const camp of out) {
      const near = Math.min(...roadJunctions().map((j) => dist(j, camp.pos)));
      expect(near).toBeGreaterThanOrEqual(HALF + rules.roadGap + camp.radius - 1e-9);
      expect(near).toBeLessThanOrEqual(HALF + rules.roadGap + camp.radius + rules.junctionReach + 1e-9);
    }
  });

  it('fence part of each camp ring with segments that leave it open', () => {
    const d = newDraft(SIZE);

    const out = camps(SEED, d, { ...none, siteChance: 1, junctionChance: 1, fenceMissing: 0 });

    const lines = fenceLines(d);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expectOpen(line);
      const camp = out.find((c) => Math.abs(dist(c.pos, line[0].pos) - c.radius) < 0.5);
      expect(camp).toBeDefined();
      for (const p of line) {
        expect(p.r).toBe(FENCE / 2);
        expect(Math.abs(dist(camp!.pos, p.pos) - camp!.radius)).toBeLessThan(0.1);
        expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, Infinity)).toBeGreaterThanOrEqual(HALF + rules.fenceRoadGap + p.r);
      }
    }
  });
});

describe('field fences', () => {
  function fieldDraft(): MapDraft {
    const d = newDraft(80);
    const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) {
      const dx = x + 0.5 - 40;
      const dy = y + 0.5 - 40;
      if (Math.abs(dx * cos + dy * sin) <= 6 && Math.abs(dy * cos - dx * sin) <= 4) d.built[y * 80 + x] = BUILT_FIELD;
    }
    return d;
  }
  const rules = NEW_WORLD.fieldFences;

  it('run straight along three of the four field edges at most, beside field tiles', () => {
    const d = fieldDraft();

    fieldFences(SEED, d, { ...rules, edgeChance: 1, missingShare: 0 });

    const lines = fenceLines(d);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expectOpen(line);
      for (const p of line) expect(Math.abs(Math.cos(p.yaw - line[0].yaw))).toBeGreaterThan(0.999);
      for (let k = 1; k < line.length; k++) expect(dist(line[k].pos, line[k - 1].pos)).toBeCloseTo((line[k].step - line[k - 1].step) * FENCE, 6);
    }
    const field = tilesMarked(d, BUILT_FIELD);
    for (const p of ofKind(d, 'fence')) expect(Math.min(...field.map((t) => dist(t, p.pos)))).toBeLessThan(1.3);
  });

  it('put no fence on a scrap of field', () => {
    const d = newDraft(80);
    markRect(d, 30, 30, 33, 33, BUILT_FIELD);

    fieldFences(SEED, d, { ...rules, edgeChance: 1 });

    expect(d.props).toEqual([]);
  });
});

describe('car wrecks', () => {
  const rules = NEW_WORLD.carWrecks;
  const none = { ...rules, roadChance: 0, oldRoadChance: 0, campChance: 0, washChance: 0 };

  it('lie on road shoulders, off the surface', () => {
    const d = newDraft(SIZE);

    carWrecks(SEED, d, [], { ...none, roadChance: 1 });

    expect(d.props.length).toBeGreaterThan(20);
    for (const p of d.props) {
      expect(p.kind).toBe('carWreck');
      expectOffBuilt(p);
      expect(ROAD_INDEX.nearestWithin(p.pos.x, p.pos.y, Infinity)).toBeLessThanOrEqual(HALF + rules.shoulder[1] + p.r + 1e-6);
    }
  });

  it('lie on old roads', () => {
    const d = newDraft(80);
    markRect(d, 15, 30, 65, 33, BUILT_OLD_ROAD);

    carWrecks(SEED, d, [], { ...none, oldRoadChance: 1 });

    expect(d.props.length).toBeGreaterThan(5);
    for (const p of d.props) expect(d.built[Math.floor(p.pos.y) * 80 + Math.floor(p.pos.x)]).toBe(BUILT_OLD_ROAD);
  });

  it('lie in a small group just outside a camp', () => {
    const d = newDraft(80);
    const camp: Camp = { pos: { x: 40, y: 40 }, radius: 5 };

    carWrecks(SEED, d, [camp], { ...none, campChance: 1 });

    expect(d.props.length).toBeGreaterThanOrEqual(rules.campGroup[0]);
    expect(d.props.length).toBeLessThanOrEqual(rules.campGroup[1]);
    for (const p of d.props) {
      expect(dist(p.pos, camp.pos) - p.r).toBeGreaterThanOrEqual(camp.radius);
      expect(dist(p.pos, camp.pos) - p.r).toBeLessThanOrEqual(camp.radius + rules.campSpread);
    }
  });

  it('lie nose down in wash beds', () => {
    const d = newDraft(80);
    setCorners(d, 'heights', (i) => -i * 0.05);
    setCorners(d, 'flow', (_i, j) => (j >= 38 && j <= 42 ? WASH * 2 : 0));

    carWrecks(SEED, d, [], { ...none, washChance: 1 });

    expect(d.props.length).toBeGreaterThan(5);
    for (const p of d.props) {
      expect(p.pos.y).toBeGreaterThanOrEqual(37);
      expect(p.pos.y).toBeLessThanOrEqual(43);
      expect(Math.cos(p.yaw)).toBeGreaterThan(0.99);
    }
  });
});

describe('new-world layer on a baked draft', () => {
  let d: MapDraft;
  beforeAll(() => {
    const base = baseLayer(SEED, SIZE);
    rain(base, { ...GEOLOGY.rain, steps: GEOLOGY.rain.steps / 4, rainPerStep: GEOLOGY.rain.rainPerStep * 4 });
    slump(base, GEOLOGY.slump);
    wind(base, GEOLOGY.wind, { rngState: SEED });
    dunes(base, GEOLOGY.dunes, GEOLOGY.wind.direction, SEED);
    d = oldWorldLayer(SEED, finishLayer(SEED, base));
  }, budget(120_000));

  function clone(from: MapDraft): MapDraft {
    return { ...from, heights: from.heights.slice(), types: from.types.slice(), props: from.props.map((p) => ({ ...p, pos: { ...p.pos } })), sand: from.sand.slice(), flow: from.flow.slice(), slumped: from.slumped.slice(), built: from.built.slice() };
  }

  it('places every kind off roads, sites and the deck, apart from each other and off cliffs', () => {
    const before = d.props.length;
    const out = newWorldLayer(SEED, clone(d));

    const added = out.props.slice(before);
    for (const kind of ['shack', 'fence', 'junk', 'carWreck']) expect(ofKind({ ...out, props: added }, kind).length).toBeGreaterThan(0);
    for (const p of added) {
      expectOffBuilt(p);
      expect(tileSteepness(out.heights, out.size, Math.floor(p.pos.y) * out.size + Math.floor(p.pos.x))).toBeLessThanOrEqual(TERRAIN.drive.maxSlope);
    }
    expectApart(out.props);
  });

  it('marks pools and scrub only off built ground and old-world marks', () => {
    const out = newWorldLayer(SEED, clone(d));

    for (const code of [BUILT_SCRUB, BUILT_DIRTY_WATER]) expect(tilesMarked(out, code).length).toBeGreaterThan(0);
    for (const code of [BUILT_SCRUB, BUILT_DIRTY_WATER, BUILT_TOXIC]) expect(tilesMarked(out, code).filter(onBuilt)).toEqual([]);
    const overwritten = out.built.filter((b, tile) => d.built[tile] !== BUILT_NONE && b !== d.built[tile]);
    expect(overwritten).toHaveLength(0);
  });

  it('leaves every fence line open', () => {
    const out = newWorldLayer(SEED, clone(d));

    const lines = fenceLines(out);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expectOpen(line);
  });

  it('gives the same props and marks for the same seed', () => {
    const a = newWorldLayer(SEED, clone(d));
    const b = newWorldLayer(SEED, clone(d));

    expect(b.props).toEqual(a.props);
    expect(Array.from(b.built)).toEqual(Array.from(a.built));
  });
});
