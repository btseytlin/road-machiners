import { describe, expect, it } from "vitest";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import { emptyWorld } from "../sim/testkit";
import type { World } from "../sim/types";
import { TruckControls } from "./truck-controls";

function controls(world: World) {
  const host = { world, revs: 0, applied: 0 };
  const c = new TruckControls({
    world: () => host.world,
    apply: (next) => { host.world = next; host.applied++; },
    refreshPlan: () => {},
    doused: () => {},
    revved: () => { host.revs++; },
  });
  return { c, host };
}

describe("the overdrive key", () => {
  it("switches overdrive on with a rev, and off again", () => {
    const { c, host } = controls(emptyWorld());
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(true);
    expect(host.revs).toBe(1);
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(false);
    expect(host.revs).toBe(1);
  });

  it("does nothing while the engine is too worn", () => {
    const w = emptyWorld();
    mountedParts(playerVehicle(w), "engine")[0].hp = 1;
    const { c, host } = controls(w);
    c.toggleOverdrive();
    expect(host.world.player.overdrive).toBe(false);
    expect(host.applied).toBe(0);
    expect(host.revs).toBe(0);
  });
});
