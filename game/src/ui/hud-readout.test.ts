import { describe, expect, it } from "vitest";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { corePart, mountedParts } from "../sim/grid";
import { knockOutNpc } from "../sim/defeat";
import { STATE_TURNS } from "../data/npcs";
import { addVehicle, emptyWorld, furyRoadWorld, npcBrain, spotWorld, startCombat } from "../sim/testkit";
import { outpostPad } from "../sim/fury-road";
import { maxHealthOf } from "../sim/health";
import { suppliesCap } from "../sim/stats";
import { maxHp } from "../sim/wear";
import { addState, towData } from "../sim/states";
import { playerAid } from "../sim/aid";
import { aidGoods, clock } from "./format";
import { t, verbatim, type Msg } from "../text/msg";
import { chassisName, driverName, professionName, siteName } from "../text/names";
import { resolve } from "../text/resolve";
import type { Vehicle } from "../sim/types";
import { bugReportUrl, ContextPicker, featureRequestUrl, getContextActions, getHudReadout, getRescueReadout, overdriveSwitch, versionLabel } from "./hud-readout";
import type { ContextAction } from "./hud";
import { GAME_VERSION } from "../config";
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { partDef } from "../data/parts";
import { startKit } from "../data/start";
import { actBlock, newWorld } from "../sim/world";
import { playerVehicle } from "../sim/damage";
import { stowPart } from "../sim/inventory";
import { beginSearch } from "../sim/search";
import { dumpOnPile, emptyHidden, isRoadWreck, oldSpotPicks, oldStockId } from "../sim/salvage";
import { TEST_MAP } from "../test/map";
import { defaultSetup } from "../sim/settings";
import { isLootSpot, territoryAt } from "../sim/territory";
import { propReach } from "../sim/mapgen";
import type { Obstacle, World } from "../sim/types";

const en = (msg: Msg): string => resolve(msg, "en");
const siteEn = (id: string): string => en(siteName(id));
const npcName = (v: Vehicle): string =>
  en(v.brain ? t("vehicle.npc", { profession: professionName(v.brain.templateId), driver: driverName(v) }) : chassisName(v.chassisId));

// The actions in reach with their words in English.
function actions(w: World) {
  return getContextActions(w, false).map((a) => ({ ...a, label: en(a.label), ...(a.hint ? { hint: en(a.hint) } : {}) }));
}

describe('knocked-out truck interaction', () => {
  it('offers looting a knocked-out truck in reach only while stopped', () => {
    const w = emptyWorld();
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + gap, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    expect(actions(w)).toEqual([]);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    expect(actions(w)[0]).toMatchObject({ label: `Loot ${npcName(buggy)}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(actions(w)[0]).toMatchObject({ label: `Loot ${npcName(buggy)}`, ready: false });
  });
});

describe('outpost interaction', () => {
  it.each(REGION.locations.filter((site) => site.kind === 'oasis'))('offers the shop at $id only while stopped, and no free refill', (site) => {
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(actions(w)[0]).toMatchObject({ label: `Enter ${siteEn(site.id)}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(actions(w)[0]).toMatchObject({ label: `Enter ${siteEn(site.id)}`, ready: false });
    expect(actions(w).map((a) => a.label).join()).not.toMatch(/Refill/);
  });

  it('hides interaction during playback and while knocked out', () => {
    const site = REGION.locations.find((site) => site.kind === 'oasis')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(getContextActions(w, true)).toEqual([]);
    w.player.state = 'knockedOut';
    expect(actions(w)).toEqual([]);
  });
});

describe('salvage interaction', () => {
  it('says a site is picked clean when its stock is empty', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos, radius: propReach(spot) };
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() }];
    expect(actions(w)[0]).toMatchObject({ label: 'Search', ready: true, combat: undefined });
    w.salvage[0].goods.scrap = 0;
    expect(actions(w)[0]).toMatchObject({ label: 'Picked clean', ready: false, hint: 'No loot left' });
  });

  it('offers a search while units stay hidden and the revealed loot once searched, both at once', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos, radius: propReach(spot) };
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } }];
    expect(actions(w).map((a) => a.label)).toEqual(['Search']);
    w.player.scavenged.push(site.id);
    expect(actions(w)).toEqual([
      expect.objectContaining({ label: 'Search', ready: true, target: { kind: 'stock', id: site.id } }),
      expect.objectContaining({ label: 'Loot', ready: true, target: { kind: 'loot', id: site.id } }),
    ]);
    w.salvage[0].hidden = emptyHidden();
    expect(actions(w).map((a) => a.label)).toEqual(['Loot']);
    w.salvage[0].goods.scrap = 0;
    expect(actions(w)[0]).toMatchObject({ label: 'Picked clean' });
  });

  it('keeps offering a search beside revealed supplies the full tank cannot take', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos, radius: propReach(spot) };
    w.player.supplies = suppliesCap(w.vehicles[0]);
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: {}, parts: [], supplies: 20, hidden: { ...emptyHidden(), goods: { scrap: 2 } } }];
    w.player.scavenged.push(site.id);
    expect(actions(w)).toEqual([
      expect.objectContaining({ label: 'Search', ready: true }),
      expect.objectContaining({ label: 'Loot', ready: true }),
    ]);
    w.salvage[0].hidden = emptyHidden();
    expect(actions(w).map((a) => a.label)).toEqual(['Loot']);
  });

  it('picks the loot of a stock beside its search with the arrows', () => {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos, radius: propReach(spot) };
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } }];
    w.player.scavenged.push(site.id);
    const picker = new ContextPicker();
    expect(en(picker.pick(getContextActions(w, false))!.label)).toBe('Search');
    picker.cycle(getContextActions(w, false), 1);
    expect(en(picker.pick(getContextActions(w, false))!.label)).toBe('Loot');
  });

  it('blocks both the search and the loot while another truck loots the stock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } });
    w.player.scavenged.push('wreck901');
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 31.5, y: 30 });
    npc.speed = 0;
    beginSearch(w, npc, 'wreck901');
    expect(actions(w)).toEqual([
      expect.objectContaining({ label: 'Search the wreck', ready: false, hint: `${npcName(npc)} is looting it` }),
      expect.objectContaining({ label: 'Loot the wreck', ready: false, hint: `${npcName(npc)} is looting it` }),
    ]);
  });
});

function parkedAt(find: (o: Obstacle) => boolean): { w: World; id: string } {
  const w = newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
  const o = w.obstacles.find(find);
  if (!o) throw new Error('No such prop on the test map');
  const me = playerVehicle(w);
  me.pos = { x: o.pos.x + propReach(o) + 1, y: o.pos.y };
  me.speed = 0;
  return { w, id: o.id };
}

function spotOf(territory: string, look: string): (o: Obstacle) => boolean {
  return (o) => isLootSpot(o) && o.kind === 'landmark' && o.look === look && territoryAt(o.pos)?.id === territory;
}

function stockLabel(w: World, id: string, kind: 'stock' | 'loot' = 'stock'): string | undefined {
  return actions(w).find((a) => a.target.kind === kind && a.target.id === id)?.label;
}

function reveal(w: World, id: string): void {
  const stock = w.salvage.find((s) => s.id === id)!;
  for (const [good, n] of Object.entries(stock.hidden.goods)) stock.goods[good] = (stock.goods[good] ?? 0) + (n ?? 0);
  stock.parts.push(...stock.hidden.parts);
  stock.hidden = emptyHidden();
}

describe('loot spot wording', () => {
  it.each(['farmhouse', 'quonset'])('says Search, then Loot, then Picked clean at an orchard %s', (look) => {
    const { w, id } = parkedAt(spotOf('orchard', look));
    expect(stockLabel(w, id)).toBe('Search');
    w.player.scavenged.push(id);
    reveal(w, id);
    expect(stockLabel(w, id, 'loot')).toBe('Loot');
    w.salvage = w.salvage.filter((s) => s.id === id);
    const stock = w.salvage[0];
    stock.goods = {};
    stock.parts = [];
    stock.fuel = 0;
    stock.supplies = 0;
    expect(actions(w).map((a) => a.label)).toEqual(['Picked clean']);
  }, 30_000);

  it.each([
    ['an orchard army truck', spotOf('orchard', 'armyTruck')],
    ['a Fallen Sun ship cache', spotOf('fallen-sun', 'shipCache')],
    ['a Glass Flats engine cache', spotOf('glass-flats', 'engineCache')],
    ['a Glass Flats dead truck', spotOf('glass-flats', 'deadTruck')],
    ['a road wreck', (o: Obstacle) => isRoadWreck(o)],
  ])('keeps the wreck wording at %s', (_name, find) => {
    const { w, id } = parkedAt(find);
    expect(stockLabel(w, id)).toBe('Search the wreck');
    w.player.scavenged.push(id);
    reveal(w, id);
    expect(stockLabel(w, id, 'loot')).toBe('Loot the wreck');
  }, 30_000);

  it.each([
    ['a building', 'Search', 'Loot'],
    ['tank hulks', 'Search the wreck', 'Loot the wreck'],
  ])('reads %s at an old-world loot spot as %s, then %s', (name, search, loot) => {
    const pick = oldSpotPicks(TEST_MAP).find((p) => (p.type === 'hulks') === (name === 'tank hulks'))!;
    const { w } = parkedAt((o) => o.id === pick.propId);
    const id = oldStockId(pick);
    expect(stockLabel(w, id)).toBe(search);
    w.player.scavenged.push(id);
    reveal(w, id);
    w.salvage.find((s) => s.id === id)!.goods.scrap = 1;
    expect(stockLabel(w, id, 'loot')).toBe(loot);
  }, 30_000);

  it('names the driver blocking a shared spot with a plain Search', () => {
    const { w, id } = parkedAt(spotOf('orchard', 'farmhouse'));
    const me = playerVehicle(w);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: me.pos.x + 2, y: me.pos.y });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    beginSearch(w, npc, id);
    expect(actions(w).find((a) => a.target.kind === 'stock' && a.target.id === id)).toMatchObject({
      label: 'Search',
      ready: false,
      hint: `${npcName(npc)} is looting it`,
    });
  }, 30_000);
});

describe('every interaction in reach', () => {
  it('lists a player pile on a town pad after the shop', () => {
    const town = REGION.towns[0];
    const w = emptyWorld({ ...sitePads(town)[0] });
    const me = w.vehicles[0];
    dumpOnPile(w, me, me.items.find((item) => item.kind === 'good') ?? me.items[0]);
    const labels = actions(w).map((a) => a.label);
    expect(labels).toEqual([`Enter ${siteEn(town.id)}`, 'Loot the pile']);
  });

  it('lists a pile on a wreck beside the wreck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    const me = w.vehicles[0];
    const pile = dumpOnPile(w, me, me.items.find((item) => item.kind === 'good') ?? me.items[0]);
    expect(actions(w).map((a) => a.target)).toEqual([
      { kind: 'stock', id: 'wreck901' },
      { kind: 'loot', id: pile.id },
    ]);
  });

  it('lists each knocked-out truck in reach', () => {
    const w = emptyWorld();
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const buggies = [gap, -gap].map((dx) => {
      const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + dx, y: 30 });
      buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
      corePart(buggy, 'cab').hp = 0;
      knockOutNpc(w, buggy);
      return buggy;
    });
    expect(actions(w).map((a) => a.target)).toEqual(buggies.map((b) => ({ kind: 'downed', id: b.id })));
  });

  it('lists no stock action while the truck is busy', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    beginSearch(w, w.vehicles[0], 'wreck901');
    expect(actions(w)).toEqual([]);
  });
});

describe('shared wreck', () => {
  it('dims the search while another driver searches the wreck, and names the driver', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 31.5, y: 30 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    expect(actions(w)[0]).toMatchObject({ label: 'Search the wreck', ready: true, combat: undefined });
    beginSearch(w, npc, 'wreck901');
    expect(actions(w)[0]).toMatchObject({ label: 'Search the wreck', ready: false, hint: `${npcName(npc)} is looting it` });
  });
});

describe('search in combat', () => {
  function siteScene() {
    const { w, spot } = spotWorld();
    const site = { id: spot.id, pos: spot.pos, radius: propReach(spot) };
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() }];
    const me = playerVehicle(w).pos;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: me.x + 6, y: me.y });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    return { w, raider };
  }

  it('does not block a search beside a hostile that has not attacked', () => {
    const { w } = siteScene();
    expect(actions(w)[0]).toMatchObject({ label: 'Search', combat: undefined });
  });

  it('blocks a search in combat and says how many turns are left', () => {
    const { w, raider } = siteScene();
    startCombat(w, raider, playerVehicle(w));
    expect(actions(w)[0]).toMatchObject({ label: 'Search', ready: false, combat: STATE_TURNS.combat });
  });
});

describe("critical vehicle readout", () => {
  it("keeps money, survival resources and driver condition visible", () => {
    const w = emptyWorld();
    w.player.money = 123450;
    w.player.fuel = 18.5;
    w.player.supplies = 7.25;
    expect(getHudReadout(w).resources.map((r) => en(r.label))).toEqual([
      "Money",
      "Fuel",
      "Supplies",
      "Driver",
    ]);
    expect(
      getHudReadout(w)
        .resources.slice(0, 3)
        .map((r) => en(r.value)),
    ).toEqual(["1,235 M's", "93 L", "7 kg"]);
  });
  it("shows fractional driver health as a whole number", () => {
    const w = emptyWorld();
    w.player.health = 41.123456789;
    const [, , , driver] = getHudReadout(w).resources.map((r) => en(r.value));
    expect(driver).toBe('42');
  });
  it("warns at the actual fuel speed-limit threshold", () => {
    const w = emptyWorld();
    const threshold =
      chassisDef(w.vehicles[0].chassisId).fuelCap * RULES.lowFuelThreshold;
    w.player.fuel = threshold;
    expect(getHudReadout(w).resources[1].warning).toBe(false);
    w.player.fuel = threshold - 0.1;
    expect(getHudReadout(w).resources[1].warning).toBe(true);
  });
  it("exposes damaged parts and injured driver without opening a window", () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], "cab").hp = 0;
    w.player.health = 25;
    w.player.supplies = 0;
    const r = getHudReadout(w);
    expect(r.resources.slice(2).every((r) => r.warning)).toBe(true);
  });
  it("shows driver health against the raised max health and warns below it", () => {
    const w = emptyWorld();
    w.player.ranks.toughness = 5;
    w.player.health = RULES.maxHealth;
    const driver = getHudReadout(w).resources.find((r) => r.id === "driver")!;
    expect({ id: driver.id, label: en(driver.label), value: en(driver.value), warning: driver.warning }).toEqual({ id: "driver", label: "Driver", value: String(RULES.maxHealth), warning: true });
    expect(maxHealthOf(w)).toBeGreaterThan(RULES.maxHealth);
  });

  it("keeps parked jobs out of the survival instruments", () => {
    const w = emptyWorld();
    w.vehicles[0].job = {
      kind: "search",
      stockId: "stock",
      turnsLeft: 2,
      total: 4,
    };
    expect(getHudReadout(w).survival.map((r) => en(r.label))).toEqual(["Heat", "Engine"]);
  });
  it("shows the weather only when it is not clear", () => {
    const w = emptyWorld();
    expect(getHudReadout(w).survival.map((r) => r.id)).not.toContain("weather");
    w.weather = [{ id: "h", kind: "heatwave", turnsLeft: 9, born: w.turn } as World["weather"][number]];
    const weather = getHudReadout(w).survival.find((r) => r.id === "weather")!;
    expect({ label: en(weather.label), value: en(weather.value), warning: weather.warning }).toEqual({ label: "Weather", value: "Heat wave", warning: false });
  });
  it("marks low fuel on the fuel readout with its cause", () => {
    const w = emptyWorld();
    w.player.fuel = 1;
    const fuel = getHudReadout(w).resources[1];
    expect(fuel).toMatchObject({ warning: true, icon: "fuel" });
    expect(en(fuel.tip!)).toMatch(/^Low fuel: max \d+ km\/h$/);
  });
  it("shows the game clock once, outside the survival instruments", () => {
    const w = emptyWorld();
    w.turn = 5;
    const before = getHudReadout(w);
    expect(en(before.clock.full)).toBe(en(clock(w.turn).full));
    expect(before.survival.some((r) => r.id === "time")).toBe(false);
    w.turn = 5 + 100000;
    const later = getHudReadout(w);
    expect(en(later.clock.full)).toBe(en(clock(w.turn).full));
    expect(en(later.clock.full)).not.toBe(en(before.clock.full));
  });
  it("keeps reverse speed and manual driving explicit", () => {
    const w = emptyWorld();
    w.vehicles[0].speed = -2;
    w.vehicles[0].direct = true;
    expect(getHudReadout(w)).toMatchObject({ speed: -29, manual: true });
  });
});

describe("act block", () => {
  it("names why the player cannot act", () => {
    const w = emptyWorld();
    expect(actBlock(w)).toBeNull();
    w.player.state = "knockedOut";
    expect(actBlock(w)).toBe("knockedOut");
  });
});

function rescue(w: World) {
  const r = getRescueReadout(w);
  if (r?.kind === "stranded") return { ...r, reason: r.reason && en(r.reason) };
  if (r?.kind === "towed") return { ...r, tower: en(r.tower), town: en(r.town) };
  return r;
}

describe("rescue readout", () => {
  it("shows negative money as a negative amount with a warning", () => {
    const w = emptyWorld();
    w.player.money = -120050;
    const money = getHudReadout(w).resources[0];
    expect({ value: en(money.value), balance: money.balance, warning: money.warning }).toEqual({ value: "\u22121,201 M's", balance: -120050, warning: true });
  });
  it("gives only the M's entry a balance", () => {
    const { resources } = getHudReadout(emptyWorld());
    expect(resources[0]).toHaveProperty("balance");
    expect(resources.slice(1).every((r) => !("balance" in r))).toBe(true);
  });
  it("names a missing engine without telling the player what to do", () => {
    const w = newWorld(1337, startKit("combat"), TEST_MAP, defaultSetup('roaming'));
    const me = playerVehicle(w);
    const engine = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "engine");
    if (!engine || engine.kind !== "part") throw new Error("Expected an engine");
    me.items = me.items.filter((it) => it.kind === "part" && partDef(it.part.defId).kind === "core");
    expect(rescue(w)).toMatchObject({ kind: "stranded", reason: "No working engine." });
    expect(stowPart(w, me, engine.part)).toBe(true);
    expect(rescue(w)).toMatchObject({ kind: "stranded", reason: "No working engine." });
  });
  it("follows the player from stranded to tow, and leaves an open offer to the radio", () => {
    const w = emptyWorld();
    expect(getRescueReadout(w)).toBeNull();
    w.player.fuel = 0;
    expect(rescue(w)).toEqual({ kind: "stranded", beacon: false, reason: "Out of fuel.", canEnd: false });
    w.player.beacon = true;
    expect(rescue(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel.", canEnd: false });
    w.player.money = 10;
    const tow = addState(w, "tow", w.vehicles[0].id, w.player.vehicleId, { kind: "tow", site: "bowl", fee: 50, waived: 0, hitched: false });
    expect(rescue(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel.", canEnd: false });
    towData(tow).hitched = true;
    expect(getRescueReadout(w)).toMatchObject({ kind: "towed", fee: 50 });
    w.player.state = "knockedOut";
    expect(getRescueReadout(w)).toEqual({ kind: "knockedOut" });
    w.player.state = "dead";
    expect(getRescueReadout(w)).toBeNull();
  });
});

describe('trade interaction', () => {
  function atTownWithTrader(npcSpeed: number) {
    const town = REGION.towns[0];
    const w = emptyWorld({ ...sitePads(town)[0] });
    const me = w.vehicles[0];
    const npc = addVehicle(w, 'traders', 'scout', [], { x: me.pos.x + 3, y: me.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    npc.speed = npcSpeed;
    addState(w, 'trade', npc.id, w.player.vehicleId, { kind: 'none' });
    return { w, town, npc };
  }

  it('offers the trade over the town once both trucks are parked side by side', () => {
    const { w, npc } = atTownWithTrader(0);
    expect(actions(w)[0]).toMatchObject({ label: `Trade with ${npcName(npc)}`, ready: true });
  });

  it('offers the town while the trader still drives', () => {
    const { w, town } = atTownWithTrader(RULES.parkedSpeed + 1);
    expect(actions(w)[0]).toMatchObject({ label: `Enter ${siteEn(town.id)}`, ready: true });
  });
});

describe('issue form links', () => {
  it('points at the bug form with the version filled', () => {
    const url = new URL(bugReportUrl('v1.2.3'));
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/btseytlin/road-machiners/issues/new');
    expect(url.searchParams.get('template')).toBe('bug.yml');
    expect(url.searchParams.get('version')).toBe('v1.2.3');
  });

  it('encodes a version with special characters', () => {
    const url = new URL(bugReportUrl('v1 & 2+3'));
    expect(url.searchParams.get('version')).toBe('v1 & 2+3');
    expect([...url.searchParams.keys()].sort()).toEqual(['template', 'version']);
  });

  it('points at the feature form', () => {
    const url = new URL(featureRequestUrl());
    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/btseytlin/road-machiners/issues/new');
    expect(url.searchParams.get('template')).toBe('feature-request.yml');
  });

  it('gives the feature form no other fields', () => {
    expect([...new URL(featureRequestUrl()).searchParams.keys()]).toEqual(['template']);
  });

  it('labels the version as the ? menu shows it', () => {
    expect(versionLabel()).toBe(`v${GAME_VERSION}`);
  });
});

describe('aid handover action', () => {
  function aidScene(npcX: number, giver: 'player' | 'npc') {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: npcX, y: 30 });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    addState(w, 'aid', npc.id, w.player.vehicleId, { kind: 'aid', giver, fuel: 5, supplies: 0, price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
    return { w, npc };
  }

  it('offers giving fuel unready while the trucks move in reach, ready once parked side by side', () => {
    const moving = aidScene(34, 'player');
    moving.npc.speed = RULES.parkedSpeed + 1;
    expect(actions(moving.w)[0]).toMatchObject({ label: `Give ${en(aidGoods(playerAid(moving.w)!))} to ${npcName(moving.npc)}`, ready: false, target: { kind: 'aid', id: moving.npc.id } });
    const near = aidScene(34, 'player');
    expect(actions(near.w)[0]).toMatchObject({ label: expect.stringContaining('Give'), ready: true, target: { kind: 'aid', id: near.npc.id } });
  });

  it('shows no aid action while the agreed driver is out of reach, even beside another driver', () => {
    const { w, npc } = aidScene(60, 'player');
    addVehicle(w, 'traders', 'scout', [], { x: 34, y: 30 });
    const all = actions(w);
    expect(all.filter((a) => a.target.kind === 'aid')).toEqual([]);
    expect(all.some((a) => a.label.includes(npcName(npc)))).toBe(false);
  });

  it('shows one aid action naming the agreed driver when another is also in reach', () => {
    const { w, npc } = aidScene(34, 'player');
    addVehicle(w, 'traders', 'scout', [], { x: 26, y: 30 });
    const aids = actions(w).filter((a) => a.target.kind === 'aid');
    expect(aids).toHaveLength(1);
    expect(aids[0]).toMatchObject({ target: { kind: 'aid', id: npc.id }, label: expect.stringContaining(npcName(npc)) });
  });

  it('gives the same actions after a save and reload', () => {
    const { w } = aidScene(34, 'player');
    expect(getContextActions(JSON.parse(JSON.stringify(w)), false)).toEqual(getContextActions(w, false));
  });

  it('offers taking fuel when the driver gives, and wins over a ready place action', () => {
    const { w, npc } = aidScene(34, 'npc');
    const site = REGION.locations.find((s) => s.kind === 'oasis')!;
    w.vehicles[0].pos = { ...sitePads(site)[0] };
    npc.pos = { x: w.vehicles[0].pos.x + 4, y: w.vehicles[0].pos.y };
    expect(actions(w)[0]).toMatchObject({ label: `Take ${en(aidGoods(playerAid(w)!))} from ${npcName(npc)}`, ready: true });
  });
});

describe('several trades', () => {
  it('lists only the trade whose driver is in reach, with that driver as target', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const far = addVehicle(w, 'traders', 'scout', [], { x: 90, y: 30 });
    const near = addVehicle(w, 'traders', 'scout', [], { x: 34, y: 30 });
    addState(w, 'trade', far.id, w.player.vehicleId, { kind: 'none' });
    addState(w, 'trade', near.id, w.player.vehicleId, { kind: 'none' });
    const trades = actions(w).filter((a) => a.target.kind === 'trade');
    expect(trades).toEqual([{ label: `Trade with ${npcName(near)}`, ready: true, target: { kind: 'trade', id: near.id } }]);
  });
});

const shop: ContextAction = { label: verbatim('Enter'), ready: true, target: { kind: 'shop' } };
const pile: ContextAction = { label: verbatim('Loot the pile'), ready: true, target: { kind: 'loot', id: 'p1' } };
const wreck: ContextAction = { label: verbatim('Search the wreck'), ready: true, target: { kind: 'stock', id: 'w1' } };

describe('context picker', () => {
  it('picks the first action by default', () => {
    expect(new ContextPicker().pick([shop, pile])).toBe(shop);
  });

  it('gives null for an empty list', () => {
    const picker = new ContextPicker();
    expect(picker.pick([])).toBeNull();
    picker.cycle([], 1);
    expect(picker.pick([])).toBeNull();
  });

  it('cycles both ways and wraps', () => {
    const picker = new ContextPicker();
    const list = [shop, pile, wreck];
    picker.cycle(list, 1);
    expect(picker.pick(list)).toBe(pile);
    picker.cycle(list, 1);
    picker.cycle(list, 1);
    expect(picker.pick(list)).toBe(shop);
    picker.cycle(list, -1);
    expect(picker.pick(list)).toBe(wreck);
  });

  it('keeps the selection on its target when the list reorders', () => {
    const picker = new ContextPicker();
    picker.cycle([shop, pile, wreck], 1);
    expect(picker.pick([wreck, shop, { ...pile, ready: false }])?.target).toEqual(pile.target);
  });

  it('falls back to the first entry when the target leaves, and stays there', () => {
    const picker = new ContextPicker();
    picker.cycle([shop, pile, wreck], 1);
    expect(picker.pick([shop, wreck])).toBe(shop);
    expect(picker.pick([wreck, pile, shop])).toBe(shop);
  });
});

describe('overdrive switch', () => {
  function wornTo(extra: number) {
    const w = emptyWorld();
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    engine.wear = 2;
    engine.hp = Math.floor(RULES.overdriveMinEngineShare * maxHp(engine)) + extra;
    return w;
  }

  it('is blocked at 15% engine HP and says why, with the share from the rule', () => {
    const w = wornTo(0);
    w.player.overdrive = true;
    const s = overdriveSwitch(w);
    const reason = `Engine too worn for overdrive: repair it above ${RULES.overdriveMinEngineShare * 100}% [O]`;
    expect({ checked: s.checked, reason: s.reason && en(s.reason), title: en(s.title) }).toEqual({ checked: false, reason, title: reason });
  });

  it('is open one HP above 15% and shows the flag', () => {
    const w = wornTo(1);
    const s = overdriveSwitch(w);
    expect({ checked: s.checked, reason: s.reason, title: en(s.title) }).toEqual({ checked: false, reason: null, title: 'Faster, but the engine heats fast [O]' });
    w.player.overdrive = true;
    expect(overdriveSwitch(w).checked).toBe(true);
  });
});

describe("Fury Road readouts", () => {
  const parkAt = (w: World, milestone: number) => {
    const me = playerVehicle(w);
    me.pos = outpostPad(w, milestone);
    me.speed = 0;
  };

  it("shows the stretch and the distance to the next outpost", () => {
    const run = getHudReadout(furyRoadWorld()).resources.find((r) => r.id === "run");

    expect(en(run!.value)).toMatch(/^1: \d+(\.\d)? k?m$/);
    expect(en(run!.tip!)).toMatch(/^Stretch 1: .* to Outpost 1$/);
  });

  it("shows no run readout in Roaming", () => {
    const w = newWorld(3, startKit("standard"), TEST_MAP, defaultSetup("roaming"));

    expect(getHudReadout(w).resources.some((r) => r.id === "run")).toBe(false);
  });

  it("offers to enter a reached outpost only while parked on its pad", () => {
    const w = furyRoadWorld();
    parkAt(w, 1);
    expect(actions(w).some((a) => a.target.kind === "outpost")).toBe(false);

    w.furyRoad!.outposts[0].paid = true;
    expect(actions(w)).toContainEqual({ label: "Enter Outpost 1", ready: true, target: { kind: "outpost" } });
    playerVehicle(w).speed = 2;
    expect(actions(w)).toContainEqual({ label: "Enter Outpost 1", ready: false, target: { kind: "outpost" } });
  });

  it("offers End run instead of the beacon to a stranded truck", () => {
    const w = furyRoadWorld();
    w.player.fuel = 0;

    expect(rescue(w)).toEqual({ kind: "stranded", beacon: false, reason: "Out of fuel.", canEnd: true });
  });
});
