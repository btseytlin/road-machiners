import * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import { PAL } from "../../render/palette";
import { vehicleStats } from "../../sim/stats";
import type { Vehicle, World } from "../../sim/types";
import { groundPoint, toMap, type VehicleFrame } from "../../phys/frames";

type RingLook = { gap: number; width: number; alpha: number; lift: number };

// The circle under the hovered vehicle, which a click inspects. Sizes are in tiles.
const PICK_RING: RingLook = { gap: 0.45, width: 0.06, alpha: 0.9, lift: 0.02 };

// Ground rings under the vehicle a click would pick.
export class PickRings {
  private readonly pick = ringMesh(PICK_RING);

  constructor(scene: THREE.Scene) {
    scene.add(this.pick);
  }

  placePick(world: World, v: Vehicle | undefined, f: VehicleFrame | undefined, hide: boolean): void {
    this.pick.visible = !hide && !!v && !!f;
    if (v && f && !hide) place(this.pick, world, v, f, PICK_RING);
  }
}

function ringMesh(look: RingLook): THREE.Mesh<THREE.RingGeometry> {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PAL.select, transparent: true, opacity: look.alpha, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.renderOrder = 5;
  return ring;
}

// The ring is rebuilt only when the vehicle's radius changes.
function place(ring: THREE.Mesh<THREE.RingGeometry>, world: World, v: Vehicle, f: VehicleFrame, look: RingLook): void {
  const S = PHYSICS.metersPerTile;
  const r = vehicleStats(world, v).radius + look.gap;
  if (ring.geometry.parameters.outerRadius !== (r + look.width / 2) * S) {
    ring.geometry.dispose();
    ring.geometry = new THREE.RingGeometry((r - look.width / 2) * S, (r + look.width / 2) * S, 48).rotateX(-Math.PI / 2);
  }
  const p = groundPoint(world.terrain, toMap(f.pos));
  ring.position.set(p.x, p.y + look.lift * S, p.z);
}
