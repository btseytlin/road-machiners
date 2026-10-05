import { describe, expect, it } from 'vitest';
import { Mesh, type MeshLambertMaterial } from 'three';
import { loadModels, model, socket } from './models';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
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
    // The patchwork tower's hut lamps and windows are glow.
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
    // The nose is toward +x, the model's front. The rise stands in the site frame, so the sockets share a side of the gate.
    expect(front.x).toBeGreaterThan(rear.x);
    expect(front.z).toBeCloseTo(rear.z, 6);
    const pitch = (Math.atan2(front.y - rear.y, front.x - rear.x) * 180) / Math.PI;
    expect(pitch).toBeGreaterThanOrEqual(6);
    expect(pitch).toBeLessThanOrEqual(10);
  });
});
