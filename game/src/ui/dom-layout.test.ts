import { describe, expect, it } from "vitest";
import { clipped, escapes, latinLeft, pairOverlaps } from "./dom";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("clipped", () => {
  const fits = { clientWidth: 100, clientHeight: 20, scrollWidth: 100, scrollHeight: 20 };
  const wide = { ...fits, scrollWidth: 140 };

  it("reports content wider than a box that clips sideways", () => {
    expect(clipped(wide, { x: true, y: false })).toBe(true);
  });

  it("lets content overflow a box that does not clip on that axis", () => {
    expect(clipped(wide, { x: false, y: true })).toBe(false);
  });

  it("forgives a pixel of rounding", () => {
    expect(clipped({ ...fits, scrollWidth: 101 }, { x: true, y: true })).toBe(false);
  });
});

describe("escapes", () => {
  it("reports text that pokes out of its clipping box", () => {
    expect(escapes(box(90, 0, 130, 20), box(0, 0, 100, 40))).toBe(true);
  });

  it("keeps text inside its box, and ignores an empty text box", () => {
    expect(escapes(box(10, 5, 90, 20), box(0, 0, 100, 40))).toBe(false);
    expect(escapes(box(500, 500, 500, 500), box(0, 0, 100, 40))).toBe(false);
  });
});

describe("pairOverlaps", () => {
  it("names each overlapping pair once", () => {
    expect(pairOverlaps([box(0, 0, 50, 20), box(40, 0, 90, 20), box(200, 0, 250, 20)])).toEqual([[0, 1]]);
  });

  it("lets touching boxes be", () => {
    expect(pairOverlaps([box(0, 0, 50, 20), box(50, 0, 90, 20)])).toEqual([]);
  });
});

describe("latinLeft", () => {
  it("finds Latin words in Russian text", () => {
    expect(latinLeft("Доставить Salt", [])).toBe(true);
  });

  it("lets allowed names and single letters stay", () => {
    expect(latinLeft("Бродяга Ada Voss", ["Ada Voss"])).toBe(false);
    expect(latinLeft("Ремонт [R], форсированный V8", [])).toBe(false);
  });
});
