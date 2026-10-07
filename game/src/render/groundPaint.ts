// Map-space ground painter: tile type colors, warm sand on open desert, and hillshade. Which ground each tile looks
// like, roads included, comes from lookTypes(). The ground shader draws roads over the paint, see render/roadPaint.ts.
// Stones, scrub and cacti are 3D, in three/render/scatter.ts. The 3D terrain (three/render/terrain.ts) uses the paint
// as its texture.

import { REGION } from "../data/region";
import { TERRAIN, TERRAIN_TYPES, type Basin, type TerrainTypeId } from "../data/terrain";
import { TERRITORIES } from "../data/territory";
import { groundSlope, type Terrain } from "../sim/terrain";
import { basinUnder, isTerritory } from "../sim/territory";
import { type Vec } from "../sim/vec";
import { hash2 } from "./noise";
import { PAL, mix, shade } from "./palette";

export const TERRAIN_MARGIN = 10; // tiles of dim ground drawn past the map edge
const TYPE_JITTER = 0.6; // tiles; jittered sampling frays the blend between tile types
const JITTER_GRID = 6; // samples per tile for the type-jitter hash, independent of paint resolution
const PATCH_TILES = 24; // tiles per cell of the slow noise that lays sand patches over open desert
const PATCH_MIX = 0.15; // strongest mix toward a patch color, at full desert weight
const SAND_WARM = 0.85; // mix toward PAL.desertSand at full desert weight
const DESERT_CALM = 0.85; // share of the speckle and fine noise that full desert weight removes, so the shader's facets carry its texture
const PATCH_OFFSET = 41.5; // lattice cells; keeps the patch noise from sharing corners with the other ground noise

// How much each ground type takes the warm sand and its patches. Farmland and its tracks, canals and slabs, old
// highways and pools keep their color, so the marks of a place read against the desert. Road tiles
// have no weight of their own: they take the look of the ground beside the road, see lookTypes().
const DESERT_WEIGHT: Record<LookType, number> = {
  hardpan: 1,
  sand: 0.6,
  scrub: 0.5,
  gravel: 0.4,
  scree: 0.3,
  field: 0,
  asphalt: 0,
  ash: 0,
  saltCrust: 0,
  mud: 0,
  dirtyWater: 0,
  toxic: 0,
  track: 0,
  canal: 0,
  concrete: 0,
};

// The ground paint under a road at mean noise, before hillshade and patches, on ground with no desert look. Road
// tiles paint as hardpan, and the road shader takes the ground's shade relative to this color.
export const ROAD_PLAIN = mix(TERRAIN_TYPES.hardpan.color, PAL.sand[3], 0.1);
// The same at full desert weight. The road shader blends the two by the desert weight under the road.
export const ROAD_SAND = mix(ROAD_PLAIN, PAL.desertSand, SAND_WARM);

// The ground type whose look a tile takes. A road tile has none of its own, since the bake lays it over whatever
// ground the road crosses.
export type LookType = Exclude<TerrainTypeId, "road">;

export function desertWeight(type: LookType): number {
  return DESERT_WEIGHT[type];
}

const lookCache = new WeakMap<Terrain, readonly LookType[]>();

// The ground type each tile's paint, road edge and scatter follow. A tile off the road takes its own type. A road
// tile takes the type of the nearest tile off the road, in 4-neighbour steps, so each edge of a road follows the
// ground beside it. Ties go to the tile reached first in a flood seeded in tile index order, the same on every load.
// On a map that is all road every tile takes hardpan, the type road tiles paint as. Built once per terrain.
export function lookTypes(t: Terrain): readonly LookType[] {
  const cached = lookCache.get(t);
  if (cached) return cached;
  const look = new Array<LookType | undefined>(t.size * t.size);
  const queue = new Int32Array(look.length);
  flood(look, queue, seedOffRoad(t, look, queue), t.size);
  const result = Array.from(look, (type) => type ?? "hardpan");
  lookCache.set(t, result);
  return result;
}

// Gives every tile off the road its own type and queues it, in tile index order. Returns the queue length.
function seedOffRoad(t: Terrain, look: (LookType | undefined)[], queue: Int32Array): number {
  let tail = 0;
  for (let i = 0; i < look.length; i++) {
    const type = t.types[i];
    if (type === "road") continue;
    look[i] = type;
    queue[tail++] = i;
  }
  return tail;
}

// Spreads each queued tile's type to its 4-neighbours that have none yet, breadth first.
function flood(look: (LookType | undefined)[], queue: Int32Array, tail: number, size: number): void {
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % size;
    if (x > 0) tail = spread(look, queue, tail, i, i - 1);
    if (x < size - 1) tail = spread(look, queue, tail, i, i + 1);
    if (i >= size) tail = spread(look, queue, tail, i, i - size);
    if (i < size * (size - 1)) tail = spread(look, queue, tail, i, i + size);
  }
}

// Gives tile n the type of tile i and queues it, unless it has a type. Returns the new queue length.
function spread(look: (LookType | undefined)[], queue: Int32Array, tail: number, i: number, n: number): number {
  if (look[n] !== undefined) return tail;
  look[n] = look[i];
  queue[tail] = n;
  return tail + 1;
}

// A map-space canvas: canvas pixel (px, py) covers map point (from + px / res, from + py / res).
export type PaintCanvas = {
  ctx: CanvasRenderingContext2D;
  size: number; // canvas side in pixels
  res: number; // pixels per tile
  from: number; // map coordinate of the canvas top-left corner, same for x and y
  toPx: (tiles: number) => number; // map coordinate to canvas pixel coordinate
};

export type PaintOptions = {
  // Multiplier on the painted hillshade. 1 is the old 2D look. Lower it (or 0) where scene
  // lighting already shades slopes, so the two effects do not double up.
  hillshade: number;
};

const DEFAULT_OPTIONS: PaintOptions = { hillshade: 1 };

// Paints the ground, the canyon and dry river, and the Fallen Sun scree onto the canvas. The caller uploads the texture.
// No town, site or crater gets a painted disc: its models and relief mark it.
export function paintGroundCanvas(
  c: PaintCanvas,
  t: Terrain,
  opts: PaintOptions = DEFAULT_OPTIONS,
): void {
  paintGround(c, t, opts.hillshade);
  const { canyon, dryRiver } = TERRAIN.features;
  stroke(
    c,
    canyon.path,
    (canyon.width + canyon.bank) * 2,
    css(PAL.rust.dark, 0.35),
    0,
  );
  stroke(c, canyon.path, canyon.width * 2, css(PAL.sand[3], 0.7), 0);
  stroke(
    c,
    dryRiver.path,
    (dryRiver.width + dryRiver.bank) * 2,
    css(PAL.sand[3], 0.35),
    0,
  );
  stroke(c, dryRiver.path, dryRiver.width * 2, css(PAL.road, 0.65), 0);
  paintScree(c);
}

// Bands a scree slope is painted in, each reaching a step further up the bank, so the colour is densest at the foot
// and thins toward the top, where it reads as a slope, not a stain. It reaches at most SCREE_REACH tiles up the bank,
// since the long banks where roads come down to the floor are road grades, not scree, and a wash over them read as a
// painted stain on the land outside.
const SCREE_BANDS = 4;
const SCREE_BAND_ALPHA = 0.3;
const SCREE_REACH = 8;

// A territory's scree slope, red-brown over the bank of its basin's scree arc.
function paintScree(c: PaintCanvas): void {
  for (const t of REGION.locations.filter(isTerritory)) {
    const scree = TERRITORIES[t.id].wreck?.scree;
    if (scree) paintScreeArc(c, basinUnder(t), scree);
  }
}

// The bank of floor vertices from..to, in bands from the floor edge up the bank. The arc's two end vertices reach
// nothing, so the slope tapers out along the rim instead of stopping at a straight cut.
function paintScreeArc(c: PaintCanvas, b: Basin, scree: { from: number; to: number }): void {
  const n = b.floor.length;
  if (!isVertex(scree.from, n) || !isVertex(scree.to, n)) throw new Error(`Scree arc ${scree.from}..${scree.to} is not on a basin of ${n} floor points`);
  const arc = Array.from({ length: ((scree.to - scree.from + n) % n) + 1 }, (_, i) => (scree.from + i) % n);
  const foot = arc.map((k) => ({ x: b.center.x + b.floor[k].x, y: b.center.y + b.floor[k].y }));
  const out = arc.map((k) => outward(b.floor, k));
  for (let band = 1; band <= SCREE_BANDS; band++) {
    const top = arc.map((k, i) => {
      const end = i === 0 || i === arc.length - 1;
      const reach = end ? 0 : (Math.min(b.bank[k], SCREE_REACH) * band) / SCREE_BANDS;
      return { x: foot[i].x + out[i].x * reach, y: foot[i].y + out[i].y * reach };
    });
    polygon(c, [...foot, ...top.reverse()], css(PAL.scree, SCREE_BAND_ALPHA));
  }
}

function isVertex(k: number, n: number): boolean {
  return Number.isInteger(k) && k >= 0 && k < n;
}

// The unit direction out of a closed polygon at vertex k: the mean of its two edges' outward normals. The floor runs
// clockwise on the map, with y down, so an edge's outward normal is its direction turned a quarter toward -y.
function outward(poly: readonly Vec[], k: number): Vec {
  const n = poly.length;
  const [a, p, b] = [poly[(k + n - 1) % n], poly[k], poly[(k + 1) % n]];
  const normal = (from: Vec, to: Vec) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return { x: (to.y - from.y) / length, y: -(to.x - from.x) / length };
  };
  const [u, v] = [normal(a, p), normal(p, b)];
  const length = Math.hypot(u.x + v.x, u.y + v.y);
  return { x: (u.x + v.x) / length, y: (u.y + v.y) / length };
}

// Per-tile inputs of the ground color, computed once per paint instead of once per pixel.
type TileLook = {
  t: Terrain;
  color: Int32Array;
  desert: Float32Array;
  shade: Float64Array;
  broad: CellNoise;
  fine: CellNoise;
  patch: CellNoise;
  cell: Cell;
};

function tileLook(t: Terrain, hillshadeStrength: number): TileLook {
  const count = t.size * t.size;
  const color = new Int32Array(count);
  const desert = new Float32Array(count);
  const shadeBy = new Float64Array(count);
  const look = lookTypes(t);
  for (let i = 0; i < count; i++) {
    color[i] = paintColor(t.types[i]);
    desert[i] = desertWeight(look[i]);
    shadeBy[i] = hillshade(t, i, hillshadeStrength);
  }
  return { t, color, desert, shade: shadeBy, broad: new CellNoise(), fine: new CellNoise(), patch: new CellNoise(), cell: { a: 0, b: 0, c: 0, d: 0, fx: 0, fy: 0 } };
}

// valueNoise that keeps the corner hashes of the last lattice cell. Neighbouring pixels share a cell, so most
// calls skip the four hashes. Same arithmetic as valueNoise.
class CellNoise {
  private x0 = NaN;
  private y0 = NaN;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  at(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 !== this.x0 || y0 !== this.y0) {
      this.x0 = x0;
      this.y0 = y0;
      this.a = hash2(x0, y0);
      this.b = hash2(x0 + 1, y0);
      this.c = hash2(x0, y0 + 1);
      this.d = hash2(x0 + 1, y0 + 1);
    }
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const { a, b, c, d } = this;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Hillshade: brighten slopes turned toward the light, darken slopes turned away.
function hillshade(t: Terrain, tile: number, strength: number): number {
  const s = groundSlope(t, tile);
  return (
    1 +
    (s.x * TERRAIN.light.x + s.y * TERRAIN.light.y) *
      TERRAIN.slopeShade *
      strength
  );
}

// Same clamping as tileAt.
function tileIndex(size: number, x: number, y: number): number {
  const i = Math.min(Math.max(Math.floor(x), 0), size - 1);
  const j = Math.min(Math.max(Math.floor(y), 0), size - 1);
  return j * size + i;
}

// Type colors blend between tile centers, with a little jitter so borders look worn, not ruled.
function typeColor(look: TileLook, cell: Cell): number {
  const a = look.color[cell.a];
  const b = look.color[cell.b];
  const c = look.color[cell.c];
  const d = look.color[cell.d];
  // Inside one type all four match, and blending equal colors returns the color.
  if (a === b && a === c && a === d) return a;
  return mix(mix(a, b, cell.fx), mix(c, d, cell.fx), cell.fy);
}

// The desert weight blends between tile centers like typeColor, so patches fray at type borders too.
function desertAt(look: TileLook, cell: Cell): number {
  const a = look.desert[cell.a];
  const b = look.desert[cell.b];
  const c = look.desert[cell.c];
  const d = look.desert[cell.d];
  const top = a + (b - a) * cell.fx;
  return top + (c + (d - c) * cell.fx - top) * cell.fy;
}

// The four tiles whose centers surround a jittered point, top left, top right, bottom left and bottom right, and
// the blend fractions between them. One pixel's typeColor and desertAt share it.
type Cell = { a: number; b: number; c: number; d: number; fx: number; fy: number };

// Fills look.cell for map point x, y. It is reused for every pixel, since the paint runs over millions of them.
function jittered(look: TileLook, x: number, y: number): Cell {
  const jx =
    x +
    (hash2(Math.floor(x * JITTER_GRID), Math.floor(y * JITTER_GRID) + 7) -
      0.5) *
      TYPE_JITTER -
    0.5;
  const jy =
    y +
    (hash2(Math.floor(x * JITTER_GRID) + 3, Math.floor(y * JITTER_GRID)) -
      0.5) *
      TYPE_JITTER -
    0.5;
  const i = Math.floor(jx);
  const j = Math.floor(jy);
  const size = look.t.size;
  const cell = look.cell;
  cell.a = tileIndex(size, i + 0.5, j + 0.5);
  cell.b = tileIndex(size, i + 1.5, j + 0.5);
  cell.c = tileIndex(size, i + 0.5, j + 1.5);
  cell.d = tileIndex(size, i + 1.5, j + 1.5);
  cell.fx = jx - i;
  cell.fy = jy - j;
  return cell;
}

// Warm sand with slow deep and light patches over open desert. Patch noise near 0.5 leaves the sand as it is.
// Both mixes run per channel with one rounding, since most of the map is desert and this runs per pixel.
function desertSand(look: TileLook, color: number, weight: number, x: number, y: number): number {
  if (weight === 0) return color;
  const warm = weight * SAND_WARM;
  const n = look.patch.at(x / PATCH_TILES + PATCH_OFFSET, y / PATCH_TILES + PATCH_OFFSET);
  const patch = n < 0.5 ? PAL.sandShade : PAL.sandLight;
  const k = Math.abs(n - 0.5) * 2 * PATCH_MIX * weight;
  return (
    (sandChannel(color >> 16, PAL.desertSand >> 16, patch >> 16, warm, k) << 16) |
    (sandChannel(color >> 8, PAL.desertSand >> 8, patch >> 8, warm, k) << 8) |
    sandChannel(color, PAL.desertSand, patch, warm, k)
  );
}

// One 8-bit channel of color mixed toward sand by warm, then toward patch by k, rounded once.
function sandChannel(color: number, sand: number, patch: number, warm: number, k: number): number {
  const c = color & 0xff;
  const warmed = c + ((sand & 0xff) - c) * warm;
  return (warmed + ((patch & 0xff) - warmed) * k + 0.5) | 0;
}

// Road tiles paint as hardpan, since the ground shader draws the road over it with its own edge.
function paintColor(type: TerrainTypeId): number {
  return TERRAIN_TYPES[type === "road" ? "hardpan" : type].color;
}

function groundColor(look: TileLook, x: number, y: number): number {
  const t = look.t;
  const cell = jittered(look, x, y);
  const weight = desertAt(look, cell);
  const calm = 1 - weight * DESERT_CALM;
  const n = look.broad.at(x / 7, y / 7) * 0.7 + look.fine.at(x / 2.5, y / 2.5) * 0.3 * calm;
  let color = mix(typeColor(look, cell), PAL.sand[3], n * 0.2);
  color = desertSand(look, color, weight, x, y);
  const speckle = 1 + (hash2(Math.floor(x * 3), Math.floor(y * 3)) * 0.05 - 0.03) * calm;
  color = shade(color, speckle * look.shade[tileIndex(t.size, x, y)]);
  const out = Math.max(-x, -y, x - t.size, y - t.size, 0);
  if (out > 0)
    color = mix(color, PAL.sandFar, Math.min(1, 0.35 + out / TERRAIN_MARGIN));
  return color;
}

function paintGround(
  c: PaintCanvas,
  t: Terrain,
  hillshadeStrength: number,
): void {
  const look = tileLook(t, hillshadeStrength);
  const img = c.ctx.createImageData(c.size, c.size);
  const data = img.data;
  for (let py = 0; py < c.size; py++) {
    for (let px = 0; px < c.size; px++) {
      const color = groundColor(
        look,
        c.from + (px + 0.5) / c.res,
        c.from + (py + 0.5) / c.res,
      );
      const i = (py * c.size + px) * 4;
      data[i] = (color >> 16) & 0xff;
      data[i + 1] = (color >> 8) & 0xff;
      data[i + 2] = color & 0xff;
      data[i + 3] = 255;
    }
  }
  c.ctx.putImageData(img, 0, 0);
}

function css(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},${alpha})`;
}

// A polyline stroke in map units, shifted sideways by offset tiles along each segment's normal.
function stroke(
  c: PaintCanvas,
  line: Vec[],
  width: number,
  style: string,
  offset: number,
): void {
  const ctx = c.ctx;
  ctx.strokeStyle = style;
  ctx.lineWidth = width * c.res;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (-(b.y - a.y) / len) * offset;
    const ny = ((b.x - a.x) / len) * offset;
    if (i === 0) ctx.moveTo(c.toPx(a.x + nx), c.toPx(a.y + ny));
    ctx.lineTo(c.toPx(b.x + nx), c.toPx(b.y + ny));
  }
  ctx.stroke();
}

// A filled closed polygon in map units.
function polygon(c: PaintCanvas, points: readonly Vec[], style: string): void {
  c.ctx.fillStyle = style;
  c.ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? c.ctx.moveTo(c.toPx(p.x), c.toPx(p.y)) : c.ctx.lineTo(c.toPx(p.x), c.toPx(p.y))));
  c.ctx.closePath();
  c.ctx.fill();
}
