import { describe, expect, it } from "vitest";
import { focusAfter } from "./part-rows";

describe("where focus goes after a part list redraws", () => {
  it("stays on the focused row when it is still listed", () => {
    expect(focusAfter(["a", "b", "c"], "b", ["a", "b", "c"])).toBe("b");
  });

  it("moves to the next surviving row when a middle row is gone", () => {
    expect(focusAfter(["a", "b", "c"], "b", ["a", "c"])).toBe("c");
  });

  it("moves to the previous row when the last row is gone", () => {
    expect(focusAfter(["a", "b", "c"], "c", ["a", "b"])).toBe("b");
  });

  it("goes nowhere when the list is empty", () => {
    expect(focusAfter(["a"], "a", [])).toBeNull();
  });

  it("throws for a focused row the old list never had", () => {
    expect(() => focusAfter(["a"], "z", ["a"])).toThrow();
  });
});
