import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { loadModels } from './models';
import { buildSites } from './sites';
import { PHYSICS } from '../../data/physics';
import { REGION } from '../../data/region';
import { siteGates } from '../../sim/sites';
import { deckAt, deckById } from '../../sim/bridge';
import { TEST_MAP } from '../../test/map';

// The model files as base64 data URLs, since tests run without a server.
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

// Pieces marked outsideEdge, like Canyon Bridge, lie outside their site on purpose.
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
    for (const site of [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')]) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      expect(group.userData.wallSections, site.id).toBeGreaterThan(5);
      expect(group.userData.gates, site.id).toBe(siteGates(site).length);
      expect(group.userData.doors, site.id).toBe(2 * siteGates(site).length);
    }
  });

  it('draws each edge on the collision edge, at most 1.5 tiles thick', () => {
    for (const site of [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')]) {
      const group = sites.getObjectByName(`landmark-${site.id}`)!;
      const reach = group.userData.edgeReach as [number, number];
      expect(reach[0], site.id).toBeGreaterThan(site.radius - 1.5);
      expect(reach[1], site.id).toBeLessThanOrEqual(site.radius + 0.01);
    }
  });

  it('keeps everything a truck could touch inside the site edge', () => {
    const S = PHYSICS.metersPerTile;
    const reach = 1; // tiles above the ground a truck body reaches
    const v = new Vector3();
    const m = new Matrix4();
    for (const site of [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')]) {
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
});

describe('deck models', () => {
  const S = PHYSICS.metersPerTile;
  const onMap = buildSites(TEST_MAP.terrain);

  it('grey by a point on their own deck centre line, in a tile whose centre is on that deck', () => {
    for (const [name, id] of [['landmark-canyon-bridge', 'canyon-bridge'], ['landmark-wing-deck', 'broken-wing']] as const) {
      const deck = deckById(id);
      const meshes: Mesh[] = [];
      onMap.getObjectByName(name)!.traverse((o) => {
        if (o instanceof Mesh && o.geometry.getAttribute('sightAt')) meshes.push(o);
      });
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const at = mesh.geometry.getAttribute('sightAt');
        expect(at.itemSize).toBe(2);
        expect(at.count).toBe(mesh.geometry.getAttribute('position').count);
        for (let i = 0; i < at.count; i++) {
          const x = at.getX(i) / S;
          const y = at.getY(i) / S;
          const along = (x - deck.from.x) * deck.axis.x + (y - deck.from.y) * deck.axis.y;
          const across = (y - deck.from.y) * deck.axis.x - (x - deck.from.x) * deck.axis.y;
          expect(Math.abs(across)).toBeLessThan(1e-3);
          expect(along).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-3);
          expect(along).toBeLessThanOrEqual(deck.length - Math.SQRT1_2 + 1e-3);
          expect(deckAt(Math.floor(x) + 0.5, Math.floor(y) + 0.5)?.deck).toBe(deck);
        }
      }
    }
  });

  it('are the only site meshes with sight sample points', () => {
    const decks = ['landmark-canyon-bridge', 'landmark-wing-deck'].map((n) => onMap.getObjectByName(n)!);
    const bridgeModel = (o: Object3D) => {
      for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.outsideEdge || p === decks[1]) return true;
      return false;
    };
    onMap.traverse((o) => {
      if (o instanceof Mesh && !bridgeModel(o)) expect(o.geometry.getAttribute('sightAt'), o.name).toBeUndefined();
    });
  });
});
