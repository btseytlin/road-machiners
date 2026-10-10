
import { MAPGEN, TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from '../data/terrain';
import { besideDeck, deckAt, decksOf, spanAt, type Deck } from './bridge';
import { clamp, type Vec } from './vec';

export type AtlasKey = { kind: 'icarus' } | { kind: 'highway'; seed: number; window: number };
export const ICARUS_KEY: AtlasKey = Object.freeze({ kind: 'icarus' });

export type Terrain = {
  size: number;
  heights: number[];
  types: TerrainTypeId[];
  atlas: AtlasKey;
};

const T = TERRAIN;

export function heightFromElevation(e: number): number {
  return e * T.height.hill + Math.max(0, e - T.height.mountainFrom) * T.height.mountain;
}

function corner(t: Terrain, i: number, j: number): number {
  return t.heights[clamp(j, 0, t.size) * (t.size + 1) + clamp(i, 0, t.size)];
}

export function tileAt(t: Terrain, p: Vec): number {
  const x = clamp(Math.floor(p.x), 0, t.size - 1);
  const y = clamp(Math.floor(p.y), 0, t.size - 1);
  return y * t.size + x;
}

export function isRoadTile(t: Terrain, p: Vec): boolean {
  return t.types[tileAt(t, p)] === 'road';
}

export function heightAt(t: Terrain, x: number, y: number): number {
  const on = deckAt(decksOf(t.atlas), x, y);
  return on === null ? groundAt(t, x, y) : deckHeight(t, on.deck, on.along);
}

export function markHeightAt(t: Terrain, origin: Vec, x: number, y: number): number {
  const h = heightAt(t, x, y);
  const span = spanAt(decksOf(t.atlas), x, y, T.vision.radius);
  if (span === null || !besideDeck(span.deck, origin, T.vision.radius)) return h;
  const deck = deckHeight(t, span.deck, span.along);
  if (h >= deck) return h;
  const from = heightAt(t, origin.x, origin.y);
  return Math.abs(from - deck) < Math.abs(from - h) ? deck : h;
}

export function groundAt(t: { size: number; heights: ArrayLike<number> }, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > t.size ? t.size : x;
  const cy = y < 0 ? 0 : y > t.size ? t.size : y;
  const i = Math.min(Math.floor(cx), t.size - 1);
  const j = Math.min(Math.floor(cy), t.size - 1);
  const fx = cx - i;
  const fy = cy - j;
  const row = t.size + 1;
  const k = j * row + i;
  const a = t.heights[k];
  const b = t.heights[k + 1];
  const c = t.heights[k + row];
  const d = t.heights[k + row + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const ALONG_SLACK = 1e-6;

export function deckHeight(t: Terrain, deck: Deck, along: number): number {
  if (along < -ALONG_SLACK || along > deck.length + ALONG_SLACK) throw new Error(`Deck ${deck.id} has no point ${along} tiles along it`);
  const k = pieceAt(deck, along);
  const a = deck.stations[k];
  const b = deck.stations[k + 1];
  const h0 = stationHeight(t, a);
  const h1 = stationHeight(t, b);
  return h0 + (h1 - h0) * ((along - a.along) / (b.along - a.along));
}

function pieceAt(deck: Deck, along: number): number {
  const { stations } = deck;
  let k = 0;
  while (k < stations.length - 2 && along > stations[k + 1].along) k++;
  return k;
}

export type DeckSegment = { from: Vec; to: Vec; along: number; length: number; h0: number; h1: number };

export function deckSegments(t: Terrain, deck: Deck): DeckSegment[] {
  return deck.stations.slice(1).map((b, k) => {
    const a = deck.stations[k];
    return { from: a.at, to: b.at, along: a.along, length: b.along - a.along, h0: stationHeight(t, a), h1: stationHeight(t, b) };
  });
}

function stationHeight(t: Terrain, s: { at: Vec; rise: number }): number {
  return groundAt(t, s.at.x, s.at.y) + s.rise;
}

export function tileSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  const on = deckAt(decksOf(t.atlas), i + 0.5, j + 0.5);
  if (on === null) return groundSlope(t, tile);
  const k = pieceAt(on.deck, on.along);
  const a = on.deck.stations[k];
  const b = on.deck.stations[k + 1];
  const grade = (stationHeight(t, b) - stationHeight(t, a)) / (b.along - a.along);
  return { x: grade * on.deck.axis.x, y: grade * on.deck.axis.y };
}

export function groundSlope(t: Terrain, tile: number): Vec {
  const i = tile % t.size;
  const j = Math.floor(tile / t.size);
  const a = corner(t, i, j);
  const b = corner(t, i + 1, j);
  const c = corner(t, i, j + 1);
  const d = corner(t, i + 1, j + 1);
  return { x: (b - a + d - c) / 2, y: (c - a + d - b) / 2 };
}

export function isCliff(t: Terrain, tile: number): boolean {
  const s = tileSlope(t, tile);
  return Math.hypot(s.x, s.y) > T.drive.maxSlope;
}

export const PROP_KINDS = ['rock', 'crag', 'ruin', 'house', 'silo', 'waterTower', 'gasStation', 'bridgeSpan', 'pole', 'billboard', 'tank', 'shack', 'fence', 'junk', 'carWreck', 'hullChunk', 'shipCache', 'reactor', 'deadTree', 'farmhouse', 'barn', 'armyCache', 'bunker', 'armyTruck', 'sandbags', 'quonset', 'guardPost', 'barrier', 'drums', 'woodpile', 'shipWing', 'hullCache', 'shipBow', 'shipCage', 'shipHub', 'hullShell', 'hullDrum', 'hullShard', 'hullTower', 'hullGantry', 'rimRock', 'tankTrap', 'fortPumpworksWall', 'fortPumpworksTower', 'fortPumpworksGate', 'fortPumpworksInner', 'fortCisternWall', 'fortCisternTower', 'fortCisternGate', 'fortCisternInner', 'fortShipWall', 'fortShipTower', 'fortShipGate', 'fortScrapWall', 'fortScrapTower', 'fortScrapGate', 'fortScrapInner', 'fortPatchworkWall', 'fortPatchworkTower', 'fortPatchworkGate', 'fortCompoundWall', 'fortCompoundTower', 'fortCompoundGate', 'fortRingWall', 'fortRingGate', 'fortYardWall', 'fortYardTower', 'fortYardGate', 'noseRise', 'noseCrag', 'engineNozzle', 'engineFrame', 'watchtower', 'ruinCompound', 'deadTruck', 'engineCache', 'glassSpire', 'scrapWall', 'escapePod', 'habitat', 'wingShard', 'powerCell'] as const;
export type PropKind = (typeof PROP_KINDS)[number];
export type BakedProp = { kind: PropKind; pos: Vec; r: number; yaw: number; group: number; step: number; hulk?: string };
export type BakedMap = { hash: string; seed: number; terrain: Terrain; props: BakedProp[] };
export type MapGrid = { size: number; heights: Float32Array; types: Uint8Array; props: BakedProp[] };

export const TYPE_IDS = Object.keys(TERRAIN_TYPES) as TerrainTypeId[];

const MAGIC = 'KMAP';
const VERSION = 4;
const HEADER = 20;
const PROP_BYTES = 1 + 4 * 4 + 2 * 2;
const INT16_MAX = 32767;
const UINT16_MAX = 65535;

export function encodeMap(d: MapGrid, seed: number): Uint8Array {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Map seed must be a 32-bit unsigned integer, got ${seed}`);
  const corners = (d.size + 1) ** 2;
  const tiles = d.size * d.size;
  const bytes = new Uint8Array(HEADER + corners * 2 + tiles + 4 + d.props.length * PROP_BYTES);
  const view = new DataView(bytes.buffer);
  for (let k = 0; k < MAGIC.length; k++) bytes[k] = MAGIC.charCodeAt(k);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, d.size, true);
  view.setUint32(12, seed, true);
  view.setUint32(16, MAPGEN.heightScale, true);
  writeHeights(view, d.heights, MAPGEN.heightScale);
  bytes.set(d.types, HEADER + corners * 2);
  writeProps(view, HEADER + corners * 2 + tiles, d.props);
  return bytes;
}

function writeHeights(view: DataView, heights: Float32Array, scale: number): void {
  heights.forEach((h, k) => {
    const q = Math.round(h * scale);
    if (!(Math.abs(q) <= INT16_MAX)) throw new Error(`Corner ${k} height ${h} does not fit the map file at scale ${scale}`);
    view.setInt16(HEADER + k * 2, q, true);
  });
}

function writeProps(view: DataView, from: number, props: BakedProp[]): void {
  view.setUint32(from, props.length, true);
  props.forEach((p, k) => {
    const at = from + 4 + k * PROP_BYTES;
    const code = PROP_KINDS.indexOf(p.kind);
    if (code < 0) throw new Error(`Prop ${k} has unknown kind ${p.kind}`);
    view.setUint8(at, code);
    view.setFloat32(at + 1, p.pos.x, true);
    view.setFloat32(at + 5, p.pos.y, true);
    view.setFloat32(at + 9, p.r, true);
    view.setFloat32(at + 13, p.yaw, true);
    view.setUint16(at + 17, u16(p.group, `Prop ${k} group`), true);
    view.setUint16(at + 19, u16(p.step, `Prop ${k} step`), true);
  });
}

function u16(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > UINT16_MAX) throw new Error(`${what} ${value} does not fit the map file`);
  return value;
}

export function decodeMap(bytes: Uint8Array): BakedMap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { size, seed, scale } = readHeader(bytes, view);
  const corners = (size + 1) ** 2;
  const propsAt = HEADER + corners * 2 + size * size;
  if (bytes.length < propsAt + 4) throw new Error(`Map file length ${bytes.length} is too short for size ${size}`);
  const propCount = view.getUint32(propsAt, true);
  if (bytes.length !== propsAt + 4 + propCount * PROP_BYTES) throw new Error(`Map file length ${bytes.length} does not match size ${size} and ${propCount} props`);
  const heights: number[] = new Array(corners);
  for (let k = 0; k < corners; k++) heights[k] = view.getInt16(HEADER + k * 2, true) / scale;
  const types = Array.from(bytes.subarray(HEADER + corners * 2, propsAt), readType);
  const props: BakedProp[] = [];
  for (let k = 0, at = propsAt + 4; k < propCount; k++, at += PROP_BYTES) props.push(readProp(view, at, k));
  const terrain: Terrain = { size, heights, types, atlas: ICARUS_KEY };
  Object.freeze(heights);
  Object.freeze(types);
  Object.freeze(terrain);
  return { hash: fnv1a(bytes), seed, terrain, props };
}

function readProp(view: DataView, at: number, k: number): BakedProp {
  const kind = PROP_KINDS[view.getUint8(at)];
  if (kind === undefined) throw new Error(`Map file prop ${k} has unknown prop kind ${view.getUint8(at)}`);
  return {
    kind,
    pos: { x: view.getFloat32(at + 1, true), y: view.getFloat32(at + 5, true) },
    r: view.getFloat32(at + 9, true),
    yaw: view.getFloat32(at + 13, true),
    group: view.getUint16(at + 17, true),
    step: view.getUint16(at + 19, true),
  };
}

function readHeader(bytes: Uint8Array, view: DataView): { size: number; seed: number; scale: number } {
  if (bytes.length < HEADER) throw new Error(`Map file length ${bytes.length} is shorter than its header`);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error(`Map file has bad magic ${JSON.stringify(magic)}`);
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`Map file version ${version} is not ${VERSION}`);
  const scale = view.getUint32(16, true);
  if (scale === 0) throw new Error('Map file height scale is 0');
  return { size: view.getUint32(8, true), seed: view.getUint32(12, true), scale };
}

function readType(code: number, tile: number): TerrainTypeId {
  const id = TYPE_IDS[code];
  if (id === undefined) throw new Error(`Map file tile ${tile} has unknown ground type ${code}`);
  return id;
}

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
