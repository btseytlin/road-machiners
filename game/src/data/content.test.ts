import { defaultSetup } from '../sim/settings';
import { beforeAll, describe, expect, it } from "vitest";
import { CHASSIS, PLAYER_CHASSIS } from "./chassis";
import { GOODS, GOOD_IDS } from "./goods";
import { EFFORT, SHOPS, type ItemKind } from "./market";
import { goodBasePrice, partPristineBuyPrice } from "../sim/market";
import { PARTS, type PartDef, type PartKind, type WeaponDef } from "./parts";
import { REGION } from "./region";
import { SALVAGE, type LootTable } from "./salvage";
import { bodyOf } from "../sim/body";
import {
  buyChassis,
  buyGood,
  buyPrice,
  sellGood,
  sellPrice,
} from "../sim/economy";
import { makePart, makeVehicle } from "../sim/factory";
import { goodsCount, gridOf, isMounted, placementError } from "../sim/grid";
import { mountPart } from "../sim/inventory";
import { emptyWorld } from "../sim/testkit";
import type { World } from "../sim/types";
import { sitePads } from "../sim/sites";
import { TRAITS } from "./npcs";
import { START_KITS } from "./start";
import { getUpkeepReserve } from "../sim/npc-decisions";
import { newWorld } from "../sim/world";
import { TEST_MAP } from "../test/map";

let world: World;
beforeAll(() => {
  world = emptyWorld(sitePads(REGION.towns[0])[0]);
  world.player.money = 3333333;
});

const addedParts: Record<Exclude<PartKind, "core" | "scanner">, string[]> = {
  store: ["jerrycans", "supplyLocker"],
  weapon: [
    "shotgun", "longRifle", "flamer", "pneumobolter", "slugCannon",
    "heavyMg", "amRifle", "autocannon", "recoilless", "battleRifle",
    "gatling", "rocketRack", "sniperCannon", "grenadeLauncher", "tankGun", "flechette", "harpoon",
  ],
  engine: ["flatFour", "workhorseDiesel", "racingV6", "heavyDiesel", "turbine"],
  armor: [
    "scrapPanels",
    "ceramicPlates",
    "spacedArmor",
    "reinforcedCage",
    "plowRam",
    "steelPlate",
    "scrapSheet",
    "ceramicTile",
    "claymoreRam",
  ],
  cargo: ["panniers", "flatbed", "lightFrame", "enclosedFrame", "heavyFrame"],
  utility: [
    "sprout", "caltrops", "oilSpiller", "patcherCrane",
    "smokeMortar", "flareCannon", "scrapersKnife", "emitter",
  ],
};
const addedGoods = ["grain", "textiles", "tools", "batteries", "electronics"];
const addedChassis = ["courier", "van", "longbed", "carrier", "tractor", "jeep", "convertible", "bus", "loader", "niva", "bukhanka", "lincoln"];
const rearEngineChassis = ["jeep", "convertible", "bus", "loader", "bukhanka"];

describe("equipment variety", () => {
  it("gives every weapon a magazine and a reload time", () => {
    for (const part of Object.values(PARTS)) {
      if (part.kind !== "weapon") continue;
      expect(Number.isInteger(part.magazine) && part.magazine > 0, `${part.id} magazine`).toBe(true);
      expect(Number.isInteger(part.reload) && part.reload > 0, `${part.id} reload`).toBe(true);
      expect(Number.isInteger(part.cooldown) && part.cooldown > 0, `${part.id} cooldown`).toBe(true);
    }
  });

  it("gives each tier one gun per class set: three pure classes and three pairs, beside the harpoon", () => {
    const weapons = Object.values(PARTS).filter((p): p is WeaponDef => p.kind === "weapon" && p.line === undefined);
    for (const tier of [1, 2, 3]) {
      const sets = weapons.filter((w) => w.tier === tier).map((w) => [...w.classes].sort().join("+")).sort();
      expect(sets, `tier ${tier}`).toEqual(["chip", "chip+damager", "chip+precision", "damager", "damager+precision", "precision"]);
    }
  });

  it("makes pure damagers weak against armor and pure chippers strong against it", () => {
    for (const w of Object.values(PARTS)) {
      if (w.kind !== "weapon" || w.classes.length !== 1) continue;
      if (w.classes[0] === "damager") expect(w.round.armorShare, w.id).toBeLessThan(1);
      if (w.classes[0] === "chip") expect(w.round.armorShare, w.id).toBeGreaterThan(1);
    }
  });

  it("gives the pure precision gun of each tier the least spread and the longest range in its tier", () => {
    const weapons = Object.values(PARTS).filter((p): p is WeaponDef => p.kind === "weapon");
    for (const tier of [1, 2, 3]) {
      const own = weapons.filter((w) => w.tier === tier);
      const precise = own.find((w) => w.classes.length === 1 && w.classes[0] === "precision")!;
      for (const w of own.filter((x) => x !== precise)) {
        expect(precise.spread, `${precise.id} vs ${w.id}`).toBeLessThan(w.spread);
        expect(precise.range, `${precise.id} vs ${w.id}`).toBeGreaterThan(w.range);
      }
    }
  });

  it.each(Object.entries(addedParts))(
    "adds usable %s parts",
    (kind, ids) => {
      const originalCounts: Record<string, number> = {
        weapon: 2,
        engine: 2,
        armor: 3,
        cargo: 2,
        store: 0,
        utility: 0,
      };
      expect(Object.values(PARTS).filter((p) => p.kind === kind)).toHaveLength(
        originalCounts[kind] + ids.length,
      );
      for (const id of ids) {
        expect(PARTS[id].kind).toBe(kind);
        const stocked = Object.values(SHOPS).some((shop) => shop.partStock.parts.some((entry) => entry.value === id));
        expect(stocked, `${id} is in no shop's stock table`).toBe(true);
        const fits = PLAYER_CHASSIS.some((chassisId) => {
          const w = structuredClone(world);
          const v = makeVehicle(w, {
            faction: "player",
            chassisId,
            parts: [],
            spares: [],
            cargo: {},
            pos: { x: 20, y: 20 },
            heading: 0,
            brain: null,
          });
          return mountPart(w, v, makePart(w, id, 0));
        });
        expect(fits, id).toBe(true);
      }
    },
  );

  it("adds buyable chassis with valid built-in parts and physics bodies", () => {
    expect(Object.keys(CHASSIS)).toHaveLength(16);
    expect(PLAYER_CHASSIS).toHaveLength(16);
    for (const id of addedChassis) {
      expect(PLAYER_CHASSIS).toContain(id);
      const w = buyChassis(world, id);
      const v = w.vehicles.find((vehicle) => vehicle.faction === "player")!;
      expect(v.chassisId).toBe(id);
      const cores = v.items.filter(
        (item) =>
          item.kind === "part" && PARTS[item.part.defId].kind === "core",
      );
      expect(cores).toHaveLength(CHASSIS[id].core.length);
      expect(cores.every((item) => isMounted(id, item))).toBe(true);
      for (const item of v.items)
        expect(placementError(gridOf(v), v.items, item, item.id)).toBeNull();
      expect(bodyOf(id).half.x).toBeGreaterThan(0);
      expect(
        new Set(CHASSIS[id].core.map((core) => `${core.x},${core.y}`)).size,
      ).toBe(CHASSIS[id].core.length);
    }
    expect(
      new Set(addedChassis.map((id) => CHASSIS[id].layout.join("\n"))).size,
    ).toBe(addedChassis.length);
  });

  it.each(rearEngineChassis)("puts the %s engine bay behind the cab", (id) => {
    const def = CHASSIS[id];
    const cab = def.core.find((core) => { const part = PARTS[core.defId]; return part.kind === "core" && part.role === "cab"; })!;
    const cabEnd = cab.y + PARTS[cab.defId].h;
    const bayRows = def.layout.flatMap((row, y) => (row.includes("E") ? [y] : []));
    expect(bayRows.length).toBeGreaterThan(0);
    expect(Math.min(...bayRows)).toBeGreaterThanOrEqual(cabEnd);
  });

  it("keeps every part, chassis and good inside its tier's effort band", () => {
    const items: { name: string; kind: ItemKind; tier: 1 | 2 | 3; value: number }[] = [
      ...Object.values(PARTS)
        .filter((p) => p.kind !== "core")
        .map((p) => ({ name: p.id, kind: p.kind as ItemKind, tier: p.tier, value: p.value })),
      ...Object.values(CHASSIS).map((c) => ({ name: c.id, kind: "chassis" as ItemKind, tier: c.tier, value: c.value })),
      ...Object.values(GOODS).map((g) => ({ name: g.id, kind: "good" as ItemKind, tier: g.tier, value: g.value })),
    ];
    for (const item of items) {
      const effort = item.value / EFFORT.wage[item.tier];
      const [lo, hi] = EFFORT.bands[item.tier][item.kind];
      expect(effort, `${item.name} (tier ${item.tier} ${item.kind}): ${effort.toFixed(1)} turns`).toBeGreaterThanOrEqual(lo);
      expect(effort, `${item.name} (tier ${item.tier} ${item.kind}): ${effort.toFixed(1)} turns`).toBeLessThanOrEqual(hi);
    }
  });

  it("adds five goods with profitable routes and real buy/sell transactions", () => {
    expect(Object.keys(GOODS)).toHaveLength(11);
    expect(GOOD_IDS).toEqual(Object.keys(GOODS));
    for (const id of addedGoods) {
      expect(GOODS[id].mass).toBeGreaterThan(0);
      const [cheap, dear] = [...REGION.towns].sort(
        (a, b) => goodBasePrice(a.id, id) - goodBasePrice(b.id, id),
      );
      expect(sellPrice(world, dear.id, id)).toBeGreaterThan(
        buyPrice(world, cheap.id, id),
      );
      const start = structuredClone(world);
      start.vehicles[0].pos = { ...sitePads(cheap)[0] };
      let w = buyGood(start, id, 1);
      expect(goodsCount(w.vehicles[0])[id]).toBe(1);
      w.vehicles[0].pos = { ...sitePads(dear)[0] };
      w = sellGood(w, id, 1);
      expect(goodsCount(w.vehicles[0])[id]).toBeUndefined();
      expect(w.player.money).toBeGreaterThan(start.player.money);
    }
  });

  it.each([["fuelDrums", []], ["water", ["dustwell", "green-pit"]]])("%s sells dear in Bowl and Nose, and only %j make it", (good, makers) => {
    for (const town of ["bowl", "nose"]) {
      expect(SHOPS[town].needs).toContain(good);
      expect(sellPrice(world, town, good)).toBeGreaterThan(0);
    }
    expect(Object.values(SHOPS).filter((shop) => shop.makes.includes(good)).map((shop) => shop.id).sort()).toEqual(makers);
  });
});

describe("utilities", () => {
  const utilities = Object.values(PARTS).filter((p) => p.kind === "utility");

  it("prices each of the eight utilities inside its one tier's effort band", () => {
    expect(utilities).toHaveLength(8);
    for (const def of utilities) {
      const [lo, hi] = EFFORT.bands[def.tier].utility;
      const effort = def.value / EFFORT.wage[def.tier];
      expect(effort, `${def.id} tier ${def.tier}: ${effort.toFixed(1)} turns`).toBeGreaterThanOrEqual(lo);
      expect(effort, `${def.id} tier ${def.tier}: ${effort.toFixed(1)} turns`).toBeLessThanOrEqual(hi);
    }
  });

  it("gives a reload to every active utility and none to the crane and the scraper", () => {
    const passive = utilities.filter((def) => def.reload === null).map((def) => def.effect.type).sort();
    expect(passive).toEqual(["crane", "scraper"]);
  });

  it("stocks every utility in a stall or garage and drops it as field loot", () => {
    const stalls = Object.values(SHOPS).filter((shop) => shop.kind === "stall");
    const tables = Object.values(SALVAGE).filter((entry): entry is LootTable => typeof entry === "object" && "spareParts" in entry);
    for (const def of utilities) {
      expect(Object.values(SHOPS).some((shop) => shop.partStock.parts.some((e) => e.value === def.id)), def.id).toBe(true);
      expect(tables.some((table) => table.spareParts.includes(def.id)), `${def.id} is in no loot table`).toBe(true);
    }
    expect(stalls.some((shop) => shop.partStock.parts.some((e) => e.value === "claymoreRam"))).toBe(true);
  });

  it("stocks garages with utilities three times as often as other parts, and the emitter at 0.6", () => {
    const garages = Object.values(SHOPS).filter((shop) => shop.kind === "garage");
    for (const shop of garages) {
      const weightOf = (id: string) => shop.partStock.parts.find((e) => e.value === id)?.weight;
      expect(weightOf("emitter"), shop.id).toBe(0.6);
      for (const def of utilities.filter((u) => u.id !== "emitter")) expect(weightOf(def.id), `${shop.id} ${def.id}`).toBe(3);
      expect(weightOf("mg"), shop.id).toBe(1);
    }
  });

  it("lists each utility twice in the loot tables that have it, and the emitter only at landmarks", () => {
    const tables = Object.entries(SALVAGE).filter((entry): entry is [string, LootTable] => typeof entry[1] === "object" && "spareParts" in entry[1]);
    for (const [id, table] of tables) {
      for (const def of utilities) {
        const count = table.spareParts.filter((part) => part === def.id).length;
        expect([0, 2], `${id} ${def.id}`).toContain(count);
      }
    }
    const holders = tables.filter(([, table]) => table.spareParts.includes("emitter"));
    expect(holders.map(([id]) => id)).toEqual(["landmark"]);
  });

  it("keeps the claymore ram an armor ram with a claymore", () => {
    const def = PARTS.claymoreRam;
    expect(def.kind === "armor" && def.look === "ram" && def.claymore !== undefined).toBe(true);
  });
});

describe("one-cell armor plates", () => {
  it.each(["steelPlate", "scrapSheet", "ceramicTile"])("%s fills one cell with its plate line's armor", (id) => {
    const line = { steelPlate: "plates", scrapSheet: "scrapPanels", ceramicTile: "ceramicPlates" }[id]!;
    expect([PARTS[id].w, PARTS[id].h]).toEqual([1, 1]);
    expect(PARTS[id].armor).toBe(PARTS[line].armor);
  });
});

function partAxes(def: PartDef): number[] {
  const cells = def.w * def.h;
  const tall = def.tall ? -1 : 0;
  switch (def.kind) {
    case "weapon": {
      const r = def.round;
      return [def.hp, -def.mass, def.armor, -cells, tall, def.range, -def.reload, def.arc, -def.spread, def.rounds,
        r.damage, r.pen, r.speed, r.splashRadius, r.splashDamage, r.splashPen, -def.recoil, -def.shake];
    }
    case "engine":
      return [def.hp, -def.mass, def.armor, -cells, def.speedBonus, def.accelBonus, -def.fuelMult, -def.noise, -def.heat];
    case "armor": {
      const repair = { none: 0, capped: 1, full: 2 }[def.fieldRepair];
      return [def.hp / cells, -def.mass / cells, def.armor, def.blastArmor, def.ramMult, repair, tall];
    }
    case "cargo":
      return [def.hp, -def.mass, def.armor, -cells, tall, def.extraRows];
    case "utility":
      return [def.hp, -def.mass, def.armor, -cells, tall, -(def.reload ?? 0)];
    default:
      return [];
  }
}

function dominates(a: PartDef, b: PartDef): boolean {
  if (a.kind === "weapon" && b.kind === "weapon" && a.round.blast !== b.round.blast) return false;
  if (a.kind === "utility" && b.kind === "utility" && a.effect.type !== b.effect.type) return false;
  const x = partAxes(a);
  const y = partAxes(b);
  return x.every((v, i) => v >= y[i]) && x.some((v, i) => v > y[i]);
}

describe("part weight by tier", () => {
  const perUnit = (def: PartDef): number => (def.kind === "cargo" ? def.mass / def.extraRows : def.mass / (def.w * def.h));
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

  const isRam = (p: PartDef): boolean => p.kind === "armor" && p.look === "ram";
  const meanAt = (defs: PartDef[], tier: number): number => mean(defs.filter((p) => p.tier === tier).map(perUnit));

  it.each(["weapon", "engine", "cargo"])("%s parts weigh less on average at each higher tier", (kind) => {
    const byTier = [1, 2, 3].map((tier) => meanAt(Object.values(PARTS).filter((p) => p.kind === kind), tier));
    expect(byTier[1]).toBeLessThan(byTier[0]);
    expect(byTier[2]).toBeLessThan(byTier[1]);
  });

  it("armor parts weigh less on average at each higher tier within their job", () => {
    const armor = Object.values(PARTS).filter((p) => p.kind === "armor");
    const plates = armor.filter((p) => !isRam(p));
    const rams = armor.filter(isRam);
    expect(meanAt(plates, 2)).toBeLessThan(meanAt(plates, 1));
    expect(meanAt(rams, 3)).toBeLessThan(meanAt(rams, 2));
  });

  it("every ram outweighs every other armor part per cell", () => {
    const armor = Object.values(PARTS).filter((p) => p.kind === "armor");
    const lightestRam = Math.min(...armor.filter(isRam).map(perUnit));
    const heaviestOther = Math.max(...armor.filter((p) => !isRam(p)).map(perUnit));
    expect(lightestRam).toBeGreaterThan(heaviestOther);
  });
});

describe("cargo tier curve", () => {
  const cargo = Object.values(PARTS).filter((p): p is Extract<PartDef, { kind: "cargo" }> => p.kind === "cargo");
  const perCell = (p: { extraRows: number; w: number; h: number }): number => p.extraRows / (p.w * p.h);
  const frames = cargo.filter((p) => p.w === 2 && p.h === 2);

  it.each(frames.map((p) => p.id))("%s beats any stack of lower-tier carriers on the same cells", (id) => {
    const frame = PARTS[id] as (typeof cargo)[number];
    const small = cargo.filter((p) => p.tier < frame.tier && p.w * p.h < 4);
    const best = small.reduce((a, p) => (perCell(p) > perCell(a) ? p : a));
    const stack = 4 * perCell(best);
    expect(frame.extraRows, `${id} gives ${frame.extraRows} rows, a stack of ${best.id} gives ${stack} on the same cells`).toBeGreaterThan(stack);
  });

  it("rows per deck cell rise with tier and the heavy frame beats every tier 2 part", () => {
    const mean = (tier: number): number => {
      const xs = cargo.filter((p) => p.tier === tier).map(perCell);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(mean(2)).toBeGreaterThan(mean(1));
    expect(mean(3)).toBeGreaterThan(mean(2));
    const tier2 = cargo.filter((p) => p.tier === 2).map((p) => p.extraRows);
    expect(PARTS.heavyFrame).toMatchObject({ kind: "cargo" });
    expect((PARTS.heavyFrame as (typeof cargo)[number]).extraRows).toBeGreaterThan(Math.max(...tier2));
  });

  // Guards old saves (docs/architecture/saves.md): a saved item keeps its x, y and rot, so a cargo part may not shrink its rows, grow its footprint or lose HP.
  const DEV_CARGO: Record<string, { w: number; h: number; hp: number; extraRows: number }> = {
    panniers: { w: 1, h: 1, hp: 20, extraRows: 1 },
    rack: { w: 2, h: 1, hp: 30, extraRows: 1 },
    flatbed: { w: 2, h: 1, hp: 50, extraRows: 2 },
    trailerBox: { w: 2, h: 2, hp: 60, extraRows: 3 },
    lightFrame: { w: 2, h: 2, hp: 24, extraRows: 3 },
    enclosedFrame: { w: 2, h: 2, hp: 110, extraRows: 3 },
    heavyFrame: { w: 2, h: 2, hp: 90, extraRows: 5 },
  };

  it("keeps every cargo part's footprint and HP and never lowers its rows", () => {
    expect(cargo.map((p) => p.id).sort()).toEqual(Object.keys(DEV_CARGO).sort());
    for (const p of cargo) {
      const old = DEV_CARGO[p.id];
      expect([p.w, p.h, p.hp]).toEqual([old.w, old.h, old.hp]);
      expect(p.extraRows).toBeGreaterThanOrEqual(old.extraRows);
    }
  });
});

describe("part trade-offs", () => {
  it("no part matches or beats another of its kind on every stat but price", () => {
    const parts = Object.values(PARTS).filter((p) => p.kind !== "core");
    const pairs = parts.flatMap((a) => parts.filter((b) => a.kind === b.kind && a.id !== b.id && dominates(a, b)).map((b) => `${a.id} beats ${b.id}`));
    expect(pairs).toEqual([]);
  });

  it("flags a part that beats another on every stat", () => {
    const worse = { ...PARTS.mg, id: "worseMg", hp: PARTS.mg.hp - 1 } as PartDef;
    expect(dominates(PARTS.mg, worse)).toBe(true);
    expect(dominates(worse, PARTS.mg)).toBe(false);
  });
});

describe("chassis drive parts", () => {
  const hpOf = (chassisId: string, role: "wheel" | "transmission" | "tank"): number => {
    const core = CHASSIS[chassisId].core.find((c) => {
      const def = PARTS[c.defId];
      return def.kind === "core" && def.role === role;
    });
    if (!core) throw new Error(`${chassisId} has no ${role}`);
    return PARTS[core.defId].hp;
  };

  it("gives heavier chassis tougher wheels, transmissions and fuel tanks", () => {
    for (const role of ["wheel", "transmission", "tank"] as const) {
      expect(hpOf("hauler", role)).toBeGreaterThan(hpOf("scout", role));
      expect(hpOf("wagon", role)).toBeGreaterThan(hpOf("hauler", role));
    }
  });
});

describe("NPC wallets and trade stakes", () => {
  it("gives every trait a trade stake", () => {
    for (const [id, trait] of Object.entries(TRAITS)) expect(trait.tradeStake, id).toBeGreaterThan(0);
  });

  it("starts every spawned driver with at least its upkeep reserve", () => {
    for (const seed of [1, 2, 3]) {
      const w = newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
      for (const v of w.vehicles.filter((x) => x.brain)) expect(v.resources!.money, v.brain!.templateId).toBeGreaterThanOrEqual(getUpkeepReserve(v));
    }
  }, 30_000);
});

describe("cargo shop prices", () => {
  const cargo = Object.values(PARTS).filter((p): p is Extract<PartDef, { kind: "cargo" }> => p.kind === "cargo");
  const shopPrice = (p: PartDef): number => partPristineBuyPrice(p.id);
  const rowsPerM = (p: { extraRows: number; id: string }): number => p.extraRows / shopPrice(PARTS[p.id]);
  const money = START_KITS.standard.money;

  it("lets the starting money buy panniers several times over", () => {
    expect(shopPrice(PARTS.panniers) * 5).toBeLessThan(money);
  });

  it("keeps the dearest frame within a few days' worth of a tier 3 weapon price, not above the dearest tier 3 part", () => {
    expect(shopPrice(PARTS.heavyFrame)).toBeLessThan(shopPrice(PARTS.emitter));
  });

  it("never asks more for a tier 1 carrier than for a tier 2 frame, and more for each tier", () => {
    const top = (tier: number) => Math.max(...cargo.filter((p) => p.tier === tier).map(shopPrice));
    const low = (tier: number) => Math.min(...cargo.filter((p) => p.tier === tier).map(shopPrice));
    expect(top(1)).toBeLessThan(low(2));
    expect(top(2)).toBeLessThan(low(3));
  });

  it("gives each tier at least as many rows per M as the tier below", () => {
    const best = (tier: number) => Math.max(...cargo.filter((p) => p.tier === tier).map(rowsPerM));
    expect(best(2)).toBeGreaterThanOrEqual(best(1));
    expect(best(3)).toBeGreaterThanOrEqual(best(1));
  });

  it("prices a cargo carrier no higher than a tier peer weapon, engine or armor", () => {
    for (const p of cargo) {
      const peers = Object.values(PARTS).filter((q) => q.tier === p.tier && ["weapon", "engine", "armor"].includes(q.kind));
      expect(shopPrice(p), p.id).toBeLessThanOrEqual(Math.max(...peers.map(shopPrice)));
    }
  });
});
