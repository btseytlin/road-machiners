// Road look for the ground shader. The mask marks where region roads (red) and territory dirt roads (green) lie on
// the map. The detail is a small tiling image of packed dirt with gravel, cracked patches and potholes, drawn in
// pixels a third the size of the ground paint pixels. The tone is slow noise that varies the road and wanders its
// edge, with a period far from the detail's, so the detail never repeats in the same light.

import { REGION, type TerritoryDef } from "../data/region";
import { TERRITORIES, type FarmRoad, type WreckRules } from "../data/territory";
import { bridgeCut, deckAt } from "../sim/bridge";
import { isTerritory, siteGap } from "../sim/sites";
import { territoryRoads } from "../sim/territory";
import { dist, type Vec } from "../sim/vec";
import type { PaintCanvas } from "./groundPaint";
import { hash2 } from "./noise";
import { PAL, mix, shade } from "./palette";

export const ROAD_DETAIL_SIDE = 256; // detail pixels per side of the tiling image
export const ROAD_TONE_SIDE = 64; // tone pixels per side of its tiling image
export const ROAD_TONE_PIXELS = 12; // detail pixels per tone pixel
const SITES = [...REGION.towns, ...REGION.locations];
// Each territory with a wreck, paired with its wreck's rules.
const WRECKS: { territory: TerritoryDef; wreck: WreckRules }[] = REGION.locations.filter(isTerritory).flatMap((territory) => {
  const wreck = TERRITORIES[territory.id].wreck;
  return wreck === null ? [] : [{ territory, wreck }];
});
const WIDTH = REGION.roadWidth * 0.9; // tiles across the painted road, before its edge wanders
const BLUR = 2.4; // tiles of mask blur, so the tone can move the edge
// Tiles of blur on each dirt road stroke. Dirt roads are narrower than BLUR, which would spread one into a wide soft
// band that never reaches half strength, so their strokes take their own blur after the region roads' one.
const DIRT_BLUR = 0.8;
const STEP = 0.5; // tiles between points of a road line
const CRACK_CELL = 16; // detail pixels between crack polygon centers
const POTHOLES = 4; // potholes in one detail image
const STONE_SHARE = 0.012; // share of detail pixels that are loose stones

export type RoadImage = { side: number; pixels: Uint8ClampedArray };

// The mask's channels: red for region roads, green for the dirt roads of every wreck territory. Each channel is the
// stroked road on black, so the shader can tell a region road from a dirt road where they meet.
export const REGION_ROAD_STYLE = "#f00";
export const DIRT_ROAD_STYLE = "#0f0";

// Strokes every road on black and blurs it. Region roads stop at site edges, where pads take over, and at Canyon
// Bridge, whose deck is its own model. Dirt roads run inside their territory and stop at decks too. The lighten mode
// keeps the larger value of each channel, so the two channels never paint over each other.
export function paintRoadMask(c: PaintCanvas): void {
  const ctx = c.ctx;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.size, c.size);
  ctx.lineJoin = "round";
  ctx.strokeStyle = REGION_ROAD_STYLE;
  strokeRuns(c, REGION.roads.flatMap((road) => runsWhere(evenPoints(road), drawn)), WIDTH);
  // One blur over the region roads. The copy mode replaces the canvas with its own blurred image.
  ctx.filter = `blur(${BLUR * c.res}px)`;
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(ctx.canvas, 0, 0);
  // The dirt roads, each stroke blurred as it is drawn.
  ctx.filter = `blur(${DIRT_BLUR * c.res}px)`;
  ctx.globalCompositeOperation = "lighten";
  ctx.strokeStyle = DIRT_ROAD_STYLE;
  for (const { territory, wreck } of WRECKS) {
    const { roads, spurs } = territoryRoads(territory);
    const fade = wreck.spurFade;
    for (const road of roads) strokeRuns(c, runsWhere(evenPoints(road.points), offDeck), road.width * 0.9);
    for (const spur of spurs) strokeSpur(c, spur, fade);
  }
  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
}

// Strokes the runs as one path at full strength, `width` tiles across.
function strokeRuns(c: PaintCanvas, runs: Vec[][], width: number): void {
  const ctx = c.ctx;
  ctx.globalAlpha = 1;
  ctx.lineWidth = width * c.res;
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (const run of runs) run.forEach((p, i) => (i === 0 ? ctx.moveTo(c.toPx(p.x), c.toPx(p.y)) : ctx.lineTo(c.toPx(p.x), c.toPx(p.y))));
  ctx.stroke();
}

// A spur at full strength up to its last `fade` tiles, then step by step narrower and fainter, to nothing at its end.
// Each fading step takes the width and strength at its far end, so the last step lays no paint.
function strokeSpur(c: PaintCanvas, spur: FarmRoad, fade: number): void {
  const points = evenPoints(spur.points);
  const left = tilesToEnd(points);
  const width = spur.width * 0.9;
  strokeRuns(c, runsWhere(points.filter((_, i) => left[i] >= fade), offDeck), width);
  const ctx = c.ctx;
  ctx.lineCap = "round";
  for (let i = 1; i < points.length; i++) {
    const k = left[i] / fade;
    if (k >= 1 || k <= 0 || !offDeck(points[i - 1]) || !offDeck(points[i])) continue;
    ctx.globalAlpha = k;
    ctx.lineWidth = width * k * c.res;
    ctx.beginPath();
    ctx.moveTo(c.toPx(points[i - 1].x), c.toPx(points[i - 1].y));
    ctx.lineTo(c.toPx(points[i].x), c.toPx(points[i].y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Tiles along the line from each point to its last point.
function tilesToEnd(points: readonly Vec[]): number[] {
  const out = new Array<number>(points.length).fill(0);
  for (let i = points.length - 2; i >= 0; i--) out[i] = out[i + 1] + dist(points[i], points[i + 1]);
  return out;
}

// Stretches of points that pass `keep`.
function runsWhere(points: Vec[], keep: (p: Vec) => boolean): Vec[][] {
  const runs: Vec[][] = [[]];
  for (const p of points) {
    if (keep(p)) runs[runs.length - 1].push(p);
    else runs.push([]);
  }
  return runs.filter((run) => run.length > 1);
}

function offDeck(p: Vec): boolean {
  return deckAt(p.x, p.y) === null;
}

// Region roads show off sites and off the decks.
function drawn(p: Vec): boolean {
  if (!offDeck(p) || bridgeCut(p.x, p.y) > 0) return false;
  return !SITES.some((site) => siteGap(site, p) < 0);
}

// Points every STEP tiles along a road from its start, and its end.
function evenPoints(road: readonly Vec[]): Vec[] {
  const out: Vec[] = [road[0]];
  let carry = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const d = dist(a, b);
    for (let s = STEP - carry; s <= d; s += STEP) out.push({ x: a.x + ((b.x - a.x) * s) / d, y: a.y + ((b.y - a.y) * s) / d });
    carry = (carry + d) % STEP;
  }
  if (dist(out[out.length - 1], road[road.length - 1]) > 1e-6) out.push(road[road.length - 1]);
  return out;
}

// RGB is the road color in sRGB. Alpha is a per-pixel dither the shader uses to fray edges.
export function paintRoadDetail(): RoadImage {
  const side = ROAD_DETAIL_SIDE;
  const pixels = new Uint8ClampedArray(side * side * 4);
  const cracks = crackCenters();
  const holes = potholes();
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const color = detailColor(x, y, cracks, holes);
      const i = (y * side + x) * 4;
      pixels[i] = (color >> 16) & 0xff;
      pixels[i + 1] = (color >> 8) & 0xff;
      pixels[i + 2] = color & 0xff;
      pixels[i + 3] = Math.floor(hash2(x + 911, y + 373) * 256);
    }
  return { side, pixels };
}

type Pothole = { x: number; y: number; r: number };

function detailColor(x: number, y: number, cracks: Vec[], holes: Pothole[]): number {
  const mottle = 0.94 + 0.08 * loopNoise(x / 16, y / 16, ROAD_DETAIL_SIDE / 16) + 0.04 * loopNoise(x / 8, y / 8, ROAD_DETAIL_SIDE / 8);
  let color = shade(PAL.road, mottle * (0.975 + 0.05 * hash2(x, y)));
  if (loopNoise(x / 32, y / 32, ROAD_DETAIL_SIDE / 32) > 0.64) color = mix(color, PAL.sand[3], 0.15);
  if (cracked(x, y, cracks)) color = mix(color, PAL.roadCrack, 0.55);
  color = potholeColor(x, y, holes) ?? color;
  return stoneColor(x, y) ?? color;
}

// Crack lines run where two crack polygons meet, only in cracked patches of the road.
function cracked(x: number, y: number, centers: Vec[]): boolean {
  if (loopNoise(x / 32 + 3, y / 32 + 5, ROAD_DETAIL_SIDE / 32) < 0.62 || hash2(x + 61, y + 67) < 0.25) return false;
  const cells = ROAD_DETAIL_SIDE / CRACK_CELL;
  const ci = Math.floor(x / CRACK_CELL);
  const cj = Math.floor(y / CRACK_CELL);
  const near: number[] = [];
  for (let j = cj - 1; j <= cj + 1; j++)
    for (let i = ci - 1; i <= ci + 1; i++) {
      const c = centers[wrap(j, cells) * cells + wrap(i, cells)];
      near.push(wrappedDist(x + 0.5, y + 0.5, c.x, c.y));
    }
  near.sort((a, b) => a - b);
  return near[1] - near[0] < 0.9;
}

function crackCenters(): Vec[] {
  const cells = ROAD_DETAIL_SIDE / CRACK_CELL;
  const out: Vec[] = [];
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) out.push({ x: (i + 0.15 + 0.7 * hash2(i, j + 51)) * CRACK_CELL, y: (j + 0.15 + 0.7 * hash2(i + 83, j)) * CRACK_CELL });
  return out;
}

function potholes(): Pothole[] {
  return Array.from({ length: POTHOLES }, (_, k) => ({ x: hash2(k, 401) * ROAD_DETAIL_SIDE, y: hash2(k, 402) * ROAD_DETAIL_SIDE, r: 2 + 2 * hash2(k, 403) }));
}

// A dark hollow with a pale lip on its far side, where the low sun catches the broken edge.
function potholeColor(x: number, y: number, holes: Pothole[]): number | null {
  for (const h of holes) {
    const d = wrappedDist(x + 0.5, y + 0.5, h.x, h.y);
    if (d < h.r) return shade(PAL.roadCrack, 0.92);
    if (d < h.r + 1 && y + 0.5 > h.y) return mix(PAL.road, PAL.sand[3], 0.3);
  }
  return null;
}

function stoneColor(x: number, y: number): number | null {
  if (hash2(x + 17, y + 29) >= STONE_SHARE) return null;
  return mix(PAL.road, hash2(x + 5, y + 3) < 0.5 ? PAL.sand[3] : PAL.rock.side, 0.5);
}

// Slow noise in R for tone and edge wander. It tiles, so the shader repeats it far apart.
export function paintRoadTone(): RoadImage {
  const side = ROAD_TONE_SIDE;
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const i = (y * side + x) * 4;
      pixels[i] = Math.floor(255 * (0.65 * loopNoise(x / 8, y / 8, side / 8) + 0.35 * loopNoise(x / 4, y / 4, side / 4)));
      pixels[i + 3] = 255;
    }
  return { side, pixels };
}

// Smooth value noise in [0, 1] that repeats every `period` lattice cells.
function loopNoise(x: number, y: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const at = (i: number, j: number) => hash2(wrap(i, period), wrap(j, period));
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function wrap(i: number, period: number): number {
  return ((i % period) + period) % period;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrappedDist(ax: number, ay: number, bx: number, by: number): number {
  const side = ROAD_DETAIL_SIDE;
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.hypot(Math.min(dx, side - dx), Math.min(dy, side - dy));
}
