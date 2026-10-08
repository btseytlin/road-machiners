// The ring around a hovered truck. It is rebuilt only when the truck's radius changes.

import * as THREE from 'three';
import { PHYSICS } from '../../data/physics';
import { PAL } from '../../render/palette';
import { groundPoint, toMap, type VehicleFrame } from '../../phys/frames';
import type { Terrain } from '../../sim/terrain';

const RING = { gap: 0.45, width: 0.06, alpha: 0.9, lift: 0.02 };

export class PickRing {
  readonly mesh = new THREE.Mesh(
    new THREE.RingGeometry(1, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PAL.select, transparent: true, opacity: RING.alpha, depthWrite: false, side: THREE.DoubleSide }),
  );

  constructor() {
    this.mesh.renderOrder = 5;
  }

  // Shows the ring around a truck of the given radius in tiles, or hides it when there is none.
  place(terrain: Terrain, frame: VehicleFrame | undefined, radius: number): void {
    this.mesh.visible = !!frame;
    if (!frame) return;
    const S = PHYSICS.metersPerTile;
    const r = radius + RING.gap;
    const geo = this.mesh.geometry;
    if (geo.parameters.outerRadius !== (r + RING.width / 2) * S) {
      geo.dispose();
      this.mesh.geometry = new THREE.RingGeometry((r - RING.width / 2) * S, (r + RING.width / 2) * S, 48).rotateX(-Math.PI / 2);
    }
    const p = groundPoint(terrain, toMap(frame.pos));
    this.mesh.position.set(p.x, p.y + RING.lift * S, p.z);
  }
}
