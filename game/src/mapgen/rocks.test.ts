import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { GEOLOGY, MAPGEN, TERRAIN } from '../data/terrain';
import { deckById } from '../sim/bridge';
import { ROAD_INDEX } from '../sim/road-index';
import { decodeMap, isCliff, tileAt, type BakedMap, type BakedProp, type Terrain } from '../sim/terrain';
import { siteGap } from '../sim/sites';
import { dist, segmentDist } from '../sim/vec';
import { newDraft, rockLayer, type MapDraft } from './bake';
import { BUILT_GLASS, BUILT_TRACK } from './newworld';
import { tileOf, tilesWithin } from './oldworld';
import { budget } from '../test/budget';

const SIZE = REGION.size;
const O = REGION.obstacles;
const SITES = [...REGION.towns, ...REGION.locations];

// Every rock and crag off roads, sites, the bridge deck and the map margin, and apart from every other one.
function expectClear(rocks: BakedProp[]): void {
  const bridge = deckById('canyon-bridge');
  for (const rock of rocks) {
    const { x, y } = rock.pos;
    expect(Math.min(x, y, SIZE - x, SIZE - y)).toBeGreaterThanOrEqual(O.edgeMargin);
    expect(ROAD_INDEX.nearestWithin(x, y, Infinity)).toBeGreaterThanOrEqual(REGION.roadWidth / 2 + O.roadClearance + rock.r);
    for (const site of SITES) expect(siteGap(site, rock.pos)).toBeGreaterThan(O.siteClearance + rock.r);
    expect(segmentDist(rock.pos, bridge.from, bridge.to)).toBeGreaterThanOrEqual(bridge.width / 2 + rock.r);
  }
  for (let a = 0; a < rocks.length; a++) for (let b = a + 1; b < rocks.length; b++) {
    expect(dist(rocks[a].pos, rocks[b].pos)).toBeGreaterThanOrEqual(rocks[a].r + rocks[b].r + O.gap);
  }
}

// A full map draft: a high plateau west of FOOT - FACE, a cliff face falling to x = FOOT, and flat ground east of it.
const FOOT = 300;
const FACE = 10;
const RISE = TERRAIN.drive.maxSlope * 2;

function cliffDraft(): MapDraft {
  const d = newDraft(SIZE);
  const n = SIZE + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = Math.min(FACE, Math.max(0, FOOT - i)) * RISE;
  return d;
}

describe('boulders', () => {
  it('puts rocks along the foot of a cliff', () => {
    const d = rockLayer(1337, cliffDraft());

    expect(d.props.every((p) => p.kind === 'rock')).toBe(true);
    const atFoot = d.props.filter((rock) => rock.pos.x >= FOOT && rock.pos.x < FOOT + 1);
    expect(atFoot.length).toBeGreaterThan(10);
  });

  it('puts no boulder on the cliff face or on the flat ground away from it', () => {
    const d = rockLayer(1337, cliffDraft());

    const onFace = d.props.filter((rock) => rock.pos.x >= FOOT - FACE && rock.pos.x < FOOT);
    const away = d.props.filter((rock) => rock.pos.x > FOOT + 1 || rock.pos.x < FOOT - FACE - 1);
    expect(onFace).toEqual([]);
    expect(away).toEqual([]);
  });

  it('puts no boulder where deep sand covers the cliff foot', () => {
    const d = cliffDraft();
    d.sand.fill(GEOLOGY.ground.looseSand);

    expect(rockLayer(1337, d).props).toEqual([]);
  });

  it('puts no boulder on flat ground', () => {
    const d = rockLayer(1337, newDraft(SIZE));

    expect(d.props).toEqual([]);
  });

  it('keeps every boulder clear of roads, sites, the bridge, the margin and other rocks', () => {
    const d = rockLayer(1337, cliffDraft());

    expectClear(d.props);
  });

  it('keeps every boulder off dirt track tiles, and places every other boulder as without the track', () => {
    // A dirt track 6 tiles wide across the cliff foot, as a territory's spur crosses open land.
    const marked = cliffDraft();
    for (let y = 200; y < 206; y++) for (let x = FOOT - 20; x < FOOT + 20; x++) marked.built[y * SIZE + x] = BUILT_TRACK;
    const onTrack = (d: MapDraft, rock: BakedProp) => [tileOf(SIZE, rock.pos), ...tilesWithin(SIZE, rock.pos, rock.r)].some((tile) => d.built[tile] === BUILT_TRACK);

    const withTrack = rockLayer(1337, marked).props;
    const without = rockLayer(1337, cliffDraft()).props;

    expect(withTrack.filter((rock) => onTrack(marked, rock))).toEqual([]);
    // Boulders the track turned away leave every other draw where it was.
    const away = (rock: BakedProp) => rock.pos.y < 200 - 3 || rock.pos.y > 206 + 3;
    expect(without.filter((rock) => !away(rock)).length).toBeGreaterThan(0);
    expect(withTrack.filter(away)).toEqual(without.filter(away));
  });

  it('keeps every boulder off fused glass', () => {
    // A glass field across the cliff foot, as a territory's glass meets a ridge.
    const marked = cliffDraft();
    for (let y = 200; y < 230; y++) for (let x = FOOT - 20; x < FOOT + 20; x++) marked.built[y * SIZE + x] = BUILT_GLASS;
    const onGlass = (rock: BakedProp) => [tileOf(SIZE, rock.pos), ...tilesWithin(SIZE, rock.pos, rock.r)].some((tile) => marked.built[tile] === BUILT_GLASS);
    const without = rockLayer(1337, cliffDraft()).props;

    const withGlass = rockLayer(1337, marked).props;

    expect(without.filter(onGlass).length).toBeGreaterThan(0);
    expect(withGlass.filter(onGlass)).toEqual([]);
  });

  it('places the same boulders for the same seed', () => {
    const a = rockLayer(1337, cliffDraft());
    const b = rockLayer(1337, cliffDraft());

    expect(a.props).toEqual(b.props);
  });
});

// A full map draft with one straight ridge along x = RIDGE, its crest `crest` high, its flanks falling
// at a drivable slope to both sides.
const RIDGE = 300;
const FLANK = 0.3;

function ridgeDraft(crest: number): MapDraft {
  const d = newDraft(SIZE);
  const n = SIZE + 1;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) d.heights[j * n + i] = crest - Math.abs(i - RIDGE) * FLANK;
  return d;
}

describe('crags', () => {
  const C = GEOLOGY.boulders.crag;

  it('turns ridge-top boulders on high ground into crags, each with a spire radius and a facing', () => {
    const d = rockLayer(1337, ridgeDraft(C.above + 1));

    expect(d.props.length).toBeGreaterThan(5);
    for (const p of d.props) {
      expect(p.kind).toBe('crag');
      expect(Math.abs(p.pos.x - RIDGE)).toBeLessThanOrEqual(0.5);
      expect(p.r).toBeGreaterThanOrEqual(C.radius[0]);
      expect(p.r).toBeLessThanOrEqual(C.radius[1]);
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThan(Math.PI * 2);
    }
  });

  it('keeps ridge-top boulders below the crag height as rocks', () => {
    const d = rockLayer(1337, ridgeDraft(C.above - 1));

    expect(d.props.length).toBeGreaterThan(5);
    expect(d.props.every((p) => p.kind === 'rock')).toBe(true);
  });

  it('keeps every crag clear of roads, sites, the bridge, the margin and other props', () => {
    expectClear(rockLayer(1337, ridgeDraft(C.above + 1)).props);
  });
});

// The committed map file, inlined by Vite as base64 data, since the project carries no Node file typings.
const FILES = import.meta.glob<string>('/public/maps/*.bin', { query: '?url&inline', import: 'default', eager: true });
const DATA_URL = 'data:application/octet-stream;base64,';

function bakedMap(): BakedMap {
  const url = FILES[`/public/${MAPGEN.file}`];
  if (url === undefined || !url.startsWith(DATA_URL)) throw new Error(`Map file public/${MAPGEN.file} is missing or did not inline. Run npm run map:bake.`);
  return decodeMap(Uint8Array.from(atob(url.slice(DATA_URL.length)), (c) => c.charCodeAt(0)));
}

describe('boulders on the baked map', () => {
  const map = bakedMap();
  const boulders = map.props.filter((p) => p.kind === 'rock' || p.kind === 'crag');

  it('holds both rocks and crags', () => {
    expect(boulders.some((p) => p.kind === 'rock')).toBe(true);
    expect(boulders.some((p) => p.kind === 'crag')).toBe(true);
  });

  it('keeps every boulder clear of roads, sites, the bridge, the margin and other rocks', () => {
    expectClear(boulders);
  }, budget(120_000)); // checks every boulder against every road and site, slow when the suite runs in parallel

  it('puts no boulder on or beside a dirt track tile', () => {
    const terrain: Terrain = map.terrain;
    const onTrack = boulders.filter((rock) => [tileAt(terrain, rock.pos), ...tilesWithin(terrain.size, rock.pos, rock.r)].some((tile) => terrain.types[tile] === 'track'));

    expect(onTrack).toEqual([]);
  }, budget(120_000));

  it('puts no boulder on a cliff tile', () => {
    const onCliff = boulders.filter((rock) => isCliff(map.terrain, tileAt(map.terrain, rock.pos)));

    expect(onCliff).toEqual([]);
  }, budget(120_000)); // decoding and checking the baked map takes 25s alone and near 40s when the whole suite shares the cores
});
