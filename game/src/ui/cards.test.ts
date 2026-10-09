import { describe, expect, it } from "vitest";
import { START_KITS } from "../data/start";
import { mountedParts } from "../sim/grid";
import { playerVehicle } from "../sim/damage";
import { addVehicle } from "../sim/testkit";
import { newWorld } from "../sim/world";
import type { PartInstance } from "../sim/types";
import { baselinePart, chassisPortraitCell, chassisStats, compareBase, dialShare, diffStats, headlineStat, itemIconCell, partStats, statValue, toneStyle } from "./cards";
import ICONS from "../data/item-icons.json";
import { CHASSIS } from "../data/chassis";
import { GOODS } from "../data/goods";
import { PARTS } from "../data/parts";
import { BODY_PARTS } from "../render/partLooks";
import { TEST_MAP } from "../test/map";
import { defaultSetup, parseSetup } from "../sim/settings";
import { emptyWorld } from "../sim/testkit";
import { roundDamage } from "../sim/combat";
import { partDef, type WeaponDef } from "../data/parts";

const boxOf = ([x, y, w, h]: number[]) => ({ x, y, w, h });
const part = (defId: string, wear = 0): PartInstance => ({ id: defId, defId, hp: 1, wear });
const world = emptyWorld();

describe("part stats and their change against the player's part", () => {
  it("marks a faster engine better and its higher fuel use worse", () => {
    const diffs = diffStats(partStats(world, part("turbine")), partStats(world, part("stockEngine")));
    const byIcon = Object.fromEntries(diffs.map((d) => [d.stat.icon, d.delta === null ? null : d.verdict]));
    expect(byIcon.speed).toBe("better");
    expect(byIcon.fuel).toBe("worse");
  });

  it("marks lower mass better, since less is the better side", () => {
    const [light, heavy] = [part("ceramicTile"), part("steelPlate")];
    const mass = diffStats(partStats(world, light), partStats(world, heavy)).find((d) => d.stat.icon === "mass");
    expect(mass).toMatchObject({ verdict: "better" });
  });

  it("gives no change without a part to compare with", () => {
    expect(diffStats(partStats(world, part("turbine")), null).every((d) => d.delta === null)).toBe(true);
  });

  it("shows worn stats, so a rebuilt engine reads slower than a pristine one", () => {
    const speed = (p: PartInstance) => partStats(world, p).find((s) => s.icon === "speed")?.value;
    expect(speed(part("turbine", 2))).toBeLessThan(speed(part("turbine")) ?? 0);
  });

  it("shows a gun's damage per shot as the world deals it, so a Damage 200% world reads twice the default", () => {
    const damaging = emptyWorld();
    damaging.setup = parseSetup({ mode: "roaming", settings: { damage: 2, fuelUse: 1, supplyUse: 1 } });
    const shot = (w: typeof world) => partStats(w, part("mg")).find((s) => s.icon === "damage")?.value;

    expect(shot(damaging)).toBeCloseTo(2 * (shot(world) ?? 0));
    const mg = partDef("mg") as WeaponDef;
    expect(shot(damaging)).toBeCloseTo(mg.rounds * roundDamage(damaging, mg));
  });

  it("compares trucks stat by stat", () => {
    const speed = diffStats(chassisStats("courier"), chassisStats("hauler")).find((d) => d.stat.icon === "speed");
    expect(speed).toMatchObject({ verdict: "better" });
  });
});

describe("cargo cards", () => {
  const courierWorld = emptyWorld();
  courierWorld.player.vehicleId = addVehicle(courierWorld, "player", "courier", [], { x: 40, y: 40 }).id;
  const head = (defId: string) => headlineStat(courierWorld, part(defId), null).stat;

  it("headline the net cargo cells on the player's chassis", () => {
    expect(head("panniers")).toMatchObject({ label: "Cargo cells", text: "+5" });
    expect(head("heavyFrame")).toMatchObject({ label: "Cargo cells", text: "+32" });
  });

  it("marks a heavy frame better than panniers", () => {
    const diff = diffStats(partStats(courierWorld, part("heavyFrame")), partStats(courierWorld, part("panniers")))[0];
    expect(diff).toMatchObject({ verdict: "better" });
  });
});

describe("the headline stat of a shop row", () => {
  it("is the first stat, with no change without a base", () => {
    const head = headlineStat(world, part("turbine"), null);
    expect(head.stat).toEqual(partStats(world, part("turbine"))[0]);
    expect(head.delta).toBeNull();
  });

  it("carries the change and verdict against a base of the same kind", () => {
    const head = headlineStat(world, part("turbine"), part("stockEngine"));
    const same = diffStats(partStats(world, part("turbine")), partStats(world, part("stockEngine")))[0];
    expect(head).toEqual(same);
    expect(head.delta).not.toBeNull();
  });
});

describe("the part a new part is weighed against", () => {
  it("is the most valuable mounted part of the same kind", () => {
    const me = playerVehicle(newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming')));
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

  it("has an item icon for every cab", () => {
    expect(["cab", "cabPickup", "cabHardtop"].map((id) => itemIconCell(id).label)).toEqual(["Driver seat", "Cab", "Hardtop cab"]);
  });

  it.each(Object.keys(CHASSIS))("names the %s portrait after its chassis", (id) => {
    expect(chassisPortraitCell(id).label).toBe(CHASSIS[id].name);
  });
});

describe("grid item icons", () => {
  it("give every item one cell, with no lying cell", () => {
    for (const icon of Object.values(ICONS.items)) expect(icon).not.toHaveProperty("lying");
  });

  it("draw every item diagonal, so no icon turns with its box", () => {
    for (const id of ["longRifle", "stockEngine", "cage", "scrap"]) expect(itemIconCell(id).view).toBe("diagonal");
  });
});

describe("item tones", () => {
  it("give each item its category's background as --tone", () => {
    expect(["mg", "cage", "panniers", "salt", "stockEngine", "scanner"].map(toneStyle)).toEqual([
      "--tone:#8c3a30",
      "--tone:#4f5458",
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

describe("stat values", () => {
  it("writes the unit as plain text after the value", () => {
    expect(statValue(partStats(world, part("mg")).find((s) => s.icon === "mass")!)).toMatch(/^[\d,]+ kg$/);
  });

  it("keeps degrees and multipliers tight to the number", () => {
    const stats = partStats(world, part("stockEngine"));
    expect(statValue(stats.find((s) => s.icon === "heat")!)).toMatch(/^[\d.]+×$/);
  });
});
