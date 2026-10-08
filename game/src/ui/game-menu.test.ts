import { describe, expect, it } from "vitest";
import { entryEnabled, type MenuEntry } from "./game-menu";

describe("entryEnabled", () => {
  const states = [
    { busy: false, hasSave: false, expected: { new: true, save: true, load: false, tips: true, help: true } },
    { busy: false, hasSave: true, expected: { new: true, save: true, load: true, tips: true, help: true } },
    { busy: true, hasSave: false, expected: { new: false, save: false, load: false, tips: true, help: true } },
    { busy: true, hasSave: true, expected: { new: false, save: false, load: false, tips: true, help: true } },
  ];
  for (const { busy, hasSave, expected } of states) {
    it(`busy ${busy}, saved ${hasSave}`, () => {
      for (const entry of Object.keys(expected) as MenuEntry[]) {
        expect(entryEnabled(entry, busy, hasSave)).toBe(expected[entry]);
      }
    });
  }
});
