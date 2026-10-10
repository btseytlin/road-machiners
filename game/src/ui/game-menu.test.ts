import { describe, expect, it } from "vitest";
import { resolve } from "../text/resolve";
import { controlsFor, entryEnabled, entryReason, type MenuEntry } from "./game-menu";
import { modeRulesOf } from "../sim/settings";

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

describe("the help rows of a mode", () => {
  const radioRows = (mode: "roaming" | "furyRoad") =>
    controlsFor(modeRulesOf(mode)).flatMap((g) => g.controls).filter((c) => c.keys.some((k) => k === "T" || k === "H" || k === "9"));

  it("leave out the radio, reply and honk keys where there is no radio", () => {
    expect(radioRows("furyRoad")).toEqual([]);
  });

  it("keep them in Roaming", () => {
    expect(radioRows("roaming")).toHaveLength(3);
  });
});
