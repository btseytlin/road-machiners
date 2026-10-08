// Every truck shape in truck-shapes.json matches its current base model file. A stale hash means the model
// changed after the last npm run models:shapes.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from './chassis';
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
