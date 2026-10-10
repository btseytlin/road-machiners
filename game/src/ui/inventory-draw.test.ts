import { describe, expect, it } from "vitest";
import { CRATE_MASS } from "../data/goods";
import { makePart } from "../sim/factory";
import { emptyWorld } from "../sim/testkit";
import type { GridItem, Rot } from "../sim/types";
import { resolve } from "../text/resolve";
import { itemState, nextRot } from "./inventory-draw";
import { kg } from "./units";

const world = emptyWorld();
const item = (defId: string, rot: Rot): GridItem => ({ kind: "part", id: "i", x: 0, y: 0, rot, part: makePart(world, defId, 0) });
const crate = (good: string): GridItem => ({ id: good, x: 0, y: 0, rot: 0, kind: "good", good });

describe("goods cells", () => {
  it("say every good is a crate of the one crate mass", () => {
    for (const good of ["electronics", "tools"]) expect(resolve(itemState(crate(good), false), "en")).toBe(`Crate, ${resolve(kg(CRATE_MASS), "en")}`);
    expect(resolve(kg(CRATE_MASS), "en")).toBe("50 kg");
  });
});

describe("nextRot", () => {
  it("turns a gun through all four quarters", () => {
    const seen: Rot[] = [];
    let rot: Rot = 0;
    for (let i = 0; i < 4; i++) {
      rot = nextRot(item("mg", rot));
      seen.push(rot);
    }
    expect(seen).toEqual([1, 2, 3, 0]);
  });

  it("toggles any other part between 0 and 1", () => {
    expect(nextRot(item("stockEngine", 0))).toBe(1);
    expect(nextRot(item("stockEngine", 1))).toBe(0);
  });

  it("sends a non-gun at 2 or 3 back into the 0 and 1 toggle", () => {
    expect(nextRot(item("stockEngine", 2))).toBe(0);
    expect(nextRot(item("stockEngine", 3))).toBe(0);
  });
});
