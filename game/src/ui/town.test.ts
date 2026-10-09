import { describe, expect, it } from "vitest";
import { pressureHint, shortBy } from "./town";
import type { ShopDef } from "../data/market";
import type { ShopState } from "../sim/market";

describe("the reason a purchase is out of reach", () => {
  it("is empty when the money covers the price", () => {
    expect(shortBy(1000, 1000)).toBe("");
    expect(shortBy(5000, 1000)).toBe("");
  });

  it("names the missing money in whole M", () => {
    expect(shortBy(0, 1200)).toBe("Need 12 M's more");
  });

  it("counts a debt into what is missing", () => {
    expect(shortBy(-300, 1200)).toBe("Need 15 M's more");
  });
});

describe("the price hint of a good", () => {
  const def = { makes: ["salt"], needs: ["scrap"] } as unknown as ShopDef;
  const state = (pressure: Record<string, number>) => ({ pressure }) as unknown as ShopState;

  it("tints a made good as cheap and a needed good as dear", () => {
    expect(pressureHint(def, state({}), "salt")).toEqual({ tone: "good", title: "Cheap here" });
    expect(pressureHint(def, state({}), "scrap")).toEqual({ tone: "bad", title: "Dear here" });
  });

  it("says nothing about a good the shop neither makes nor needs", () => {
    expect(pressureHint(def, state({}), "parts")).toBeNull();
  });

  it("lets a strong price pressure outrank what the shop makes", () => {
    expect(pressureHint(def, state({ salt: 1 }), "salt")).toEqual({ tone: "bad", title: "Short here" });
    expect(pressureHint(def, state({ scrap: -1 }), "scrap")).toEqual({ tone: "good", title: "Flooded here" });
  });
});
