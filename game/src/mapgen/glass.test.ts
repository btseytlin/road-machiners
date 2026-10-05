import { describe, expect, it } from 'vitest';
import { REGION, type TerritoryDef } from '../data/region';
import type { BuildingGroup, GlassRules, TerritoryRules, WreckRules } from '../data/territory';
import { dist } from '../sim/vec';
import { newDraft, type MapDraft } from './bake';
import { touchedTiles } from './farm';
import { fillGlass, markGlass } from './glass';
import { BUILT_GLASS, BUILT_SCRUB, BUILT_TRACK } from './newworld';
import { prop, ruleRng, tileCenter, tilesWithin } from './oldworld';

// A synthetic territory on open ground north-west of the orchard, where no region road runs, on a flat draft.
const T: TerritoryDef = { id: 'test-glass', name: 'Test Glass', kind: 'territory', pos: { x: 405, y: 378 }, radius: 24, outline: null };
const GLASS: GlassRules = { cell: 6, cover: [0.25, 0.55], clear: 1.5, spires: { look: 'hullShard', count: 6, radius: [0.8, 1.1] } };
// Rules with no wreck and no farm: only the glass bakes.
const RULES: TerritoryRules = { seed: 2, wreck: null, farm: null, glass: GLASS, spotGap: 6, debrisGap: 1.5, reactor: null };

// A wreck with nothing but the given building groups.
function wreckOf(buildings: BuildingGroup[]): WreckRules {
  return {
    pieces: [],
    buildings,
    caches: [],
    cacheLook: 'hullCache',
    cacheTable: 'landmark',
    cacheRadius: 0.7,
    patches: [],
    spotLook: 'shipCache',
    spotTable: 'hullScrap',
    spotRadius: [0.6, 0.8],
    seatEase: 3,
    rimRocks: null,
    scree: null,
    roads: [],
    spurs: [],
    spurFade: 5,
    decks: [],
    landing: 0,
  };
}

function insideTiles(d: MapDraft): number[] {
  return tilesWithin(d.size, T.pos, T.radius);
}

function glassTiles(d: MapDraft): number[] {
  return insideTiles(d).filter((tile) => d.built[tile] === BUILT_GLASS);
}

describe('fused glass', () => {
  it('keeps glass off dirt road tiles and clear of every kept prop', () => {
    const d = newDraft(REGION.size);
    // A track across the territory, three tiles wide.
    for (let y = 377; y < 380; y++) for (let x = 380; x < 430; x++) d.built[y * d.size + x] = BUILT_TRACK;
    const building = prop('barn', { x: 412, y: 370 }, 2.5, 0);

    markGlass(d, T, { ...GLASS, cover: [1, 1] }, [building], 11);

    const glass = glassTiles(d);
    expect(glass.length).toBeGreaterThan(0);
    for (let y = 377; y < 380; y++) for (let x = 380; x < 430; x++) expect(d.built[y * d.size + x]).toBe(BUILT_TRACK);
    expect(glass.filter((tile) => dist(tileCenter(d.size, tile), building.pos) <= building.r + GLASS.clear)).toEqual([]);
  });

  it('turns scrub to glass but keeps glass inside the territory', () => {
    const d = newDraft(REGION.size);
    d.built.fill(BUILT_SCRUB);

    markGlass(d, T, { ...GLASS, cover: [1, 1] }, [], 11);

    const all = Array.from(d.built.keys()).filter((tile) => d.built[tile] === BUILT_GLASS);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((tile) => dist(tileCenter(d.size, tile), T.pos) > T.radius)).toEqual([]);
  });

  it('lays thinner glass near the centre than toward the edge', () => {
    const d = newDraft(REGION.size);

    markGlass(d, T, { ...GLASS, cover: [0.1, 0.9] }, [], 11);

    const share = (lo: number, hi: number): number => {
      const ring = insideTiles(d).filter((tile) => {
        const r = dist(tileCenter(d.size, tile), T.pos) / T.radius;
        return r >= lo && r < hi;
      });
      return ring.filter((tile) => d.built[tile] === BUILT_GLASS).length / ring.length;
    };
    expect(share(0, 0.35)).toBeLessThan(share(0.65, 1));
  });

  it('stands every spire wholly on glass, apart from other props', () => {
    const d = newDraft(REGION.size);

    fillGlass(d, T, RULES, GLASS, ruleRng(7, 9102));

    const spires = d.props.filter((p) => p.kind === GLASS.spires.look);
    expect(spires).toHaveLength(GLASS.spires.count);
    for (const s of spires) expect(touchedTiles(d.size, s.pos, s.r).every((tile) => d.built[tile] === BUILT_GLASS)).toBe(true);
    for (const [a, b] of pairs(spires)) expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(a.r + b.r + REGION.obstacles.gap);
  });

  it('keeps every spire the debris gap from each loot spot of the territory', () => {
    const d = newDraft(REGION.size);
    const rules: TerritoryRules = {
      ...RULES,
      wreck: wreckOf([{ look: 'barn', table: 'farmStores', turnJitter: 0, shift: 0, poses: [] }]),
    };
    const barn = prop('barn', { x: 412, y: 370 }, 2.5, 0);
    d.props.push(barn);

    fillGlass(d, T, rules, GLASS, ruleRng(7, 9102));

    const spires = d.props.filter((p) => p.kind === GLASS.spires.look);
    for (const s of spires) expect(dist(s.pos, barn.pos)).toBeGreaterThanOrEqual(s.r + barn.r + REGION.obstacles.gap + RULES.debrisGap);
  });

  it('marks the same glass and spires for the same seed, and others for another', () => {
    const run = (seed: number): MapDraft => {
      const d = newDraft(REGION.size);
      fillGlass(d, T, RULES, GLASS, ruleRng(seed, 9102));
      return d;
    };
    const [a, b, c] = [run(7), run(7), run(8)];

    expect(glassTiles(a)).toEqual(glassTiles(b));
    expect(a.props).toEqual(b.props);
    expect(glassTiles(a)).not.toEqual(glassTiles(c));
    expect(a.props).not.toEqual(c.props);
  });

  it('throws on a cover outside 0 to 1 or a cell that is not positive', () => {
    const bad: GlassRules[] = [
      { ...GLASS, cover: [-0.1, 0.5] },
      { ...GLASS, cover: [0.2, 1.5] },
      { ...GLASS, cell: 0 },
    ];
    for (const glass of bad) expect(() => fillGlass(newDraft(REGION.size), T, RULES, glass, ruleRng(7, 9102))).toThrow(/glass/);
  });
});

function pairs<P>(list: readonly P[]): [P, P][] {
  return list.flatMap((a, i) => list.slice(i + 1).map((b): [P, P] => [a, b]));
}
