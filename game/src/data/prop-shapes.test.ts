// Every prop shape in prop-shapes.json matches its current model file (IV2). A stale hash means the model
// changed after the last npm run models:shapes.

import { describe, expect, it } from 'vitest';
import { FORTRESS } from './fortress';
import { PHYSICS } from './physics';
import SHAPES from './prop-shapes.json';
import TRUCKS from './truck-shapes.json';

type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

// Which boxes of a model its length measures.
const WHOLE = (): boolean => true;
// The dead tree's crown: boxes at or above truck clearance, which block neither driving nor nav.
const CROWN = (b: Box) => b.z0 >= PHYSICS.truckClearance;
// The bunker's blockhouse, without the lower sandbag ring around it: boxes that rise above 3 m.
const BLOCKHOUSE = (b: Box) => b.z1 > 3;
const ARMY_TRUCK_M = 8.1;
// The guard post is built at a 3.2 m radius, and the orchard poses it at r 1.1 tiles. Every other model in the
// table is built at its in-game size and drawn at scale 1.
const GUARD_POST_SCALE = (1.1 * PHYSICS.metersPerTile) / 3.2;

// IV11: the length of each orchard model in game, in meters, from Old Orchard's concept. Length is the extent of the
// measured boxes along the model's longer horizontal axis (x or y), times the model's pose scale.
const ORCHARD_SIZES = [
  { model: 'quonset', meters: 22, boxes: WHOLE, scale: 1 },
  { model: 'barn', meters: 24, boxes: WHOLE, scale: 1 },
  { model: 'farmhouse', meters: 26, boxes: WHOLE, scale: 1 },
  { model: 'bunker', meters: 14, boxes: BLOCKHOUSE, scale: 1 },
  { model: 'guard_post', meters: 4.5, boxes: WHOLE, scale: GUARD_POST_SCALE },
  { model: 'army_truck', meters: ARMY_TRUCK_M, boxes: WHOLE, scale: 1 },
  { model: 'dead_tree', meters: 6.5, boxes: CROWN, scale: 1 },
  { model: 'drums', meters: 2.5, boxes: WHOLE, scale: 1 },
  { model: 'woodpile', meters: 4, boxes: WHOLE, scale: 1 },
] as const;

function shapeBoxes(model: string): readonly Box[] {
  const shape = (SHAPES as Record<string, { boxes: Box[] } | undefined>)[model];
  if (shape === undefined) throw new Error(`Model ${model} has no shape in prop-shapes.json. Run npm run models:shapes.`);
  return shape.boxes;
}

// Extent along the longer horizontal axis of the boxes, in model meters.
function lengthOf(boxes: readonly Box[]): number {
  if (boxes.length === 0) throw new Error('No boxes to measure');
  const along = Math.max(...boxes.map((b) => b.x1)) - Math.min(...boxes.map((b) => b.x0));
  const across = Math.max(...boxes.map((b) => b.y1)) - Math.min(...boxes.map((b) => b.y0));
  return Math.max(along, across);
}

function orchardLength(model: string): number {
  const size = ORCHARD_SIZES.find((s) => s.model === model);
  if (size === undefined) throw new Error(`Model ${model} is not in the orchard size table`);
  return lengthOf(shapeBoxes(model).filter(size.boxes)) * size.scale;
}

describe('orchard model sizes (IV11)', () => {
  it.each(ORCHARD_SIZES)('$model is $meters m long, within 15%', ({ model, meters }) => {
    expect(Math.abs(orchardLength(model) - meters)).toBeLessThanOrEqual(meters * 0.15);
  });

  it('makes the Quonset hut at least 2.5 army trucks long', () => {
    expect(orchardLength('quonset')).toBeGreaterThanOrEqual(2.5 * orchardLength('army_truck'));
  });

  it('makes the barn at least 2.8 army trucks long', () => {
    expect(orchardLength('barn')).toBeGreaterThanOrEqual(2.8 * orchardLength('army_truck'));
  });

  it('keeps every dead tree box below truck clearance inside the 2.4 m trunk footprint', () => {
    const low = shapeBoxes('dead_tree').filter((b) => b.z0 < PHYSICS.truckClearance);
    expect(low.length).toBeGreaterThan(0);
    for (const b of low) {
      expect(Math.min(b.x0, b.y0)).toBeGreaterThanOrEqual(-1.2);
      expect(Math.max(b.x1, b.y1)).toBeLessThanOrEqual(1.2);
    }
  });

  it('fails loudly on a model missing from prop-shapes.json', () => {
    expect(() => shapeBoxes('no_such_model')).toThrow('no shape');
  });
});

// IV13: each gatehouse model's height in tiles. The masonry and scrap gates are FORTRESS.gate. The flush styles' gates
// follow C1-C5: 3 tiles for patchwork, compound, ring and yard, and 4.5 for ship metal.
const GATE_TILES: Record<string, number> = {
  fort_masonry_gate: FORTRESS.gate.height,
  fort_scrap_gate: FORTRESS.gate.height,
  fort_ship_gate: 4.5,
  fort_patchwork_gate: 3,
  fort_compound_gate: 3,
  fort_ring_gate: 3,
  fort_yard_gate: 3,
};

// The fort piece models built from C1-C5, with their footprint in meters from their kit files: along x and across y.
// limit is half the footprint the boxes must stay in across y: a 3 m wall, a 6 m tower or the gate width, so face
// detail never widens a collider past its layout rectangle.
const FORT_SIZES = [
  { model: 'fort_patchwork_wall', along: 8, across: 2.9, limit: 1.5 },
  { model: 'fort_patchwork_tower', along: 5.8, across: 5.9, limit: 3 },
  { model: 'fort_patchwork_gate', along: 5, across: 12, limit: 6 },
  { model: 'fort_compound_wall', along: 8, across: 3, limit: 1.5 },
  { model: 'fort_compound_tower', along: 5.7, across: 5.8, limit: 3 },
  { model: 'fort_compound_gate', along: 4, across: 8, limit: 4 },
  { model: 'fort_ring_wall', along: 8, across: 3, limit: 1.5 },
  { model: 'fort_ring_gate', along: 4, across: 8, limit: 4 },
  { model: 'fort_yard_wall', along: 8, across: 2.9, limit: 1.5 },
  { model: 'fort_yard_tower', along: 5.9, across: 5.9, limit: 3 },
  { model: 'fort_yard_gate', along: 4, across: 10, limit: 5 },
  { model: 'fort_ship_wall', along: 8, across: 2.9, limit: 1.5 },
  { model: 'fort_ship_tower', along: 5.4, across: 5.4, limit: 3 },
  { model: 'fort_ship_gate', along: 5.5, across: 23.4, limit: 12 },
] as const;

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?url&inline', import: 'default' });
const DATA_URL = 'data:model/gltf-binary;base64,';

// The same FNV-1a over the file bytes as scripts/prop-shapes.mjs.
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function readModel(name: string): Promise<Uint8Array> {
  const load = FILES[`/public/models/${name}.glb`];
  if (load === undefined) throw new Error(`Model public/models/${name}.glb is missing`);
  const url = await load();
  if (!url.startsWith(DATA_URL)) throw new Error(`Model ${name}.glb did not inline as base64 data`);
  return Uint8Array.from(atob(url.slice(DATA_URL.length)), (c) => c.charCodeAt(0));
}

describe('prop shapes', () => {
  const names = Object.keys(SHAPES) as (keyof typeof SHAPES)[];

  it('hashes with standard 32-bit FNV-1a', () => {
    expect(fnv1a(new TextEncoder().encode('a'))).toBe('e40c292c');
  });

  it('lists the prop models', () => {
    expect(names).toEqual(expect.arrayContaining(['building', 'fence', 'gas_station', 'ruin_house', 'rock', 'wreck']));
  });

  it.each(names)('%s matches its model file', async (name) => {
    expect(SHAPES[name].hash).toBe(fnv1a(await readModel(name)));
  });

  it.each(names)('%s has boxes with positive size', (name) => {
    const boxes = SHAPES[name].boxes;
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.x1).toBeGreaterThan(b.x0);
      expect(b.y1).toBeGreaterThan(b.y0);
      expect(b.z1).toBeGreaterThan(b.z0);
    }
  });

  it('keeps the gas station canopy high above the ground between its posts', () => {
    const boxes = SHAPES.gas_station.boxes;
    const underCanopy = boxes.filter((b) => b.x0 < 2 && b.x1 > 2 && b.y0 < 3.8 && b.y1 > 3.8);
    expect(underCanopy.length).toBeGreaterThan(0);
    for (const b of underCanopy) expect(b.z0).toBeGreaterThan(3.5);
  });

  it('leaves the road under the hoop open', () => {
    const boxes = SHAPES.ship_wing.boxes;
    const overRoad = boxes.filter((b) => b.y0 < 12 && b.y1 > -12);
    expect(overRoad.length).toBeGreaterThan(0);
    for (const b of overRoad) expect(b.z0).toBeGreaterThanOrEqual(PHYSICS.truckClearance + 1);
    const low = boxes.filter((b) => b.z0 < PHYSICS.truckClearance + 1);
    expect(low.some((b) => b.y1 <= -13)).toBe(true);
    expect(low.some((b) => b.y0 >= 13)).toBe(true);
    for (const b of low) expect(b.y1 <= -13 || b.y0 >= 13).toBe(true);
  });

  it('keeps model axes: the gas station sign stands at +x, +y and its kiosk at -x', () => {
    const boxes = SHAPES.gas_station.boxes;
    const sign = boxes.reduce((a, b) => (b.z1 > a.z1 ? b : a));
    expect(sign.x0).toBeGreaterThan(4.5);
    expect(sign.y0).toBeGreaterThan(2.5);
    expect(boxes.some((b) => b.x0 < -6 && b.x1 < -2 && b.z1 > 2.5)).toBe(true);
  });

  it('gives each gatehouse model its gate height as the parapet (IV13)', () => {
    const gates = names.filter((n) => /^fort_.*_gate$/.test(n));
    expect(gates.sort()).toEqual(Object.keys(GATE_TILES).sort());
    for (const name of gates) {
      const parapet = GATE_TILES[name] * PHYSICS.metersPerTile;
      const top = Math.max(...SHAPES[name].boxes.map((b) => b.z1));
      // Only the masonry gatehouse ends at its parapet. The others carry a post, a rail, antennae or a tower top up to 2.5 m above it, beside the gate gun.
      expect(top, name).toBeGreaterThanOrEqual(parapet - 0.5);
      // Ship metal's built-in towers rise 4 m over the catwalk to 22 m, and their antennae 2 m more.
      const over = name.includes('masonry') ? 0.5 : name.includes('ship') ? 6.5 : 2.5;
      expect(top, name).toBeLessThanOrEqual(parapet + over);
    }
  });

  it.each(FORT_SIZES)('builds $model to its kit size', ({ model, along, across, limit }) => {
    const boxes = shapeBoxes(model);
    const x = Math.max(...boxes.map((b) => b.x1)) - Math.min(...boxes.map((b) => b.x0));
    const y = Math.max(...boxes.map((b) => b.y1)) - Math.min(...boxes.map((b) => b.y0));
    expect(Math.abs(x - along), `${model} along x`).toBeLessThanOrEqual(0.2);
    expect(Math.abs(y - across), `${model} across y`).toBeLessThanOrEqual(0.2);
    expect(Math.max(...boxes.map((b) => b.y1)), model).toBeLessThanOrEqual(limit);
    expect(Math.min(...boxes.map((b) => b.y0)), model).toBeGreaterThanOrEqual(-limit);
  });

  it('keeps the flush gatehouse models behind their outer face, with no flare', () => {
    for (const { model } of FORT_SIZES.filter((s) => s.model.endsWith('_gate'))) {
      expect(Math.max(...shapeBoxes(model).map((b) => b.x1)), model).toBeLessThanOrEqual(0);
    }
  });

  it('stands every fortress piece at least 3x the tallest truck (IV4)', () => {
    const tallest = Math.max(...Object.values(TRUCKS).flatMap((t) => t.boxes.map((b) => b.z1)));
    const forts = names.filter((n) => n.startsWith('fort_'));
    expect(forts).toHaveLength(24);
    for (const name of forts) {
      expect(Math.max(...SHAPES[name].boxes.map((b) => b.z1)), name).toBeGreaterThanOrEqual(tallest * 3);
    }
  });

  // A truck drives through the cage and the shells along their length, so no box low enough to hit it crosses a
  // lane along the axis, even after the boxes merge down to the cap. Lane half-widths are in model meters.
  it.each([
    ['ship_cage', 5],
    ['hull_shell', 10],
  ] as const)('keeps a lane open through %s', (name, half) => {
    const boxes = SHAPES[name].boxes;
    const low = boxes.filter((b) => b.z0 < PHYSICS.truckClearance);
    expect(low.length).toBeGreaterThan(0);
    for (const b of low) expect(b.y1 <= -half || b.y0 >= half, JSON.stringify(b)).toBe(true);
    // The roof spans the lane.
    expect(boxes.some((b) => b.y0 < 0 && b.y1 > 0 && b.z0 >= PHYSICS.truckClearance)).toBe(true);
  });
});
