// The map bake: a fixed order of layers over one draft, from base relief to rocks and crags. Heights, sand, flow and
// slumped marks live on tile corners, (size + 1) x (size + 1), corner (i, j) at j * (size + 1) + i. Types
// live on tiles, tile (x, y) at y * size + x, as an index into TYPE_IDS.

import { REGION } from '../data/region';
import { GEOLOGY, MAPGEN, TERRAIN, type TerrainTypeId } from '../data/terrain';
import { bridgeCut, deckAt } from '../sim/bridge';
import { broadAt, flattenFactor, reliefAt } from '../sim/elevation';
import { gradeRoads } from '../sim/road-grade';
import { ROAD_INDEX } from '../sim/road-index';
import { chance, randRange, type Rng } from '../sim/rng';
import { heightFromElevation, TYPE_IDS, type BakedProp } from '../sim/terrain';
import { clearOfSites, onDeck } from '../sim/mapgen';
import { siteGap } from '../sim/sites';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { BUILT_CANAL, BUILT_PAD, BUILT_DIRTY_WATER, BUILT_SCRUB, BUILT_TOXIC, BUILT_TRACK, newWorldLayer } from './newworld';
import { BUILT_FIELD, BUILT_OLD_ROAD, oldWorldLayer } from './oldworld';
import { territoryLayer } from './territory';
import { cornerNeighbors, geologyLayer, pondDepths, type Neighbors } from './geology';

export function bakeMap(seed: number): MapDraft {
  let d = timed('base', () => baseLayer(seed, REGION.size));
  d = timed('geology', () => geologyLayer(seed, d));
  d = timed('finish', () => finishLayer(seed, d));
  d = timed('old world', () => oldWorldLayer(seed, d));
  d = timed('new world', () => newWorldLayer(seed, d));
  d = timed('territories', () => territoryLayer(seed, d));
  d = timed('ground', () => groundLayer(seed, d));
  return timed('rocks', () => rockLayer(seed, d));
}

function timed(layer: string, run: () => MapDraft): MapDraft {
  const start = performance.now();
  const d = run();
  console.log(`${layer}: ${Math.round(performance.now() - start)} ms`);
  return d;
}

// The draft every layer reads and changes.

export type MapDraft = {
  size: number;
  heights: Float32Array;
  types: Uint8Array;
  props: BakedProp[];
  sand: Float32Array;
  flow: Float32Array;
  slumped: Uint8Array;
  // Ground marks per tile, as the BUILT_ codes in ./oldworld and ./newworld.
  built: Uint8Array;
  // Points where a current road crosses a wash under a broken road bridge.
};

export function newDraft(size: number): MapDraft {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`Map size must be a positive integer, got ${size}`);
  const corners = (size + 1) * (size + 1);
  return {
    size,
    heights: new Float32Array(corners),
    types: new Uint8Array(size * size),
    props: [],
    sand: new Float32Array(corners),
    flow: new Float32Array(corners),
    slumped: new Uint8Array(corners),
    built: new Uint8Array(size * size),
  };
}

export function typeCode(id: TerrainTypeId): number {
  const code = TYPE_IDS.indexOf(id);
  if (code < 0) throw new Error(`Unknown ground type ${id}`);
  return code;
}

// Steepness of a tile: height change per tile, from its four corners averaged over both edges on each axis.
export function tileSteepness(heights: ArrayLike<number>, size: number, tile: number): number {
  const i = tile % size;
  const j = Math.floor(tile / size);
  const w = size + 1;
  const a = heights[j * w + i];
  const b = heights[j * w + i + 1];
  const c = heights[(j + 1) * w + i];
  const d = heights[(j + 1) * w + i + 1];
  return Math.hypot((b - a + d - c) / 2, (c - a + d - b) / 2);
}

// Base layer: noise relief, ridges and the fixed landforms at full height, before any flattening.

export function baseLayer(seed: number, size: number): MapDraft {
  const d = newDraft(size);
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) d.heights[j * (size + 1) + i] = heightFromElevation(reliefAt(seed, i, j) + broadAt(seed, i, j));
  return d;
}

// Finish layer: ground near roads and sites blends down to the broad rolling height, except in the gap
// under Canyon Bridge, then road grading caps every road and bank grade.

export function finishLayer(seed: number, d: MapDraft): MapDraft {
  const w = d.size + 1;
  for (let j = 0; j <= d.size; j++) for (let i = 0; i <= d.size; i++) {
    const flatten = flattenFactor(i, j) * (1 - bridgeCut(i, j));
    if (flatten === 0) continue;
    const k = j * w + i;
    d.heights[k] += (heightFromElevation(broadAt(seed, i, j)) - d.heights[k]) * flatten;
  }
  d.heights.set(gradeRoads({ size: d.size, heights: Array.from(d.heights), types: [] }));
  return d;
}

// Ground layer. Built ground first: roads, the bridge deck and site ground. Then old-world and new-world
// tile marks, then the first geology rule that holds for the tile, then hardpan. Geology marks live on
// corners, so each rule reads the tile's four corners.

// Territories keep their natural ground.
const SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')];
const T = TERRAIN.types;
const G = GEOLOGY.ground;

type GroundInput = { seed: number; d: MapDraft; pond: Float32Array };

// A geology rule: the ground type it lays on tile (x, y), whose top-left corner is k, or null.
type GroundRule = (g: GroundInput, tile: number, k: number) => TerrainTypeId | null;

export function groundLayer(seed: number, d: MapDraft): MapDraft {
  const g: GroundInput = { seed, d, pond: drainChannels(pondDepths(d.heights, d.size, G.lakeDepth), d.size) };
  for (let y = 0; y < d.size; y++) for (let x = 0; x < d.size; x++) d.types[y * d.size + x] = typeCode(pickType(g, x, y));
  return d;
}

// Ground types for old-world tile marks.
const MARKED_TYPES: Record<number, TerrainTypeId> = {
  [BUILT_OLD_ROAD]: 'asphalt',
  [BUILT_FIELD]: 'field',
  [BUILT_SCRUB]: 'scrub',
  [BUILT_DIRTY_WATER]: 'dirtyWater',
  [BUILT_TOXIC]: 'toxic',
  [BUILT_TRACK]: 'track',
  [BUILT_CANAL]: 'canal',
  [BUILT_PAD]: 'concrete',
};

function pickType(g: GroundInput, x: number, y: number): TerrainTypeId {
  const c = { x: x + 0.5, y: y + 0.5 };
  const built = builtType(c);
  if (built) return built;
  const tile = y * g.d.size + x;
  const marked = MARKED_TYPES[g.d.built[tile]];
  if (marked) return marked;
  const k = y * (g.d.size + 1) + x;
  for (const rule of GEOLOGY_RULES) {
    const type = rule(g, tile, k);
    if (type) return type;
  }
  // Scrub grows only where the new-world layer let it spread, so the rest is bare hardpan.
  return 'hardpan';
}

// The canyon, the dry river and Broken Wing's trench are water courses: their floors and lower banks are wash beds, never lakes,
// even where the carved floor holds a closed hollow. Half the bank reaches the foot of the slope.
function drainChannels(pond: Float32Array, size: number): Float32Array {
  const n = size + 1;
  const channels = [TERRAIN.features.canyon, TERRAIN.features.dryRiver, TERRAIN.features.trench];
  for (let k = 0; k < pond.length; k++) {
    if (pond[k] === 0) continue;
    const p = { x: k % n, y: Math.floor(k / n) };
    if (channels.some((c) => polylineDist(p, c.path) <= c.width + c.bank / 2)) pond[k] = 0;
  }
  return pond;
}

// Road on roads and the decks, hardpan on and around sites, null elsewhere.
function builtType(c: Vec): TerrainTypeId | null {
  if (deckAt(c.x, c.y) !== null) return 'road';
  if (ROAD_INDEX.nearestWithin(c.x, c.y, REGION.roadWidth / 2) < REGION.roadWidth / 2) return 'road';
  return SITES.some((s) => siteGap(s, c) < T.siteMargin) ? 'hardpan' : null;
}

// Steep ground and ground where soil slumped are scree.
function screeType(g: GroundInput, tile: number, k: number): TerrainTypeId | null {
  if (tileSteepness(g.d.heights, g.d.size, tile) >= T.screeSlope) return 'scree';
  return cornerMax(g.d.slumped, g.d.size, k) > 0 ? 'scree' : null;
}

// Standing water dries out: shallow ponds leave salt crust, deep ones mud.
function pondType(g: GroundInput, _tile: number, k: number): TerrainTypeId | null {
  const depth = cornerMax(g.pond, g.d.size, k);
  if (depth >= G.mudDepth) return 'mud';
  return depth >= G.saltDepth ? 'saltCrust' : null;
}

// Wash beds: fast water on steep beds leaves gravel, slow water on gentle beds leaves sand.
function washType(g: GroundInput, tile: number, k: number): TerrainTypeId | null {
  if (cornerMax(g.d.flow, g.d.size, k) < G.washFlow) return null;
  return tileSteepness(g.d.heights, g.d.size, tile) >= G.gravelSlope ? 'gravel' : 'sand';
}

function sandType(g: GroundInput, _tile: number, k: number): TerrainTypeId | null {
  return cornerMean(g.d.sand, g.d.size, k) >= G.looseSand ? 'sand' : null;
}

// Drift sand lies over Broken Wing's ramps, round the hoop's feet and on the trench floor, where the wing came down.
function wingSandType(g: GroundInput, _tile: number, k: number): TerrainTypeId | null {
  const n = g.d.size + 1;
  const p = { x: (k % n) + 0.5, y: Math.floor(k / n) + 0.5 };
  const F = TERRAIN.features;
  if (F.mounds.some((m) => dist(p, m.center) <= m.radius + m.bank * 0.7)) return 'sand';
  if (dist(p, F.wing.pos) <= F.wing.r) return 'sand';
  return polylineDist(p, F.trench.path) <= F.trench.width ? 'sand' : null;
}

const GEOLOGY_RULES: GroundRule[] = [screeType, wingSandType, pondType, washType, sandType];

// Largest and mean value over the four corners of the tile whose top-left corner is k.
function cornerMax(a: ArrayLike<number>, size: number, k: number): number {
  const w = size + 1;
  return Math.max(a[k], a[k + 1], a[k + w], a[k + w + 1]);
}

function cornerMean(a: ArrayLike<number>, size: number, k: number): number {
  const w = size + 1;
  return (a[k] + a[k + 1] + a[k + w] + a[k + w + 1]) / 4;
}


// Rock layer: boulders on corners at the foot of cliffs and on ridge tops, each by its own chance from
// the map seed, off the roads, sites, the decks, cliffs, the map margin and earlier props. A boulder
// on a ridge top as high as the crag height is a crag, a larger rock spire.

const O = REGION.obstacles;
const B = GEOLOGY.boulders;
// The map file rounds heights to 1 / heightScale, which moves a tile's steepness by up to sqrt(2) / heightScale.
// Boulders keep that margin below the cliff slope, so none sits on a cliff in the file.
const BOULDER_SLOPE_LIMIT = TERRAIN.drive.maxSlope - Math.SQRT2 / MAPGEN.heightScale;

export function rockLayer(seed: number, d: MapDraft): MapDraft {
  const rng: Rng = { rngState: seed };
  const n = d.size + 1;
  const nb = cornerNeighbors(n);
  d.props = d.props.filter((p) => p.kind !== 'rock' && p.kind !== 'crag');
  for (let j = 1; j < d.size; j++) for (let i = 1; i < d.size; i++) {
    // Sand buries rock, and dune crests are not rock ridges.
    const spot = d.sand[j * n + i] >= G.looseSand ? null : boulderSpot(d.heights, nb, n, j * n + i);
    if (spot && chance(rng, spot.odds)) placeBoulder(d, rng, i, j, spot.kind);
  }
  return d;
}

type BoulderSpot = { odds: number; kind: 'rock' | 'crag' };

function boulderSpot(h: ArrayLike<number>, nb: Neighbors, n: number, k: number): BoulderSpot | null {
  if (isCliffBase(h, nb, k)) return { odds: B.cliffBase, kind: 'rock' };
  if (!isRidgeTop(h, n, k)) return null;
  return { odds: B.ridgeTop, kind: h[k] >= B.crag.above ? 'crag' : 'rock' };
}

// A corner at the foot of a cliff: some neighbor rises from it steeper than a truck can climb.
function isCliffBase(h: ArrayLike<number>, nb: Neighbors, k: number): boolean {
  for (let q = 0; q < 8; q++) {
    if ((h[k + nb.offsets[q]] - h[k]) * nb.invDist[q] > TERRAIN.drive.maxSlope) return true;
  }
  return false;
}

// A ridge top: along some line through the corner, it is the highest of three corners and bulges above
// the middle of the other two by the ridge curvature.
function isRidgeTop(h: ArrayLike<number>, n: number, k: number): boolean {
  return bulges(h, k, 1, 1) || bulges(h, k, n, 1) || bulges(h, k, n + 1, 2) || bulges(h, k, n - 1, 2);
}

// Offset o to the neighbors on each side, spanSq the squared distance to them in tiles.
function bulges(h: ArrayLike<number>, k: number, o: number, spanSq: number): boolean {
  const a = h[k - o];
  const b = h[k + o];
  if (h[k] < a || h[k] < b) return false;
  return (h[k] - (a + b) / 2) / spanSq >= B.ridgeCurvature;
}

// A boulder somewhere within half a tile of corner (i, j), kept only where it fits. A crag gets its own facing.
function placeBoulder(d: MapDraft, rng: Rng, i: number, j: number, kind: 'rock' | 'crag'): void {
  const pos = { x: i + randRange(rng, -0.5, 0.5), y: j + randRange(rng, -0.5, 0.5) };
  const [low, high] = kind === 'crag' ? B.crag.radius : B.radius;
  const r = randRange(rng, low, high);
  const yaw = kind === 'crag' ? randRange(rng, 0, Math.PI * 2) : 0;
  if (fitsOffRoad(d.size, d.heights, d.props, pos, r)) d.props.push({ kind, pos, r, yaw, group: 0, step: 0 });
}

function fitsOffRoad(size: number, heights: ArrayLike<number>, placed: BakedProp[], pos: Vec, r: number): boolean {
  if (Math.min(pos.x, pos.y, size - pos.x, size - pos.y) < O.edgeMargin) return false;
  const roadGap = REGION.roadWidth / 2 + O.roadClearance + r;
  if (ROAD_INDEX.nearestWithin(pos.x, pos.y, roadGap) < roadGap) return false;
  const tile = Math.floor(pos.y) * size + Math.floor(pos.x);
  if (tileSteepness(heights, size, tile) > BOULDER_SLOPE_LIMIT) return false;
  return !onDeck(pos, r) && clearOfSites(pos, r) && placed.every((o) => dist(pos, o.pos) >= o.r + r + O.gap);
}
