import { describe, expect, it } from "vitest";
import { isBrowserChord, overlaps } from "./dom";

const keys = { ctrlKey: false, metaKey: false, altKey: false };

describe("isBrowserChord", () => {
  it("treats Ctrl, Meta and Alt as chords", () => {
    expect(isBrowserChord({ ...keys, ctrlKey: true })).toBe(true);
    expect(isBrowserChord({ ...keys, metaKey: true })).toBe(true);
    expect(isBrowserChord({ ...keys, altKey: true })).toBe(true);
  });
  it("treats AltGr (Ctrl+Alt) as a chord", () => {
    expect(isBrowserChord({ ...keys, ctrlKey: true, altKey: true })).toBe(true);
  });
  it("leaves bare keys and Shift to the game", () => {
    expect(isBrowserChord(keys)).toBe(false);
    expect(isBrowserChord({ ...keys, shiftKey: true } as KeyboardEvent)).toBe(false);
  });
});

describe("overlaps", () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  it("holds for crossing boxes", () => {
    expect(overlaps(box(0, 0, 100, 100), box(50, 50, 150, 150))).toBe(true);
    expect(overlaps(box(50, 50, 150, 150), box(0, 0, 100, 100))).toBe(true);
  });
  it("does not hold for boxes that only touch", () => {
    expect(overlaps(box(0, 0, 100, 100), box(0, 100, 100, 200))).toBe(false);
    expect(overlaps(box(0, 0, 100, 100), box(100, 0, 200, 100))).toBe(false);
  });
  it("does not hold for boxes apart", () => {
    expect(overlaps(box(0, 0, 100, 100), box(0, 300, 100, 400))).toBe(false);
  });
  it("does not hold for an empty box, as a hidden panel measures", () => {
    expect(overlaps(box(0, 0, 0, 0), box(-10, -10, 10, 10))).toBe(false);
    expect(overlaps(box(-10, -10, 10, 10), box(5, 5, 5, 5))).toBe(false);
  });
});
