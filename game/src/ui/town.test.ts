import { describe, expect, it } from "vitest";
import { shortBy } from "./town";

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
