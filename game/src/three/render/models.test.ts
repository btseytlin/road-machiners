import { describe, expect, it } from 'vitest';
import { Mesh, type MeshLambertMaterial } from 'three';
import { loadModels, model, socket } from './models';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
const progress: [number, number][] = [];
await loadModels(
  async (name) => {
    const url = FILES[`/public/models/${name}.glb`];
    if (!url) throw new Error(`Missing model file for ${name}`);
    return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
  },
  (done, total) => progress.push([done, total]),
);

describe('loadModels progress', () => {
  it('reports 0 first, then one more file each time, ending at the total', () => {
    const total = progress[0][1];
    expect(total).toBe(Object.keys(FILES).length);
    expect(progress.map(([done]) => done)).toEqual(Array.from({ length: total + 1 }, (_, i) => i));
    expect(progress.every(([, t]) => t === total)).toBe(true);
  });
});

function materialsOf(name: Parameters<typeof model>[0]): MeshLambertMaterial[] {
  const found: MeshLambertMaterial[] = [];
  model(name).traverse((o) => {
    if (o instanceof Mesh) found.push(...(Array.isArray(o.material) ? o.material : [o.material]));
  });
  return found;
}

describe('model materials', () => {
  it('lights a glow material with its own color (IV21)', () => {
    const glow = materialsOf('fort_patchwork_tower').filter((m) => m.name === 'glow');
    expect(glow.length).toBeGreaterThan(0);
    for (const m of glow) expect(m.emissive.getHex()).toBe(m.color.getHex());
  });

  it('leaves every other material unlit', () => {
    const plain = materialsOf('fort_patchwork_tower').filter((m) => m.name !== 'glow');
    expect(plain.length).toBeGreaterThan(0);
    for (const m of plain) expect(m.emissive.getHex(), m.name).toBe(0);
  });
});

describe('nose_rise sockets', () => {
  it('holds the ship on two hull-axis points that pitch it 6 to 10 degrees nose-up', () => {
    const front = socket('nose_rise', 'ship_front');
    const rear = socket('nose_rise', 'ship_rear');
    expect(front.x).toBeGreaterThan(rear.x);
    expect(front.z).toBeCloseTo(rear.z, 6);
    const pitch = (Math.atan2(front.y - rear.y, front.x - rear.x) * 180) / Math.PI;
    expect(pitch).toBeGreaterThanOrEqual(6);
    expect(pitch).toBeLessThanOrEqual(10);
  });
});
