// Writes src/data/prop-shapes.json: the collision boxes of every static prop model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a prop model changes.
// The shape test fails while a stored hash differs from its .glb.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fnv1a, formatShapes, loadTriangles, shapeOf } from './shape-lib.mjs';

const PROP_MODELS = [
  'billboard',
  'bridge_broken',
  'building',
  'crag',
  'crates',
  'fence',
  'gas_station',
  'junk',
  'power_pole',
  'rock',
  'ruin_house',
  'shack',
  'silo',
  'tank_hulk',
  'water_tower',
  'wreck',
];

const OUT = 'src/data/prop-shapes.json';
const CFG = {
  cell: 0.5,
  ground: 0.15,
  gap: 0.5,
  band: 0.5,
  costHeight: 2,
  maxBoxes: 32,
  rays: 4,
  rayShift: { x: 0.0137, y: 0.0291 },
};

const shapes = {};
for (const name of PROP_MODELS) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const boxes = shapeOf(await loadTriangles(bytes), CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${PROP_MODELS.length} models`);

