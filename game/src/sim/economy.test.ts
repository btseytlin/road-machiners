import { START_KITS } from "../data/start";
import { describe, expect, it } from "vitest";
import { CHASSIS } from "../data/chassis";
import { ECONOMY, GOOD_IDS } from "../data/goods";
import { SHOPS } from "../data/market";
import { goodBasePrice, lotPrice, shopState } from "./market";
import { PARTS, partDef } from "../data/parts";
import { REGION } from "../data/region";
import { RULES } from "../data/rules";
import { CONDITION } from "../data/wear";
import {
  basicsRepairCost,
  buyChassis,
  buyGood,
  buyStockPart,
  buyPrice,
  buySupply,
  chassisTradeIn,
  getLotTradePrice,
  partRepairCost,
  partTradePrice,
  repairAll,
  repairBasics,
  repairCost,
  repairPart,
  sellGood,
  sellPrice,
  sellPart,
  serviceVehicle,
} from "./economy";
import {
  corePart,
  coreParts,
  freeCells,
  goodsCount,
  mountedParts,
} from "./grid";
import { makePart } from "./factory";
import { maxHp, partValue } from "./wear";
import { addGoods, canStowPart, spareParts, stowPart } from "./inventory";
import { canScavenge, canUseOasis, salvageNear, scavenge, useOasis } from "./locations";
import { consumeSupplies } from "./supplies";
import { heatAt } from "./sun";
import { sitePads, townAt, townNear } from "./sites";
import { addVehicle, emptyWorld, testDrive } from "./testkit";
import { endTurn, newWorld } from "./world";
import { TEST_MAP } from "../test/map";

const bowl = REGION.towns.find((t) => t.id === "bowl")!;
const nose = REGION.towns.find((t) => t.id === "nose")!;
const startAtBowl = () => emptyWorld(sitePads(bowl)[0]);
// A longbed at Bowl, for trades bigger than the start scout's cargo room. Its money is back to the start amount.
const longbedAtBowl = () => {
  const start = startAtBowl();
  const money = start.player.money;
  start.player.money = CHASSIS.longbed.value * 10;
  const w = buyChassis(start, "longbed");
  w.player.money = money;
  return w;
};

describe("trade", () => {
  it("buying moves money into cargo", () => {
    const start = startAtBowl();
    const price = buyPrice(start, "bowl", "scrap");
    const w = buyGood(start, "scrap", 3);
    expect(goodsCount(w.vehicles[0]).scrap).toBe(2 + 3);
    expect(w.player.money).toBe(1000 - 3 * price);
  });

  it("enforces cargo capacity and money", () => {
    const w = startAtBowl();
    w.player.money = 10000;
    expect(() => buyGood(w, "scrap", freeCells(w.vehicles[0]) + 1)).toThrow(
      /cargo space/,
    );
    w.player.money = 300;
    expect(() => buyGood(w, "meds", 10)).toThrow(/money/);
  });

  it("the salt route from Nose to Bowl pays and trains Social", () => {
    const start = startAtBowl();
    start.vehicles[0].pos = { ...sitePads(nose)[0] };
    const bought = buyPrice(start, "nose", "salt");
    let w = buyGood(start, "salt", 8);
    w.vehicles[0].pos = { ...sitePads(bowl)[0] };
    const money = w.player.money;
    expect(sellPrice(w, "bowl", "salt")).toBeGreaterThan(bought);
    const held = goodsCount(w.vehicles[0]).salt;
    const total = getLotTradePrice(w, w.vehicles[0], "bowl", "salt", held, "sell");
    w = sellGood(w, "salt", held);
    expect(w.player.money - money).toBe(total);
    expect(w.player.xp).toBeGreaterThan(0);
  });

  it("buying raises the local price and selling lowers it", () => {
    const w = longbedAtBowl();
    const before = buyPrice(w, "bowl", "scrap");
    const after = buyGood(w, "scrap", 20);
    expect(buyPrice(after, "bowl", "scrap")).toBeGreaterThan(before);
    const sold = sellGood(after, "scrap", 20);
    expect(buyPrice(sold, "bowl", "scrap")).toBeLessThan(buyPrice(after, "bowl", "scrap"));
  });

  it("social narrows the spread", () => {
    const w = startAtBowl();
    const before = buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt");
    w.player.ranks.social = 3;
    expect(
      buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt"),
    ).toBeLessThan(before);
  });

  it("social at max level cuts the spread by at most half", () => {
    const w = startAtBowl();
    w.player.ranks.social = 5;
    const spreadAtMax = buyPrice(w, "bowl", "salt") - sellPrice(w, "bowl", "salt");
    const w0 = startAtBowl();
    const spreadAtZero = buyPrice(w0, "bowl", "salt") - sellPrice(w0, "bowl", "salt");
    expect(Math.abs(spreadAtMax - spreadAtZero / 2)).toBeLessThanOrEqual(1);
  });

  it("trade needs a shop", () => {
    expect(() => buyGood(emptyWorld({ x: 30, y: 30 }), "scrap", 1)).toThrow(
      /shop/,
    );
  });

  it("every garage prices every good", () => {
    for (const [id] of Object.entries(SHOPS).filter(([, s]) => s.kind === "garage"))
      for (const good of GOOD_IDS) expect(goodBasePrice(id, good)).toBeGreaterThan(0);
  });

  it("a lot price equals the sum of single-unit trades", () => {
    const w = startAtBowl();
    const state = shopState(w, "bowl");
    for (const direction of ["buy", "sell"] as const) {
      const lot = lotPrice("bowl", state, "scrap", direction, ECONOMY.spread, 25);
      let summed = 0;
      const pressure = { ...state.pressure };
      for (let i = 0; i < 25; i++) {
        summed += lotPrice("bowl", { ...state, pressure }, "scrap", direction, ECONOMY.spread, 1);
        pressure.scrap = (pressure.scrap ?? 0) + SHOPS.bowl.pressurePerUnit * (direction === "buy" ? 1 : -1);
      }
      expect(lot).toBe(summed);
    }
  });

  it.each([0, 3])(
    "selling then buying back 25 units always loses money, at social rank %i",
    (social) => {
      for (const pressureStart of [0, 0.3, -0.3]) {
        const w = longbedAtBowl();
        w.player.ranks.social = social;
        w.shops.bowl.pressure.scrap = pressureStart;
        addGoods(w, w.vehicles[0], "scrap", 25 - (goodsCount(w.vehicles[0]).scrap ?? 0));

        const before = w.player.money;
        const after = buyGood(sellGood(w, "scrap", 25), "scrap", 25);
        expect(after.player.money).toBeLessThan(before);
      }
    },
  );

  it.each([0, 3])(
    "buying then selling back 25 units always loses money, at social rank %i",
    (social) => {
      for (const pressureStart of [0, 0.3, -0.3]) {
        const w = longbedAtBowl();
        w.player.ranks.social = social;
        w.shops.bowl.pressure.scrap = pressureStart;

        const before = w.player.money;
        const after = sellGood(buyGood(w, "scrap", 25), "scrap", 25);
        expect(after.player.money).toBeLessThan(before);
      }
    },
  );
});

describe("garage", () => {
  it("buys supplies up to the cap", () => {
    const start = startAtBowl();
    start.player.supplies = 12;
    const w = buySupply(start, "supplies", RULES.baseSupplies - 12);
    expect(w.player.supplies).toBe(RULES.baseSupplies);
    expect(() => buySupply(w, "supplies", 1)).toThrow();
  });

  const STALLS = ["salvage-yard", "granary", "pump-station"];
  const atSite = (id: string) => emptyWorld({ ...sitePads(REGION.locations.find((l) => l.id === id)!)[0] });

  it.each(STALLS)("sells fuel and supplies at the %s at the town prices", (id) => {
    const w = atSite(id);
    w.player.money = 1000;
    w.player.fuel = 0;
    w.player.supplies = 0;
    for (const kind of ["fuel", "supplies"] as const) {
      const r = buySupply(w, kind, 3);
      expect(r.player[kind]).toBe(3);
      expect(r.player.money).toBe(1000 - 3 * ECONOMY.supplyPrice[kind]);
    }
  });

  it.each(STALLS)("repairs at the %s for the shown prices", (id) => {
    const w = atSite(id);
    const gun = mountedParts(w.vehicles[0])[0];
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 10;
    gun.hp = 1;
    const part = partRepairCost(w, gun);

    const one = repairPart(w, gun.id);
    expect(mountedParts(one.vehicles[0])[0].hp).toBe(maxHp(gun));
    expect(one.player.money).toBe(w.player.money - part);

    const basics = repairBasics(w);
    expect(corePart(basics.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
    expect(basics.player.money).toBe(w.player.money - basicsRepairCost(w));

    const all = repairAll(w);
    expect(all.player.money).toBe(w.player.money - repairCost(w));
    expect(mountedParts(all.vehicles[0])[0].hp).toBe(maxHp(gun));
  });

  it("leaves rebuildable junk to a town garage", () => {
    const stall = atSite("granary");
    const town = startAtBowl();
    for (const w of [stall, town]) {
      w.player.perks = ["rebuild"];
      const junk = mountedParts(w.vehicles[0])[0];
      junk.hp = 0;
      junk.wear = CONDITION.maxWear + 1;
    }
    const junkId = mountedParts(stall.vehicles[0])[0].id;

    expect(() => repairPart(stall, junkId)).toThrow(/junk/);
    expect(repairCost(stall)).toBe(0);
    expect(repairAll(stall).player.money).toBe(stall.player.money);
    expect(mountedParts(repairAll(town).vehicles[0])[0]).toMatchObject({ rebuilt: true });
  });

  it.each(["scrapjaw", "dustwell", "orchard", "podfield"])("sells and repairs nothing at %s", (id) => {
    const w = atSite(id);
    corePart(w.vehicles[0], "cab").hp = 10;
    w.player.fuel = 0;
    const before = JSON.stringify(w);
    expect(() => buySupply(w, "fuel", 1)).toThrow();
    expect(() => buySupply(w, "supplies", 1)).toThrow();
    expect(() => repairPart(w, corePart(w.vehicles[0], "cab").id)).toThrow();
    expect(() => repairAll(w)).toThrow();
    expect(() => repairBasics(w)).toThrow();
    expect(JSON.stringify(w)).toBe(before);
  });

  it("still fills supplies free at an oasis", () => {
    const w = atSite("dustwell");
    w.player.supplies = 0;
    expect(useOasis(w).player.supplies).toBeGreaterThan(0);
  });

  it("repairs parts for money", () => {
    const w = startAtBowl();
    corePart(w.vehicles[0], "cab").hp = 10;
    mountedParts(w.vehicles[0])[0].hp = 0;
    const r = repairAll(w);
    expect(corePart(r.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
    expect(mountedParts(r.vehicles[0])[0].hp).toBeGreaterThan(0);
    expect(r.player.money).toBeLessThan(1000);
  });

  it("repairs only the built-in parts with repair basics, for the shown price", () => {
    const w = startAtBowl();
    const gun = mountedParts(w.vehicles[0])[0];
    corePart(w.vehicles[0], "cab").hp = 10;
    gun.hp = 1;
    const price = basicsRepairCost(w);

    const r = repairBasics(w);

    expect(corePart(r.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
    expect(mountedParts(r.vehicles[0])[0].hp).toBe(1);
    expect(mountedParts(r.vehicles[0])[0].wear).toBe(gun.wear);
    expect(r.player.money).toBe(w.player.money - price);
  });

  it("prices repair all as repair basics plus the other parts", () => {
    const w = startAtBowl();
    const gun = mountedParts(w.vehicles[0])[0];
    corePart(w.vehicles[0], "cab").hp = 10;
    gun.hp = 1;

    expect(basicsRepairCost(w)).toBeGreaterThan(0);
    expect(repairCost(w) - basicsRepairCost(w)).toBe(partRepairCost(w, gun));
  });

  it("refuses repair basics away from a garage or without the money", () => {
    const away = emptyWorld({ x: 30, y: 30 });
    corePart(away.vehicles[0], "cab").hp = 10;
    expect(() => repairBasics(away)).toThrow();

    const broke = startAtBowl();
    corePart(broke.vehicles[0], "cab").hp = 10;
    broke.player.money = 0;
    const before = JSON.stringify(broke);
    expect(() => repairBasics(broke)).toThrow();
    expect(JSON.stringify(broke)).toBe(before);
  });

  it("skips a junk built-in part in repair basics without the Rebuild perk and rebuilds it with", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 0;
    cab.wear = CONDITION.maxWear + 1;
    expect(corePart(repairBasics(w).vehicles[0], "cab").hp).toBe(0);

    w.player.perks = ["rebuild"];
    expect(corePart(repairBasics(w).vehicles[0], "cab")).toMatchObject({ rebuilt: true });
    expect(corePart(repairBasics(w).vehicles[0], "cab").hp).toBeGreaterThan(0);
  });

  it("refuses to rebuild a junk part and leaves it out of repair all", () => {
    const w = startAtBowl();
    const junk = mountedParts(w.vehicles[0])[0];
    junk.hp = 0;
    junk.wear = CONDITION.maxWear + 1;
    corePart(w.vehicles[0], "cab").hp = 10;

    expect(() => repairPart(w, junk.id)).toThrow(/junk/);
    const r = repairAll(w);

    expect(mountedParts(r.vehicles[0])[0].hp).toBe(0);
    expect(corePart(r.vehicles[0], "cab").hp).toBe(partDef("cab").hp);
  });

  it("rebuilds a junk part with the Rebuild perk at the full repair price of its last wear step", () => {
    const w = startAtBowl();
    w.player.perks = ["rebuild"];
    const junk = mountedParts(w.vehicles[0])[0];
    junk.hp = 0;
    junk.wear = CONDITION.maxWear + 1;
    const price = partRepairCost(w, { ...junk, wear: CONDITION.maxWear });

    expect(partRepairCost(w, junk)).toBe(price);
    const r = repairPart(w, junk.id);

    const rebuilt = mountedParts(r.vehicles[0])[0];
    expect(rebuilt).toMatchObject({ wear: CONDITION.maxWear, hp: maxHp(rebuilt), rebuilt: true });
    expect(r.player.money).toBe(w.player.money - price);
  });

  it("rebuilds junk in repair all with the Rebuild perk, but a rebuilt part only once", () => {
    const w = startAtBowl();
    w.player.perks = ["rebuild"];
    const [first, second] = mountedParts(w.vehicles[0]);
    for (const p of [first, second]) {
      p.hp = 0;
      p.wear = CONDITION.maxWear + 1;
    }
    second.rebuilt = true;

    const r = repairAll(w);

    expect(mountedParts(r.vehicles[0])[0]).toMatchObject({ wear: CONDITION.maxWear, rebuilt: true });
    expect(mountedParts(r.vehicles[0])[1].hp).toBe(0);
    expect(() => repairPart(r, second.id)).toThrow(/junk/);
  });

  it("repairs a worn part up to its worn max HP", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    cab.wear = 2;
    cab.hp = 0;
    const r = repairPart(w, cab.id);
    expect(corePart(r.vehicles[0], "cab")).toMatchObject({ hp: maxHp(cab), wear: 2 });
    expect(maxHp(cab)).toBeLessThan(partDef("cab").hp);
  });

  it("repairs only the selected truck part for its quoted cost", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    const wheel = coreParts(w.vehicles[0], "wheel")[0];
    cab.hp = 10;
    wheel.hp = 1;
    const cost = partRepairCost(w, cab);

    const repaired = repairPart(w, cab.id);

    expect(corePart(repaired.vehicles[0], "cab").hp).toBe(
      partDef(cab.defId).hp,
    );
    expect(coreParts(repaired.vehicles[0], "wheel")[0].hp).toBe(1);
    expect(repaired.player.money).toBe(w.player.money - cost);
    expect(cab.hp).toBe(10);
  });

  it("rejects an unknown part, a part outside the truck, and insufficient money", () => {
    const w = startAtBowl();
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 10;
    expect(() => repairPart(w, "missing")).toThrow(/part/);
    w.player.storage.push({ ...cab, id: "stored" });
    expect(() => repairPart(w, "stored")).toThrow(/part/);
    w.player.money = 0;
    expect(() => repairPart(w, cab.id)).toThrow(/money/);
    expect(cab.hp).toBe(10);
  });

  it("requires a shop for individual repairs", () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const cab = corePart(w.vehicles[0], "cab");
    cab.hp = 10;
    expect(() => repairPart(w, cab.id)).toThrow(/shop/);
    expect(cab.hp).toBe(10);
  });

  it("chassis swap keeps fitting parts and stores the rest", () => {
    let w = startAtBowl();
    w.player.money = 2000;
    w = buyChassis(w, "hauler");
    const me = w.vehicles[0];
    expect(me.chassisId).toBe("hauler");
    expect(
      mountedParts(me)
        .map((p) => p.defId)
        .filter((id) => partDef(id).kind !== "core")
        .sort(),
    ).toEqual(["cage", "mg", "panniers", "stockEngine"]);
    expect(goodsCount(me)).toEqual({ scrap: 2, parts: 2 });
    expect(w.player.money).toBe(
      2000 -
        (CHASSIS.hauler.value -
          Math.floor(CHASSIS.scout.value * (1 - ECONOMY.spread))),
    );
    w = buyChassis(w, "scout");
    expect(w.player.storage.length).toBe(0);
  });

  it("refunds the difference when the trade-in beats the new chassis price", () => {
    let w = startAtBowl();
    w.player.money = 5000;
    w = buyChassis(w, "carrier");
    const tradeIn = chassisTradeIn(w);
    expect(tradeIn).toBeGreaterThan(CHASSIS.scout.value);
    const before = w.player.money;
    w = buyChassis(w, "scout");
    expect(w.player.money).toBe(before + (tradeIn - CHASSIS.scout.value));
  });

  it("trade-in drops with built-in part damage", () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    coreParts(w.vehicles[0], "wheel")[0].hp = 0;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });

  it("trade-in drops with worn built-in parts, even at full health", () => {
    const w = startAtBowl();
    const whole = chassisTradeIn(w);
    for (const wheel of coreParts(w.vehicles[0], "wheel")) wheel.wear = 2;
    expect(chassisTradeIn(w)).toBeLessThan(whole);
  });
});

describe("part value and trade price", () => {
  it("wear lowers value", () => {
    const pristine = makePart(startAtBowl(), "mg", 0);
    const worn = makePart(startAtBowl(), "mg", 2);
    expect(partValue(worn)).toBeLessThan(partValue(pristine));
  });

  it("sells a broken part for its scrap floor", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    const floor = Math.round(ECONOMY.scrapPerKg * partDef("mg").mass);
    expect(partTradePrice(w, w.vehicles[0], part, "sell")).toBe(floor);
  });

  it("sell is always below buy at the same place", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 1);
    part.hp = Math.floor(maxHp(part) * 0.6);
    expect(partTradePrice(w, w.vehicles[0], part, "sell")).toBeLessThan(
      partTradePrice(w, w.vehicles[0], part, "buy"),
    );
  });

  it("a 0 HP part buys back strictly above its sell price", () => {
    const w = startAtBowl();
    const part = makePart(w, "turbine", 0);
    part.hp = 0;
    expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
      partTradePrice(w, w.vehicles[0], part, "sell"),
    );
  });

  it("a half-HP part buys back strictly above its sell price", () => {
    const w = startAtBowl();
    const part = makePart(w, "turbine", 0);
    part.hp = Math.floor(maxHp(part) / 2);
    expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
      partTradePrice(w, w.vehicles[0], part, "sell"),
    );
  });

  it("buy price is strictly above sell price for every part def and wear step, at any Social rank", () => {
    const w = startAtBowl();
    for (const social of [0, 3]) {
      w.player.ranks.social = social;
      for (const defId of Object.keys(PARTS)) {
        for (let wear = 0; wear <= CONDITION.maxWear; wear++) {
          const part = makePart(w, defId, wear);
          for (const hpShare of [0, 0.5, 1]) {
            part.hp = Math.floor(maxHp(part) * hpShare);
            expect(partTradePrice(w, w.vehicles[0], part, "buy")).toBeGreaterThan(
              partTradePrice(w, w.vehicles[0], part, "sell"),
            );
          }
        }
      }
    }
  });

  it("repair cost scales with the part's value", () => {
    const w = startAtBowl();
    const mg = makePart(w, "mg", 0);
    const rack = makePart(w, "rocketRack", 0);
    mg.hp = 0;
    rack.hp = 0;
    expect(partRepairCost(w, rack)).toBeGreaterThan(partRepairCost(w, mg));
    expect(partDef(rack.defId).value).toBeGreaterThan(partDef(mg.defId).value);
  });

  it("rebuild cost at 0 HP pays the full repair share of value", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    expect(partRepairCost(w, part)).toBe(
      Math.ceil(ECONOMY.repairShare * partValue(part)),
    );
  });

  it("refuses to price a rebuild for a junk part", () => {
    const w = startAtBowl();
    const part = makePart(w, "mg", 0);
    part.hp = 0;
    part.wear = CONDITION.maxWear + 1;
    expect(() => partRepairCost(w, part)).toThrow(/junk/);
  });

  it("loses money on a full rebuild then sale, for every part def, at Social 0", () => {
    const w = startAtBowl();
    for (const defId of Object.keys(PARTS)) {
      const part = makePart(w, defId, 0);
      part.hp = 0;
      const cost = partRepairCost(w, part);
      const saleBefore = partTradePrice(w, w.vehicles[0], part, "sell");
      part.hp = partDef(defId).hp;
      const saleAfter = partTradePrice(w, w.vehicles[0], part, "sell");
      expect(cost).toBeGreaterThan(saleAfter - saleBefore);
    }
  });
});

describe("supplies", () => {
  it("supplies drain each turn and running out hurts health", () => {
    const w = emptyWorld();
    w.player.supplies = 0.01;
    consumeSupplies(w);
    expect(w.player.supplies).toBe(0);
    expect(w.player.health).toBe(RULES.maxHealth - RULES.starveDamage);
  });

  it("drains suppliesPerTurn times heat over ten turns", () => {
    const w = emptyWorld();
    const heat = heatAt(w, w.vehicles[0].pos);
    const before = w.player.supplies;
    for (let i = 0; i < 10; i++) consumeSupplies(w);
    expect(w.player.supplies).toBeCloseTo(
      before - 10 * RULES.suppliesPerTurn * heat,
    );
  });

  it("toughness cuts use", () => {
    const w = emptyWorld();
    const heat = heatAt(w, w.vehicles[0].pos);
    w.player.ranks.toughness = 2;
    const before = w.player.supplies;
    consumeSupplies(w);
    expect(before - w.player.supplies).toBeLessThan(RULES.suppliesPerTurn * heat);
  });
});

describe("locations", () => {
  it("oasis refills supplies", () => {
    const oasis = REGION.locations.find((l) => l.kind === "oasis")!;
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    const after = useOasis(w);
    expect(after.player.supplies).toBe(RULES.baseSupplies);
    expect(w.player.supplies).toBe(1);
  });

  it.each(REGION.locations.filter((site) => site.kind === "oasis"))("$name does not refill automatically", (oasis) => {
    const w = emptyWorld({ x: oasis.pos.x + 2, y: oasis.pos.y });
    w.player.supplies = 10;
    const after = endTurn(w, () => {});
    expect(after.player.supplies).toBeLessThanOrEqual(10);
  });

  it("requires stopping before refilling at an oasis", () => {
    const oasis = REGION.locations.find((site) => site.kind === "oasis")!;
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(() => useOasis(w)).toThrow("Stop the truck first");
    expect(w.player.supplies).toBe(1);
  });

  it.each(REGION.locations.filter((site) => site.kind === "oasis"))("interacts with $name only while stopped", (oasis) => {
    const w = emptyWorld({ ...sitePads(oasis)[0] });
    w.player.supplies = 1;
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(canUseOasis(w)).toBe(false);
    expect(() => useOasis(w)).toThrow("Stop the truck first");
    expect(w.player.supplies).toBe(1);
    w.vehicles[0].speed = 0;
    expect(canUseOasis(w)).toBe(true);
    const after = useOasis(w);
    expect(after.player.supplies).toBe(RULES.baseSupplies);
    expect(after?.events).toContainEqual({ t: "info", text: `Filled supplies at ${oasis.name}` });
  });

  it("rejects refilling away from an oasis", () => {
    const w = emptyWorld({ x: 0, y: 0 });
    expect(() => useOasis(w)).toThrow("Not at an oasis");
  });

  it("convoy starts a timed search, and a second search cannot start while it runs", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    const after = scavenge(w, convoy.id);
    expect(after.vehicles[0].job).toEqual(
      expect.objectContaining({ kind: "search", stockId: convoy.id }),
    );
    expect(() => scavenge(after, convoy.id)).toThrow();
  });

  it("a town in reach needs a stop before it can be used", () => {
    const gate = sitePads(REGION.towns[0])[0];
    const w = emptyWorld({ ...gate });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(townAt(w)).toBeNull();
    expect(townNear(w)?.id).toBe(REGION.towns[0].id);
  });

  it("salvage in range needs a stop before it can be searched", () => {
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    const w = emptyWorld({ ...sitePads(convoy)[0] });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(canScavenge(w, convoy.id)).toBe(false);
    expect(salvageNear(w)?.id).toBe(convoy.id);
  });

  it("driving near a site discovers it once, with XP", () => {
    let w = newWorld(5, START_KITS.standard, TEST_MAP);
    const convoy = REGION.locations.find((l) => l.kind === "convoy")!;
    w.vehicles.find((v) => v.faction === "player")!.pos = {
      x: convoy.pos.x + 3.5,
      y: convoy.pos.y + 3.5,
    };
    w = endTurn(w, testDrive);
    expect(w.player.discovered).toContain("burnt-convoy");
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(1);
    w = endTurn(w, testDrive);
    expect(
      w.events.filter((e) => e.t === "discover" && e.location === convoy.id),
    ).toHaveLength(0);
  });
});

describe("debt", () => {
  it("a player in debt cannot buy anything", () => {
    const w = startAtBowl();
    w.player.money = -100;
    w.player.fuel = CHASSIS.scout.fuelCap - 1;
    expect(() => buyGood(w, "scrap", 1)).toThrow(/money/);
    expect(() => buySupply(w, "fuel", 1)).toThrow(/money/);
    expect(() => buyStockPart(w, w.shops.bowl.stock[0].id)).toThrow(/money/);
    expect(() => repairAll(w)).toThrow(/money/);
    // A chassis swap that costs nothing is still a purchase.
    w.player.money = -1;
    expect(() => buyChassis(w, "courier")).toThrow(/money/);
  });

  it("sales pay the debt down", () => {
    const w = startAtBowl();
    w.player.money = -100;
    const after = sellGood(w, "scrap", 2);
    expect(after.player.money).toBe(-100 + 2 * sellPrice(w, "bowl", "scrap"));
  });

  it("an NPC in debt gets no fuel, supplies or repairs in town", () => {
    const w = startAtBowl();
    const npc = addVehicle(w, "traders", "hauler", ["stockEngine"], { ...sitePads(bowl)[0] });
    npc.resources!.money = -50;
    npc.resources!.fuel = 1;
    npc.resources!.supplies = 1;
    const engine = mountedParts(npc, "engine")[0];
    engine.hp = 1;
    serviceVehicle(w, npc, "bowl", 0);
    expect(npc.resources).toMatchObject({ money: -50, fuel: 1, supplies: 1 });
    expect(engine.hp).toBe(1);
  });
});

describe("garage storage at a stall", () => {
  const atPump = () => emptyWorld({ ...sitePads(REGION.locations.find((l) => l.id === "pump-station")!)[0] });
  const fillGrid = (w: ReturnType<typeof emptyWorld>, defId: string) => {
    while (canStowPart(w.vehicles[0], makePart(w, defId, 0))) stowPart(w, w.vehicles[0], makePart(w, defId, 0));
  };

  it("sends a bought part that does not fit to storage, for the quoted price", () => {
    const w = atPump();
    w.player.money = 100000;
    const part = w.shops["pump-station"].stock[0];
    fillGrid(w, part.defId);
    const price = partTradePrice(w, w.vehicles[0], part, "buy");
    const items = w.vehicles[0].items.length;
    const next = buyStockPart(w, part.id);
    expect(next.player.money).toBe(100000 - price);
    expect(next.player.storage.filter((p) => p.id === part.id)).toHaveLength(1);
    expect(next.shops["pump-station"].stock.some((p) => p.id === part.id)).toBe(false);
    expect(next.vehicles[0].items).toHaveLength(items);
  });

  it("still refuses a part the player cannot pay for", () => {
    const w = atPump();
    w.player.money = 0;
    const part = w.shops["pump-station"].stock[0];
    fillGrid(w, part.defId);
    expect(() => buyStockPart(w, part.id)).toThrow(/money/);
  });

  it("buys a stored part into the stall stock", () => {
    const w = atPump();
    const stored = makePart(w, "mg", 0);
    w.player.storage.push(stored);
    const price = partTradePrice(w, w.vehicles[0], stored, "sell");
    const next = sellPart(w, stored.id);
    expect(next.player.money).toBe(w.player.money + price);
    expect(next.player.storage).toEqual([]);
    expect(next.shops["pump-station"].stock.some((p) => p.id === stored.id)).toBe(true);
  });

  it("sells no chassis at a stall", () => {
    const w = atPump();
    w.player.money = 100000;
    expect(() => buyChassis(w, "longbed")).toThrow(/town/);
  });
});
