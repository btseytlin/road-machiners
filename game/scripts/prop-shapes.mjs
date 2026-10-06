// Writes src/data/prop-shapes.json: the collision boxes of every static prop model in public/models/.
// scripts/shape-lib.mjs explains how boxes come from a model. Rerun after a prop model changes.
// The shape test fails while a stored hash differs from its .glb.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { capBoxes, fnv1a, formatShapes, loadTriangles, mergeCells, rasterize, roundBox, shapeOf } from './shape-lib.mjs';

// Every model a static prop view draws: landmark looks, fortress pieces, buildings, wrecks, rocks and junk piles.
// Site decor keeps its circle, so its models are not here.
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
  cell: 0.5, // m, fine enough for a post or a fence rail, coarse enough to keep few boxes
  ground: 0.15, // m, geometry wholly below this, like a concrete apron or a ground skirt, never blocks a wheel
  gap: 0.5, // m, a vertical gap narrower than this is filled, since nothing passes through it
  band: 0.5, // m, cells merge into one box when their slabs start and end in the same bands
  costHeight: 2, // m, about a truck's height, see capBoxes()
  maxBoxes: 32, // keeps the ruin walls and the gas station posts apart, and still few colliders per prop (PC1)
  rays: 4, // rays per cell side, 12.5 cm apart, so no post or wall slips between them
  rayShift: { x: 0.0137, y: 0.0291 },
};

// Models whose boxes must keep the line at truck clearance: a box that starts at or above it blocks neither driving
// nor nav, so a dead tree's crown must not merge down into its trunk. CLEARANCE is PHYSICS.truckClearance in
// src/data/physics.ts, and src/data/prop-shapes.test.ts checks the dead tree's low boxes against it.
const SPLIT_AT_CLEARANCE = new Set(['dead_tree']);
const CLEARANCE = 2.8; // m
const LOW_BOXES = 8; // of CFG.maxBoxes, for the boxes that start below clearance

// Boxes below and above clearance merge apart, so each low box keeps the footprint of what stands below clearance.
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

