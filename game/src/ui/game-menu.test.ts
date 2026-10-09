import { describe, expect, it } from "vitest";
import { entryEnabled, entryReason, type MenuEntry } from "./game-menu";

describe("entryEnabled", () => {
  const states = [
    { busy: false, hasSave: false, expected: { new: true, save: true, load: false, help: true } },
    { busy: false, hasSave: true, expected: { new: true, save: true, load: true, help: true } },
    { busy: true, hasSave: false, expected: { new: false, save: false, load: false, help: true } },
    { busy: true, hasSave: true, expected: { new: false, save: false, load: false, help: true } },
  ];
  for (const { busy, hasSave, expected } of states) {
    it(`busy ${busy}, saved ${hasSave}`, () => {
      for (const entry of Object.keys(expected) as MenuEntry[]) {
        expect(entryEnabled(entry, busy, hasSave)).toBe(expected[entry]);
      }
    });
  }
});

describe("entryReason", () => {
  it("names why Load is off", () => {
    expect(entryReason("load", false, false)).toBe("No saves yet");
    expect(entryReason("load", false, true)).toBeNull();
  });
  it("names the turn when it blocks an entry", () => {
    expect(entryReason("save", true, true)).toBe("Wait for the turn");
    expect(entryReason("help", true, false)).toBeNull();
  });
});
