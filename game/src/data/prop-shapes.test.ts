// Every prop shape in prop-shapes.json matches its current model file (IV2). A stale hash means the model
// changed after the last npm run models:shapes.

import { describe, expect, it } from 'vitest';
import SHAPES from './prop-shapes.json';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?url&inline', import: 'default' });
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

  it('keeps model axes: the gas station sign stands at +x, +y and its kiosk at -x', () => {
    const boxes = SHAPES.gas_station.boxes;
    const sign = boxes.reduce((a, b) => (b.z1 > a.z1 ? b : a));
    expect(sign.x0).toBeGreaterThan(4.5);
    expect(sign.y0).toBeGreaterThan(2.5);
    expect(boxes.some((b) => b.x0 < -6 && b.x1 < -2 && b.z1 > 2.5)).toBe(true);
  });
});
