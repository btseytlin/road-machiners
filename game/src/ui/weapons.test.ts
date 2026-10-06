import { afterEach, describe, expect, it, vi } from "vitest";
import { hitOdds } from "../sim/combat";
import { playerVehicle } from "../sim/damage";
import { mountedParts } from "../sim/grid";
import type { Vehicle } from "../sim/types";
import { addState } from "../sim/states";
import { vehicleStats } from "../sim/stats";
import { addVehicle, emptyWorld, npcBrain } from "../sim/testkit";
import { refreshVision } from "../sim/vision";
import type { UiHost } from "./host";
import { HoverHold, WeaponPanel, aimAtPart, aimMarks, aimsAt, InspectPin, gunsLabel, aimName, ammoCells, canForceReload, getWeaponReadout, toggleTarget, vehicleMarks } from "./weapons";

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
    });
  });
});

describe("aiming the body", () => {
  it("aims at the clicked vehicle, and a second click clears the order", () => {
    const { world, target, gun } = createDuel();
    world.vehicles[0].weaponOrders = {};
    const aimed = toggleTarget(world, [gun], target);
    expect(aimed.vehicles[0].weaponOrders[gun.part.id]).toEqual({ targetId: target.id, aim: "body" });
    expect(toggleTarget(aimed, [gun], target).vehicles[0].weaponOrders).toEqual({});
  });

  it("moves an order from another vehicle instead of clearing it", () => {
    const { world, gun } = createDuel();
    const other = addVehicle(world, "raiders", "buggy", ["mg", "stockEngine"], { x: 30, y: 33 });
    refreshVision(world);
    const moved = toggleTarget(world, [gun], other);
    expect(moved.vehicles[0].weaponOrders[gun.part.id].targetId).toBe(other.id);
  });
});

describe("aim query", () => {
  it("tells whether the chosen guns aim at a target, and names them", () => {
    const { world, target, gun } = createDuel();
    world.vehicles[0].weaponOrders = {};
    expect(aimsAt(world, [gun], target.id)).toBe(false);
    expect(aimsAt(world, [], target.id)).toBe(false);
    const aimed = toggleTarget(world, [gun], target);
    expect(aimsAt(aimed, [gun], target.id)).toBe(true);
    expect(gunsLabel(world, null)).toBe("all guns");
    expect(gunsLabel(world, gun.part.id)).toBe("gun 1");
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
    addState(world, "patch", target.id, me.id, { kind: "patch", deal: "free", parts: 1, price: 0, work: 4, workLeft: 3 });
    expect(vehicleMarks(world, null).get(target.id)?.job).toEqual({ label: `Patch ${me.name}`, progress: 0.25 });
  });

  it("shows the patch a seen NPC gets with its patcher", () => {
    const { world, me, target } = createDuel();
    target.brain = npcBrain("scavenger", target.pos, ["scavenger"]);
    target.pos = { x: me.pos.x + 1, y: me.pos.y };
    target.speed = 0;
    me.speed = 0;
    addState(world, "patch", me.id, target.id, { kind: "patch", deal: "free", parts: 1, price: 0, work: 4, workLeft: 1 });
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

  it("returns to a body shot when the guns already aim at the part", () => {
    const { world, target, gun } = createDuel();
    const wheel = wheelOf(target);
    const again = aimAtPart(aimAtPart(world, [gun], target, wheel.id), [gun], target, wheel.id);
    expect(playerVehicle(again).weaponOrders[gun.part.id]).toEqual({ targetId: target.id, aim: "body" });
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
  style: Record<string, string> = {};
  children: (FakeNode | string)[] = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly tag: string) {}
  append(...c: (FakeNode | string)[]) { this.children.push(...c); }
  replaceChildren(...c: (FakeNode | string)[]) { this.children = c; }
  setAttribute() {}
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

  function build(auto = false) {
    ui.children = [];
    win.listeners.clear();
    vi.stubGlobal("document", { createElement: (t: string) => new FakeNode(t), getElementById: () => ui });
    vi.stubGlobal("window", win);
    const { world, gun } = createDuel();
    const host = {
      world: () => world,
      apply: vi.fn(),
      selectedWeapon: vi.fn<() => string | null>(() => null),
      selectWeapon: vi.fn(),
      pressTurn: vi.fn(),
      releaseTurn: vi.fn(),
      runKey: vi.fn(),
      autoTravel: () => auto,
      getTurnPhase: () => null,
    } satisfies UiHost;
    const panel = new WeaponPanel(host);
    panel.render();
    const panels = (ui.children as FakeNode[]).map((n) => n);
    return { panel, host, gun, button: (text: string) => panels.map((n) => n.find((b) => b.tag === "button" && (text === "Auto" ? b.text() === text : b.text().includes(text)))).find(Boolean)! };
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
    for (const [text, code] of [["Hide [X]", "KeyX"], ["All [0]", "Digit0"]] as const) {
      button(text).fire("click");
      expect(host.runKey).toHaveBeenLastCalledWith(code);
    }
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
  return { calls, pin: new InspectPin(() => calls.n++) };
}

describe("InspectPin", () => {
  it("pins, switches and unpins on click", () => {
    const { pin, calls } = make();
    pin.click("a");
    expect(pin.id).toBe("a");
    pin.click("b");
    expect(pin.id).toBe("b");
    pin.click("b");
    expect(pin.id).toBeNull();
    expect(calls.n).toBe(3);
  });

  it("clears, and tells only about real changes", () => {
    const { pin, calls } = make();
    pin.clear();
    pin.keepIf(true);
    expect(calls.n).toBe(0);
    pin.click("a");
    pin.keepIf(true);
    expect(pin.id).toBe("a");
    pin.keepIf(false);
    expect(pin.id).toBeNull();
    expect(calls.n).toBe(2);
  });

  it("rejects an empty id", () => {
    expect(() => make().pin.click("")).toThrow();
  });
});
