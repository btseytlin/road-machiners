// Every truck shape in truck-shapes.json matches its current base model file. A stale hash means the model
// changed after the last npm run models:shapes.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from './chassis';
import { PHYSICS } from './physics';
import SHAPES from './truck-shapes.json';

const FILES = import.meta.glob<string>('/public/models/base_*.glb', { query: '?url&inline', import: 'default' });
const DATA_URL = 'data:model/gltf-binary;base64,';

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

describe('truck shapes', () => {
  const names = Object.keys(SHAPES) as (keyof typeof SHAPES)[];

  it('has a shape for the base model of every chassis', () => {
    expect(names.sort()).toEqual(Object.keys(CHASSIS).map((id) => `base_${id}`).sort());
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

  it.each(names)('%s has a 0.1 m height map with geometry under every collision box center', (name) => {
    const { heights, boxes } = SHAPES[name];
    expect(heights.cell).toBe(0.1);
    for (const b of boxes) {
      const i = Math.floor((b.x0 + b.x1) / 2 / heights.cell) - heights.i0;
      const j = Math.floor((b.y0 + b.y1) / 2 / heights.cell) - heights.j0;
      expect(heights.top[i]?.[j], `${name} box center`).toEqual(expect.any(Number));
    }
  });
});

type Profile = { x: number; top: number }[];

function profileOf(name: keyof typeof SHAPES): Profile {
  const { heights } = SHAPES[name];
  const columns = heights.top.map((row, i) => {
    let top = -Infinity;
    row.forEach((cm, j) => {
      const y = ((heights.j0 + j + 0.5) * heights.cell);
      if (cm !== null && Math.abs(y) <= 0.6) top = Math.max(top, cm / 100);
    });
    return { x: (heights.i0 + i + 0.5) * heights.cell, top };
  });
  return columns.filter((c) => c.top > -Infinity).sort((a, b) => b.x - a.x);
}

const NEAR = 0.05;

function stationsOf(profile: Profile, ground: number) {
  const nose = profile[0].x;
  const tail = profile[profile.length - 1].x;
  const length = nose - tail;
  const top = Math.max(...profile.map((p) => p.top));
  const at = (x: number) => profile.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best)).top;
  const hoodLevel = at(nose - 0.15 * length);
  const hoodEnd = profile.find((p) => Math.abs(p.top - hoodLevel) > NEAR && p.x < nose - 0.15 * length)?.x ?? tail;
  const roofCols = profile.filter((p) => top - p.top <= NEAR);
  const deckLevel = at(tail + 0.1 * length);
  const deckEnd = [...profile].reverse().find((p) => p.top - deckLevel > NEAR && p.x > tail + 0.1 * length)?.x ?? nose;
  return {
    height: top - ground,
    hood: (nose - hoodEnd) / length,
    roof: (roofCols[0].x - roofCols[roofCols.length - 1].x) / length,
    deck: (deckEnd - tail) / length,
    roofStart: (nose - roofCols[0].x) / length,
    noseDrop: top - at(nose - 0.02 * length),
    tailDrop: top - at(tail + 0.03 * length),
  };
}

type Band = [number, number];
type Reference = { height: Band; hood?: Band; roof: Band; deck?: Band; roofStart?: Band; noseDrop?: Band; tailDrop?: Band };

const REFERENCE: Record<'lincoln' | 'niva' | 'bukhanka', Reference> = {
  lincoln: { height: [1.56, 1.8], hood: [0.34, 0.42], roof: [0.14, 0.24], deck: [0.22, 0.3] },
  niva: { height: [1.89, 2.19], hood: [0.22, 0.28], roof: [0.55, 1], tailDrop: [0, 0.1] },
  bukhanka: { height: [2.34, 2.7], roof: [0.75, 1], roofStart: [0, 0.12], noseDrop: [0.15, 9], tailDrop: [0, 0.15] },
};

describe('issue 149 trucks keep their reference proportions', () => {
  it.each(['lincoln', 'niva', 'bukhanka'] as const)('%s', (id) => {
    const body = PHYSICS.bodies[id];
    const ground = body.wheelY - PHYSICS.truck.suspensionRest - body.wheelRadius;
    const got = stationsOf(profileOf(`base_${id}` as const), ground);
    const misses: string[] = [];
    for (const [key, band] of Object.entries(REFERENCE[id]) as [keyof Reference, Band][]) {
      if (got[key] < band[0] || got[key] > band[1]) misses.push(`${key} ${got[key].toFixed(3)} outside ${band[0]}..${band[1]}`);
    }
    expect(misses).toEqual([]);
  });
});
