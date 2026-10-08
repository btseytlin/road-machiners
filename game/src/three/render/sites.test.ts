import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { loadModels } from './models';
import { buildSites } from './sites';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { siteGates } from '../../sim/sites';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
const sites = buildSites({ size: 1, heights: [0, 0, 0, 0], types: ['hardpan'] });

function measureSite(id: string): Vector3 {
  const site = sites.getObjectByName(`landmark-${id}`);
  if (!site) throw new Error(`Missing site ${id}`);
  return new Box3().setFromObject(site).getSize(new Vector3());
}

function outsideEdge(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.outsideEdge) return true;
  return false;
}

describe('landmark scale', () => {
  it('builds inhabited settlements rather than truck-sized props', () => {
    for (const id of ['bowl', 'nose']) {
      const size = measureSite(id);
      expect(size.x).toBeGreaterThan(180);
      expect(size.z).toBeGreaterThan(180);
      expect(sites.getObjectByName(`landmark-${id}`)!.userData.homes).toBeGreaterThan(30);
    }
  });

  it('walls each town with a gate per road', () => {
    for (const id of ['bowl', 'nose']) {
      const town = sites.getObjectByName(`landmark-${id}`)!;
      expect(town.userData.wallSections).toBeGreaterThan(40);
      expect(town.userData.gates).toBe(2);
    }
  });

  it('closes every site with an edge and shut doors at each gate', () => {
    for (const site of [...REGION.towns, ...REGION.locations]) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeGreaterThan(5);
      expect(group.userData.gates, site.id).toBe(siteGates(site).length);
      expect(group.userData.doors, site.id).toBe(2 * siteGates(site).length);
    }
  });

  it('draws each edge on the collision edge, at most 1.5 tiles thick', () => {
    for (const site of [...REGION.towns, ...REGION.locations]) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      const reach = group.userData.edgeReach as [number, number];
      expect(reach[0], site.id).toBeGreaterThan(site.radius - 1.5);
      expect(reach[1], site.id).toBeLessThanOrEqual(site.radius + 0.01);
    }
  });

  it('keeps everything a truck could touch inside the site edge', () => {
    const S = PHYSICS.metersPerTile;
    const reach = 1;
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of [...REGION.towns, ...REGION.locations]) {
      let worst = 0;
      sites.getObjectByName(`landmark-${site.id}`)!.traverse((o) => {
        if (!(o instanceof Mesh) || outsideEdge(o)) return;
        o.updateWorldMatrix(true, false);
        const pos = o.geometry.getAttribute('position');
        const copies = o instanceof InstancedMesh ? o.count : 1;
        for (let k = 0; k < copies; k++) {
          const at = o.matrixWorld.clone();
          if (o instanceof InstancedMesh) at.multiply(o.getMatrixAt(k, m));
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(at);
            if (v.y > reach * S) continue;
            worst = Math.max(worst, Math.hypot(v.x / S - site.pos.x, v.z / S - site.pos.y) - site.radius);
          }
        }
      });
      expect.soft(worst, site.id).toBeLessThanOrEqual(0.05);
    }
  });

  it('gives the orchard a field-sized footprint and the ship a larger hull', () => {
    const orchard = measureSite('orchard');
    expect(orchard.x).toBeGreaterThan(80);
    expect(orchard.z).toBeGreaterThan(80);
    expect(measureSite('fallen-sun').x).toBeGreaterThan(250);
  });
});
