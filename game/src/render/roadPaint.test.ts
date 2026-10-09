import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRITORIES } from '../data/territory';
import { deckAt } from '../sim/bridge';
import { siteGap } from '../sim/sites';
import { isTerritory, territoryRoads } from '../sim/territory';
import { dist, polylineDist, type Vec } from '../sim/vec';
import { TERRAIN_MARGIN, type PaintCanvas } from './groundPaint';
import { DIRT_ROAD_STYLE, LANE_STYLE, laneLines, paintRoadMask, REGION_ROAD_STYLE } from './roadPaint';
import { highwayAtlas } from '../sim/highway';
import { ICARUS_DECKS } from '../sim/bridge';
import { icarusAtlas, type Atlas } from '../sim/atlas';

const sun = REGION.locations.filter(isTerritory).find((l) => l.id === 'fallen-sun')!;
const SPUR_FADE = TERRITORIES['fallen-sun'].wreck!.spurFade;

type Stroke = { style: unknown; alpha: number; width: number; lines: Vec[][] };

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
  private lines: Vec[][] = [];

  fillRect() {}
  drawImage() {}
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
    this.strokes.push({ style: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth, lines: this.lines.map((l) => [...l]) });
  }
}

function paintedMask(atlas: Atlas = icarusAtlas()): { canvas: PaintCanvas; strokes: Stroke[] } {
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
  paintRoadMask(canvas, atlas);
  return { canvas, strokes: ctx.strokes };
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
    const road = roads.find((r) => r.points.length > 1 && deckAt(ICARUS_DECKS, (r.points[0].x + r.points[1].x) / 2, (r.points[0].y + r.points[1].y) / 2) === null)!;
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
      .find((m) => deckAt(ICARUS_DECKS, m.x, m.y) === null && [...REGION.towns, ...REGION.locations].every((s) => siteGap(s, m) > 2))!;
    expect(channelAt(mask, RED, p)).toBe(1);
    expect(channelAt(mask, GREEN, p)).toBe(0);
  });
});

describe('highway lane paint', () => {
  const highway = highwayAtlas(4, 1);

  it('marks four northbound lanes: solid edges and three dashed dividers, with no middle line', () => {
    const lines = laneLines(highway.roads[0]);

    expect(lines.map((l) => l.offset)).toEqual([-4, 4, -2, 0, 2]);
    expect(lines.map((l) => l.dashed)).toEqual([false, false, true, true, true]);
  });

  it('paints lanes and no dirt road on the highway, and no lanes on Icarus', () => {
    const lanes = paintedMask(highway).strokes;

    expect(lanes.some((s) => s.style === LANE_STYLE && s.lines.length > 0)).toBe(true);
    expect(lanes.filter((s) => s.style === REGION_ROAD_STYLE).every((s) => s.lines.length === 0)).toBe(true);
    expect(paintedMask().strokes.some((s) => s.style === LANE_STYLE)).toBe(false);
  });
});
