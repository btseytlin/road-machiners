// Map-space ground painter: tile type colors and hillshade. The ground shader draws roads over it, see render/roadPaint.ts. Pebbles and scrub are 3D, in
// three/render/scatter.ts. The 3D terrain (three/render/terrain.ts) uses it as its texture.

import { REGION } from "../data/region";
import { TERRAIN, TERRAIN_TYPES, type TerrainTypeId } from "../data/terrain";
import { groundSlope, type Terrain } from "../sim/terrain";
import { type Vec } from "../sim/vec";
import { hash2 } from "./noise";
import { PAL, mix, shade } from "./palette";

export const TERRAIN_MARGIN = 10;
const TYPE_JITTER = 0.6;
const JITTER_GRID = 6;

export type PaintCanvas = {
  ctx: CanvasRenderingContext2D;
  size: number;
  res: number;
  from: number;
  toPx: (tiles: number) => number;
};

export type PaintOptions = {
  hillshade: number;
};

const DEFAULT_OPTIONS: PaintOptions = { hillshade: 1 };

export function paintGroundCanvas(
  c: PaintCanvas,
  t: Terrain,
  opts: PaintOptions = DEFAULT_OPTIONS,
): void {
  paintGround(c, t, opts.hillshade);
  for (const l of REGION.locations) {
    const farm = l.id === "orchard" || l.id === "granary";
    if (farm) disc(c, l.pos, l.radius + 3, css(PAL.scrub[0], 0.2));
    disc(
      c,
      l.pos,
      l.radius + 0.5,
      css(
        l.kind === "oasis" || farm
          ? shade(PAL.scrub[0], 1.1)
          : shade(PAL.rust.dark, 1.6),
        0.45,
      ),
    );
  }
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
  for (const crater of TERRAIN.features.craters) {
    disc(
      c,
      crater.center,
      crater.radius + crater.bank,
      css(PAL.rust.side, 0.18),
    );
    disc(c, crater.center, crater.radius, css(PAL.rust.dark, 0.25));
  }
}

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

function hillshade(t: Terrain, tile: number, strength: number): number {
  const s = groundSlope(t, tile);
  return (
    1 +
    (s.x * TERRAIN.light.x + s.y * TERRAIN.light.y) *
      TERRAIN.slopeShade *
      strength
  );
}

function tileIndex(size: number, x: number, y: number): number {
  const i = Math.min(Math.max(Math.floor(x), 0), size - 1);
  const j = Math.min(Math.max(Math.floor(y), 0), size - 1);
  return j * size + i;
}

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
  if (a === b && a === c && a === d) return a;
  const fx = jx - i;
  const fy = jy - j;
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

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

function blob(c: PaintCanvas, p: Vec, r: number, style: string): void {
  c.ctx.fillStyle = style;
  c.ctx.beginPath();
  c.ctx.arc(c.toPx(p.x), c.toPx(p.y), r * c.res, 0, Math.PI * 2);
  c.ctx.fill();
}
