import { describe, expect, it } from "vitest";
import { chassisDef } from "../data/chassis";
import { RULES } from "../data/rules";
import { corePart, mountedParts } from "../sim/grid";
import { knockOutNpc } from "../sim/defeat";
import { STATE_TURNS } from "../data/npcs";
import { addVehicle, emptyWorld, npcBrain, startCombat } from "../sim/testkit";
import { npcName } from "../sim/spawn";
import { maxHealthOf } from "../sim/health";
import { addState, towData } from "../sim/states";
import { playerAid } from "../sim/aid";
import { aidGoods, clockLabel } from "./format";
import { bugReportUrl, ContextPicker, featureRequestUrl, getContextActions, getHudReadout, getRescueReadout, overdriveSwitch, versionLabel } from "./hud-readout";
import type { ContextAction } from "./hud";
import { GAME_VERSION } from "../config";
import { REGION } from '../data/region';
import { sitePads } from '../sim/sites';
import { partDef } from "../data/parts";
import { startKit } from "../data/start";
import { newWorld } from "../sim/world";
import { playerVehicle } from "../sim/damage";
import { stowPart } from "../sim/inventory";
import { beginSearch } from "../sim/search";
import { dumpOnPile, emptyHidden, isRoadWreck } from "../sim/salvage";
import { TEST_MAP } from "../test/map";
import { defaultSetup } from "../sim/settings";
import { isLootSpot, territoryAt } from "../sim/territory";
import { propReach } from "../sim/mapgen";
import type { Obstacle, World } from "../sim/types";

describe('knocked-out truck interaction', () => {
  it('offers looting a knocked-out truck in reach only while stopped', () => {
    const w = emptyWorld();
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + gap, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    expect(getContextActions(w, false)).toEqual([]);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Loot ${npcName(buggy)}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Loot ${npcName(buggy)}`, ready: false });
  });
});

describe('oasis interaction', () => {
  it.each(REGION.locations.filter((site) => site.kind === 'oasis'))('offers refilling at $name only while stopped', (site) => {
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Refill supplies at ${site.name}`, ready: true });
    w.vehicles[0].speed = RULES.parkedSpeed + 1;
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Refill supplies at ${site.name}`, ready: false });
  });

  it('hides interaction during playback and while knocked out', () => {
    const site = REGION.locations.find((site) => site.kind === 'oasis')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    expect(getContextActions(w, true)).toEqual([]);
    w.player.state = 'knockedOut';
    expect(getContextActions(w, false)).toEqual([]);
  });
});

describe('salvage interaction', () => {
  it('says a site is picked clean when its stock is empty', () => {
    const site = REGION.locations.find((site) => site.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() }];
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Search ${site.name}`, ready: true, combat: undefined });
    w.salvage[0].goods.scrap = 0;
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `${site.name} is picked clean`, ready: false, hint: 'No loot left' });
  });

  it('offers a search while units stay hidden and the revealed loot once searched, both at once', () => {
    const site = REGION.locations.find((site) => site.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } }];
    expect(getContextActions(w, false).map((a) => a.label)).toEqual([`Search ${site.name}`]);
    w.player.scavenged.push(site.id);
    expect(getContextActions(w, false)).toEqual([
      expect.objectContaining({ label: `Search ${site.name}`, ready: true, target: { kind: 'stock', id: site.id } }),
      expect.objectContaining({ label: `Loot ${site.name}`, ready: true, target: { kind: 'loot', id: site.id } }),
    ]);
    w.salvage[0].hidden = emptyHidden();
    expect(getContextActions(w, false).map((a) => a.label)).toEqual([`Loot ${site.name}`]);
    w.salvage[0].goods.scrap = 0;
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `${site.name} is picked clean` });
  });

  it('picks the loot of a stock beside its search with the arrows', () => {
    const site = REGION.locations.find((site) => site.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } }];
    w.player.scavenged.push(site.id);
    const picker = new ContextPicker();
    expect(picker.pick(getContextActions(w, false))?.label).toBe(`Search ${site.name}`);
    picker.cycle(getContextActions(w, false), 1);
    expect(picker.pick(getContextActions(w, false))?.label).toBe(`Loot ${site.name}`);
  });

  it('blocks both the search and the loot while another truck loots the stock', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 1 }, parts: [], hidden: { ...emptyHidden(), goods: { scrap: 2 } } });
    w.player.scavenged.push('wreck901');
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 31.5, y: 30 });
    npc.speed = 0;
    beginSearch(w, npc, 'wreck901');
    expect(getContextActions(w, false)).toEqual([
      expect.objectContaining({ label: 'Search the wreck', ready: false, hint: `${npc.name} is looting it` }),
      expect.objectContaining({ label: 'Loot the wreck', ready: false, hint: `${npc.name} is looting it` }),
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
  return getContextActions(w, false).find((a) => a.target.kind === kind && a.target.id === id)?.label;
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
    expect(getContextActions(w, false).map((a) => a.label)).toEqual(['Picked clean']);
  }, 30_000);

  it.each([
    ['an orchard army truck', spotOf('orchard', 'armyTruck')],
    ['a Fallen Sun ship cache', spotOf('fallen-sun', 'shipCache')],
    ['a road wreck', (o: Obstacle) => isRoadWreck(o)],
  ])('keeps the wreck wording at %s', (_name, find) => {
    const { w, id } = parkedAt(find);
    expect(stockLabel(w, id)).toBe('Search the wreck');
    w.player.scavenged.push(id);
    reveal(w, id);
    expect(stockLabel(w, id, 'loot')).toBe('Loot the wreck');
  }, 30_000);

  it('names the driver blocking a shared spot with a plain Search', () => {
    const { w, id } = parkedAt(spotOf('orchard', 'farmhouse'));
    const me = playerVehicle(w);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: me.pos.x + 2, y: me.pos.y });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    beginSearch(w, npc, id);
    expect(getContextActions(w, false).find((a) => a.target.kind === 'stock' && a.target.id === id)).toMatchObject({
      label: 'Search',
      ready: false,
      hint: `${npc.name} is looting it`,
    });
  }, 30_000);
});

describe('every interaction in reach', () => {
  it('lists a player pile on a town pad after the shop', () => {
    const town = REGION.towns[0];
    const w = emptyWorld({ ...sitePads(town)[0] });
    const me = w.vehicles[0];
    dumpOnPile(w, me, me.items.find((item) => item.kind === 'good') ?? me.items[0]);
    const labels = getContextActions(w, false).map((a) => a.label);
    expect(labels).toEqual([`Enter ${town.name}`, 'Loot the pile']);
  });

  it('lists a pile on a wreck beside the wreck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    const me = w.vehicles[0];
    const pile = dumpOnPile(w, me, me.items.find((item) => item.kind === 'good') ?? me.items[0]);
    expect(getContextActions(w, false).map((a) => a.target)).toEqual([
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
    expect(getContextActions(w, false).map((a) => a.target)).toEqual(buggies.map((b) => ({ kind: 'downed', id: b.id })));
  });

  it('lists no stock action while the truck is busy', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    beginSearch(w, w.vehicles[0], 'wreck901');
    expect(getContextActions(w, false)).toEqual([]);
  });
});

describe('shared wreck', () => {
  it('dims the search while another driver searches the wreck, and names the driver', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.salvage.push({ id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 3 }, parts: [], hidden: emptyHidden() });
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine'], { x: 31.5, y: 30 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    expect(getContextActions(w, false)[0]).toMatchObject({ label: 'Search the wreck', ready: true, combat: undefined });
    beginSearch(w, npc, 'wreck901');
    expect(getContextActions(w, false)[0]).toMatchObject({ label: 'Search the wreck', ready: false, hint: `${npc.name} is looting it` });
  });
});

describe('search in combat', () => {
  function siteScene() {
    const site = REGION.locations.find((site) => site.id === 'podfield')!;
    const w = emptyWorld({ ...sitePads(site)[0] });
    w.salvage = [{ id: site.id, pos: { ...site.pos }, radius: site.radius, goods: { scrap: 1 }, parts: [], hidden: emptyHidden() }];
    const me = playerVehicle(w).pos;
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: me.x + 6, y: me.y });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    return { w, site, raider };
  }

  it('does not block a search beside a hostile that has not attacked', () => {
    const { w, site } = siteScene();
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Search ${site.name}`, combat: undefined });
  });

  it('blocks a search in combat and says how many turns are left', () => {
    const { w, site, raider } = siteScene();
    startCombat(w, raider, playerVehicle(w));
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Search ${site.name}`, ready: false, combat: STATE_TURNS.combat });
  });
});

describe("critical vehicle readout", () => {
  it("keeps money, survival resources and driver condition visible", () => {
    const w = emptyWorld();
    w.player.money = 123450;
    w.player.fuel = 18.5;
    w.player.supplies = 7.25;
    expect(getHudReadout(w).resources.map((r) => r.label)).toEqual([
      "Money",
      "Fuel",
      "Supplies",
      "Driver",
    ]);
    expect(
      getHudReadout(w)
        .resources.slice(0, 3)
        .map((r) => r.value),
    ).toEqual(["1,235 M", "93 / 200 L", "7.3"]);
  });
  it("shows fractional driver health as a whole number", () => {
    const w = emptyWorld();
    w.player.health = 41.123456789;
    const [, , , driver] = getHudReadout(w).resources.map((r) => r.value);
    expect(driver).toBe(`42 / ${RULES.maxHealth}`);
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
    const driver = getHudReadout(w).resources.find((r) => r.label === "Driver")!;
    expect(driver).toEqual({ label: "Driver", value: `${RULES.maxHealth} / ${maxHealthOf(w)}`, warning: true });
  });

  it("keeps parked jobs out of the survival instruments", () => {
    const w = emptyWorld();
    w.vehicles[0].job = {
      kind: "search",
      stockId: "stock",
      turnsLeft: 2,
      total: 4,
    };
    expect(getHudReadout(w).survival.map((r) => r.label)).toEqual([
      "Heat",
      "Engine",
      "Weather",
    ]);
  });
  it("shows the game clock once, outside the survival instruments", () => {
    const w = emptyWorld();
    w.turn = 5;
    const before = getHudReadout(w);
    expect(before.clock).toBe(clockLabel(w.turn));
    expect(before.survival.some((r) => r.label === "Time")).toBe(false);
    w.turn = 5 + 100000;
    const later = getHudReadout(w);
    expect(later.clock).toBe(clockLabel(w.turn));
    expect(later.clock).not.toBe(before.clock);
  });
  it("keeps reverse speed and manual driving explicit", () => {
    const w = emptyWorld();
    w.vehicles[0].speed = -2;
    w.vehicles[0].direct = true;
    expect(getHudReadout(w)).toMatchObject({ speed: "-29", manual: true });
  });
});

describe("rescue readout", () => {
  it("shows negative money as debt with a warning", () => {
    const w = emptyWorld();
    w.player.money = -120050;
    expect(getHudReadout(w).resources[0]).toMatchObject({
      value: "Debt 1,201 M",
      warning: true,
    });
  });
  it("tells a stranded player to install a spare engine it carries", () => {
    const w = newWorld(1337, startKit("combat"), TEST_MAP, defaultSetup('roaming'));
    const me = playerVehicle(w);
    const engine = me.items.find((it) => it.kind === "part" && partDef(it.part.defId).kind === "engine");
    if (!engine || engine.kind !== "part") throw new Error("Expected an engine");
    me.items = me.items.filter((it) => it.kind === "part" && partDef(it.part.defId).kind === "core");
    expect(getRescueReadout(w)).toMatchObject({ kind: "stranded", reason: "No working engine." });
    expect(stowPart(w, me, engine.part)).toBe(true);
    expect(getRescueReadout(w)).toMatchObject({ kind: "stranded", reason: "No working engine. Install the spare [I]." });
  });
  it("follows the player from stranded to tow, and leaves an open offer to the radio", () => {
    const w = emptyWorld();
    expect(getRescueReadout(w)).toBeNull();
    w.player.fuel = 0;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: false, reason: "Out of fuel." });
    w.player.beacon = true;
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel." });
    w.player.money = 10;
    const tow = addState(w, "tow", w.vehicles[0].id, w.player.vehicleId, { kind: "tow", site: "bowl", fee: 50, waived: 0, hitched: false });
    expect(getRescueReadout(w)).toEqual({ kind: "stranded", beacon: true, reason: "Out of fuel." });
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
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Trade with ${npcName(npc)}`, ready: true });
  });

  it('offers the town while the trader still drives', () => {
    const { w, town } = atTownWithTrader(RULES.parkedSpeed + 1);
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Enter ${town.name}`, ready: true });
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
    expect(getContextActions(moving.w, false)[0]).toMatchObject({ label: `Give ${aidGoods(playerAid(moving.w)!)} to ${npcName(moving.npc)}`, ready: false, target: { kind: 'aid', id: moving.npc.id } });
    const near = aidScene(34, 'player');
    expect(getContextActions(near.w, false)[0]).toMatchObject({ label: expect.stringContaining('Give'), ready: true, target: { kind: 'aid', id: near.npc.id } });
  });

  it('shows no aid action while the agreed driver is out of reach, even beside another driver', () => {
    const { w, npc } = aidScene(60, 'player');
    addVehicle(w, 'traders', 'scout', [], { x: 34, y: 30 });
    const actions = getContextActions(w, false);
    expect(actions.filter((a) => a.target.kind === 'aid')).toEqual([]);
    expect(actions.some((a) => a.label.includes(npcName(npc)))).toBe(false);
  });

  it('shows one aid action naming the agreed driver when another is also in reach', () => {
    const { w, npc } = aidScene(34, 'player');
    addVehicle(w, 'traders', 'scout', [], { x: 26, y: 30 });
    const aids = getContextActions(w, false).filter((a) => a.target.kind === 'aid');
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
    expect(getContextActions(w, false)[0]).toMatchObject({ label: `Take ${aidGoods(playerAid(w)!)} from ${npcName(npc)}`, ready: true });
  });
});

describe('several trades', () => {
  it('lists only the trade whose driver is in reach, with that driver as target', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const far = addVehicle(w, 'traders', 'scout', [], { x: 90, y: 30 });
    const near = addVehicle(w, 'traders', 'scout', [], { x: 34, y: 30 });
    addState(w, 'trade', far.id, w.player.vehicleId, { kind: 'none' });
    addState(w, 'trade', near.id, w.player.vehicleId, { kind: 'none' });
    const trades = getContextActions(w, false).filter((a) => a.target.kind === 'trade');
    expect(trades).toEqual([{ label: `Trade with ${npcName(near)}`, ready: true, target: { kind: 'trade', id: near.id } }]);
  });
});

const shop: ContextAction = { label: 'Enter', ready: true, target: { kind: 'shop' } };
const pile: ContextAction = { label: 'Loot the pile', ready: true, target: { kind: 'loot', id: 'p1' } };
const wreck: ContextAction = { label: 'Search the wreck', ready: true, target: { kind: 'stock', id: 'w1' } };

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
  function wornTo(hp: number) {
    const w = emptyWorld();
    const engine = mountedParts(playerVehicle(w), 'engine')[0];
    engine.wear = 2;
    engine.hp = hp;
    return w;
  }

  it('is blocked at 15% engine HP and says why, with the share from the rule', () => {
    const w = wornTo(6);
    w.player.overdrive = true;
    const s = overdriveSwitch(w);
    expect(s).toMatchObject({ checked: false, blocked: true });
    expect(s.title).toBe(`Engine too worn for overdrive: repair it above ${RULES.overdriveMinEngineShare * 100}% [O]`);
  });

  it('is open one HP above 15% and shows the flag', () => {
    const w = wornTo(7);
    expect(overdriveSwitch(w)).toEqual({ checked: false, blocked: false, title: 'Engine overdrive: faster, but the engine heats fast [O]' });
    w.player.overdrive = true;
    expect(overdriveSwitch(w).checked).toBe(true);
  });
});
