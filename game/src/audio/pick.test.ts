import { describe, expect, it } from "vitest";
import { loudestAt, pickVariant, shuffled, spatial, VoiceLimiter } from "./pick";

describe("shuffled", () => {
  it("reorders a copy by its rolls and keeps every item", () => {
    const items = ["a", "b", "c", "d"];
    expect(shuffled(items, () => 0)).toEqual(["b", "c", "d", "a"]);
    expect(shuffled(items, () => 0.99)).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});

describe("pickVariant", () => {
  it("never repeats the last variant", () => {
    for (let last = 0; last < 3; last++)
      for (const roll of [0, 0.3, 0.5, 0.99]) expect(pickVariant(3, last, roll)).not.toBe(last);
  });
  it("covers every variant", () => {
    const seen = new Set([0, 0.34, 0.67, 0.99].map((r) => pickVariant(3, null, r)));
    expect(seen).toEqual(new Set([0, 1, 2]));
  });
  it("fails on a cue with no files", () => {
    expect(() => pickVariant(0, null, 0.5)).toThrow();
  });
});

describe("spatial", () => {
  it("pans left and right by screen side", () => {
    expect(spatial(0, 100, 0, 40, 0.7).pan).toBeCloseTo(-0.7);
    expect(spatial(50, 100, 0, 40, 0.7).pan).toBeCloseTo(0);
    expect(spatial(100, 100, 0, 40, 0.7).pan).toBeCloseTo(0.7);
    expect(spatial(300, 100, 0, 40, 0.7).pan).toBeCloseTo(0.7);
  });
  it("halves gain at the half-gain distance", () => {
    expect(spatial(50, 100, 0, 40, 0.7).gain).toBe(1);
    expect(spatial(50, 100, 40, 40, 0.7).gain).toBeCloseTo(0.5);
  });
});

describe("VoiceLimiter", () => {
  it("caps sounding plays and frees them when they end", () => {
    const v = new VoiceLimiter();
    expect(v.admit("mg", 2, 0, 1)).toBe(true);
    expect(v.admit("mg", 2, 0, 1)).toBe(true);
    expect(v.admit("mg", 2, 0.5, 1.5)).toBe(false);
    expect(v.admit("cannon", 2, 0.5, 1.5)).toBe(true);
    expect(v.admit("mg", 2, 1, 2)).toBe(true);
  });
});

describe("loudestAt", () => {
  it("finds the middle of the loudest window", () => {
    const samples = new Float32Array(1000);
    for (let i = 600; i < 610; i++) samples[i] = 1;
    samples[100] = 0.5;
    expect(loudestAt(samples, 1000, 0.01)).toBeCloseTo(0.605);
  });
});
