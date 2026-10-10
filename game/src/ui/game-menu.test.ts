import { describe, expect, it } from "vitest";
import { resolve } from "../text/resolve";
import { entryEnabled, entryReason, type MenuEntry } from "./game-menu";

describe("entryEnabled", () => {
  const states = [
    { busy: false, hasSave: false, expected: { new: true, save: true, load: false, options: true, tips: true, help: true } },
    { busy: false, hasSave: true, expected: { new: true, save: true, load: true, options: true, tips: true, help: true } },
    { busy: true, hasSave: false, expected: { new: false, save: false, load: false, options: true, tips: true, help: true } },
    { busy: true, hasSave: true, expected: { new: false, save: false, load: false, options: true, tips: true, help: true } },
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
    expect(resolve(entryReason("load", false, false)!, "en")).toBe("No saves yet");
    expect(entryReason("load", false, true)).toBeNull();
  });
  it("names the turn when it blocks an entry", () => {
    expect(resolve(entryReason("save", true, true)!, "en")).toBe("Wait for the turn");
    expect(entryReason("help", true, false)).toBeNull();
  });
});
