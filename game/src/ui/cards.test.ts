import { describe, expect, it } from "vitest";
import { START_KITS } from "../data/start";
import { mountedParts } from "../sim/grid";
import { playerVehicle } from "../sim/damage";
import { newWorld } from "../sim/world";
import type { PartInstance } from "../sim/types";
import { baselinePart, chassisPortraitCell, chassisStats, compareBase, dialShare, diffStats, gridIconFrame, itemIconCell, partStats, toneStyle } from "./cards";
import ICONS from "../data/item-icons.json";
import { CHASSIS } from "../data/chassis";
import { GOODS } from "../data/goods";
import { PARTS } from "../data/parts";
import { BODY_PARTS } from "../render/partLooks";
import { TEST_MAP } from "../test/map";

const boxOf = ([x, y, w, h]: number[]) => ({ x, y, w, h });
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

describe("the speed dial's needle", () => {
  it("shows the speed's share of the top speed, capped at full", () => {
    expect([dialShare(3, 6), dialShare(-3, 6), dialShare(9, 6)]).toEqual([0.5, 0.5, 1]);
  });

  it("is a number for a truck with no top speed, as one shut down: full while rolling, empty at rest", () => {
    expect([dialShare(4, 0), dialShare(0, 0)]).toEqual([1, 0]);
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

  it("turn a gun lying sideways a quarter with its box, cropped to its drawing", () => {
    const rifle = itemIconCell("longRifle");
    expect(gridIconFrame(rifle, sideways)).toEqual({ crop: boxOf(ICONS.items.longRifle.box), turn: 1 });
  });

  it("leave a gun lying straight unturned, barrel up", () => {
    const rifle = itemIconCell("longRifle");
    const frame = gridIconFrame(rifle, straight);
    expect(frame).toEqual({ crop: rifle.box, turn: 0 });
    expect(frame.crop.h).toBeGreaterThan(2 * frame.crop.w);
  });

  it("turn a square gun at rot 1 a quarter too", () => {
    expect(gridIconFrame(itemIconCell("mg"), sideways).turn).toBe(1);
  });

  it("give every item one cell, with no lying cell", () => {
    for (const icon of Object.values(ICONS.items)) expect(icon).not.toHaveProperty("lying");
  });

  it("turn another top-down part a quarter with the part, and not when it lies straight", () => {
    const engine = itemIconCell("stockEngine");
    expect(gridIconFrame(engine, sideways)).toEqual({ crop: engine.box, turn: 1 });
    expect(gridIconFrame(engine, straight).turn).toBe(0);
  });

  it("turn armor, drawn as a front plate, to face the side it covers, whatever its rot", () => {
    const [, , w, h] = ICONS.items.cage.box;
    expect(w).toBeGreaterThan(h);
    const frame = (id: string, rot: 0 | 1, side: "F" | "L" | "B" | "R") => gridIconFrame(itemIconCell(id), { rot, side });
    const turn = (id: string, rot: 0 | 1, side: "F" | "L" | "B" | "R") => frame(id, rot, side).turn;
    expect([turn("cage", 1, "F"), turn("cage", 0, "L"), turn("cage", 1, "B"), turn("cage", 0, "R")]).toEqual([0, 1, 2, 3]);
    expect(turn("steelPlate", 0, "R")).toBe(3);
    expect(frame("cage", 1, "L").crop).toEqual(boxOf(ICONS.items.cage.box));
  });

  it("never turn a good, which is drawn diagonal", () => {
    const scrap = itemIconCell("scrap");
    expect(scrap.view).toBe("diagonal");
    expect(gridIconFrame(scrap, sideways)).toEqual({ crop: scrap.box, turn: 0 });
  });
});

describe("item tones", () => {
  it("give each item its category's background as --tone", () => {
    expect(["mg", "cage", "panniers", "salt", "stockEngine", "scanner"].map(toneStyle)).toEqual([
      "--tone:#8c3a30",
      "--tone:#686c6f",
      "--tone:#6e5236",
      "--tone:#6e5236",
      "--tone:#35587a",
      "--tone:#35587a",
    ]);
  });

  it("fail on an id that is no item", () => {
    expect(() => toneStyle("hoverPad")).toThrow(/hoverPad/);
  });
});

describe("chassis portraits", () => {
  it.each(Object.keys(CHASSIS))("crop the %s portrait to its drawing", (id) => {
    expect(chassisPortraitCell(id).box).toEqual(boxOf(ICONS.chassis[id as keyof typeof ICONS.chassis].box));
  });
});
