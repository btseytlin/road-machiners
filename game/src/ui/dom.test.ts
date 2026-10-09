import { describe, expect, it } from "vitest";
import { isBrowserChord } from "./dom";

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
