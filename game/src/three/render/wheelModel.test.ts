// The shared wheel model reads as one tire: mirror-symmetric tread, a 1 m frame, and a round side outline.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { loadModels, model } from './models';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

function worldVertices(root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  });
  return out;
}

const key = (x: number, y: number, z: number) => [x, y, z].map((v) => (Math.round(v * 1e4) / 1e4 || 0).toFixed(4)).join(',');

describe('wheel model', () => {
  const verts = worldVertices(model('wheel'));

  it('is mirror-symmetric across the plane normal to the axle', () => {
    const keys = new Set(verts.map((v) => key(v.x, v.y, v.z)));
    const missing = verts.filter((v) => !keys.has(key(v.x, v.y, -v.z))).slice(0, 5).map((v) => key(v.x, v.y, v.z));
    expect(missing).toEqual([]);
  });

  it('keeps the 1 m frame centred on the hub', () => {
    const reach = Math.max(...verts.map((v) => Math.hypot(v.x, v.y)));
    expect(reach).toBeGreaterThanOrEqual(0.99);
    expect(reach).toBeLessThanOrEqual(1.01);
    expect(Math.max(...verts.map((v) => Math.abs(v.z)))).toBeLessThanOrEqual(0.5);
    const box = new THREE.Box3().setFromPoints(verts);
    const c = box.getCenter(new THREE.Vector3());
    expect(Math.hypot(c.x, c.y, c.z)).toBeLessThan(0.01);
  });

  it('reads round from the side', () => {
    const scene = model('wheel');
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const mats = meshes.map((m) => m.material as THREE.Material);
    for (const m of mats) m.side = THREE.DoubleSide;
    const ray = new THREE.Raycaster();
    const outline: number[] = [];
    for (let i = 0; i < 72; i++) {
      const a = (Math.PI * 2 * (i + 0.5)) / 72;
      let best = 0;
      for (let s = -4; s <= 4; s++) {
        const z = s * 0.1;
        ray.set(new THREE.Vector3(Math.cos(a) * 2, Math.sin(a) * 2, z), new THREE.Vector3(-Math.cos(a), -Math.sin(a), 0));
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit) best = Math.max(best, 2 - hit.distance);
      }
      outline.push(best);
    }
    expect(Math.min(...outline) / Math.max(...outline)).toBeGreaterThanOrEqual(0.92);
  });
});
