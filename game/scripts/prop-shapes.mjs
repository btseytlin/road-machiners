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
  'cargo_pod',
  'crates',
  'dead_tree',
  'drums',
  'engine_frame',
  'engine_nozzle',
  'engine_section',
  'farmhouse',
  'fence',
  'fort_compound_gate',
  'fort_compound_tower',
  'fort_compound_wall',
  'fort_masonry_bastion',
  'fort_masonry_gate',
  'fort_masonry_inner',
  'fort_masonry_tower',
  'fort_masonry_wall',
  'fort_patchwork_gate',
  'fort_patchwork_tower',
  'fort_patchwork_wall',
  'fort_ring_gate',
  'fort_ring_wall',
  'fort_scrap_bastion',
  'fort_scrap_gate',
  'fort_scrap_inner',
  'fort_scrap_tower',
  'fort_scrap_wall',
  'fort_ship_gate',
  'fort_ship_tower',
  'fort_ship_wall',
  'fort_yard_gate',
  'fort_yard_tower',
  'fort_yard_wall',
  'gas_station',
  'glass_spire',
  'guard_post',
  'hull_bay',
  'hull_chunk',
  'hull_drum',
  'hull_gantry',
  'hull_shard',
  'hull_shell',
  'hull_tower',
  'junk',
  'nose_crag',
  'nose_rise',
  'power_pole',
  'quonset',
  'reactor',
  'rim_rock',
  'rock',
  'sandbags',
  'ruin_compound',
  'ruin_house',
  'scrap_wall',
  'shack',
  'ship_bow',
  'ship_cage',
  'ship_hub',
  'silo',
  'tank_hulk',
  'tank_trap',
  'ship_wing',
  'watchtower',
  'escape_pod',
  'habitat_cylinder',
  'wing_shard',
  'power_cell',
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

const SPLIT_AT_CLEARANCE = new Set(['dead_tree', 'engine_frame', 'engine_nozzle']);
const CLEARANCE = 2.8;
const LOW_BOXES = 8;

function splitShapeOf(triangles) {
  const boxes = mergeCells(rasterize(triangles, CFG), CFG);
  const low = boxes.filter((b) => b.z0 < CLEARANCE);
  const high = boxes.filter((b) => b.z0 >= CLEARANCE);
  const lowCap = Math.min(low.length, LOW_BOXES);
  return [...capBoxes(low, { ...CFG, maxBoxes: lowCap }), ...capBoxes(high, { ...CFG, maxBoxes: CFG.maxBoxes - lowCap })].map(roundBox);
}

const MASS_CFG = {
  ...CFG,
  cell: 2,
  band: 64,
  maxBoxes: 96,
};
const MASSES = new Set(['nose_rise', 'nose_crag']);

const shapes = {};
for (const name of PROP_MODELS) {
  const bytes = readFileSync(`public/models/${name}.glb`);
  const triangles = await loadTriangles(bytes);
  const boxes = SPLIT_AT_CLEARANCE.has(name) ? splitShapeOf(triangles) : shapeOf(triangles, MASSES.has(name) ? MASS_CFG : CFG);
  shapes[name] = { hash: fnv1a(bytes), boxes };
  console.log(`${name}: ${boxes.length} boxes`);
}
writeFileSync(`${OUT}.tmp`, formatShapes(shapes));
renameSync(`${OUT}.tmp`, OUT);
console.log(`${OUT}: ${PROP_MODELS.length} models`);

