import { describe, expect, it } from "vitest";
import { START_KITS } from "../data/start";
import { mountedParts } from "../sim/grid";
import { playerVehicle } from "../sim/damage";
import { newWorld } from "../sim/world";
import type { PartInstance } from "../sim/types";
import { baselinePart, chassisPortraitCell, chassisStats, compareBase, diffStats, gridIconFrame, itemIconCell, partStats } from "./cards";
import ICONS from "../data/item-icons.json";
import { CHASSIS } from "../data/chassis";
import { GOODS } from "../data/goods";
import { PARTS } from "../data/parts";
import { BODY_PARTS } from "../render/partLooks";
import { TEST_MAP } from "../test/map";

const part = (defId: string, wear = 0): PartInstance => ({ id: defId, defId, hp: 1, wear });

describe("part stats and their change against the player's part", () => {
  it("marks a faster engine better and its higher fuel use worse", () => {
    const diffs = diffStats(partStats(part("turbine")), partStats(part("stockEngine")));
    const byIcon = Object.fromEntries(diffs.map((d) => [d.stat.icon, d.delta === null ? null : d.verdict]));
    expect(byIcon.speed).toBe("better");
    expect(byIcon.fuel).toBe("worse");
  });

  it("marks lower mass better, since less is the better side", () => {
    const [light, heavy] = [part("ceramicTile"), part("steelPlate")];
    const mass = diffStats(partStats(light), partStats(heavy)).find((d) => d.stat.icon === "mass");
    expect(mass).toMatchObject({ verdict: "better" });
  });

  it("gives no change without a part to compare with", () => {
    expect(diffStats(partStats(part("turbine")), null).every((d) => d.delta === null)).toBe(true);
  });

  it("shows worn stats, so a rebuilt engine reads slower than a pristine one", () => {
    const speed = (p: PartInstance) => partStats(p).find((s) => s.icon === "speed")?.value;
    expect(speed(part("turbine", 2))).toBeLessThan(speed(part("turbine")) ?? 0);
  });

  it("compares trucks stat by stat", () => {
    const speed = diffStats(chassisStats("courier"), chassisStats("hauler")).find((d) => d.stat.icon === "speed");
    expect(speed).toMatchObject({ verdict: "better" });
  });
});

describe("the part a new part is weighed against", () => {
  it("is the most valuable mounted part of the same kind", () => {
    const me = playerVehicle(newWorld(1, START_KITS.standard, TEST_MAP));
    const engines = mountedParts(me, "engine");
    expect(baselinePart(me, "engine")).toBe(engines[0]);
    expect(baselinePart(me, "scanner")).toBeNull();
  });
});

describe("the part a shop card compares with", () => {
  it("is the selected item", () => {
    expect(compareBase(part("turbine"), part("stockEngine"))).toEqual(part("turbine"));
  });

  it("is nothing while no item is selected, so the card shows plain stats", () => {
    expect(compareBase(null, part("stockEngine"))).toBeNull();
  });

  it("is nothing for the selected part's own card", () => {
    expect(compareBase(part("turbine"), part("turbine"))).toBeNull();
  });
});

describe("item icons", () => {
  const items = [...Object.keys(PARTS).filter((id) => !BODY_PARTS.has(id)), ...Object.keys(GOODS)];

  it.each(items)("names the %s icon after its def", (id) => {
    expect(itemIconCell(id).label).toBe(id in GOODS ? GOODS[id].name : PARTS[id].name);
  });

  it("gives every item its own cell on the sheet", () => {
    const cells = items.map((id) => {
      const c = itemIconCell(id);
      return `${c.col},${c.row}`;
    });
    expect(new Set(cells).size).toBe(items.length);
  });

  it("keeps every cell on the sheet", () => {
    for (const id of items) {
      const c = itemIconCell(id);
      expect(c.col).toBeLessThan(c.cols);
      expect(c.row).toBeLessThan(c.rows);
    }
  });

  it("fails on an id with no icon", () => {
    expect(() => itemIconCell("hoverPad")).toThrow(/hoverPad/);
  });

  it("has no model icon for a cab, which keeps its glyph", () => {
    expect(() => itemIconCell("cabPickup")).toThrow(/npm run icons/);
  });

  it.each(Object.keys(CHASSIS))("names the %s portrait after its chassis", (id) => {
    expect(chassisPortraitCell(id).label).toBe(CHASSIS[id].name);
  });
});

describe("grid item icons", () => {
  const straight = { rot: 0, side: null } as const;
  const sideways = { rot: 1, side: null } as const;

  it("crop a gun to its drawn extent, so it fills its footprint box", () => {
    const [x, y, w, h] = ICONS.items.longRifle.box;
    expect(gridIconFrame(itemIconCell("longRifle"), straight).crop).toEqual({ x, y, w, h });
    expect(h).toBeGreaterThan(2 * w);
  });

  it("turn a top-down part a quarter with the part, and not when it lies straight", () => {
    expect(gridIconFrame(itemIconCell("longRifle"), sideways).turn).toBe(1);
    expect(gridIconFrame(itemIconCell("longRifle"), straight).turn).toBe(0);
  });

  it("turn armor, drawn as a front plate, to face the side it covers, whatever its rot", () => {
    const [, , w, h] = ICONS.items.cage.box;
    expect(w).toBeGreaterThan(h);
    const turn = (id: string, rot: 0 | 1, side: "F" | "L" | "B" | "R") => gridIconFrame(itemIconCell(id), { rot, side }).turn;
    expect([turn("cage", 1, "F"), turn("cage", 0, "L"), turn("cage", 1, "B"), turn("cage", 0, "R")]).toEqual([0, 1, 2, 3]);
    expect(turn("steelPlate", 0, "R")).toBe(3);
  });

  it("never turn a good, which is drawn diagonal", () => {
    expect(itemIconCell("scrap").view).toBe("diagonal");
    expect(gridIconFrame(itemIconCell("scrap"), sideways).turn).toBe(0);
  });
});
