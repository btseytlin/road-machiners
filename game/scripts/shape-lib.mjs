// Turns a model's triangles into collision boxes. The prop and truck shape scripts share it.
// Each model's triangles are rasterized on a grid of cfg.cell meters in model space. Every cell keeps the height
// slabs its geometry fills. Cells merge into boxes by height band, and then the boxes merge down to cfg.maxBoxes.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3 } from 'three';

const CM = 100;

export function shapeOf(triangles, cfg) {
  return capBoxes(mergeCells(rasterize(triangles, cfg), cfg), cfg).map(roundBox);
}

export function heightMap(triangles, cell) {
  const cfg = { cell };
  const best = new Map();
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const tri of triangles) {
    for (const [key, i, j, part] of triangleCells(tri, cfg)) {
      if (!(best.get(key) >= part.z1)) best.set(key, part.z1);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
  }
  const top = Array.from({ length: i1 - i0 + 1 }, (_, i) => Array.from({ length: j1 - j0 + 1 }, (_, j) => {
    const z = best.get(`${i + i0},${j + j0}`);
    return z === undefined ? null : Math.ceil(z * CM - 1e-6);
  }));
  return { cell, i0, j0, top };
}

export function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export async function loadTriangles(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const tris = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh) tris.push(...meshTriangles(o));
  });
  if (tris.length === 0) throw new Error('Model has no triangles');
  return tris;
}

function meshTriangles(mesh) {
  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const count = index ? index.count : pos.count;
  const corner = (i) => {
    const v = new Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    return { x: v.x, y: -v.z, z: v.y };
  };
  const tris = [];
  for (let i = 0; i < count; i += 3) tris.push([corner(i), corner(i + 1), corner(i + 2)]);
  return tris;
}

export function rasterize(tris, cfg) {
  const raw = new Map();
  for (const tri of tris) {
    for (const [key, i, j, part] of triangleCells(tri, cfg)) {
      if (!raw.has(key)) raw.set(key, { i, j, parts: [], tris: [] });
      raw.get(key).parts.push(part);
      raw.get(key).tris.push(tri);
    }
  }
  const cells = new Map();
  for (const [key, cell] of raw) {
    const slabs = joinSlabs([...cell.parts, ...cellSolids(cell, cfg)], cfg).filter((s) => s.z1 >= cfg.ground);
    if (slabs.length > 0) cells.set(key, slabs);
  }
  return cells;
}

function triangleCells(tri, cfg) {
  const out = [];
  const [i0, i1] = cellRange(tri.map((p) => p.x), cfg);
  const [j0, j1] = cellRange(tri.map((p) => p.y), cfg);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const part = extentOf(clipToCell(tri, i, j, cfg));
      if (part) out.push([`${i},${j}`, i, j, part]);
    }
  }
  return out;
}

function cellSolids(cell, cfg) {
  const spans = [];
  for (let a = 0; a < cfg.rays; a++) {
    for (let b = 0; b < cfg.rays; b++) {
      const x = (cell.i + (a + 0.5 + cfg.rayShift.x) / cfg.rays) * cfg.cell;
      const y = (cell.j + (b + 0.5 + cfg.rayShift.y) / cfg.rays) * cfg.cell;
      spans.push(...raySolids(cell.tris, x, y));
    }
  }
  return spans;
}

function raySolids(tris, x, y) {
  const hits = tris.map((t) => rayHit(t, x, y)).filter((h) => h !== null).sort((p, q) => p.z - q.z);
  const spans = [];
  let depth = 0;
  let from = 0;
  for (const h of hits) {
    if (depth === 0) from = h.z;
    depth += h.step;
    if (depth === 0) spans.push({ x0: x, x1: x, y0: y, y1: y, z0: from, z1: h.z });
  }
  if (depth !== 0) throw new Error(`Open mesh under the ray at x ${x}, y ${y}`);
  return spans;
}

function rayHit(tri, x, y) {
  const [a, b, c] = tri;
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(area) < 1e-12) return null;
  const u = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
  const v = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
  const w = 1 - u - v;
  if (u < 0 || v < 0 || w < 0) return null;
  return { z: u * a.z + v * b.z + w * c.z, step: area > 0 ? -1 : 1 };
}

function cellRange(values, cfg) {
  return [Math.floor(Math.min(...values) / cfg.cell), Math.floor(Math.max(...values) / cfg.cell)];
}

function clipToCell(tri, i, j, cfg) {
  const e = 1e-4;
  let poly = tri;
  poly = clip(poly, (p) => p.x - (i * cfg.cell + e));
  poly = clip(poly, (p) => (i + 1) * cfg.cell - e - p.x);
  poly = clip(poly, (p) => p.y - (j * cfg.cell + e));
  return clip(poly, (p) => (j + 1) * cfg.cell - e - p.y);
}

function clip(poly, inside) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const da = inside(a);
    const db = inside(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function extentOf(points) {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const zs = points.map((p) => p.z);
  return {
    x0: Math.min(...xs), x1: Math.max(...xs),
    y0: Math.min(...ys), y1: Math.max(...ys),
    z0: Math.min(...zs), z1: Math.max(...zs),
  };
}

function joinSlabs(parts, cfg) {
  const sorted = [...parts].sort((a, b) => a.z0 - b.z0);
  const slabs = [{ ...sorted[0] }];
  for (const p of sorted.slice(1)) {
    const top = slabs[slabs.length - 1];
    if (p.z0 - top.z1 < cfg.gap) Object.assign(top, union(top, p));
    else slabs.push({ ...p });
  }
  return slabs;
}

function union(a, b) {
  return {
    x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1),
    y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1),
    z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
  };
}

export function mergeCells(cells, cfg) {
  const bands = new Map();
  for (const [key, slabs] of cells) {
    const [i, j] = key.split(',').map(Number);
    for (const s of slabs) {
      const band = `${Math.floor(s.z0 / cfg.band)},${Math.ceil(s.z1 / cfg.band)}`;
      if (!bands.has(band)) bands.set(band, new Map());
      bands.get(band).set(key, { i, j, slab: s });
    }
  }
  const boxes = [];
  for (const band of [...bands.keys()].sort()) boxes.push(...coverBand(bands.get(band)));
  return boxes;
}

function coverBand(cells) {
  const left = new Map(cells);
  const order = [...cells.values()].sort((a, b) => a.j - b.j || a.i - b.i);
  const boxes = [];
  for (const start of order) {
    if (!left.has(`${start.i},${start.j}`)) continue;
    boxes.push(takeRectangle(left, start));
  }
  return boxes;
}

function takeRectangle(left, start) {
  let iEnd = start.i;
  while (left.has(`${iEnd + 1},${start.j}`)) iEnd++;
  const rowFree = (j) => Array.from({ length: iEnd - start.i + 1 }, (_, k) => `${start.i + k},${j}`).every((key) => left.has(key));
  let jEnd = start.j;
  while (rowFree(jEnd + 1)) jEnd++;
  let box = null;
  for (let j = start.j; j <= jEnd; j++) {
    for (let i = start.i; i <= iEnd; i++) {
      const { slab } = left.get(`${i},${j}`);
      box = box ? union(box, slab) : { ...slab };
      left.delete(`${i},${j}`);
    }
  }
  return box;
}

export function capBoxes(input, cfg) {
  const boxes = [...input];
  while (boxes.length > cfg.maxBoxes) {
    const [a, b] = cheapestPair(boxes, cfg);
    boxes[a] = union(boxes[a], boxes[b]);
    boxes.splice(b, 1);
  }
  return boxes;
}

function cheapestPair(boxes, cfg) {
  let best = null;
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const waste = costVolume(union(boxes[a], boxes[b]), cfg) - costVolume(boxes[a], cfg) - costVolume(boxes[b], cfg);
      if (best === null || waste < best.waste) best = { a, b, waste };
    }
  }
  return [best.a, best.b];
}

function costVolume(b, cfg) {
  return (b.x1 - b.x0) * (b.y1 - b.y0) * Math.max(b.z1 - b.z0, cfg.costHeight);
}

export function roundBox(b) {
  const down = (v) => Math.floor(v * CM + 1e-6) / CM + 0;
  const up = (v) => Math.ceil(v * CM - 1e-6) / CM + 0;
  return { x0: down(b.x0), x1: up(b.x1), y0: down(b.y0), y1: up(b.y1), z0: down(b.z0), z1: up(b.z1) };
}

export function formatShapes(all) {
  const blocks = Object.keys(all).sort().map((name) => {
    const { hash, boxes, heights } = all[name];
    const lines = boxes.map((b) => `      ${JSON.stringify(b)}`).join(',\n');
    const head = `  ${JSON.stringify(name)}: {\n    "hash": ${JSON.stringify(hash)},\n    "boxes": [\n${lines}\n    ]`;
    if (!heights) return `${head}\n  }`;
    const rows = heights.top.map((r) => `        ${JSON.stringify(r)}`).join(',\n');
    return `${head},\n    "heights": {\n      "cell": ${heights.cell},\n      "i0": ${heights.i0},\n      "j0": ${heights.j0},\n      "top": [\n${rows}\n      ]\n    }\n  }`;
  });
  return `{\n${blocks.join(',\n')}\n}\n`;
}
