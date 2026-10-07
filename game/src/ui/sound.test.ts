import { describe, expect, it } from "vitest";
import { MIX } from "../data/sounds";
import { dragged, knobAngle, parseSettings, turned } from "./sound";

describe("parseSettings", () => {
  it("starts from the mix volumes", () => {
    expect(parseSettings(null)).toEqual({ muted: false, volume: MIX.busVolume });
  });
  it("keeps valid stored settings", () => {
    const s = { muted: true, volume: { ui: 0, sfx: 1, ambient: 0.5, music: 0.2 } };
    expect(parseSettings(JSON.stringify(s))).toEqual(s);
  });
  it("fails loud on invalid settings", () => {
    expect(() => parseSettings('{"muted":true}')).toThrow();
    expect(() => parseSettings('{"muted":false,"volume":{"ui":2,"sfx":1,"ambient":1,"music":1}}')).toThrow();
  });
});

describe("turned", () => {
  it("steps a twentieth at a time and snaps to whole steps", () => {
    expect(turned(0.5, 1)).toBeCloseTo(0.55);
    expect(turned(0.5, -2)).toBeCloseTo(0.4);
    expect(turned(0.52, 0)).toBeCloseTo(0.5);
  });
  it("gives exact step values, so stored settings hold no float noise", () => {
    expect(turned(0.1, 1)).toBe(0.15);
    expect(turned(0.65, 1)).toBe(0.7);
  });
  it("stops at silence and full", () => {
    expect(turned(0.95, 3)).toBe(1);
    expect(turned(0.05, -3)).toBe(0);
  });
});

describe("dragged", () => {
  it("ignores travel under the dead zone", () => {
    expect(dragged(0.5, 2, 0)).toBe(0.5);
    expect(dragged(0.5, 1, -1)).toBe(0.5);
  });
  it("raises going up or right and lowers going down or left", () => {
    expect(dragged(0, 0, -80)).toBe(0.5);
    expect(dragged(0, 0, -160)).toBe(1);
    expect(dragged(0, 80, 0)).toBe(0.5);
    expect(dragged(1, 0, 160)).toBe(0);
    expect(dragged(1, -80, 0)).toBe(0.5);
  });
  it("stops at silence and full", () => {
    expect(dragged(0.5, 0, -500)).toBe(1);
    expect(dragged(0.5, -500, 0)).toBe(0);
  });
  it("gives whole percents and keeps an off-grid start", () => {
    expect(dragged(0.37, 0, -16)).toBe(0.47);
    expect(dragged(0.37, 3, 0)).toBe(0.39);
  });
});

describe("knobAngle", () => {
  it("swings the pointer through 270 degrees", () => {
    expect(knobAngle(0)).toBe(-135);
    expect(knobAngle(0.5)).toBe(0);
    expect(knobAngle(1)).toBe(135);
  });
});
