import { afterEach, describe, expect, it, vi } from "vitest";
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
import { UtilityAim } from "../three/utility-aim";
import { HoverHold, UtilityRow, WeaponPanel, aimAtPart, aimMarks, aimName, ammoCells, canForceReload, getWeaponReadout, toggleTarget, utilitySlots, utilityStatus, vehicleMarks } from "./weapons";

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

describe("targeting by click", () => {
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
  attrs: Record<string, string> = {};
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
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

describe("the harpoon's standing order", () => {
  it("aims while recharging, since its order waits for the charge", () => {
    const { w, harpoon } = harpoonDuel();
    harpoon.charge = { reload: 2 };
    expect(utilityStatus(w, harpoon, true)).toEqual({ state: "aiming", text: "aim: click a truck" });
  });

  it("shows its waiting reason on the slot, or that it fires this turn", () => {
    const near = harpoonDuel(5);
    const far = harpoonDuel(9);
    for (const s of [near, far]) s.me.utilityOrders[s.harpoon.id] = { kind: "truck", targetId: s.target.id, aim: "body" };
    expect(utilityStatus(near.w, near.harpoon, false)).toEqual({ state: "set", text: "fires this turn" });
    expect(utilityStatus(far.w, far.harpoon, true)).toEqual({ state: "set", text: "out of range" });
    near.harpoon.charge = { reload: 2 };
    expect(utilityStatus(near.w, near.harpoon, false)).toEqual({ state: "set", text: "recharging 2 turns" });
  });

  it("marks its target with the harpoon's key, look and waiting reason", () => {
    const far = harpoonDuel(9);
    far.me.utilityOrders[far.harpoon.id] = { kind: "truck", targetId: far.target.id, aim: "body" };
    const key = utilitySlots(far.w).indexOf(far.harpoon) + 5;
    expect(vehicleMarks(far.w, null).get(far.target.id)?.weapons).toEqual([{ slot: key, look: "harpoon", status: "out of range", ready: false }]);
    far.target.pos = { x: far.me.pos.x + 5, y: far.me.pos.y };
    expect(vehicleMarks(far.w, null).get(far.target.id)?.weapons).toEqual([{ slot: key, look: "harpoon", status: "ready", ready: true }]);
  });

  function aimAt(s: ReturnType<typeof harpoonDuel>) {
    const world = { w: s.w };
    const note = vi.fn();
    const aim = new UtilityAim({ world: () => world.w, apply: (next) => { world.w = next; }, note });
    aim.select(s.harpoon.id);
    return { world, note, aim };
  }

  it("a truck click out of range sets a waiting order, not a refusal, and keeps the harpoon aimed", () => {
    const s = harpoonDuel(9);
    const { world, note, aim } = aimAt(s);
    expect(aim.click(s.target, null)).toBe(true);
    expect(note).not.toHaveBeenCalled();
    expect(world.w.vehicles[0].utilityOrders[s.harpoon.id]).toEqual({ kind: "truck", targetId: s.target.id, aim: "body" });
    expect(aim.selectedId).toBe(s.harpoon.id);
  });

  it("a second click on the target clears the order", () => {
    const s = harpoonDuel();
    const { world, aim } = aimAt(s);
    aim.click(s.target, null);
    aim.click(world.w.vehicles.find((v) => v.id === s.target.id) ?? null, null);
    expect(world.w.vehicles[0].utilityOrders).toEqual({});
  });

  it("a click on a truck it cannot take notes the reason and sets nothing", () => {
    const s = harpoonDuel(80);
    const { world, note, aim } = aimAt(s);
    aim.click(s.target, null);
    expect(note).toHaveBeenCalledWith(expect.stringMatching(/unseen/));
    expect(world.w.vehicles[0].utilityOrders).toEqual({});
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
    const badge = (slot: FakeNode) => slot.find((n) => n.className === "slot-badge")?.attrs["data-badge"] ?? null;
    const bar = (slot: FakeNode) => {
      const fill = slot.find((n) => n.className === "recharge-bar")?.children[0];
      return fill instanceof FakeNode ? fill.attrs.style : null;
    };
    return { slots, badge, bar, sprout, mortar };
  }

  it("gives each slot one data-state, its badge, and at most one aiming slot", () => {
    const { slots, badge } = renderRow((w, p) => { w.vehicles[0].utilityOrders[p.sprout] = { kind: "self" }; });
    expect(slots.map((s) => s.attrs["data-state"])).toEqual(["set", "aiming"]);
    expect(slots.map(badge)).toEqual(["check", "crosshair"]);
    expect(slots.filter((s) => s.attrs["data-state"] === "aiming")).toHaveLength(1);
  });

  it("fills the recharge bar as the reload counts down", () => {
    const { slots, bar, sprout } = renderRow((w, p) => {
      const part = mountedParts(w.vehicles[0]).find((x) => x.id === p.sprout);
      if (!part) throw new Error("No Sprout");
      part.charge = { reload: 1 };
    });
    const total = wornReload(sprout);
    expect(slots[0].attrs["data-state"]).toBe("recharging");
    expect(bar(slots[0])).toBe(`width:${Math.round(((total - 1) / total) * 100)}%`);
    expect(bar(slots[1])).toBeNull();
  });

  it("shows a broken utility blocked, with no badge", () => {
    const { slots, badge } = renderRow((w, p) => {
      const part = mountedParts(w.vehicles[0]).find((x) => x.id === p.sprout);
      if (!part) throw new Error("No Sprout");
      part.hp = 0;
    });
    expect(slots.map((s) => s.attrs["data-state"])).toEqual(["blocked", "aiming"]);
    expect(badge(slots[0])).toBeNull();
  });
});
