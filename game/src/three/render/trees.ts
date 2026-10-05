// Dead trees drawn as one instanced model per terrain chunk, like map rocks. A grove holds hundreds of trees, so
// one view each would cost a draw call per tree. A broken tree's instance hides, and it shows again when the tree
// grows back. Only the trees baked into the map are drawn here.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { propPose, propReach, type PropPose } from '../../sim/mapgen';
import { propBase } from '../../sim/bridge';
import type { Terrain } from '../../sim/terrain';
import type { Obstacle } from '../../sim/types';
import { dist } from '../../sim/vec';
import { instancedModel } from './models';
import type { RenderScope } from './scope';
import { TERRAIN_CHUNK } from './terrain';

const S = PHYSICS.metersPerTile;
const ZERO = new Float32Array(16); // a zero matrix collapses an instance to a point, so nothing of it draws

type Landmark = Extract<Obstacle, { kind: 'landmark' }>;
// Where a tree's instance lives: the meshes of its chunk's model and its index in each. standing holds the
// instance matrices of each mesh as built, so a tree that grows back gets its pose again.
type Slot = { meshes: THREE.InstancedMesh[]; standing: Float32Array[]; index: number };

export class TreeInstances {
  private readonly slots = new Map<string, Slot>();
  private readonly hidden = new Set<string>();

  constructor(scope: RenderScope, terrain: Terrain, trees: readonly Landmark[]) {
    for (const list of byChunk(trees).values()) this.addChunk(scope, terrain, list);
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  hide(id: string): void {
    const slot = this.slotOf(id);
    if (this.hidden.has(id)) return;
    this.hidden.add(id);
    for (const mesh of slot.meshes) setInstance(mesh, slot.index, ZERO);
  }

  show(id: string): void {
    const slot = this.slotOf(id);
    if (!this.hidden.delete(id)) return;
    slot.meshes.forEach((mesh, i) => setInstance(mesh, slot.index, slot.standing[i].subarray(slot.index * 16, slot.index * 16 + 16)));
  }

  private slotOf(id: string): Slot {
    const slot = this.slots.get(id);
    if (!slot) throw new Error(`Dead tree ${id} is not a baked tree; trees are drawn as fixed instances`);
    return slot;
  }

  private addChunk(scope: RenderScope, terrain: Terrain, list: readonly Landmark[]): void {
    const placements = list.map((o) => {
      const g = posed(propBase(terrain, o), propPose(o));
      g.updateMatrix();
      return g.matrix;
    });
    const group = instancedModel('dead_tree', placements, placements.map(() => 1));
    const meshes = group.children.map((m) => {
      if (!(m instanceof THREE.InstancedMesh)) throw new Error('Instanced dead_tree holds a mesh that is not instanced');
      return m;
    });
    const standing = meshes.map((m) => Float32Array.from(m.instanceMatrix.array));
    list.forEach((o, index) => this.slots.set(o.id, { meshes, standing, index }));
    const center = list.reduce((c, o) => ({ x: c.x + o.pos.x / list.length, y: c.y + o.pos.y / list.length }), { x: 0, y: 0 });
    const reach = Math.max(...list.map((o) => dist(center, o.pos) + propReach(o)));
    scope.add(group, center, reach);
  }
}

// A group at the prop's pose, standing at base height units: propBase() in src/sim/bridge.ts. A three.js turn by -yaw
// points the model's +X at map direction yaw. Model sideways is three.js z and model up is three.js y.
export function posed(base: number, pose: PropPose): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pose.pos.x * S, base * S, pose.pos.y * S);
  g.rotation.y = -pose.yaw;
  g.scale.set(pose.scale.x, pose.scale.z, pose.scale.y);
  return g;
}

function byChunk(trees: readonly Landmark[]): Map<string, Landmark[]> {
  const out = new Map<string, Landmark[]>();
  for (const o of trees) {
    if (o.look !== 'deadTree') throw new Error(`Landmark ${o.id} is a ${o.look}, not a dead tree`);
    const key = `${Math.floor(o.pos.x / TERRAIN_CHUNK)},${Math.floor(o.pos.y / TERRAIN_CHUNK)}`;
    const list = out.get(key);
    if (list) list.push(o);
    else out.set(key, [o]);
  }
  return out;
}

// The outline shares the mesh's instance matrices, so it hides and shows with it.
function setInstance(mesh: THREE.InstancedMesh, index: number, matrix: ArrayLike<number>): void {
  mesh.instanceMatrix.array.set(matrix, index * 16);
  mesh.instanceMatrix.needsUpdate = true;
}
