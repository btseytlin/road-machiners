import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import { PHYSICS } from "../../data/physics";
import type { Terrain } from "../../sim/terrain";
import { emptyWorld } from "../../sim/testkit";
import { PathView } from "./path";
import { ICARUS_KEY } from '../../sim/atlas';

const terrain: Terrain = { size: 2, heights: Array(9).fill(0), types: Array(4).fill("road"), atlas: ICARUS_KEY };

function orderIcon(path: PathView): THREE.Object3D {
  return path.root.children.find((c) => c !== path.preview)!;
}

describe("waypoint marker", () => {
  it("remains at the destination while the preview is hidden and cleared", () => {
    const path = new PathView(terrain);
    const world = emptyWorld({ x: 1, y: 1 });
    world.vehicles[0].order = { kind: "stopAt", dest: { x: 1, y: 1 } };
    path.show(false, world, false);
    path.clear();

    expect(path.preview.visible).toBe(false);
    expect(orderIcon(path).visible).toBe(true);
    expect(orderIcon(path).position.x).toBe(PHYSICS.metersPerTile);
    expect(orderIcon(path).position.z).toBe(PHYSICS.metersPerTile);

    path.show(true, world, true);
    expect(orderIcon(path).visible).toBe(false);
  });

  it("hides without an order", () => {
    const path = new PathView(terrain);
    path.show(true, emptyWorld({ x: 1, y: 1 }), false);
    expect(orderIcon(path).visible).toBe(false);
  });
});
