// Writes src/data/truck-shapes.json: the collision boxes of every base_* truck model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a base model changes.
// The shape test fails while a stored hash differs from its .glb.

import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fnv1a, formatShapes, heightMap, loadTriangles, shapeOf } from './shape-lib.mjs';

const OUT = 'src/data/truck-shapes.json';
const CFG = {
  cell: 0.25,
  ground: -Infinity,
  gap: 0.25,
  band: 0.25,
  costHeight: 1,
  maxBoxes: 12,
  rays: 4,
  rayShift: { x: 0.0137, y: 0.0291 },
};

const HEIGHT_CELL = 0.1;

const names = readdirSync('public/models').filter((f) => /^base_.*\.glb$/.test(f)).map((f) => f.replace('.glb', '')).sort();
const shapes = {};
for (const name of names) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const tris = await loadTriangles(bytes);
  const boxes = shapeOf(tris, CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes, heights: heightMap(tris, HEIGHT_CELL) };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${names.length} models`);
