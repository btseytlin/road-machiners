import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TERRAIN } from '../data/terrain';
import { TERRITORIES } from '../data/territory';
import { basin } from '../sim/elevation';
import { pointInPolygon, polylineDist, type Vec } from '../sim/vec';
import { TEST_MAP } from '../test/map';
import { groundDiscs, paintGroundCanvas, TERRAIN_MARGIN, type PaintCanvas } from './groundPaint';

const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const sunBasin = TERRAIN.features.basins.find((b) => b.center.x === sun.pos.x && b.center.y === sun.pos.y)!;

describe('ground discs', () => {
  it('paints no disc under the outlined Fallen Sun and Old Orchard', () => {
    const ids = groundDiscs().map((d) => d.id);
    expect(ids).not.toContain('fallen-sun');
    expect(ids).not.toContain('orchard');
  });
});

// A path the painter filled or stroked, in canvas pixels.
type Shape = { kind: 'arc'; x: number; y: number; r: number } | { kind: 'poly'; points: Vec[] };
type Op = { kind: 'image' } | { kind: 'fill'; shapes: Shape[] } | { kind: 'stroke'; shapes: Shape[]; width: number };

// The part of a 2D context the ground painter uses. It keeps each fill and stroke as geometry, so a test can ask
// which paint lands on a point. Node has no canvas, and the painted pixels follow from that geometry.
class RecordingContext {
  ops: Op[] = [];
  fillStyle: unknown = null;
  strokeStyle: unknown = null;
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  private path: Shape[] = [];
  private open: Vec[] | null = null;

  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData() {
    this.ops.push({ kind: 'image' });
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
  createLinearGradient() {
    return { addColorStop() {} };
  }
  beginPath() {
    this.path = [];
    this.open = null;
  }
  moveTo(x: number, y: number) {
    this.open = [{ x, y }];
    this.path.push({ kind: 'poly', points: this.open });
  }
  lineTo(x: number, y: number) {
    if (!this.open) this.moveTo(x, y);
    else this.open.push({ x, y });
  }
  closePath() {
    this.open = null;
  }
  arc(x: number, y: number, r: number) {
    this.path.push({ kind: 'arc', x, y, r });
    this.open = null;
  }
  fill() {
    this.ops.push({ kind: 'fill', shapes: [...this.path] });
  }
  stroke() {
    this.ops.push({ kind: 'stroke', shapes: [...this.path], width: this.lineWidth });
  }
}

function covers(op: Op, p: Vec): boolean {
  if (op.kind === 'image') return true;
  return op.shapes.some((s) => {
    if (s.kind === 'arc') return Math.hypot(p.x - s.x, p.y - s.y) <= (op.kind === 'stroke' ? s.r + op.width / 2 : s.r);
    if (op.kind === 'stroke') return polylineDist(p, s.points) <= op.width / 2;
    return pointInPolygon(p, s.points);
  });
}

// The whole map painted at half a pixel per tile, with its ops recorded.
function paintedMap(): { canvas: PaintCanvas; ops: Op[] } {
  const res = 0.5;
  const from = -TERRAIN_MARGIN;
  const ctx = new RecordingContext();
  const canvas: PaintCanvas = {
    // The recorder covers every call the painter makes; the painter never reads anything else off the context.
    ctx: ctx as unknown as CanvasRenderingContext2D,
    size: Math.ceil((TEST_MAP.terrain.size + 2 * TERRAIN_MARGIN) * res),
    res,
    from,
    toPx: (tiles) => (tiles - from) * res,
  };
  paintGroundCanvas(canvas, TEST_MAP.terrain);
  return { canvas, ops: ctx.ops };
}

// Paint laid over the ground image at a map point, in paint order.
function paintOver(painted: { canvas: PaintCanvas; ops: Op[] }, p: Vec): Op[] {
  const px = { x: painted.canvas.toPx(p.x), y: painted.canvas.toPx(p.y) };
  const image = painted.ops.findIndex((op) => op.kind === 'image');
  return painted.ops.slice(image + 1).filter((op) => covers(op, px));
}

describe('ground paint over the Fallen Sun', () => {
  const painted = paintedMap();

  it('paints the ground image first', () => {
    expect(painted.ops[0]).toEqual({ kind: 'image' });
  });

  it('centres no disc on a basin', () => {
    const centres = painted.ops.flatMap((op) => (op.kind === 'image' ? [] : op.shapes.flatMap((s) => (s.kind === 'arc' ? [s] : []))));
    expect(centres.length).toBeGreaterThan(0);
    for (const b of TERRAIN.features.basins) {
      const at = { x: painted.canvas.toPx(b.center.x), y: painted.canvas.toPx(b.center.y) };
      for (const c of centres) expect(Math.hypot(c.x - at.x, c.y - at.y)).toBeGreaterThan(painted.canvas.res);
      for (const crater of TERRAIN.features.craters) expect(crater.center).not.toEqual(b.center);
    }
  });

  it('leaves the basin floor as bare as the wasteland around it', () => {
    let floor = 0;
    for (let y = -50; y <= 50; y += 3) for (let x = -50; x <= 50; x += 3) {
      const p = { x: sunBasin.center.x + x, y: sunBasin.center.y + y };
      if (basin(sunBasin, p.x, p.y).cut !== sunBasin.depth) continue;
      floor++;
      expect(paintOver(painted, p), `${x},${y}`).toEqual([]);
    }
    expect(floor).toBeGreaterThan(500);
  });

  it('paints scree on the foot of the bank of the west arc only', () => {
    const scree = TERRITORIES['fallen-sun'].wreck!.scree!;
    // `up` tiles up the bank, out from a floor vertex along its bearing.
    const onBank = (k: number, up = 3) => {
      const v = sunBasin.floor[k];
      const r = Math.hypot(v.x, v.y);
      const out = (r + up) / r;
      return { x: sunBasin.center.x + v.x * out, y: sunBasin.center.y + v.y * out };
    };
    const n = sunBasin.floor.length;
    // The vertices strictly between the arc's two ends, which wraps past vertex 0.
    const arc = Array.from({ length: (scree.to - scree.from + n) % n - 1 }, (_, i) => (scree.from + 1 + i) % n);
    expect(arc).toEqual([21, 0, 1]);
    for (const k of arc) expect(paintOver(painted, onBank(k)).length, `vertex ${k}`).toBeGreaterThan(0);
    for (const k of [6, 12, 17]) expect(paintOver(painted, onBank(k)), `vertex ${k}`).toEqual([]);
    // The west road's long bank is a road grade: no scree halfway up it.
    expect(sunBasin.bank[21]).toBeGreaterThan(20);
    expect(paintOver(painted, onBank(21, sunBasin.bank[21] / 2))).toEqual([]);
  });

  it("keeps the Bowl's scorched crater floor", () => {
    const bowl = TERRAIN.features.craters[0];
    expect(paintOver(painted, bowl.center).length).toBeGreaterThanOrEqual(2);
  });
});
