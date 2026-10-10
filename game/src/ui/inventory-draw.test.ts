import { describe, expect, it } from "vitest";
import { CRATE_MASS } from "../data/goods";
import type { GridItem } from "../sim/types";
import { resolve } from "../text/resolve";
import { itemState } from "./inventory-draw";
import { kg } from "./units";

const crate = (good: string): GridItem => ({ id: good, x: 0, y: 0, rot: 0, kind: "good", good });

describe("goods cells", () => {
  it("say every good is a crate of the one crate mass", () => {
    for (const good of ["electronics", "tools"]) expect(resolve(itemState(crate(good), false), "en")).toBe(`Crate, ${resolve(kg(CRATE_MASS), "en")}`);
    expect(resolve(kg(CRATE_MASS), "en")).toBe("50 kg");
  });
});
