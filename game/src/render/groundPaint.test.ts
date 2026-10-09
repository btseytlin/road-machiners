import { defaultSetup } from '../sim/settings';
import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { REGION } from '../data/region';
import { TERRAIN, type TerrainTypeId } from '../data/terrain';
import { TERRITORIES } from '../data/territory';
import { basin } from '../sim/elevation';
import type { Terrain } from '../sim/terrain';
import { pointInPolygon, polylineDist, type Vec } from '../sim/vec';
import { newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import { desertWeight, glassField, lookTypes, paintGroundCanvas, TERRAIN_MARGIN, type LookType, type PaintCanvas } from './groundPaint';
import { ICARUS_KEY } from '../sim/atlas';

const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
const sunBasin = TERRAIN.features.basins.find((b) => b.center.x === sun.pos.x && b.center.y === sun.pos.y)!;

describe('desertWeight', () => {
  it('keeps farmland, old highways, pools and the orchard marks out of the warm sand and its patches', () => {
    const kept: LookType[] = ['field', 'asphalt', 'ash', 'saltCrust', 'mud', 'dirtyWater', 'toxic', 'track', 'canal', 'concrete'];
    for (const type of kept) expect(desertWeight(type), type).toBe(0);
  });
});

function bandMap(): Terrain {
  const size = 12;
  const types: TerrainTypeId[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) types.push(x < 3 ? 'hardpan' : x < 9 ? 'road' : 'saltCrust');
  return { size, heights: new Array<number>((size + 1) ** 2).fill(0), types, atlas: ICARUS_KEY };
}

describe('lookTypes', () => {
  it('gives each half of a road the look of the ground on its side', () => {
    const t = bandMap();
    const look = lookTypes(t);
    expect(look).not.toContain('road');
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) {
      const i = y * t.size + x;
      const want = x < 6 ? 'hardpan' : 'saltCrust';
      expect(look[i], `${x},${y}`).toBe(t.types[i] === 'road' ? want : t.types[i]);
    }
  });

  it('gives a map that is all road the hardpan look road tiles paint as', () => {
    const t: Terrain = { ...bandMap(), types: new Array<TerrainTypeId>(144).fill('road') };
    expect(new Set(lookTypes(t))).toEqual(new Set(['hardpan']));
  });

  it('gives the same look on every call', () => {
    const t = bandMap();
    expect([...lookTypes({ ...t })]).toEqual([...lookTypes(t)]);
  });

  it('gives road tiles beside ground without a desert look no desert look', () => {
    const t = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming')).terrain;
    const look = lookTypes(t);
    let checked = 0;
    for (let y = 1; y < t.size - 1; y++) for (let x = 1; x < t.size - 1; x++) {
      const i = y * t.size + x;
      if (t.types[i] !== 'road') continue;
      const off = [i - 1, i + 1, i - t.size, i + t.size].filter((n) => t.types[n] !== 'road');
      if (off.length === 0 || off.some((n) => desertWeight(look[n]) > 0)) continue;
      checked++;
      expect(desertWeight(look[i]), `${x},${y}`).toBe(0);
    }
    expect(checked).toBeGreaterThan(50);
  });
});

type Shape = { kind: 'arc'; x: number; y: number; r: number } | { kind: 'poly'; points: Vec[] };
type Op = { kind: 'image' } | { kind: 'fill'; shapes: Shape[] } | { kind: 'stroke'; shapes: Shape[]; width: number };

class RecordingContext {
  ops: Op[] = [];
  image: Uint8ClampedArray | null = null;
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
  putImageData(image: { data: Uint8ClampedArray }) {
    this.image = image.data;
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

function paintedMap(): { canvas: PaintCanvas; ops: Op[] } {
  const res = 0.5;
  const from = -TERRAIN_MARGIN;
  const ctx = new RecordingContext();
  const canvas: PaintCanvas = {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    size: Math.ceil((TEST_MAP.terrain.size + 2 * TERRAIN_MARGIN) * res),
    res,
    from,
    toPx: (tiles) => (tiles - from) * res,
  };
  paintGroundCanvas(canvas, TEST_MAP.terrain);
  return { canvas, ops: ctx.ops };
}

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
    for (const b of TERRAIN.features.basins) {
      const at = { x: painted.canvas.toPx(b.center.x), y: painted.canvas.toPx(b.center.y) };
      for (const c of centres) expect(Math.hypot(c.x - at.x, c.y - at.y)).toBeGreaterThan(painted.canvas.res);
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
    const onBank = (k: number, up = 3) => {
      const v = sunBasin.floor[k];
      const r = Math.hypot(v.x, v.y);
      const out = (r + up) / r;
      return { x: sunBasin.center.x + v.x * out, y: sunBasin.center.y + v.y * out };
    };
    const n = sunBasin.floor.length;
    const arc = Array.from({ length: (scree.to - scree.from + n) % n - 1 }, (_, i) => (scree.from + 1 + i) % n);
    expect(arc).toEqual([21, 0, 1]);
    for (const k of arc) expect(paintOver(painted, onBank(k)).length, `vertex ${k}`).toBeGreaterThan(0);
    for (const k of [6, 12, 17]) expect(paintOver(painted, onBank(k)), `vertex ${k}`).toEqual([]);
    expect(sunBasin.bank[21]).toBeGreaterThan(20);
    expect(paintOver(painted, onBank(21, sunBasin.bank[21] / 2))).toEqual([]);
  });
});

describe('ground paint around towns, sites and craters', () => {
  const painted = paintedMap();
  const places = [...REGION.towns, ...REGION.locations];

  it('centres no circle on a town, site or crater', () => {
    const arcs = painted.ops.flatMap((op) => (op.kind === 'image' ? [] : op.shapes.flatMap((s) => (s.kind === 'arc' ? [s] : []))));
    const centres = [...places.map((p) => p.pos), ...TERRAIN.features.craters.map((c) => c.center)];
    for (const at of centres) {
      const px = { x: painted.canvas.toPx(at.x), y: painted.canvas.toPx(at.y) };
      for (const a of arcs) expect(Math.hypot(a.x - px.x, a.y - px.y)).toBeGreaterThan(painted.canvas.res);
    }
  });

  it("paints nothing over Bowl's crater floor", () => {
    const crater = TERRAIN.features.craters[0];
    let samples = 0;
    for (let y = -crater.radius; y <= crater.radius; y += 3) for (let x = -crater.radius; x <= crater.radius; x += 3) {
      if (Math.hypot(x, y) > crater.radius) continue;
      samples++;
      expect(paintOver(painted, { x: crater.center.x + x, y: crater.center.y + y }), `${x},${y}`).toEqual([]);
    }
    expect(samples).toBeGreaterThan(300);
  });

  it('paints nothing on or just around a site', () => {
    const { canyon, dryRiver } = TERRAIN.features;
    for (const id of ['bowl', 'nose', 'dustwell', 'granary', 'scrapjaw', 'kiln', 'green-pit']) {
      const place = places.find((p) => p.id === id);
      if (!place) continue;
      const reach = place.radius + 3;
      let samples = 0;
      let clear = 0;
      for (let y = -reach; y <= reach; y++) for (let x = -reach; x <= reach; x++) {
        if (Math.hypot(x, y) > reach) continue;
        const p = { x: place.pos.x + x, y: place.pos.y + y };
        samples++;
        if (polylineDist(p, canyon.path) <= canyon.width + canyon.bank) continue;
        if (polylineDist(p, dryRiver.path) <= dryRiver.width + dryRiver.bank) continue;
        clear++;
        expect(paintOver(painted, p), `${id} ${x},${y}`).toEqual([]);
      }
      expect(clear / samples, id).toBeGreaterThan(0.8);
    }
  });
});

function paintedImage(t: Terrain): Uint8ClampedArray {
  const res = 4;
  const size = t.size * res;
  const ctx = new RecordingContext();
  const canvas: PaintCanvas = { ctx: ctx as unknown as CanvasRenderingContext2D, size, res, from: 0, toPx: (tiles) => tiles * res };
  paintGroundCanvas(canvas, t);
  if (!ctx.image) throw new Error('The painter put no ground image');
  return ctx.image;
}

describe('ground paint under fused glass', () => {
  it('paints glass tiles as hardpan, so the shader can draw glass with its own smooth edge', () => {
    const size = 12;
    const flat = new Array<number>((size + 1) ** 2).fill(0);
    const map = (type: (x: number) => TerrainTypeId): Terrain => ({ size, heights: flat, types: Array.from({ length: size * size }, (_, i) => type(i % size)), atlas: ICARUS_KEY });
    const glass = paintedImage(map((x) => (x < 6 ? 'glass' : 'hardpan')));
    const hardpan = paintedImage(map(() => 'hardpan'));
    expect(glass).toEqual(hardpan);
  });
});

function glassMap(size: number, glass: (x: number, y: number) => boolean): Terrain {
  const types: TerrainTypeId[] = Array.from({ length: size * size }, (_, i) => (glass(i % size, Math.floor(i / size)) ? 'glass' : 'sand'));
  return { size, heights: new Array<number>((size + 1) ** 2).fill(0), types, atlas: ICARUS_KEY };
}

const HALF = 128;

describe('glassField', () => {
  it('is full inside a glass field and empty far from it', () => {
    const field = glassField(glassMap(20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15));
    expect(field[10 * 20 + 10]).toBe(255);
    expect(field[1 * 20 + 1]).toBe(0);
  });

  it('puts the half line on the tile edge of a straight glass edge, and rounds a square corner', () => {
    const field = glassField(glassMap(20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15));
    const at = (x: number, y: number) => field[y * 20 + x];
    expect(at(5, 10)).toBeGreaterThan(HALF);
    expect(at(4, 10)).toBeLessThan(HALF);
    expect(at(5, 5)).toBeLessThan(at(5, 10));
  });

  it('keeps a one tile wide strip, and drops a lone tile', () => {
    const strip = glassField(glassMap(20, (x) => x === 10));
    expect(strip[10 * 20 + 10]).toBeGreaterThan(HALF);
    const lone = glassField(glassMap(20, (x, y) => x === 10 && y === 10));
    expect(lone[10 * 20 + 10]).toBeLessThan(HALF);
  });
});
