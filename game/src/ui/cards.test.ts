import { describe, expect, it } from "vitest";
import { START_KITS } from "../data/start";
import { mountedParts } from "../sim/grid";
import { playerVehicle } from "../sim/damage";
import { newWorld } from "../sim/world";
import type { PartInstance } from "../sim/types";
import { baselinePart, chassisStats, compareBase, diffStats, partStats } from "./cards";
import { TEST_MAP } from "../test/map";
import { defaultSetup, parseSetup } from "../sim/settings";
import { emptyWorld } from "../sim/testkit";
import { roundDamage } from "../sim/combat";
import { partDef, type WeaponDef } from "../data/parts";

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
