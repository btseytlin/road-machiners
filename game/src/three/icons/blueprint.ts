// Draws an item icon as a blueprint, all in vectors so it stays sharp at any size. The item's shape is the union of its
// model's triangles as drawn, filled deep, with the faces turned from the light filled deeper. The outer contour draws
// in one thick line with sharp corners. Inside it, thin lines mark only where one part's outline passes in front of
// another, so each part reads and its own folds are left to the shading.
// An edge draws where its faces turn away from the viewer. A ray toward the camera hides the parts of it behind other
// faces. Model pieces too small to read at icon size drop out entirely.

import ClipperLib from 'clipper-lib';
import * as THREE from 'three';
import { thicken, type Mask, type Pixels } from './lines';

// A piece narrower than this share of the drawing's longer side drops out, so small fittings do not become squiggles.
const MIN_PIECE = 0.12;
// Inner lines shorter than this share of the drawing's longer side drop out.
const MIN_INNER = 0.1;
// How far apart visibility samples lie along an edge, in drawing pixels.
const SAMPLE_PX = 2;
// A face this close to the sample, in meters, is the edge's own face, not one in front of it.
const HIDE_EPS = 0.004;
// An edge within this angle of a model axis draws along that axis, so dented boxes still draw with parallel sides.
const SNAP_DEG = 8;
// Inner lines keep only the points that bend them more than this many drawing pixels, since each edge is straight.
const LINE_TOLERANCE = 0.5;
// The shadow follows the shaded pixels within this many drawing pixels, so its staircases draw straight.
const SHADOW_TOLERANCE = 1.5;
// The shape's corners snap to 1/SNAP_GRID of a drawing pixel.
const SNAP_GRID = 4;
// Shadow patches smaller across than this share of the drawing's longer side drop out.
const MIN_SHADOW = 0.04;
// The light in view space, from over the viewer's left shoulder. A face lit less than SHADE_AT of full is in shadow,
// and one lit more than LIT_AT is in highlight.
const LIGHT = new THREE.Vector3(-0.6, 0.45, 0.65).normalize();
const SHADE_AT = 0.35;
const LIT_AT = 0.65;

// Line widths in drawing pixels.
export type BlueprintPen = { outer: number; inner: number };
// light: the highlight color. Without it the lit faces keep the fill.
export type BlueprintColors = { line: string; fill: string; shadow: string; glass: string; light?: string };
// The material name of window glass, which draws in its own color so cabs show their windows.
export const GLASS_MATERIAL = 'glass';

type Vec2 = { x: number; y: number };

// One icon in drawing pixels of a size x size square: the filled shape, its shadow, highlight and glass loops and its
// inner lines.
export type Blueprint = {
  size: number;
  pen: BlueprintPen;
  shape: Vec2[][];
  shadow: Vec2[][];
  light: Vec2[][];
  glass: Vec2[][];
  lines: Vec2[][];
};

// draw renders the scene at size x size with the material, or with its own materials for null.
export function blueprintOf(
  scene: THREE.Scene,
  camera: THREE.OrthographicCamera,
  size: number,
  pen: BlueprintPen,
  draw: (override: THREE.Material | null) => Pixels,
): Blueprint {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => o instanceof THREE.Mesh && meshes.push(o));
  scene.updateMatrixWorld(true);
  const toPx = projector(camera, size);
  const tris = trianglesOf(meshes);
  const longest = dropSmallPieces(meshes, tris, toPx);
  const shape = shapeOf(tris, toPx);
  const solid = maskOf(shape, size);
  // Inner lines keep clear of the contour by their own width, so the two never merge into one heavy line.
  const outside = { w: solid.w, h: solid.h, bits: solid.bits.map((b) => b ^ 1) };
  const near = thicken(outside, pen.outer / 2 + pen.inner);
  const lines = visibleRuns(meshes, tris, camera, toPx, near)
    .filter((r) => lengthOf(r) >= MIN_INNER * longest)
    .map((r) => (r.length > 2 ? douglasPeucker(r, LINE_TOLERANCE) : r));
  const normal = draw(new THREE.MeshNormalMaterial({ flatShading: true }));
  const shadow = patchesOf(lightMask(normal, solid, (lit) => lit < SHADE_AT), longest);
  const light = patchesOf(lightMask(normal, solid, (lit) => lit > LIT_AT), longest);
  const glass = patchesOf(glassMask(meshes, draw, solid), longest);
  return { size, pen, shape, shadow, light, glass, lines };
}

// A mask's patches as straightened loops, without those under MIN_SHADOW of the drawing across.
function patchesOf(mask: Mask, longest: number): Vec2[][] {
  return contours(mask)
    .map((loop) => simplifyPath(loop, SHADOW_TOLERANCE))
    .filter((loop) => Math.sqrt(Math.abs(areaOf(loop))) >= MIN_SHADOW * longest);
}

// Pixels inside the shape where glass shows, from a pass that draws glass white and everything else black.
function glassMask(meshes: readonly THREE.Mesh[], draw: (override: THREE.Material | null) => Pixels, solid: Mask): Mask {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const own = meshes.map((m) => m.material);
  meshes.forEach((m, i) => (m.material = (own[i] as THREE.Material).name === GLASS_MATERIAL ? white : black));
  const pass = draw(null);
  meshes.forEach((m, i) => (m.material = own[i]));
  [white, black].forEach((m) => m.dispose());
  return { w: solid.w, h: solid.h, bits: solid.bits.map((b, i) => (b && pass.data[i * 4] > 127 ? 1 : 0)) };
}

// Paints the blueprint scaled to the canvas, on a transparent background.
export function paintBlueprint(ctx: CanvasRenderingContext2D, bp: Blueprint, colors: BlueprintColors): void {
  const k = ctx.canvas.width / bp.size;
  ctx.save();
  ctx.scale(k, k);
  const shape = new Path2D(shapePath(bp.shape));
  ctx.fillStyle = colors.fill;
  ctx.fill(shape, 'evenodd');
  ctx.save();
  ctx.clip(shape, 'evenodd');
  ctx.fillStyle = colors.shadow;
  ctx.fill(new Path2D(loopsPath(bp.shadow)), 'evenodd');
  ctx.fillStyle = colors.glass;
  ctx.fill(new Path2D(loopsPath(bp.glass)), 'evenodd');
  ctx.restore();
  ctx.strokeStyle = colors.line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = bp.pen.inner;
  ctx.stroke(new Path2D(linesPath(bp.lines)));
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.lineWidth = bp.pen.outer;
  ctx.stroke(shape);
  ctx.restore();
}

// The blueprint as one SVG group in drawing pixels, for a sheet or a file. id names its clip path. Colors go in style,
// so they may be CSS variables. With screenPen, line widths are CSS values in screen pixels whatever the scale.
export function blueprintSvg(bp: Blueprint, colors: BlueprintColors, id: string, screenPen?: { outer: string; inner: string }): string {
  const shape = shapePath(bp.shape);
  const width = (drawn: number, screen: string | undefined): string =>
    screen === undefined ? `stroke-width:${num(drawn)}` : `stroke-width:${screen};vector-effect:non-scaling-stroke`;
  return [
    `<clipPath id="${id}"><path d="${shape}" clip-rule="evenodd"/></clipPath>`,
    `<path d="${shape}" style="fill:${colors.fill}" fill-rule="evenodd"/>`,
    `<path d="${loopsPath(bp.shadow)}" style="fill:${colors.shadow}" fill-rule="evenodd" clip-path="url(#${id})"/>`,
    colors.light === undefined ? '' : `<path d="${loopsPath(bp.light)}" style="fill:${colors.light}" fill-rule="evenodd" clip-path="url(#${id})"/>`,
    `<path d="${loopsPath(bp.glass)}" style="fill:${colors.glass}" fill-rule="evenodd" clip-path="url(#${id})"/>`,
    `<path d="${linesPath(bp.lines)}" style="fill:none;stroke:${colors.line};${width(bp.pen.inner, screenPen?.inner)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${shape}" style="fill:none;stroke:${colors.line};${width(bp.pen.outer, screenPen?.outer)}" stroke-linejoin="miter" stroke-miterlimit="3"/>`,
  ].join('');
}

// The blueprint calmer for small screens. Its shape keeps outer loops only, without holes, and drops loops under
// minArea of the largest. Shading and glass patches narrower than minPatch of the drawing drop out. Every loop
// straightens steps under tolerance of the drawing, so diagonal edges draw as one line.
export type Calm = { tolerance: number; minArea: number; minPatch: number };
export function calmed(bp: Blueprint, calm: Calm): Blueprint {
  const areas = bp.shape.map(areaOf);
  const largest = areas.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const straight = (loop: Vec2[]): Vec2[] => simplifyPath(loop, calm.tolerance * bp.size);
  const shape = bp.shape
    .filter((_, i) => Math.sign(areas[i]) === Math.sign(largest) && Math.abs(areas[i]) >= calm.minArea * Math.abs(largest))
    .map(straight);
  const patches = (loops: Vec2[][]): Vec2[][] =>
    loops.filter((loop) => Math.sqrt(Math.abs(areaOf(loop))) >= calm.minPatch * bp.size).map(straight);
  return { ...bp, shape, shadow: patches(bp.shadow), light: patches(bp.light), glass: patches(bp.glass) };
}

// The blueprint's outline alone as SVG for a plan, which the game stretches over grid cells. Its colors come from the
// CSS variables --plan-line and --plan-fill, and the line keeps its width in screen pixels whatever the stretch.
export function blueprintPlanSvg(bp: Blueprint, stroke: number): string {
  const shape = shapePath(bp.shape);
  return `<path d="${shape}" style="fill:var(--plan-fill);stroke:var(--plan-line);stroke-width:${stroke}px;vector-effect:non-scaling-stroke" fill-rule="evenodd" stroke-linejoin="miter" stroke-miterlimit="3"/>`;
}

// Drawing pixels are a quarter of a sheet pixel, so one decimal is finer than any screen shows.
function num(v: number): string {
  return String(Math.round(v * 10) / 10);
}

function shapePath(shape: readonly Vec2[][]): string {
  return loopsPath(shape);
}

function loopsPath(loops: readonly Vec2[][]): string {
  return loops.map((l) => `M${l.map((p) => `${num(p.x)} ${num(p.y)}`).join('L')}Z`).join('');
}

function linesPath(lines: readonly Vec2[][]): string {
  return lines.map((l) => `M${(l.length === 1 ? [l[0], l[0]] : l).map((p) => `${num(p.x)} ${num(p.y)}`).join('L')}`).join('');
}

// The union of every triangle as drawn: the item's exact outline as closed loops, holes included. Clipper works in
// whole numbers, so corners land on a 1/SNAP_GRID pixel grid.
function shapeOf(tris: readonly Tri[], toPx: (p: THREE.Vector3) => Vec2): Vec2[][] {
  const paths = tris.flatMap((t) => {
    const [a, b, c] = [t.a, t.b, t.c].map((p) => {
      const q = toPx(p);
      return { X: Math.round(q.x * SNAP_GRID), Y: Math.round(q.y * SNAP_GRID) };
    });
    const area = (b.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (b.Y - a.Y);
    if (area === 0) return [];
    // One winding for every triangle, so front and back faces add up and never cancel.
    return [area > 0 ? [a, b, c] : [a, c, b]];
  });
  if (!paths.length) throw new Error('A blueprint has no triangles to draw');
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out: ClipperLib.Path[] = [];
  if (!clipper.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) {
    throw new Error('The blueprint union failed');
  }
  return out.map((path) => path.map((p) => ({ x: p.X / SNAP_GRID, y: p.Y / SNAP_GRID })));
}

function maskOf(shape: readonly Vec2[][], size: number): Mask {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context');
  ctx.fill(new Path2D(shapePath(shape)), 'evenodd');
  const { data } = ctx.getImageData(0, 0, size, size);
  const bits = new Uint8Array(size * size);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return { w: size, h: size, bits };
}

// Pixels inside the shape whose face, by the normal pass, is lit less than SHADE_AT.
// The solid pixels whose face's light share passes the test.
function lightMask(normal: Pixels, solid: Mask, test: (lit: number) => boolean): Mask {
  const bits = new Uint8Array(solid.bits.length);
  for (let i = 0; i < bits.length; i++) {
    if (!solid.bits[i] || normal.data[i * 4 + 3] === 0) continue;
    const n = [0, 1, 2].map((c) => (normal.data[i * 4 + c] / 255) * 2 - 1);
    bits[i] = test(n[0] * LIGHT.x + n[1] * LIGHT.y + n[2] * LIGHT.z) ? 1 : 0;
  }
  return { w: solid.w, h: solid.h, bits };
}

function areaOf(loop: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [p, q] = [loop[i], loop[(i + 1) % loop.length]];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function projector(camera: THREE.OrthographicCamera, size: number): (p: THREE.Vector3) => Vec2 {
  return (p) => {
    const ndc = p.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * size, y: ((1 - ndc.y) / 2) * size };
  };
}

// A triangle in world space, with the mesh and the vertex index of its first corner.
type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; mesh: number; first: number; normal: THREE.Vector3 };

function trianglesOf(meshes: readonly THREE.Mesh[]): Tri[] {
  const out: Tri[] = [];
  meshes.forEach((m, mesh) => {
    if (m.geometry.index) m.geometry = m.geometry.toNonIndexed();
    const pos = m.geometry.getAttribute('position');
    const at = (i: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    for (let i = 0; i < pos.count; i += 3) {
      const [a, b, c] = [at(i), at(i + 1), at(i + 2)];
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (normal.lengthSq() === 0) continue;
      out.push({ a, b, c, mesh, first: i, normal: normal.normalize() });
    }
  });
  return out;
}

function keyOf(p: THREE.Vector3): string {
  return `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
}

// Joins triangles that share a corner into pieces, collapses every piece whose drawn extent is under MIN_PIECE of the
// drawing's longer side, and returns that longer side in pixels. Collapsed triangles leave tris and the geometry.
function dropSmallPieces(meshes: readonly THREE.Mesh[], tris: Tri[], toPx: (p: THREE.Vector3) => Vec2): number {
  const roots = pieceRoots(tris);
  const { boxes, all } = pieceBoxes(tris, roots, toPx);
  const longest = Math.max(all.x1 - all.x0, all.y1 - all.y0);
  const small = tris.map((_, i) => {
    const b = boxes.get(roots[i]);
    if (!b) throw new Error('Triangle without a piece');
    return Math.max(b.x1 - b.x0, b.y1 - b.y0) < MIN_PIECE * longest;
  });
  collapse(meshes, tris.filter((_, i) => small[i]));
  const kept = tris.filter((_, i) => !small[i]);
  tris.splice(0, tris.length, ...kept);
  return longest;
}

// Each triangle's piece, named by one corner key, joining triangles that share a corner (union-find).
function pieceRoots(tris: readonly Tri[]): string[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    parent.set(k, r);
    return r;
  };
  for (const t of tris) {
    const ks = [keyOf(t.a), keyOf(t.b), keyOf(t.c)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[1]), find(ks[0]));
    parent.set(find(ks[2]), find(ks[0]));
  }
  return tris.map((t) => find(keyOf(t.a)));
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

function grow(b: Box, p: Vec2): void {
  [b.x0, b.y0, b.x1, b.y1] = [Math.min(b.x0, p.x), Math.min(b.y0, p.y), Math.max(b.x1, p.x), Math.max(b.y1, p.y)];
}

// Each piece's drawn bounds, and the whole drawing's.
function pieceBoxes(tris: readonly Tri[], roots: readonly string[], toPx: (p: THREE.Vector3) => Vec2): { boxes: Map<string, Box>; all: Box } {
  const boxes = new Map<string, Box>();
  const all = emptyBox();
  tris.forEach((t, i) => {
    const box = boxes.get(roots[i]) ?? emptyBox();
    for (const p of [t.a, t.b, t.c].map(toPx)) {
      grow(box, p);
      grow(all, p);
    }
    boxes.set(roots[i], box);
  });
  return { boxes, all };
}

// Folds each triangle onto its first corner, so it draws and hits nothing.
function collapse(meshes: readonly THREE.Mesh[], dropped: readonly Tri[]): void {
  for (const t of dropped) {
    const pos = meshes[t.mesh].geometry.getAttribute('position');
    for (let k = 1; k < 3; k++) pos.setXYZ(t.first + k, pos.getX(t.first), pos.getY(t.first), pos.getZ(t.first));
    pos.needsUpdate = true;
  }
  for (const m of meshes) m.geometry.computeBoundingSphere();
}

// The edges that draw, by the faces on each side.
function featureEdges(tris: readonly Tri[], toward: THREE.Vector3): [THREE.Vector3, THREE.Vector3][] {
  return [...edgeFaces(tris).values()].filter((e) => drawsEdge(e.normals, toward)).map((e) => [e.a, e.b]);
}

// Every edge with the normals of the faces that share it.
function edgeFaces(tris: readonly Tri[]): Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }> {
  const faces = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; normals: THREE.Vector3[] }>();
  for (const t of tris) {
    for (const [p, q] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as const) {
      const [kp, kq] = [keyOf(p), keyOf(q)];
      const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const e = faces.get(key) ?? { a: p, b: q, normals: [] };
      e.normals.push(t.normal);
      faces.set(key, e);
    }
  }
  return faces;
}

// An open edge draws, and so does one between a face toward the viewer and one away: a part's outline as seen.
function drawsEdge(normals: readonly THREE.Vector3[], toward: THREE.Vector3): boolean {
  if (normals.length === 1) return true;
  const facing = normals.map((n) => n.dot(toward) > 1e-3);
  return facing.some((f) => f) && facing.some((f) => !f);
}

// The visible stretches of every feature edge in pixels, outside the near mask.
function visibleRuns(meshes: THREE.Mesh[], tris: readonly Tri[], camera: THREE.OrthographicCamera, toPx: (p: THREE.Vector3) => Vec2, near: Mask): Vec2[][] {
  const toward = camera.getWorldDirection(new THREE.Vector3()).negate();
  const ray = new THREE.Raycaster();
  const reach = 50;
  const shown = (p: THREE.Vector3): boolean => {
    ray.set(p.clone().addScaledVector(toward, reach), toward.clone().negate());
    const hit = ray.intersectObjects(meshes, false)[0];
    return !hit || hit.distance > reach - HIDE_EPS;
  };
  const blocked = (p: Vec2): boolean => {
    const [ix, iy] = [Math.round(p.x), Math.round(p.y)];
    return ix < 0 || iy < 0 || ix >= near.w || iy >= near.h || near.bits[iy * near.w + ix] === 1;
  };
  return featureEdges(tris, toward).flatMap(([a, b]) => edgeRuns(a, b, toPx, (px, at) => !blocked(px) && shown(at)));
}

// The stretches of one edge where seen(pixel, model point) holds, sampled every SAMPLE_PX along its snapped line.
function edgeRuns(a: THREE.Vector3, b: THREE.Vector3, toPx: (p: THREE.Vector3) => Vec2, seen: (px: Vec2, at: THREE.Vector3) => boolean): Vec2[][] {
  const [sa, sb] = snapped(a, b);
  const [pa, pb] = [toPx(sa), toPx(sb)];
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (len < 1) return [];
  const steps = Math.ceil(len / SAMPLE_PX);
  const runs: Vec2[][] = [];
  let run: Vec2[] | null = null;
  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const px = { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f };
    if (!seen(px, a.clone().lerp(b, f))) run = null;
    else if (run) run.push(px);
    else runs.push((run = [px]));
  }
  return runs;
}

// The edge turned onto the model axis it runs within SNAP_DEG of, about its middle, or unchanged.
function snapped(a: THREE.Vector3, b: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const cos = Math.cos(SNAP_DEG * THREE.MathUtils.DEG2RAD);
  for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
    const along = d.dot(axis);
    if (Math.abs(along) < cos * len) continue;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const half = axis.multiplyScalar(along / 2);
    return [mid.clone().sub(half), mid.add(half)];
  }
  return [a, b];
}

function lengthOf(points: readonly Vec2[]): number {
  return Math.hypot(points[points.length - 1].x - points[0].x, points[points.length - 1].y - points[0].y);
}

// A pixel's four sides: the neighbor that must be off for the side to be an edge, and the side's corners in order.
const SIDES = [
  { dx: 0, dy: -1, from: [1, 0], to: [0, 0] },
  { dx: -1, dy: 0, from: [0, 0], to: [0, 1] },
  { dx: 0, dy: 1, from: [0, 1], to: [1, 1] },
  { dx: 1, dy: 0, from: [1, 1], to: [1, 0] },
] as const;

// Every closed loop of the mask's pixel edges, outer rims and holes alike, as pixel corners with the mask on one side.
export function contours(mask: Mask): Vec2[][] {
  const next = edgeLinks(mask);
  const loops: Vec2[][] = [];
  for (const start of next.keys()) while ((next.get(start) ?? []).length) loops.push(traceLoop(next, start, mask.w + 1));
  return loops;
}

// From each pixel corner, keyed y * (w + 1) + x, the corners its edges lead to.
function edgeLinks(mask: Mask): Map<number, number[]> {
  const { w, h } = mask;
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask.bits[y * w + x] === 1;
  const next = new Map<number, number[]>();
  const key = (x: number, y: number): number => y * (w + 1) + x;
  for (let i = 0; i < w * h; i++) {
    const [x, y] = [i % w, Math.floor(i / w)];
    if (!on(x, y)) continue;
    for (const s of SIDES.filter((side) => !on(x + side.dx, y + side.dy))) {
      const k = key(x + s.from[0], y + s.from[1]);
      next.set(k, [...(next.get(k) ?? []), key(x + s.to[0], y + s.to[1])]);
    }
  }
  return next;
}

// Follows edges from start back to it, using each up.
function traceLoop(next: Map<number, number[]>, start: number, stride: number): Vec2[] {
  const loop: Vec2[] = [];
  let at = start;
  do {
    loop.push({ x: at % stride, y: Math.floor(at / stride) });
    const to = next.get(at)?.pop();
    if (to === undefined) throw new Error('Contour does not close');
    at = to;
  } while (at !== start);
  return loop;
}

// The loop with every point dropped that lies within tolerance of the line its neighbors keep (Douglas-Peucker).
export function simplifyPath(loop: readonly Vec2[], tolerance: number): Vec2[] {
  if (loop.length < 4) return [...loop];
  // Split the loop at its point farthest from the first, so each half is an open path.
  let far = 0;
  loop.forEach((p, i) => {
    if (Math.hypot(p.x - loop[0].x, p.y - loop[0].y) > Math.hypot(loop[far].x - loop[0].x, loop[far].y - loop[0].y)) far = i;
  });
  const first = douglasPeucker(loop.slice(0, far + 1), tolerance);
  const second = douglasPeucker([...loop.slice(far), loop[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function douglasPeucker(path: readonly Vec2[], tolerance: number): Vec2[] {
  const [a, b] = [path[0], path[path.length - 1]];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let [worst, at] = [0, -1];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const d = len === 0 ? Math.hypot(p.x - a.x, p.y - a.y) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tolerance) return [a, b];
  return [...douglasPeucker(path.slice(0, at + 1), tolerance).slice(0, -1), ...douglasPeucker(path.slice(at), tolerance)];
}
