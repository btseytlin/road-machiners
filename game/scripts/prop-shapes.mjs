// Writes src/data/prop-shapes.json: the collision boxes of every static prop model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a prop model changes.
// The shape test fails while a stored hash differs from its .glb.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { capBoxes, fnv1a, formatShapes, loadTriangles, mergeCells, rasterize, roundBox, shapeOf } from './shape-lib.mjs';

const PROP_MODELS = [
  'army_truck',
  'barn',
  'barrier',
  'billboard',
  'bridge_broken',
  'building',
  'bunker',
  'crag',
  'crates',
  'dead_tree',
  'drums',
  'farmhouse',
  'fence',
  'gas_station',
  'guard_post',
  'hull_chunk',
  'hull_drum',
  'hull_gantry',
  'hull_shard',
  'hull_shell',
  'hull_tower',
  'junk',
  'power_pole',
  'quonset',
  'reactor',
  'rim_rock',
  'rock',
  'sandbags',
  'ruin_house',
  'shack',
  'ship_bow',
  'ship_cage',
  'ship_hub',
  'silo',
  'tank_hulk',
  'tank_trap',
  'ship_wing',
  'water_tower',
  'woodpile',
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

const SPLIT_AT_CLEARANCE = new Set(['dead_tree']);
const CLEARANCE = 2.8;
const LOW_BOXES = 8;

function splitShapeOf(triangles) {
  const boxes = mergeCells(rasterize(triangles, CFG), CFG);
  const low = boxes.filter((b) => b.z0 < CLEARANCE);
  const high = boxes.filter((b) => b.z0 >= CLEARANCE);
  const lowCap = Math.min(low.length, LOW_BOXES);
  return [...capBoxes(low, { ...CFG, maxBoxes: lowCap }), ...capBoxes(high, { ...CFG, maxBoxes: CFG.maxBoxes - lowCap })].map(roundBox);
}

const shapes = {};
for (const name of PROP_MODELS) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const triangles = await loadTriangles(bytes);
  const boxes = SPLIT_AT_CLEARANCE.has(name) ? splitShapeOf(triangles) : shapeOf(triangles, CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${PROP_MODELS.length} models`);

