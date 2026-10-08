import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hitOdds } from "../sim/combat";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import type { Vehicle, World } from "../sim/types";
import { addState } from "../sim/states";
import { vehicleStats } from "../sim/stats";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import { refreshVision } from "../sim/vision";
import type { UiHost } from "./host";
import { makePart } from "../sim/factory";
import { mountPart } from "../sim/inventory";
import { wornReload } from "../sim/utility";
import { HoverHold, UtilityRow, WeaponPanel, aimAtPart, aimMarks, aimsBody, bodyMarks, InspectPin, aimLine, type AimState, gunsLabel, aimName, ammoCells, canForceReload, getWeaponReadout, toggleBodyAim, vehicleMarks, shortStatus, weaponGrid, BLOCK_SHORT, utilityKey, utilitySlots, utilityStatus } from "./weapons";

function createDuel() {
  const world = emptyWorld();
  const me = world.vehicles[0];
  const target = addVehicle(world, "raiders", "buggy", ["mg", "stockEngine"], {
    x: 33,
    y: 30,
  });
  refreshVision(world);
  const gun = vehicleStats(world, me).weapons[0];
  me.weaponOrders[gun.part.id] = { targetId: target.id, aim: "body" };
  return { world, me, target, gun };
}

describe("weapon readout at current positions", () => {
  it("shows the simulation hit chance for a ready weapon", () => {
    const { world, me, target, gun } = createDuel();
    expect(getWeaponReadout(world, gun)).toEqual({
      target,
      status: "ready",
      chance: hitOdds(world, me, gun, target, "body").damageChance,
      canFire: true,
      block: null,
    });
  });

  it("labels hold fire without a hit chance", () => {
    const { world, me, gun } = createDuel();
    me.weaponOrders = {};
    expect(getWeaponReadout(world, gun)).toEqual({
      target: null,
      status: "hold fire",
      chance: null,
      canFire: false,
      block: "noTarget",
    });
  });

  it("shows remaining cooldown turns without implying a shot can fire", () => {
    const { world, gun } = createDuel();
    gun.part.gun = { cooldown: 2, ammo: 1, reloadWork: 0 };
    expect(getWeaponReadout(world, gun)).toMatchObject({
      status: "ready in 2 turns",
      chance: null,
      canFire: false,
    });
  });

  it("shows remaining reload turns for an empty gun", () => {
    const { world, gun } = createDuel();
    gun.part.gun = { cooldown: 0, ammo: 0, reloadWork: 1 };
    expect(getWeaponReadout(world, gun)).toMatchObject({
      status: `reloading ${gun.def.reload - 1} ${gun.def.reload - 1 === 1 ? "turn" : "turns"}`,
      chance: null,
      canFire: false,
    });
  });

  it("hides the hit chance for an out-of-range order but keeps the target", () => {
    const { world, target, gun } = createDuel();
    target.pos.x = 30 + gun.def.range + 1;
    refreshVision(world);
    expect(getWeaponReadout(world, gun)).toEqual({
      target,
      status: "out of range",
      chance: null,
      canFire: false,
      block: "range",
    });
  });

  it("uses the forward arc restriction", () => {
    const { world, target, gun } = createDuel();
    const forward = { ...gun, def: { ...gun.def, arc: 60 } };
    target.pos = { x: 30, y: 33 };
    refreshVision(world);
    expect(getWeaponReadout(world, forward)).toMatchObject({
      status: "out of arc",
      chance: null,
      canFire: false,
    });
  });

  it("does not expose a hidden target through a stale order", () => {
    const { world, target, gun } = createDuel();
    world.obstacles = [
      { id: "rock", kind: "rock", pos: { x: 31.5, y: 30 }, r: 0.8 },
    ];
    refreshVision(world);
    expect(getWeaponReadout(world, gun)).toEqual({
      target: null,
      status: "not in sight",
      chance: null,
      canFire: false,
      block: "unseen",
    });
    expect(world.vehicles).toContain(target);
  });

  it("offers a forced reload only for a partly spent magazine", () => {
    const { gun } = createDuel();
    expect(canForceReload(gun)).toBe(false);
    gun.part.gun = { cooldown: 0, ammo: 1, reloadWork: 0 };
    expect(canForceReload(gun)).toBe(true);
    gun.part.gun = { cooldown: 0, ammo: 0, reloadWork: 0 };
    expect(canForceReload(gun)).toBe(false);
  });

  it("keeps disabled status ahead of reload", () => {
    const { world, gun } = createDuel();
    gun.part.hp = 0;
    gun.part.gun = { cooldown: 2, ammo: 1, reloadWork: 0 };
    expect(getWeaponReadout(world, gun)).toMatchObject({
      status: "disabled",
      chance: null,
      canFire: false,
    });
  });

  it("handles a removed target as hold fire", () => {
    const { world, target, gun } = createDuel();
    world.vehicles = world.vehicles.filter((v) => v !== target);
    expect(getWeaponReadout(world, gun)).toEqual({
      target: null,
      status: "hold fire",
      chance: null,
      canFire: false,
      block: "noTarget",
    });
  });
});

describe("aiming the body", () => {
  it("aims at the clicked vehicle, and a second click clears the order", () => {
    const { world, target, gun } = createDuel();
    world.vehicles[0].weaponOrders = {};
    const aimed = toggleBodyAim(world, [gun], target);
    expect(aimed.vehicles[0].weaponOrders[gun.part.id]).toEqual({ targetId: target.id, aim: "body" });
    expect(toggleBodyAim(aimed, [gun], target).vehicles[0].weaponOrders).toEqual({});
  });

  it("moves an order from another vehicle instead of clearing it", () => {
    const { world, gun } = createDuel();
    const other = addVehicle(world, "raiders", "buggy", ["mg", "stockEngine"], { x: 30, y: 33 });
    refreshVision(world);
    const moved = toggleBodyAim(world, [gun], other);
    expect(moved.vehicles[0].weaponOrders[gun.part.id].targetId).toBe(other.id);
  });
});

describe("aim query", () => {
  it("tells whether the chosen guns have a body shot at a target, and names them", () => {
    const { world, target, gun } = createDuel();
    world.vehicles[0].weaponOrders = {};
    expect(aimsBody(world, [gun], target.id)).toBe(false);
    expect(aimsBody(world, [], target.id)).toBe(false);
    const aimed = toggleBodyAim(world, [gun], target);
    expect(aimsBody(aimed, [gun], target.id)).toBe(true);
    expect(bodyMarks(aimed, target.id)).toEqual([1]);
    expect(gunsLabel(world, null)).toBe("all guns");
    expect(gunsLabel(world, gun.part.id)).toBe("gun 1");
  });

  it("moves a part aim to the body, and a second toggle clears it", () => {
    const { world, target, gun } = createDuel();
    world.vehicles[0].weaponOrders = {};
    const wheel = mountedParts(target).find((p) => p.defId === "wheel")!;
    const onPart = aimAtPart(world, [gun], target, wheel.id);
    expect(bodyMarks(onPart, target.id)).toEqual([]);
    const body = toggleBodyAim(onPart, [gun], target);
    expect(playerVehicle(body).weaponOrders[gun.part.id]).toEqual({ targetId: target.id, aim: "body" });
    expect(toggleBodyAim(body, [gun], target).vehicles[0].weaponOrders).toEqual({});
  });
});

describe("vehicle marks", () => {
  it("shows each aimed weapon on its target with slot, look and status", () => {
    const { world, target, gun } = createDuel();
    expect(vehicleMarks(world, null).get(target.id)).toEqual({
      weapons: [{ slot: 1, look: gun.def.look, status: "ready", ready: true }],
      radio: false,
      job: null,
      out: false,
      gaveUp: false,
    });
  });

  it("leaves no player mark without a weapon aimed at it", () => {
    const { world } = createDuel();
    expect(vehicleMarks(world, null).has(world.player.vehicleId)).toBe(false);
  });

  it("shows nothing for a vehicle without orders", () => {
    const { world, target } = createDuel();
    world.vehicles[0].weaponOrders = {};
    expect(vehicleMarks(world, null).has(target.id)).toBe(false);
  });

  it("shows the job of a seen NPC with its progress", () => {
    const { world, target } = createDuel();
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.job = { kind: "search", stockId: "wreck-1", turnsLeft: 3, total: 4 };
    expect(vehicleMarks(world, null).get(target.id)?.job).toEqual({ label: "Search", progress: 0.25 });
  });

  it("shows the patch a seen NPC does with its progress", () => {
    const { world, me, target } = createDuel();
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.pos = { x: me.pos.x + 1, y: me.pos.y };
    target.speed = 0;
    me.speed = 0;
    addState(world, "patch", target.id, me.id, { kind: "patch", deal: "free", parts: 1, partIds: [], price: 0, work: 4, workLeft: 3 });
    expect(vehicleMarks(world, null).get(target.id)?.job).toEqual({ label: `Patch ${me.name}`, progress: 0.25 });
  });

  it("shows the patch a seen NPC gets with its patcher", () => {
    const { world, me, target } = createDuel();
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.pos = { x: me.pos.x + 1, y: me.pos.y };
    target.speed = 0;
    me.speed = 0;
    addState(world, "patch", me.id, target.id, { kind: "patch", deal: "free", parts: 1, partIds: [], price: 0, work: 4, workLeft: 1 });
    expect(vehicleMarks(world, null).get(target.id)?.job).toEqual({ label: `Patched by ${me.name}`, progress: 0.75 });
  });

  it("marks a seen knocked-out NPC and offers no radio key on it", () => {
    const { world, target } = createDuel();
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.defeat = { phase: "out", turns: 0, unseen: 0, foes: [], gaveUp: true };
    expect(vehicleMarks(world, target.id).get(target.id)).toMatchObject({ out: true, gaveUp: true, radio: false });
    target.defeat.gaveUp = false;
    expect(vehicleMarks(world, target.id).get(target.id)).toMatchObject({ out: true, gaveUp: false });
    target.defeat.phase = "retreat";
    expect(vehicleMarks(world, target.id).get(target.id)).toMatchObject({ out: false, radio: true });
  });

  it("hides the job of an NPC out of sight", () => {
    const { world, target } = createDuel();
    world.vehicles[0].weaponOrders = {};
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.job = { kind: "search", stockId: "wreck-1", turnsLeft: 3, total: 4 };
    target.pos = { x: 58, y: 58 };
    expect(vehicleMarks(world, null).has(target.id)).toBe(false);
  });
});

describe("ammo cells", () => {
  it("shows a full magazine as all loaded", () => {
    expect(ammoCells(3, 3, 0, 4)).toEqual(["loaded", "loaded", "loaded"]);
  });

  it("shows spent rounds after the loaded ones", () => {
    expect(ammoCells(5, 2, 0, 4)).toEqual(["loaded", "loaded", "spent", "spent", "spent"]);
  });

  it("fills spent cells left to right with the reload share", () => {
    expect(ammoCells(4, 0, 2, 4)).toEqual(["reloading", "reloading", "spent", "spent"]);
  });

  it("keeps loaded cells while a partly spent gun reloads", () => {
    expect(ammoCells(4, 1, 1, 2)).toEqual(["loaded", "reloading", "reloading", "spent"]);
  });

  it("never fills more cells than are spent", () => {
    expect(ammoCells(4, 3, 3, 4)).toEqual(["loaded", "loaded", "loaded", "reloading"]);
  });
});

describe("aiming at parts", () => {
  function wheelOf(target: Vehicle) {
    const wheel = mountedParts(target).find((p) => p.defId === "wheel");
    if (!wheel) throw new Error("Target has no wheel");
    return wheel;
  }

  it("aims the given guns at a part and marks it with the gun number", () => {
    const { world, target, gun } = createDuel();
    const wheel = wheelOf(target);
    const next = aimAtPart(world, [gun], target, wheel.id);
    expect(playerVehicle(next).weaponOrders[gun.part.id]).toEqual({ targetId: target.id, aim: wheel.id });
    expect(aimMarks(next, target.id).get(wheel.id)).toEqual([1]);
  });

  it("stops the guns when they already aim at the part", () => {
    const { world, target, gun } = createDuel();
    const wheel = wheelOf(target);
    const again = aimAtPart(aimAtPart(world, [gun], target, wheel.id), [gun], target, wheel.id);
    expect(playerVehicle(again).weaponOrders[gun.part.id]).toBeUndefined();
    expect(aimMarks(again, target.id).size).toBe(0);
  });

  it("names the aimed part or a body shot", () => {
    const { target } = createDuel();
    expect(aimName(target, "body")).toBe("body shot");
    expect(aimName(target, wheelOf(target).id)).toBe("Wheel");
  });

  it("rejects a part the target does not have", () => {
    const { world, target, gun } = createDuel();
    expect(() => aimAtPart(world, [gun], target, "nope")).toThrow();
  });
});

describe("hover hold", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const seen: (string | null)[] = [];
    const hold = new HoverHold((id) => seen.push(id), 400);
    return { seen, hold };
  }

  it("passes a hover on a truck at once", () => {
    const { seen, hold } = setup();
    hold.move("v2", "v1");
    expect(seen).toEqual(["v2"]);
  });

  it("ends the hover after the delay when the pointer leaves the truck", () => {
    const { seen, hold } = setup();
    hold.move(null, "v1");
    vi.advanceTimersByTime(399);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([null]);
  });

  it("keeps the hover while the pointer is on the panel and ends it when the pointer leaves", () => {
    const { seen, hold } = setup();
    const panel = new EventTarget();
    hold.watch(panel);
    hold.move(null, "v1");
    panel.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([]);
    panel.dispatchEvent(new Event("mouseleave"));
    expect(seen).toEqual([null]);
  });

  it("does nothing when nothing was hovered", () => {
    const { seen, hold } = setup();
    hold.move(null, null);
    expect(seen).toEqual([null]);
  });
});

class FakeNode {
  className = "";
  props = new Map<string, string>();
  style = { setProperty: (k: string, v: string) => { this.props.set(k, v); } };
  children: (FakeNode | string)[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  attrs = new Map<string, string>();
  constructor(readonly tag: string) {}
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = c; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  querySelector(sel: string): FakeNode | undefined {
    const byWeapon = sel.match(/^\[data-weapon="(.*)"\]$/);
    if (byWeapon) return this.find((n) => n.attrs.get("data-weapon") === byWeapon[1]);
    if (sel === ".weapon-slots") return this.find((n) => n.className === "weapon-slots");
    const cls = sel.replace(":scope > .", "");
    return this.children.find((c): c is FakeNode => typeof c !== "string" && c.className.split(" ").includes(cls));
  }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  text(): string { return this.children.map((c) => (typeof c === "string" ? c : c.text())).join(""); }
  find(pred: (n: FakeNode) => boolean): FakeNode | undefined {
    if (pred(this)) return this;
    for (const c of this.children) if (typeof c !== "string") { const f = c.find(pred); if (f) return f; }
    return undefined;
  }
  fire(type: string, e: unknown = {}) { for (const f of this.listeners.get(type) ?? []) f(e); }
}

describe("weapon panel keys and the turn button", () => {
  const ui = new FakeNode("div");
  const win = new FakeNode("window");

  afterEach(() => vi.unstubAllGlobals());

  function build(auto = false, setup: (w: World) => void = () => {}) {
    ui.children = [];
    win.listeners.clear();
    vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t), createElementNS: (_ns: string, t: string) => new FakeNode(t), getElementById: () => ui });
    vi.stubGlobal("window", win);
    const { world, gun } = createDuel();
    setup(world);
    const host = {
      world: () => world,
      apply: vi.fn(),
      announce: vi.fn(),
      selectedWeapon: vi.fn<() => string | null>(() => null),
      selectWeapon: vi.fn(),
      selectedUtility: vi.fn<() => string | null>(() => null),
      selectUtility: vi.fn(),
      pressTurn: vi.fn(),
      releaseTurn: vi.fn(),
      runKey: vi.fn(),
      autoTravel: () => auto,
      getTurnPhase: () => null,
    } satisfies UiHost;
    const panel = new WeaponPanel(host);
    panel.render();
    const panels = (ui.children as FakeNode[]).map((n) => n);
    return { panel, host, gun, row: () => ui.children.map((n) => (n as FakeNode).querySelector(".weapon-slots")).find(Boolean)!, card: (id: string) => ui.children.map((n) => (n as FakeNode).querySelector(`[data-weapon="${id}"]`)).find(Boolean)!, button: (text: string) => panels.map((n) => n.find((b) => b.tag === "button" && (text === "Auto" ? b.text() === text : b.text().includes(text)))).find(Boolean)! };
  }

  it("selectIndex picks a weapon, picks all again on repeat, and ignores a missing index", () => {
    const { panel, host, gun } = build();
    panel.selectIndex(0);
    expect(host.selectWeapon).toHaveBeenLastCalledWith(gun.part.id);
    host.selectedWeapon.mockReturnValue(gun.part.id);
    panel.selectIndex(0);
    expect(host.selectWeapon).toHaveBeenLastCalledWith(null);
    host.selectWeapon.mockClear();
    panel.selectIndex(9);
    expect(host.selectWeapon).not.toHaveBeenCalled();
  });

  it("the Q, X and All buttons run their keys", () => {
    const { host, button } = build();
    for (const [text, code] of [["Auto fire [Q]", "KeyQ"], ["Hide [X]", "KeyX"], ["All [0]", "Digit0"]] as const) {
      button(text).fire("click");
      expect(host.runKey).toHaveBeenLastCalledWith(code);
    }
  });

  it("draws a compact element with the inventory icon, no filler text and no old glyphs", () => {
    const { card, row } = build();
    const slot = card(createDuel().gun.part.id);
    const text = (ui.children as FakeNode[]).map((n) => n.text()).join(" ");
    for (const prose of ["hold fire", "no target", "MG turret"]) expect(text).not.toContain(prose);
    expect(slot.find((n) => n.className.split(" ").includes("item-icon"))).toBeDefined();
    expect(slot.find((n) => /icon-(mg|cannon)/.test(n.className))).toBeUndefined();
    expect((row() as FakeNode).props.get("--weapon-cols")).toBe("1");
    expect(row().className).toBe("weapon-slots");
  });

  it("Auto fire shows its state and Hold is disabled with nothing to hold", () => {
    const off = build(false, (w) => { playerVehicle(w).weaponOrders = {}; });
    expect(off.button("Auto fire").attrs.get("aria-pressed")).toBe("false");
    expect(off.button("Hold").attrs.has("disabled")).toBe(true);
    const on = build(false, (w) => { w.player.autoFire = true; });
    expect(on.button("Auto fire").attrs.get("aria-pressed")).toBe("true");
    expect(on.button("Auto fire").className).toBe("on");
    expect(on.button("Hold").attrs.has("disabled")).toBe(false);
  });

  it("Hold is enabled with an order and clears it with auto fire off", () => {
    const { host, button } = build();
    expect(button("Hold").attrs.has("disabled")).toBe(false);
    button("Hold").fire("click");
    const applied = host.apply.mock.calls[0][0] as World;
    expect(applied.player.autoFire).toBe(false);
    expect(Object.keys(playerVehicle(applied).weaponOrders)).toHaveLength(0);
  });

  it("the turn button presses on pointerdown and releases on pointerup of that press", () => {
    const { host, button } = build();
    button("Space").fire("pointerdown", { button: 2 });
    expect(host.pressTurn).not.toHaveBeenCalled();
    button("Space").fire("pointerdown", { button: 0 });
    expect(host.pressTurn).toHaveBeenCalledTimes(1);
    expect(host.releaseTurn).not.toHaveBeenCalled();
    win.fire("pointerup");
    expect(host.releaseTurn).toHaveBeenCalledTimes(1);
    win.fire("pointerup");
    expect(host.releaseTurn).toHaveBeenCalledTimes(1);
  });

  it("the Auto look presses the same way", () => {
    const { host, button } = build(true);
    button("Auto").fire("pointerdown", { button: 0 });
    expect(host.pressTurn).toHaveBeenCalledTimes(1);
    win.fire("pointercancel");
    expect(host.releaseTurn).toHaveBeenCalledTimes(1);
  });
});

function make() {
  const calls = { n: 0 };
  const sight = { seen: true };
  const pass = (pin: InspectPin, id: string, inWorld = true) => {
    pin.note({ id } as Vehicle, inWorld);
    pin.settle();
  };
  return { calls, sight, pass, pin: new InspectPin(() => calls.n++, () => sight.seen) };
}

describe("InspectPin", () => {
  it("pins and switches, and a second click keeps the pin", () => {
    const { pin, calls } = make();
    pin.click("a");
    expect(pin.id).toBe("a");
    pin.click("b");
    expect(pin.id).toBe("b");
    pin.click("b");
    expect(pin.id).toBe("b");
    expect(calls.n).toBe(2);
  });

  it("clears, and tells only about real changes", () => {
    const { pin, calls, pass } = make();
    pin.clear();
    pass(pin, "a");
    expect(calls.n).toBe(0);
    pin.click("a");
    pass(pin, "a");
    expect(pin.id).toBe("a");
    pin.clear();
    expect(pin.id).toBeNull();
    expect(calls.n).toBe(2);
  });

  it("drops the pin when its truck is out of sight, gone from the world or not in the pass", () => {
    const { pin, sight, pass } = make();
    pin.click("a");
    sight.seen = false;
    pass(pin, "a");
    expect(pin.id).toBeNull();
    sight.seen = true;
    pin.click("a");
    pass(pin, "a", false);
    expect(pin.id).toBeNull();
    pin.click("a");
    pass(pin, "b");
    expect(pin.id).toBeNull();
  });

  it("rejects an empty id", () => {
    expect(() => make().pin.click("")).toThrow();
  });
});

describe("aim line", () => {
  beforeEach(() => vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t) }));
  afterEach(() => vi.unstubAllGlobals());

  const line = (state: Partial<AimState>, onBody = vi.fn()) =>
    aimLine({ guns: "all guns", body: [], bodyAimed: false, locked: false, hasGuns: true, ...state }, onBody) as unknown as FakeNode;
  const chip = (n: FakeNode) => n.find((c) => c.tag === "button")!;

  it("holds only the Body chip, with no instruction text", () => {
    expect(line({}).text()).toBe("Body");
    expect(chip(line({ guns: "gun 2" })).attrs.get("title")).toContain("gun 2");
  });

  it("shows the numbers of the guns with a body shot", () => {
    expect(line({ body: [1, 2] }).text()).toBe("Body1 2");
  });

  it("presses the chip while aimed, disables it while locked and calls back on click", () => {
    const onBody = vi.fn();
    expect(chip(line({ bodyAimed: true })).attrs.get("aria-pressed")).toBe("true");
    expect(chip(line({ locked: true })).attrs.get("disabled")).toBe("");
    chip(line({}, onBody)).fire("click");
    expect(onBody).toHaveBeenCalledOnce();
  });

  it("is missing without guns", () => {
    expect(aimLine({ guns: "all guns", body: [], bodyAimed: false, locked: false, hasGuns: false }, vi.fn())).toBeNull();
  });
});

describe("the utility row", () => {
  // The player's truck with a Sprout and a Smoke mortar on deck, and a host that applies commands to its world.
  function build() {
    const world = { w: emptyWorld() };
    const me = world.w.vehicles[0];
    const sprout = makePart(world.w, "sprout", 0);
    const mortar = makePart(world.w, "smokeMortar", 0);
    for (const part of [sprout, mortar]) if (!mountPart(world.w, me, part)) throw new Error(`No room for ${part.defId}`);
    const host = {
      world: () => world.w,
      apply: vi.fn((next: World) => { world.w = next; }),
      selectedWeapon: () => null,
      selectWeapon: vi.fn(),
      announce: vi.fn((next: World) => { world.w = next; }),
      selectedUtility: vi.fn<() => string | null>(() => null),
      selectUtility: vi.fn(),
      pressTurn: vi.fn(),
      releaseTurn: vi.fn(),
      runKey: vi.fn(),
      autoTravel: () => false,
      getTurnPhase: vi.fn<() => "Moving" | null>(() => null),
    } satisfies UiHost;
    return { world, host, row: new UtilityRow(host), sprout, mortar };
  }

  it("lists the active utilities in mount order, not the passive ones", () => {
    const { world, sprout, mortar } = build();
    const crane = makePart(world.w, "patcherCrane", 0);
    mountPart(world.w, world.w.vehicles[0], crane);
    expect(utilitySlots(world.w).map((p) => p.id)).toEqual([sprout.id, mortar.id]);
  });

  it("a self utility's press sets its use for this turn, and a second press clears it", () => {
    const { world, row, sprout } = build();
    row.selectUtility(0);
    expect(world.w.vehicles[0].utilityOrders).toEqual({ [sprout.id]: { kind: "self" } });
    expect(utilityStatus(world.w, sprout, false)).toEqual({ state: "set", text: "fires this turn" });
    row.selectUtility(0);
    expect(world.w.vehicles[0].utilityOrders).toEqual({});
  });

  it("a point utility's press selects it and a second press drops the selection", () => {
    const { host, row, mortar } = build();
    row.selectUtility(1);
    expect(host.selectUtility).toHaveBeenLastCalledWith(mortar.id);
    host.selectedUtility.mockReturnValue(mortar.id);
    row.selectUtility(1);
    expect(host.selectUtility).toHaveBeenLastCalledWith(null);
  });

  it("a recharging utility shows its turns left out of its reload and its press does nothing", () => {
    const { world, host, row, sprout, mortar } = build();
    sprout.charge = { reload: 3 };
    mortar.charge = { reload: 1 };
    row.selectUtility(0);
    row.selectUtility(1);
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.selectUtility).toHaveBeenLastCalledWith(null);
    expect(utilityStatus(world.w, sprout, false)).toEqual({ state: "recharging", text: "recharging 3 turns", reload: { left: 3, total: wornReload(sprout) } });
    expect(utilityStatus(world.w, mortar, true)).toEqual({ state: "recharging", text: "recharging 1 turn", reload: { left: 1, total: wornReload(mortar) } });
  });

  it("shows a broken utility, a ready one, a selected point utility, a set point and an armed claymore", () => {
    const { world, sprout, mortar } = build();
    sprout.hp = 0;
    expect(utilityStatus(world.w, sprout, false)).toEqual({ state: "blocked", text: "broken" });
    expect(utilityStatus(world.w, mortar, false)).toEqual({ state: "ready", text: "ready" });
    expect(utilityStatus(world.w, mortar, true)).toEqual({ state: "aiming", text: "aim: click the ground" });
    world.w.vehicles[0].utilityOrders[mortar.id] = { kind: "point", pos: { x: 40, y: 30 } };
    expect(utilityStatus(world.w, mortar, true)).toEqual({ state: "set", text: "fires this turn" });
    const claymore = makePart(world.w, "claymoreRam", 0);
    claymore.charge = { reload: 0, armed: true };
    expect(utilityStatus(world.w, claymore, false)).toEqual({ state: "armed", text: "armed" });
  });

  it("blocks an oil spiller with too little fuel to spill", () => {
    const { world } = build();
    const spiller = makePart(world.w, "oilSpiller", 0);
    mountPart(world.w, world.w.vehicles[0], spiller);
    world.w.player.fuel = 0;
    expect(utilityStatus(world.w, spiller, false)).toEqual({ state: "blocked", text: "no fuel" });
  });

  it("throws for a passive utility, which has no slot", () => {
    const { world } = build();
    const crane = makePart(world.w, "patcherCrane", 0);
    expect(() => utilityStatus(world.w, crane, false)).toThrow(/passive/);
  });

  it("ignores presses while a turn plays and on an empty slot", () => {
    const { host, row } = build();
    row.selectUtility(3);
    host.getTurnPhase.mockReturnValue("Moving");
    row.selectUtility(0);
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.selectUtility).not.toHaveBeenCalled();
  });
});

// The player facing east with a harpoon on its deck and a trader hauler `gap` tiles east of it, in sight.
function harpoonDuel(gap = 5) {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const harpoon = makePart(w, "harpoon", 0);
  if (!mountPart(w, me, harpoon)) throw new Error("No deck room for the harpoon");
  const target = addVehicle(w, "traders", "hauler", ["stockEngine"], { x: me.pos.x + gap, y: me.pos.y }, Math.PI / 2);
  refreshVision(w);
  return { w, me, harpoon, target };
}

describe("slot keys", () => {
  it("gives the utility slots the numbers after the last gun, so a gun and a utility never share a key", () => {
    const keysWith = (parts: string[]) => {
      const w = emptyWorld();
      const me = w.vehicles[0];
      for (const defId of parts) if (!mountPart(w, me, makePart(w, defId, 0))) throw new Error(`No room for ${defId}`);
      return { guns: vehicleStats(w, me).weapons.length, keys: utilitySlots(w).map((_, i) => utilityKey(w, i)) };
    };
    const plain = keysWith(["sprout"]);
    const hooked = keysWith(["harpoon", "sprout"]);

    expect(plain.keys).toEqual([plain.guns + 1]);
    expect(hooked.guns).toBe(plain.guns + 1);
    expect(hooked.keys).toEqual([hooked.guns + 1]);
  });

  it("leaves a utility slot past key 9 without a key", () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    if (!mountPart(w, me, makePart(w, "sprout", 0))) throw new Error("No room for the sprout");
    const guns = vehicleStats(w, me).weapons.length;
    expect(utilityKey(w, 9 - guns - 1)).toBe(9);
    expect(utilityKey(w, 9 - guns)).toBeNull();
  });
});

describe("the harpoon on the weapon panel", () => {
  const harpoonGun = (s: ReturnType<typeof harpoonDuel>) => {
    const mw = vehicleStats(s.w, s.me).weapons.find((m) => m.part.id === s.harpoon.id);
    if (!mw) throw new Error("The harpoon is not a mounted gun");
    return mw;
  };

  it("is a gun slot and not a utility slot", () => {
    const s = harpoonDuel();
    expect(harpoonGun(s).def.name).toBe("Harpoon");
    expect(utilitySlots(s.w)).not.toContain(s.harpoon);
  });

  it("reads ready only with its round loaded, and reloading with the turns left after a shot", () => {
    const s = harpoonDuel();
    s.me.weaponOrders[s.harpoon.id] = { targetId: s.target.id, aim: "body" };
    expect(getWeaponReadout(s.w, harpoonGun(s))).toMatchObject({ status: "ready", canFire: true });
    s.harpoon.gun = { cooldown: 0, ammo: 0, reloadWork: 1 };
    expect(getWeaponReadout(s.w, harpoonGun(s))).toMatchObject({ status: "reloading 4 turns", canFire: false, chance: null });
  });

  it("marks its target like a gun, with why it waits", () => {
    const far = harpoonDuel(9);
    far.me.weaponOrders[far.harpoon.id] = { targetId: far.target.id, aim: "body" };
    const slot = vehicleStats(far.w, far.me).weapons.findIndex((m) => m.part.id === far.harpoon.id) + 1;
    expect(vehicleMarks(far.w, null).get(far.target.id)?.weapons).toEqual([{ slot, look: "cannon", status: "out of range", ready: false }]);
  });
});

describe("a utility slot's look", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Renders the row of a truck with a Sprout and a Smoke mortar, with the mortar selected.
  function renderRow(edit: (w: World, parts: { sprout: string; mortar: string }) => void) {
    vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t) });
    const w = emptyWorld();
    const me = w.vehicles[0];
    const sprout = makePart(w, "sprout", 0);
    const mortar = makePart(w, "smokeMortar", 0);
    for (const part of [sprout, mortar]) if (!mountPart(w, me, part)) throw new Error(`No room for ${part.defId}`);
    edit(w, { sprout: sprout.id, mortar: mortar.id });
    const host = { selectedUtility: () => mortar.id } as unknown as UiHost;
    const row = new UtilityRow(host).render(w) as unknown as FakeNode;
    const slots = row.children as FakeNode[];
    const badge = (slot: FakeNode) => slot.find((n) => n.className === "slot-badge")?.attrs.get("data-badge") ?? null;
    const bar = (slot: FakeNode) => {
      const fill = slot.find((n) => n.className === "recharge-bar")?.children[0];
      return fill instanceof FakeNode ? fill.attrs.get("style") : null;
    };
    return { slots, badge, bar, sprout, mortar };
  }

  it("gives each slot one data-state, its badge, and at most one aiming slot", () => {
    const { slots, badge } = renderRow((w, p) => { w.vehicles[0].utilityOrders[p.sprout] = { kind: "self" }; });
    expect(slots.map((s) => s.attrs.get("data-state"))).toEqual(["set", "aiming"]);
    expect(slots.map(badge)).toEqual(["check", "crosshair"]);
    expect(slots.filter((s) => s.attrs.get("data-state") === "aiming")).toHaveLength(1);
  });

  it("fills the recharge bar as the reload counts down", () => {
    const { slots, bar, sprout } = renderRow((w, p) => {
      const part = mountedParts(w.vehicles[0]).find((x) => x.id === p.sprout);
      if (!part) throw new Error("No Sprout");
      part.charge = { reload: 1 };
    });
    const total = wornReload(sprout);
    expect(slots[0].attrs.get("data-state")).toBe("recharging");
    expect(bar(slots[0])).toBe(`width:${Math.round(((total - 1) / total) * 100)}%`);
    expect(bar(slots[1])).toBeNull();
  });

  it("shows a broken utility blocked, with no badge", () => {
    const { slots, badge } = renderRow((w, p) => {
      const part = mountedParts(w.vehicles[0]).find((x) => x.id === p.sprout);
      if (!part) throw new Error("No Sprout");
      part.hp = 0;
    });
    expect(slots.map((s) => s.attrs.get("data-state"))).toEqual(["blocked", "aiming"]);
    expect(badge(slots[0])).toBeNull();
  });
});

describe("compact gun grid", () => {
  it("keeps up to five guns in one row and balances two rows above that", () => {
    expect(weaponGrid(0)).toEqual({ cols: 0, small: false });
    expect(weaponGrid(1)).toEqual({ cols: 1, small: false });
    expect(weaponGrid(5)).toEqual({ cols: 5, small: false });
    expect(weaponGrid(6)).toEqual({ cols: 3, small: true });
    expect(weaponGrid(7)).toEqual({ cols: 4, small: true });
    expect(weaponGrid(10)).toEqual({ cols: 5, small: true });
    expect(weaponGrid(11)).toEqual({ cols: 6, small: true });
  });

  it("gives a short state: nothing without an order, a chance, or a short reason", () => {
    const { world, me, gun } = createDuel();
    expect(shortStatus(gun, getWeaponReadout(world, gun))).toMatch(/^\d+%$/);
    gun.part.gun = { cooldown: 2, ammo: 1, reloadWork: 0 };
    expect(shortStatus(gun, getWeaponReadout(world, gun))).toBe("wait 2");
    gun.part.gun = { cooldown: 0, ammo: 0, reloadWork: 1 };
    expect(shortStatus(gun, getWeaponReadout(world, gun))).toBe(`load ${gun.def.reload - 1}`);
    gun.part.gun = { cooldown: 0, ammo: 1, reloadWork: 0 };
    gun.part.hp = 0;
    expect(shortStatus(gun, getWeaponReadout(world, gun))).toBe("broken");
    gun.part.hp = 10;
    me.weaponOrders = {};
    expect(shortStatus(gun, getWeaponReadout(world, gun))).toBe("");
    for (const word of Object.values(BLOCK_SHORT)) expect(word.length).toBeLessThanOrEqual(7);
  });
});
