import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { initPhysics } from '../../phys/drive';
import type { Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import { loadModels } from './models';
import { ObstacleViews } from './obstacles';
import { RenderScope, SightLimit } from './scope';
import { TreeInstances } from './trees';

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});
await initPhysics();

const SIZE = 64;

function flat(): Terrain {
  return { size: SIZE, heights: new Array<number>((SIZE + 1) * (SIZE + 1)).fill(0), types: new Array(SIZE * SIZE).fill('hardpan') };
}

function tree(id: string, x: number, y: number): Landmark {
  return { id, pos: { x, y }, r: 0.35, kind: 'landmark', look: 'deadTree', yaw: 0.3 };
}

const TREES = [tree('deadTree-0', 5, 5), tree('deadTree-1', 7, 6), tree('deadTree-2', 9, 4), tree('deadTree-3', 40, 5)];

function build(): { root: THREE.Group; trees: TreeInstances } {
  const root = new THREE.Group();
  const scope = new RenderScope(root, SIZE, new SightLimit(SIZE), true, true);
  return { root, trees: new TreeInstances(scope, flat(), TREES) };
}

function meshesOf(root: THREE.Group, chunk: string): THREE.InstancedMesh[] {
  const group = root.getObjectByName(chunk);
  if (!group) throw new Error(`Missing ${chunk}`);
  const out: THREE.InstancedMesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && !o.userData.outline) out.push(o);
  });
  return out;
}

function matricesOf(meshes: THREE.InstancedMesh[]): number[][] {
  return meshes.map((m) => Array.from(m.instanceMatrix.array));
}

function zeroInstances(mesh: THREE.InstancedMesh): number {
  let zero = 0;
  const m = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    if (m.elements.every((e) => e === 0)) zero++;
  }
  return zero;
}

describe('TreeInstances', () => {
  it('draws one instance per tree in its chunk', () => {
    const { root } = build();

    const west = meshesOf(root, 'scope-chunk-0-0');
    const east = meshesOf(root, 'scope-chunk-1-0');

    expect(west.length).toBeGreaterThan(0);
    expect(west.map((m) => m.count)).toEqual(west.map(() => 3));
    expect(east.map((m) => m.count)).toEqual(east.map(() => 1));
  });

  it('hides a broken tree and restores its pose when it grows back', () => {
    const { root, trees } = build();
    const meshes = meshesOf(root, 'scope-chunk-0-0');
    const standing = matricesOf(meshes);

    trees.hide('deadTree-1');
    const hidden = meshes.map(zeroInstances);
    trees.show('deadTree-1');

    expect(hidden).toEqual(meshes.map(() => 1));
    expect(matricesOf(meshes)).toEqual(standing);
  });

  it('leaves the other chunks alone when a tree hides', () => {
    const { root, trees } = build();
    const east = meshesOf(root, 'scope-chunk-1-0');
    const standing = matricesOf(east);

    trees.hide('deadTree-0');

    expect(matricesOf(east)).toEqual(standing);
  });

  it('knows its trees', () => {
    const { trees } = build();

    expect(trees.has('deadTree-3')).toBe(true);
    expect(trees.has('fence-1')).toBe(false);
  });

  it('throws on a tree it does not draw', () => {
    const { trees } = build();

    expect(() => trees.hide('deadTree-9')).toThrow(/deadTree-9/);
    expect(() => trees.show('deadTree-9')).toThrow(/deadTree-9/);
  });

  it('refuses a landmark that is not a dead tree', () => {
    const root = new THREE.Group();
    const scope = new RenderScope(root, SIZE, new SightLimit(SIZE), true, true);
    const fence: Landmark = { ...tree('fence-1', 5, 5), look: 'fence' };

    expect(() => new TreeInstances(scope, flat(), [fence])).toThrow(/fence-1/);
  });
});

describe('ObstacleViews dead trees', () => {
  function views(): { root: THREE.Group; obstacles: ObstacleViews } {
    const root = new THREE.Group();
    const obstacles = new ObstacleViews(new RenderScope(root, SIZE, new SightLimit(SIZE), true, true), flat());
    obstacles.sync([...TREES], [], []);
    return { root, obstacles };
  }

  it('hides a tree while it is broken and shows it again when it grows back', () => {
    const { root, obstacles } = views();
    const meshes = meshesOf(root, 'scope-chunk-0-0');
    const standing = matricesOf(meshes);

    obstacles.sync(TREES.filter((o) => o.id !== 'deadTree-2'), [], [{ obstacle: TREES[2], turn: 1 }]);
    const hidden = meshes.map(zeroInstances);
    obstacles.sync([...TREES], [], []);

    expect(meshes.length).toBeGreaterThan(0);
    expect(hidden).toEqual(meshes.map(() => 1));
    expect(matricesOf(meshes)).toEqual(standing);
  });

  it('draws no view of its own for a tree', () => {
    const { root } = views();

    const meshes = meshesOf(root, 'scope-chunk-0-0');

    expect(meshes.map((m) => m.count)).toEqual(meshes.map(() => 3));
    expect(root.getObjectByName('scope-chunk-0-0')?.children).toHaveLength(1);
  });

  it('throws on a tree that appears after the bake', () => {
    const { obstacles } = views();

    expect(() => obstacles.sync([...TREES, tree('deadTree-9', 12, 12)], [], [])).toThrow(/deadTree-9/);
  });
});
