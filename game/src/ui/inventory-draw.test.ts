import { describe, expect, it } from "vitest";
import { CRATE_MASS } from "../data/goods";
import type { GridItem } from "../sim/types";
import { itemState, itemTitle } from "./inventory-draw";
import { kg } from "./units";

const crate = (good: string): GridItem => ({ id: good, x: 0, y: 0, rot: 0, kind: "good", good });

describe("goods cells", () => {
  it("say every good is a crate of the one crate mass", () => {
    for (const good of ["electronics", "tools"]) expect(itemState(crate(good), false)).toBe(`Crate, ${kg(CRATE_MASS)}`);
    expect(itemTitle(crate("tools"), false)).toBe(`Machine tools, crate of ${kg(CRATE_MASS)}`);
    expect(kg(CRATE_MASS)).toBe("50 kg");
  });
});
