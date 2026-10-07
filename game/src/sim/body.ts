// Truck body in meters. The collider is the boxes of the chassis base model, and the wheel mounts are data per look.
// The grid is logical and knows no meters. cellRect() projects it over the model and is the only place that converts
// between cells and meters.
// Body space: +x is the nose, +z the truck's right, +y up, origin at the box center. Grid row 0 is the nose, column 0 the left.

import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import TRUCK_SHAPES from '../data/truck-shapes.json';
import { baseGrid } from './grid';
import type { ShapeBox } from './mapgen';

// One collider box: its center and half extents in body meters.
export type BodyBox = { at: { x: number; y: number; z: number }; half: { x: number; y: number; z: number } };

// half: half extents along length, height, width. Length and width are the bounds of the boxes, height is the chassis box.
// boxes: the collider, from the base model. wheelX: front and rear axle distance from the center.
// wheelZ: wheel distance from the center line. wheelY: suspension mount height relative to the chassis center.
export type Body = {
  half: { x: number; y: number; z: number };
  boxes: BodyBox[];
  wheelX: number;
  wheelZ: number;
  wheelY: number;
  wheelRadius: number;
  wheelHalfWidth: number;
};

// A footprint in body meters, x0 < x1 along the truck and z0 < z1 across it.
export type CellRect = { x0: number; x1: number; z0: number; z1: number };

// The top surface of a model: top[i][j] is the highest point in centimeters over the sample cell that spans model x from
// (i0 + i) * cell to (i0 + i + 1) * cell and model y from (j0 + j) * cell, or null where the model has no geometry.
type HeightMap = { cell: number; i0: number; j0: number; top: (number | null)[][] };
type TruckShape = { boxes: ShapeBox[]; heights: HeightMap };

const bodies = new Map<string, Body>();

export function bodyOf(chassisId: string): Body {
  const cached = bodies.get(chassisId);
  if (cached) return cached;
  const body = buildBody(chassisId);
  bodies.set(chassisId, body);
  return body;
}

function buildBody(chassisId: string): Body {
  const look = PHYSICS.bodies[chassisDef(chassisId).look];
  const boxes = collisionBoxes(chassisId, look.halfHeight, restTop(look));
  const half = {
    x: Math.max(...boxes.map((b) => Math.abs(b.at.x) + b.half.x)),
    y: look.halfHeight,
    z: Math.max(...boxes.map((b) => Math.abs(b.at.z) + b.half.z)),
  };
  return { half, boxes, wheelX: look.wheelX, wheelZ: look.wheelZ, wheelY: look.wheelY, wheelRadius: look.wheelRadius, wheelHalfWidth: look.wheelHalfWidth };
}

// The collider top in body meters: truckRoof above the ground at rest.
function restTop(look: { wheelY: number; wheelRadius: number }): number {
  return PHYSICS.truckRoof - (look.wheelRadius + PHYSICS.truck.suspensionRest - look.wheelY);
}

function truckShape(chassisId: string): TruckShape {
  const shape = (TRUCK_SHAPES as Record<string, TruckShape>)[`base_${chassisId}`];
  if (!shape) throw new Error(`Chassis ${chassisId} has no truck shape base_${chassisId}. Run npm run models:shapes.`);
  return shape;
}

// The model's boxes in body space. The base hangs a skirt below the chassis bottom, and some models stand above the
// roof height that props leave clear, so the collider stops at the chassis bottom and at the roof limit.
function collisionBoxes(chassisId: string, halfHeight: number, top: number): BodyBox[] {
  return truckShape(chassisId).boxes.map((b) => {
    const y0 = Math.max(b.z0, -halfHeight);
    const y1 = Math.min(b.z1, top);
    if (!(y1 > y0)) throw new Error(`A ${chassisId} collision box has no height between the chassis bottom and the roof limit`);
    return {
      at: { x: (b.x0 + b.x1) / 2, y: (y0 + y1) / 2, z: -(b.y0 + b.y1) / 2 },
      half: { x: (b.x1 - b.x0) / 2, y: (y1 - y0) / 2, z: (b.y1 - b.y0) / 2 },
    };
  });
}

const hulks = new Map<string, readonly ShapeBox[]>();

// The model's boxes for the hulk a dead truck leaves, in model meters with z up from the ground. The hulk lies on its
// chassis bottom, so the skirt below it sinks into the ground and is cut away.
export function hulkBoxes(chassisId: string): readonly ShapeBox[] {
  const cached = hulks.get(chassisId);
  if (cached) return cached;
  const bottom = -bodyOf(chassisId).half.y;
  const boxes = truckShape(chassisId).boxes.map((b) => {
    const z0 = Math.max(b.z0, bottom);
    if (!(b.z1 > z0)) throw new Error(`A ${chassisId} hulk box has no height above the chassis bottom`);
    return { ...b, z0: z0 - bottom, z1: b.z1 - bottom };
  });
  hulks.set(chassisId, boxes);
  return boxes;
}

// The projection of the grid onto the model. Rows spread evenly over the model's length and the inner columns over its
// width, so an inner cell lies where the model's own row and column lie. The armor ring lies on the model's faces. A left
// or right column cell has no width and lies on the side face over its row. A first or last row cell has no depth and lies
// on the nose or tail face over its column. The side columns win in the corners.
export function cellRect(chassisId: string, cells: readonly { x: number; y: number }[]): CellRect {
  if (cells.length === 0) throw new Error(`No cells to project on ${chassisId}`);
  const rects = cells.map((c) => singleCellRect(chassisId, c.x, c.y));
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z0: Math.min(...rects.map((r) => r.z0)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

// Center of grid cell (x, y) in body meters.
export function cellCenter(chassisId: string, x: number, y: number): { x: number; z: number } {
  const r = singleCellRect(chassisId, x, y);
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

function singleCellRect(chassisId: string, x: number, y: number): CellRect {
  const { w, h } = gridContaining(chassisId, x, y);
  const { half } = bodyOf(chassisId);
  const rowStep = (2 * half.x) / h;
  const colStep = (2 * half.z) / (w - 2);
  const along = { x0: half.x - (y + 1) * rowStep, x1: half.x - y * rowStep };
  const across = { z0: -half.z + (x - 1) * colStep, z1: -half.z + x * colStep };
  const side = ringSign(x, w, -1);
  const end = ringSign(y, h, 1);
  if (side !== 0) return { ...along, z0: side * half.z, z1: side * half.z };
  if (end !== 0) return { x0: end * half.x, x1: end * half.x, ...across };
  return { ...along, ...across };
}

function gridContaining(chassisId: string, x: number, y: number): { w: number; h: number } {
  const grid = baseGrid(chassisId);
  const inside = x >= 0 && x < grid.w && y >= 0 && y < grid.h;
  if (!inside) throw new Error(`Cell ${x},${y} is outside the ${chassisId} grid`);
  return grid;
}

// -first for index 0, first for the last index, 0 between. It tells which face of the ring a cell lies on.
function ringSign(index: number, count: number, first: number): number {
  if (index === 0) return first;
  return index === count - 1 ? -first : 0;
}

// The largest height map value over the sample cells that lie fully inside the ranges, in meters, or -Infinity over no
// geometry. A sample cell that reaches over a range edge belongs to the neighbor, so a wall that ends at a row edge does
// not raise the next row. A range narrower than a sample cell reads the cell at its middle. Ranges are in model space.
function topOver(map: HeightMap, xa: number, xb: number, ya: number, yb: number): number {
  const eps = 1e-6;
  const cellsOf = (lo: number, hi: number) => {
    const first = Math.ceil((lo - eps) / map.cell);
    const last = Math.floor((hi + eps) / map.cell) - 1;
    if (last < first) return [Math.floor((lo + hi) / 2 / map.cell)];
    return Array.from({ length: last - first + 1 }, (_, k) => first + k);
  };
  const tops = cellsOf(xa, xb).flatMap((i) => cellsOf(ya, yb).map((j) => map.top[i - map.i0]?.[j - map.j0]));
  return Math.max(-Infinity, ...tops.filter((t): t is number => typeof t === 'number').map((t) => t / 100));
}

// The body y of the highest point of the model's top surface under the rect. A rect with no width or depth, like an
// armor cell on a face, reads the samples one step around it. Throws when the model has no geometry there.
export function surfaceAt(chassisId: string, rect: CellRect): number {
  const best = highestUnder(chassisId, rect);
  if (best === -Infinity) throw new Error(`The ${chassisId} model has no surface under x ${rect.x0}..${rect.x1}, z ${rect.z0}..${rect.z1}`);
  return best;
}

// Like surfaceAt, but -Infinity over air.
export function highestUnder(chassisId: string, rect: CellRect): number {
  const map = truckShape(chassisId).heights;
  const reach = (lo: number, hi: number) => (hi > lo ? [lo, hi] : [lo - map.cell, hi + map.cell]);
  const [xa, xb] = reach(rect.x0, rect.x1);
  // Model y points to the truck's left, body z to its right.
  const [ya, yb] = reach(-rect.z1, -rect.z0);
  return topOver(map, xa, xb, ya, yb);
}

// The model's top surface samples whose centers lie within radius of a body point, in body meters: x and z the sample
// center, y its top and half its half size. Samples over air are left out.
export function surfaceSamples(chassisId: string, center: { x: number; z: number }, radius: number): { x: number; z: number; y: number; half: number }[] {
  const map = truckShape(chassisId).heights;
  const out: { x: number; z: number; y: number; half: number }[] = [];
  const reach = Math.ceil(radius / map.cell) + 1;
  // Model y points to the truck's left, body z to its right.
  const i0 = Math.floor(center.x / map.cell);
  const j0 = Math.floor(-center.z / map.cell);
  for (let i = i0 - reach; i <= i0 + reach; i++) {
    for (let j = j0 - reach; j <= j0 + reach; j++) {
      const top = map.top[i - map.i0]?.[j - map.j0];
      if (typeof top !== 'number') continue;
      const x = (i + 0.5) * map.cell;
      const z = -(j + 0.5) * map.cell;
      if (Math.hypot(x - center.x, z - center.z) <= radius) out.push({ x, z, y: top / 100, half: map.cell / 2 });
    }
  }
  return out;
}

// How far a surface may stand above a resting part before the part would cut into it, in meters. A gap within it also
// counts as touching, so a part or a gun mount that far above the surface under it stands on it.
export const CLIP_TOLERANCE = 0.05;
// A part never shrinks below this share of its footprint along either axis to clear taller surfaces. A small part
// standing on something reads better than a full one floating.
const MIN_KEEP = 0.3;
// The share of a resting part's footprint that must touch the surface under it, so at most a sliver overhangs.
const MIN_SUPPORT = 0.9;

// Where a part rests: its base height, the footprint it is drawn over, and whether it perches on top of something.
// slope is the rise of the resting surface per meter along the truck (x) and across it (z). A flat rest has no slope.
export type Rest = { y: number; rect: CellRect; perched: boolean; slope: { x: number; z: number } };

const FLAT = { x: 0, z: 0 };
// The steepest surface a part leans on, as rise per meter: about 35 degrees. Steeper, it perches instead.
const MAX_SLOPE = 0.7;
// A surface that fits a plane this steep or steeper, as rise per meter, tilts the part even when a flat rest would fit.
const MIN_SLOPE = 0.1;

// A part rests on a surface of the model without cutting into it. Each candidate surface runs from the one that carries
// half its footprint, the median of the height samples under it, up to the highest. On a candidate, the drawn footprint
// shrinks away from anything taller, like a bed wall or a rim, and at least half of what is left must touch the
// surface. The candidate that keeps the most footprint wins. A clean slope, one plane with no sample far below it,
// tilts the part first. A part that fits on no flat surface, like one on a raked
// window, leans on the plane that fits the samples, raised until none pokes through, if at least half of them touch
// it. A part that fits on neither perches: tilted on that plane when it floats less that way than flat on the highest
// point.
export function restOn(chassisId: string, rect: CellRect): Rest {
  const map = truckShape(chassisId).heights;
  const samples = rect.x1 > rect.x0 && rect.z1 > rect.z0 ? samplesUnder(map, rect) : [];
  if (samples.length === 0) return restOnEdge(chassisId, rect);
  return cleanSlope(map, samples, rect) ?? restFlat(map, samples, rect) ?? perch(chassisId, map, samples, rect);
}

// A rect with no width or depth, like a ring cell, rests on the samples around it. Over air nothing holds the part, so
// it perches.
function restOnEdge(chassisId: string, rect: CellRect): Rest {
  const y = highestUnder(chassisId, rect);
  return y === -Infinity ? { y: 0, rect, perched: true, slope: FLAT } : { y, rect, perched: false, slope: FLAT };
}

// A plane at least MIN_SLOPE steep that half the footprint touches and nothing pokes through. Null otherwise.
function cleanSlope(map: HeightMap, samples: Sample[], rect: CellRect): Rest | null {
  const slope = leanOn(map, samples, rect, CLIP_TOLERANCE, true);
  return slope && Math.hypot(slope.slope.x, slope.slope.z) >= MIN_SLOPE ? slope : null;
}

// The flat surface that keeps the most footprint, see restOn(). Null when none fits.
function restFlat(map: HeightMap, samples: Sample[], rect: CellRect): Rest | null {
  const tops = samples.map((sm) => sm.top).filter(Number.isFinite).sort((a, b) => a - b);
  const levels = [...new Set(tops.slice(Math.floor((tops.length - 1) / 2)))];
  const fits = levels.flatMap((y) => {
    const box = clearBox(samples, y - CLIP_TOLERANCE, y + CLIP_TOLERANCE);
    const di = (box.i1 - box.i0) / spanOf(samples, 'i');
    const dj = (box.j1 - box.j0) / spanOf(samples, 'j');
    return !box.empty && Math.min(di, dj) >= MIN_KEEP && supports(samples, box, y) ? [{ y, box, area: di * dj }] : [];
  });
  const best = fits.reduce<(typeof fits)[number] | null>((a, b) => (a && a.area >= b.area ? a : b), null);
  return best && { y: best.y, rect: rectOfBox(map, best.box, rect), perched: false, slope: FLAT };
}

// A part that fits nowhere: tilted on the fitted plane when that floats less than flat on the highest point.
function perch(chassisId: string, map: HeightMap, samples: Sample[], rect: CellRect): Rest {
  const tops = samples.map((sm) => sm.top).filter(Number.isFinite);
  if (tops.length === 0) return { y: surfaceAt(chassisId, rect), rect, perched: true, slope: FLAT };
  const highest = Math.max(...tops);
  const leaning = leanOn(map, samples, rect, highest - Math.min(...tops), false);
  return leaning ? { ...leaning, perched: true } : { y: highest, rect, perched: true, slope: FLAT };
}

// The plane through the samples by least squares, raised until no sample stands above it. Null when it is steeper than
// MAX_SLOPE, over air, when a sample lies more than maxGap below it, or, with mostTouching, when less than MIN_SUPPORT of
// the footprint touches it.
function leanOn(map: HeightMap, samples: Sample[], rect: CellRect, maxGap: number, mostTouching: boolean): Rest | null {
  if (samples.some((sm) => !Number.isFinite(sm.top))) return null;
  const points = samples.map((sm) => ({ x: (sm.i + 0.5) * map.cell, z: -(sm.j + 0.5) * map.cell, y: sm.top }));
  const plane = fitPlane(points);
  if (!plane || Math.hypot(plane.x, plane.z) > MAX_SLOPE) return null;
  const at = (pt: { x: number; z: number }) => plane.y + plane.x * pt.x + plane.z * pt.z;
  const lift = Math.max(...points.map((pt) => pt.y - at(pt)));
  const gaps = points.map((pt) => at(pt) + lift - pt.y);
  if (!gapsFit(gaps, maxGap, mostTouching)) return null;
  const center = { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 };
  return { y: at(center) + lift, rect, perched: false, slope: { x: plane.x, z: plane.z } };
}

// No gap wider than maxGap, and with mostTouching, at least MIN_SUPPORT of the gaps within the clip tolerance.
function gapsFit(gaps: number[], maxGap: number, mostTouching: boolean): boolean {
  if (gaps.some((g) => g > maxGap)) return false;
  return !mostTouching || gaps.filter((g) => g <= CLIP_TOLERANCE).length >= MIN_SUPPORT * gaps.length;
}

// Least squares y = y0 + x * sx + z * sz over the points, as { y: y0, x: sx, z: sz }. Null when the points lie on a line.
function fitPlane(points: { x: number; y: number; z: number }[]): { y: number; x: number; z: number } | null {
  const n = points.length;
  const mean = (f: (pt: { x: number; y: number; z: number }) => number) => points.reduce((sum, pt) => sum + f(pt), 0) / n;
  const mx = mean((pt) => pt.x);
  const mz = mean((pt) => pt.z);
  const my = mean((pt) => pt.y);
  const sxx = mean((pt) => (pt.x - mx) ** 2);
  const szz = mean((pt) => (pt.z - mz) ** 2);
  const sxz = mean((pt) => (pt.x - mx) * (pt.z - mz));
  const sxy = mean((pt) => (pt.x - mx) * (pt.y - my));
  const szy = mean((pt) => (pt.z - mz) * (pt.y - my));
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-12) return null;
  const x = (sxy * szz - szy * sxz) / det;
  const z = (szy * sxx - sxy * sxz) / det;
  return { y: my - x * mx - z * mz, x, z };
}

type Sample = { i: number; j: number; top: number };
// cut marks the sides that trimming moved: i0, i1, j0 and j1, in that order.
type Box = { i0: number; i1: number; j0: number; j1: number; empty: boolean; cut: [boolean, boolean, boolean, boolean] };

// The height samples that lie fully inside the rect, with their tops in meters. Where the model has no geometry the top
// is -Infinity, air that holds nothing up. Model y points to the truck's left.
function samplesUnder(map: HeightMap, rect: CellRect): Sample[] {
  const range = (lo: number, hi: number) => {
    const first = Math.ceil((lo - 1e-6) / map.cell);
    const last = Math.floor((hi + 1e-6) / map.cell) - 1;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => first + k);
  };
  return range(rect.x0, rect.x1).flatMap((i) => range(-rect.z1, -rect.z0).flatMap((j) => {
    const top = map.top[i - map.i0]?.[j - map.j0];
    return [{ i, j, top: typeof top === 'number' ? top / 100 : -Infinity }];
  }));
}

// True when at least MIN_SUPPORT of the samples inside the box reach the level, so the part barely overhangs anything.
function supports(samples: Sample[], box: Box, y: number): boolean {
  const inside = samples.filter((sm) => sm.i >= box.i0 && sm.i < box.i1 && sm.j >= box.j0 && sm.j < box.j1);
  return inside.filter((sm) => sm.top >= y - CLIP_TOLERANCE).length >= MIN_SUPPORT * inside.length;
}

function spanOf(samples: Sample[], key: 'i' | 'j'): number {
  const values = samples.map((sm) => sm[key]);
  return Math.max(...values) - Math.min(...values) + 1;
}

// The sample box left after trimming away every sample outside the band from low to high, one edge row or column at a
// time: taller things the part would cut into, and drops or air it would hang over. Box bounds are half open.
function clearBox(samples: Sample[], low: number, high: number): Box {
  const box: Box = { i0: Math.min(...samples.map((sm) => sm.i)), i1: Math.max(...samples.map((sm) => sm.i)) + 1, j0: Math.min(...samples.map((sm) => sm.j)), j1: Math.max(...samples.map((sm) => sm.j)) + 1, empty: false, cut: [false, false, false, false] };
  const inBox = (sm: Sample) => sm.i >= box.i0 && sm.i < box.i1 && sm.j >= box.j0 && sm.j < box.j1;
  for (;;) {
    const tall = samples.filter((sm) => (sm.top > high || sm.top < low) && inBox(sm));
    if (tall.length === 0) return box;
    trimEdge(box, tall);
    if (box.i1 <= box.i0 || box.j1 <= box.j0) return { ...box, empty: true };
  }
}

// Trims the edge row or column of the box that holds the most tall samples. When no edge holds one, it trims the edge
// nearest the first tall sample, so the loop always closes in on it.
function trimEdge(box: Box, tall: Sample[]): void {
  const edges = [(sm: Sample) => sm.i === box.i0, (sm: Sample) => sm.i === box.i1 - 1, (sm: Sample) => sm.j === box.j0, (sm: Sample) => sm.j === box.j1 - 1];
  const counts = edges.map((on) => tall.filter(on).length);
  const most = Math.max(...counts);
  const first = tall[0];
  const gaps = [first.i - box.i0, box.i1 - 1 - first.i, first.j - box.j0, box.j1 - 1 - first.j];
  const side = most > 0 ? counts.indexOf(most) : gaps.indexOf(Math.min(...gaps));
  box.cut[side] = true;
  if (side === 0) box.i0 += 1;
  else if (side === 1) box.i1 -= 1;
  else if (side === 2) box.j0 += 1;
  else box.j1 -= 1;
}

// The rect with each trimmed side moved in to the sample box. Model j grows to the truck's left, so j1 bounds z0.
function rectOfBox(map: HeightMap, box: Box, rect: CellRect): CellRect {
  return {
    x0: box.cut[0] ? box.i0 * map.cell : rect.x0,
    x1: box.cut[1] ? box.i1 * map.cell : rect.x1,
    z0: box.cut[3] ? -box.j1 * map.cell : rect.z0,
    z1: box.cut[2] ? -box.j0 * map.cell : rect.z1,
  };
}

// The center of the hood hole on the bay floor, where the engine is drawn.
export function engineAnchor(chassisId: string): { x: number; y: number; z: number } {
  return { ...PHYSICS.bodies[chassisDef(chassisId).look].engine };
}

// The grid lanes a stretch of the truck's edge crosses, in body meters. Columns are lanes for a hit on the nose or tail,
// measured across the truck. Rows are lanes for a hit on a side, measured along it. The stretch may reach past the
// model, and then the lanes clamp to the ring columns or the end rows.
export function lanesAt(chassisId: string, axis: 'column' | 'row', a: number, b: number): number[] {
  const { w, h } = baseGrid(chassisId);
  const { half } = bodyOf(chassisId);
  const lane = axis === 'column'
    ? (z: number) => (z < -half.z ? 0 : z >= half.z ? w - 1 : 1 + Math.floor(((z + half.z) * (w - 2)) / (2 * half.z)))
    : (x: number) => Math.min(h - 1, Math.max(0, Math.floor(((half.x - x) * h) / (2 * half.x))));
  const first = Math.min(lane(a), lane(b));
  const last = Math.max(lane(a), lane(b));
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

