// Map-space ground painter: tile type colors and hillshade. The ground shader draws roads over it, see render/roadPaint.ts. Pebbles and scrub are 3D, in
// three/render/scatter.ts. The 3D terrain (three/render/terrain.ts) uses it as its texture.

import { REGION } from "../data/region";
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from "../data/terrain";
import { TERRITORIES } from "../data/territory";
import { groundSlope, type Terrain } from "../sim/terrain";
import { type Vec } from "../sim/vec";
import { hash2 } from "./noise";
import { PAL, mix, shade } from "./palette";

export const TERRAIN_MARGIN = 10; // tiles of dim ground drawn past the map edge
const TYPE_JITTER = 0.6; // tiles; jittered sampling frays the blend between tile types
const JITTER_GRID = 6; // samples per tile for the type-jitter hash, independent of paint resolution

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

// Discs of worn ground painted under locations, in paint order. A location with an outline gets none: its edge is
// not a circle, and its own marks show its ground.
export function groundDiscs(): { id: string; pos: Vec; radius: number; style: string }[] {
  return REGION.locations
    .filter((l) => !("outline" in l && l.outline))
    .flatMap((l) => {
      const farm = l.id === "granary";
      const wear = css(l.kind === "oasis" || farm ? shade(PAL.scrub[0], 1.1) : shade(PAL.rust.dark, 1.6), 0.45);
      return [
        ...(farm ? [{ id: l.id, pos: l.pos, radius: l.radius + 3, style: css(PAL.scrub[0], 0.2) }] : []),
        { id: l.id, pos: l.pos, radius: l.radius + 0.5, style: wear },
      ];
    });
}

// Paints ground, oasis/convoy discs and terrain features onto the canvas. The caller uploads the texture.
export function paintGroundCanvas(
  c: PaintCanvas,
  t: Terrain,
  opts: PaintOptions = DEFAULT_OPTIONS,
): void {
  paintGround(c, t, opts.hillshade);
  for (const d of groundDiscs()) disc(c, d.pos, d.radius, d.style);
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
  paintCraters(c);
  paintScree(c);
}

// Each crater's bank is rust-tinted. A territory's crater floor is warm open sand, as in the Fallen Sun's level
// concept; other floors are scorched.
function paintCraters(c: PaintCanvas): void {
  for (const crater of TERRAIN.features.craters) {
    disc(c, crater.center, crater.radius + crater.bank, css(PAL.rust.side, 0.18));
    disc(c, crater.center, crater.radius, holdsTerritory(crater.center) ? css(PAL.craterSand, 0.6) : css(PAL.rust.dark, 0.25));
  }
}

// A territory's scree slope, red-brown over the sand.
function paintScree(c: PaintCanvas): void {
  for (const t of REGION.locations.filter((l) => l.kind === "territory")) {
    const scree = TERRITORIES[t.id].wreck?.scree;
    if (scree) fadedDisc(c, { x: t.pos.x + scree.at.x, y: t.pos.y + scree.at.y }, scree.radius, PAL.scree, 0.95);
  }
}

// A disc that holds its color to half its radius and fades out to the edge, so it reads as a slope, not a stain.
function fadedDisc(c: PaintCanvas, p: Vec, r: number, color: number, alpha: number): void {
  const [x, y] = [c.toPx(p.x), c.toPx(p.y)];
  const fill = c.ctx.createRadialGradient(x, y, 0, x, y, r * c.res);
  fill.addColorStop(0.5, css(color, alpha));
  fill.addColorStop(1, css(color, 0));
  blob(c, p, r, fill);
}

function holdsTerritory(centre: Vec): boolean {
  return REGION.locations.some((l) => l.kind === "territory" && Math.hypot(l.pos.x - centre.x, l.pos.y - centre.y) < 1);
}

// Per-tile inputs of the ground color, computed once per paint instead of once per pixel.
type TileLook = { t: Terrain; color: Int32Array; shade: Float64Array; broad: CellNoise; fine: CellNoise };

function tileLook(t: Terrain, hillshadeStrength: number): TileLook {
  const count = t.size * t.size;
  const color = new Int32Array(count);
  const shadeBy = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    color[i] = paintColor(t.types[i]);
    shadeBy[i] = hillshade(t, i, hillshadeStrength);
  }
  return { t, color, shade: shadeBy, broad: new CellNoise(), fine: new CellNoise() };
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
function typeColor(look: TileLook, x: number, y: number): number {
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
  const a = look.color[tileIndex(size, i + 0.5, j + 0.5)];
  const b = look.color[tileIndex(size, i + 1.5, j + 0.5)];
  const c = look.color[tileIndex(size, i + 0.5, j + 1.5)];
  const d = look.color[tileIndex(size, i + 1.5, j + 1.5)];
  // Inside one type all four match, and blending equal colors returns the color.
  if (a === b && a === c && a === d) return a;
  const fx = jx - i;
  const fy = jy - j;
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

// Road tiles paint as hardpan, since the ground shader draws the road over it with its own edge.
function paintColor(type: TerrainTypeId): number {
  return TERRAIN_TYPES[type === "road" ? "hardpan" : type].color;
}

function groundColor(look: TileLook, x: number, y: number): number {
  const t = look.t;
  const n = look.broad.at(x / 7, y / 7) * 0.7 + look.fine.at(x / 2.5, y / 2.5) * 0.3;
  let color = mix(typeColor(look, x, y), PAL.sand[3], n * 0.2);
  color = shade(
    color,
    (0.97 + hash2(Math.floor(x * 3), Math.floor(y * 3)) * 0.05) *
      look.shade[tileIndex(t.size, x, y)],
  );
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

function disc(c: PaintCanvas, p: Vec, r: number, style: string): void {
  blob(c, p, r, style);
}

function blob(c: PaintCanvas, p: Vec, r: number, style: string | CanvasGradient): void {
  c.ctx.fillStyle = style;
  c.ctx.beginPath();
  c.ctx.arc(c.toPx(p.x), c.toPx(p.y), r * c.res, 0, Math.PI * 2);
  c.ctx.fill();
}
