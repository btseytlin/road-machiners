import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRITORIES } from '../data/territory';
import { deckAt } from '../sim/bridge';
import { siteGap } from '../sim/sites';
import { isTerritory, territoryRoads } from '../sim/territory';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { TERRAIN_MARGIN, type PaintCanvas } from './groundPaint';
import { BLUR_REACH, DIRT_ROAD_STYLE, paintRoadMask, REGION_ROAD_STYLE } from './roadPaint';

const sun = REGION.locations.filter(isTerritory).find((l) => l.id === 'fallen-sun')!;
const SPUR_FADE = TERRITORIES['fallen-sun'].wreck!.spurFade;

type Clip = { x: number; y: number; w: number; h: number };
type Stroke = { style: unknown; alpha: number; width: number; lines: Vec[][]; filter: string; clip: Clip | null };

class RecordingContext {
  strokes: Stroke[] = [];
  fillStyle: unknown = null;
  strokeStyle: unknown = null;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  filter = 'none';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  canvas = {};
  clips: (Clip | null)[] = [];
  private lines: Vec[][] = [];
  private pending: Clip | null = null;
  private saved: { filter: string; globalAlpha: number; lineCap: string }[] = [];

  fillRect() {}
  drawImage() {}
  save() {
    this.saved.push({ filter: this.filter, globalAlpha: this.globalAlpha, lineCap: this.lineCap });
  }
  restore() {
    Object.assign(this, this.saved.pop());
    this.clips.pop();
  }
  rect(x: number, y: number, w: number, h: number) {
    this.pending = { x, y, w, h };
  }
  clip() {
    this.clips.push(this.pending);
  }
  beginPath() {
    this.lines = [];
  }
  moveTo(x: number, y: number) {
    this.lines.push([{ x, y }]);
  }
  lineTo(x: number, y: number) {
    this.lines[this.lines.length - 1].push({ x, y });
  }
  stroke() {
    this.strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, lines: this.lines.map((l) => [...l]), filter: this.filter, clip: this.clips[this.clips.length - 1] ?? null });
  }
}

function paintedMask(): { canvas: PaintCanvas; strokes: Stroke[]; ctx: RecordingContext } {
  const res = 2;
  const from = -TERRAIN_MARGIN;
  const ctx = new RecordingContext();
  const canvas: PaintCanvas = {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    size: 64,
    res,
    from,
    toPx: (tiles) => (tiles - from) * res,
  };
  paintRoadMask(canvas);
  return { canvas, strokes: ctx.strokes, ctx };
}

function channelAt(mask: { canvas: PaintCanvas; strokes: Stroke[] }, style: string, p: Vec): number {
  const px = { x: mask.canvas.toPx(p.x), y: mask.canvas.toPx(p.y) };
  let most = 0;
  for (const s of mask.strokes) {
    if (s.style !== style) continue;
    if (s.lines.some((line) => line.length > 1 && polylineDist(px, line) <= s.width / 2)) most = Math.max(most, s.alpha);
  }
  return most;
}

function backFromEnd(line: readonly Vec[], d: number): Vec {
  let left = d;
  for (let i = line.length - 1; i > 0; i--) {
    const [a, b] = [line[i - 1], line[i]];
    const len = dist(a, b);
    if (left <= len) return { x: b.x + ((a.x - b.x) * left) / len, y: b.y + ((a.y - b.y) * left) / len };
    left -= len;
  }
  throw new Error(`Line is shorter than ${d} tiles`);
}

describe('road mask', () => {
  const mask = paintedMask();
  const { roads, spurs } = territoryRoads(sun);
  const RED = REGION_ROAD_STYLE;
  const GREEN = DIRT_ROAD_STYLE;

  it('paints a Fallen Sun dirt road green, not red', () => {
    const road = roads.find((r) => r.points.length > 1 && deckAt((r.points[0].x + r.points[1].x) / 2, (r.points[0].y + r.points[1].y) / 2) === null)!;
    const p = { x: (road.points[0].x + road.points[1].x) / 2, y: (road.points[0].y + road.points[1].y) / 2 };
    expect(channelAt(mask, GREEN, p)).toBe(1);
    expect(channelAt(mask, RED, p)).toBe(0);
  });

  it('paints every spur green at full strength before its fade', () => {
    for (const spur of spurs) expect(channelAt(mask, GREEN, backFromEnd(spur.points, SPUR_FADE + 1))).toBe(1);
  });

  it('fades each spur to nothing over its last tiles', () => {
    for (const spur of spurs) {
      const near = channelAt(mask, GREEN, backFromEnd(spur.points, 1));
      const mid = channelAt(mask, GREEN, backFromEnd(spur.points, 3));
      expect(channelAt(mask, GREEN, spur.points[spur.points.length - 1])).toBe(0);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThan(mid);
      expect(mid).toBeLessThan(1);
    }
  });

  it('paints no green off the dirt roads', () => {
    const lines = [...roads, ...spurs];
    let checked = 0;
    for (let y = -60; y <= 60; y += 4)
      for (let x = -60; x <= 60; x += 4) {
        const p = { x: sun.pos.x + x, y: sun.pos.y + y };
        if (lines.some((r) => polylineDist(p, r.points) < r.width + 1)) continue;
        checked++;
        expect(channelAt(mask, GREEN, p), `${x},${y}`).toBe(0);
      }
    expect(checked).toBeGreaterThan(300);
  });

  it('keeps the region roads red', () => {
    const road = REGION.roads[0];
    const p = road
      .slice(1)
      .map((b, i) => ({ x: (road[i].x + b.x) / 2, y: (road[i].y + b.y) / 2 }))
      .find((m) => deckAt(m.x, m.y) === null && [...REGION.towns, ...REGION.locations].every((s) => siteGap(s, m) > 2))!;
    expect(channelAt(mask, RED, p)).toBe(1);
    expect(channelAt(mask, GREEN, p)).toBe(0);
  });

  it('clips every blurred stroke to its bounds plus the blur reach on whole pixels', () => {
    const blurred = mask.strokes.filter((s) => s.filter !== 'none');
    expect(blurred.length).toBeGreaterThan(20);
    for (const s of blurred) {
      const sigma = Number(/blur\(([\d.]+)px\)/.exec(s.filter)![1]);
      const reach = s.width / 2 + BLUR_REACH * sigma;
      const pts = s.lines.flat();
      const c = s.clip!;
      expect(c).not.toBeNull();
      for (const edge of [c.x, c.y, c.w, c.h]) expect(Number.isInteger(edge)).toBe(true);
      expect(c.x).toBeLessThanOrEqual(Math.min(...pts.map((p) => p.x)) - reach);
      expect(c.y).toBeLessThanOrEqual(Math.min(...pts.map((p) => p.y)) - reach);
      expect(c.x + c.w).toBeGreaterThanOrEqual(Math.max(...pts.map((p) => p.x)) + reach);
      expect(c.y + c.h).toBeGreaterThanOrEqual(Math.max(...pts.map((p) => p.y)) + reach);
    }
  });

  it('strokes the region roads without a clip or filter', () => {
    const red = mask.strokes.filter((s) => s.style === REGION_ROAD_STYLE);
    expect(red.length).toBeGreaterThan(0);
    for (const s of red) {
      expect(s.clip).toBeNull();
      expect(s.filter).toBe('none');
    }
  });

  it('leaves the canvas state as it found it', () => {
    expect(mask.ctx.clips).toEqual([]);
    expect(mask.ctx.filter).toBe('none');
    expect(mask.ctx.globalCompositeOperation).toBe('source-over');
    expect(mask.ctx.globalAlpha).toBe(1);
  });
});
