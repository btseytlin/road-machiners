import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { fireBlock, gunOf, hitOdds, type FireBlock } from "../sim/combat";
import { gaveUp, isKnockedOut } from "../sim/defeat";
import { findPart, playerVehicle } from "../sim/damage";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Aim, PartInstance, UtilityOrder, Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { workOf } from "../sim/states";
import { playerCanAct, reloadWeapon, setAutoFire, setUtilityOrder, setWeaponOrder } from "../sim/world";
import { chargeOf, chargedParts, orderKindOf, utilityBlock, utilityOrderError, wornReload } from "../sim/utility";
import { oilShort } from "../sim/hazards";
import { el, panel } from "./dom";
import { meters } from "./units";
import type { UiHost } from "./host";
import { createIcon } from './cards';
import { createSwitch } from "./switch";
import { canCall } from "./dialogue";
import { workLabel, workProgress } from "./format";

export const BLOCK_TEXT: Record<FireBlock, string> = {
  disabled: "disabled",
  cooldown: "cooling down",
  empty: "reloading",
  range: "out of range",
  arc: "out of arc",
  blocked: "view blocked on truck",
  noTarget: "hold fire",
  unseen: "not in sight",
  covered: "behind cover",
  talking: "on the radio",
  out: "driver knocked out",
  unmounted: "not mounted",
  shutDown: "shut down",
  lineOut: "line out",
};

// One weapon aimed at a vehicle, as its marker shows it.
export type WeaponMark = { slot: number; look: "mg" | "cannon"; status: string; ready: boolean };
// Timed work a seen NPC does, with its progress from 0 to 1.
export type JobMark = { label: string; progress: number };
export type VehicleMark = { weapons: WeaponMark[]; radio: boolean; job: JobMark | null; out: boolean; gaveUp: boolean };

// Markers above vehicles, by vehicle id: each player weapon aimed at the vehicle with its status, the
// radio key on the hovered truck when it can take a call, the job of each seen NPC, and each seen knocked-out NPC.
export function vehicleMarks(w: World, hovered: string | null): Map<string, VehicleMark> {
  const marks = new Map<string, VehicleMark>();
  const markOf = (id: string) => {
    const found = marks.get(id);
    if (found) return found;
    const made: VehicleMark = { weapons: [], radio: false, job: null, out: false, gaveUp: false };
    marks.set(id, made);
    return made;
  };
  vehicleStats(w, playerVehicle(w)).weapons.forEach((mw, i) => {
    const readout = getWeaponReadout(w, mw);
    if (readout.target)
      markOf(readout.target.id).weapons.push({ slot: i + 1, look: mw.def.look, status: readout.status, ready: readout.canFire });
  });
  if (hovered && canCall(w, hovered)) markOf(hovered).radio = true;
  for (const v of w.vehicles.filter((x) => x.brain && playerSees(w, x.pos))) {
    const job = seenNpcJob(w, v);
    if (job) markOf(v.id).job = job;
    if (isKnockedOut(v)) {
      markOf(v.id).out = true;
      markOf(v.id).gaveUp = gaveUp(v);
    }
  }
  return marks;
}

function seenNpcJob(w: World, v: Vehicle): JobMark | null {
  const work = workOf(w, v);
  return work && { label: workLabel(w, v, work), progress: workProgress(work) };
}

// A click on a vehicle aims the weapons at it. When all of them already aim at it, the click clears them.
export function toggleTarget(w: World, weapons: MountedWeapon[], target: Vehicle): World {
  const orders = playerVehicle(w).weaponOrders;
  const aimed = weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === target.id);
  if (w.player.autoFire) w = setAutoFire(w, false);
  for (const mw of weapons)
    w = setWeaponOrder(w, mw.part.id, aimed ? null : { targetId: target.id, aim: "body" });
  return w;
}

// Aims the chosen guns at one part of a target. When they all aim at that part already, they go back to a body shot.
export function aimAtPart(w: World, weapons: MountedWeapon[], target: Vehicle, partId: string): World {
  const orders = playerVehicle(w).weaponOrders;
  const aimed = weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === target.id && orders[mw.part.id].aim === partId);
  if (w.player.autoFire) w = setAutoFire(w, false);
  for (const mw of weapons)
    w = setWeaponOrder(w, mw.part.id, { targetId: target.id, aim: aimed ? "body" : partId });
  return w;
}

// Gun numbers, as the panel counts them, that aim at each part of a target. A body shot marks no part.
export function aimMarks(w: World, targetId: string): Map<string, number[]> {
  const marks = new Map<string, number[]>();
  const orders = playerVehicle(w).weaponOrders;
  vehicleStats(w, playerVehicle(w)).weapons.forEach((mw, i) => {
    const order = orders[mw.part.id];
    if (!order || order.targetId !== targetId || order.aim === "body") return;
    marks.set(order.aim, [...(marks.get(order.aim) ?? []), i + 1]);
  });
  return marks;
}

// The aimed spot in words: "body shot" or the part's name.
export function aimName(target: Vehicle, aim: Aim): string {
  const part = aim === "body" ? null : findPart(target, aim);
  return part ? partDef(part.defId).name : "body shot";
}

function turns(n: number): string {
  return `${n} ${n === 1 ? "turn" : "turns"}`;
}

// Why a gun cannot fire, with the turns left for a cooldown or a reload.
export function blockText(mw: MountedWeapon, block: FireBlock): string {
  const gun = gunOf(mw.part);
  if (block === "cooldown") return `ready in ${turns(gun.cooldown)}`;
  if (block === "empty") return `reloading ${turns(mw.def.reload - gun.reloadWork)}`;
  return BLOCK_TEXT[block];
}

// Rounds left in the magazine, like "3/5".
export function ammoText(mw: MountedWeapon): string {
  return `${gunOf(mw.part).ammo}/${mw.def.magazine}`;
}

export type AmmoCell = "loaded" | "spent" | "reloading";

// One cell per magazine round: loaded rounds first, then spent ones. A gun at work on a reload
// fills its spent cells left to right with the share reloadWork / reload of the whole row.
export function ammoCells(magazine: number, ammo: number, reloadWork: number, reload: number): AmmoCell[] {
  const spent = magazine - ammo;
  const filled = reloadWork > 0 ? Math.min(spent, Math.ceil((reloadWork / reload) * magazine)) : 0;
  return Array.from({ length: magazine }, (_, i) =>
    i < ammo ? "loaded" : i < ammo + filled ? "reloading" : "spent");
}

// Ammo status for the tooltip and screen readers.
export function ammoLabel(mw: MountedWeapon): string {
  const gun = gunOf(mw.part);
  if (gun.reloadWork > 0) return `reloading, ${turns(mw.def.reload - gun.reloadWork)} left`;
  return `${gun.ammo}/${mw.def.magazine} rounds`;
}

// A forced reload helps only a gun with a partly spent magazine.
export function canForceReload(mw: MountedWeapon): boolean {
  const ammo = gunOf(mw.part).ammo;
  return mw.part.hp > 0 && ammo > 0 && ammo < mw.def.magazine;
}

// Current-position feedback shared by the weapon buttons and map markers.
export function getWeaponReadout(w: World, mw: MountedWeapon) {
  const me = playerVehicle(w);
  const order = me.weaponOrders[mw.part.id];
  const assigned = order
    ? (w.vehicles.find((v) => v.id === order.targetId) ?? null)
    : null;
  const target = assigned && playerSees(w, assigned.pos) ? assigned : null;
  const block = fireBlock(w, me, mw, assigned);
  const status = block ? blockText(mw, block) : "ready";
  return {
    target,
    status,
    chance:
      block === null && target && order
        ? hitOdds(w, me, mw, target, order.aim).damageChance
        : null,
    canFire: block === null,
  };
}

export const UTILITY_SLOTS = 4;
// The number keys 1 to 9 run the slots in panel order: the guns first, then the utility row. A slot past 9 has no key.
export const SLOT_KEYS = 9;

// The number key of utility slot i, the next after the truck's guns, or null past SLOT_KEYS.
export function utilityKey(w: World, i: number): number | null {
  const key = vehicleStats(w, playerVehicle(w)).weapons.length + i + 1;
  return key <= SLOT_KEYS ? key : null;
}

// What a selected slot asks for, and what a slot with an order that acts this turn reads.
const PICK_TEXT: Record<"point", string> = { point: "aim: click the ground" };
const FIRES_TEXT = "fires this turn";

// A utility slot's look: an order set, a claymore armed, waiting for its target click, recharging, blocked or ready.
// Only the selected slot can be aiming. reload: the turns left of the recharge, out of the part's whole reload.
export type UtilityState = "ready" | "aiming" | "set" | "armed" | "recharging" | "blocked";
export type UtilityStatus = { state: UtilityState; text: string; reload?: { left: number; total: number } };

// The parts in the utility row, in slot order: active utilities and claymore rams, working or not.
export function utilitySlots(w: World): PartInstance[] {
  return chargedParts(playerVehicle(w)).slice(0, UTILITY_SLOTS);
}

// The slot's state and text. Throws for a passive utility, which has no slot.
export function utilityStatus(w: World, part: PartInstance, selected: boolean): UtilityStatus {
  const kind = orderKindOf(part);
  if (kind === null) throw new Error(`${partDef(part.defId).name} is passive and has no slot`);
  const order = playerVehicle(w).utilityOrders[part.id];
  if (order) return { state: "set", text: FIRES_TEXT };
  if (chargeOf(part).armed) return { state: "armed", text: "armed" };
  return aimingStatus(w, part, kind, selected) ?? idleStatus(w, part);
}

// The selected point utility waits for its target click while it can aim, or null.
function aimingStatus(w: World, part: PartInstance, kind: UtilityOrder["kind"], selected: boolean): UtilityStatus | null {
  if (!selected || kind === "self" || aimBlock(w, part) !== null) return null;
  return { state: "aiming", text: PICK_TEXT[kind] };
}

// A slot with no order, armed charge or aim: recharging with its turns, blocked with the reason, or ready.
function idleStatus(w: World, part: PartInstance): UtilityStatus {
  const block = utilityBlock(w, playerVehicle(w), part);
  if (block === "cooldown") return { state: "recharging", text: utilityBlockText(part, block), reload: { left: chargeOf(part).reload, total: wornReload(part) } };
  if (block) return { state: "blocked", text: utilityBlockText(part, block) };
  return noFuel(w, part) ? { state: "blocked", text: "no fuel" } : { state: "ready", text: "ready" };
}

// Whether the part spills oil the tank holds too little fuel for.
function noFuel(w: World, part: PartInstance): boolean {
  const def = partDef(part.defId);
  return def.kind === "utility" && def.effect.type === "oil" && oilShort(w, playerVehicle(w), def.effect.fuel);
}

// Why the part cannot be selected to aim, or null when it can.
export function aimBlock(w: World, part: PartInstance): FireBlock | null {
  return utilityBlock(w, playerVehicle(w), part);
}

export function utilityBlockText(part: PartInstance, block: FireBlock): string {
  if (block === "cooldown") return `recharging ${turns(chargeOf(part).reload)}`;
  return block === "disabled" ? "broken" : BLOCK_TEXT[block];
}

// The utility row of the weapon panel. A slot press, by key or click, toggles a self use for this turn, or selects a
// point utility so the next click on the ground gives its order. A press on a slot with an order
// clears it.
// The badge each slot state shows in its corner, drawn by the slot CSS. States without one show none.
const BADGE: Partial<Record<UtilityState, string>> = { aiming: "crosshair", set: "check", armed: "fuse" };

// A bar along the slot's bottom that fills as the recharge counts down.
function rechargeBar(reload: { left: number; total: number }): HTMLElement {
  const share = Math.max(0, (reload.total - reload.left) / reload.total);
  return el("span", { class: "recharge-bar", "aria-hidden": "true" }, el("span", { style: `width:${Math.round(share * 100)}%` }));
}

export class UtilityRow {
  constructor(private host: UiHost) {}

  render(w: World): HTMLElement | null {
    const parts = utilitySlots(w);
    if (parts.length === 0) return null;
    return el("div", { class: "weapon-slots utility-slots" }, ...parts.map((part, i) => this.renderSlot(w, part, i)));
  }

  private renderSlot(w: World, part: PartInstance, i: number): HTMLElement {
    const selected = this.host.selectedUtility() === part.id;
    const status = utilityStatus(w, part, selected);
    const name = partDef(part.defId).name;
    const key = utilityKey(w, i);
    return el(
      "div",
      { class: "weapon-slot utility-slot", "data-utility": part.id, "data-state": status.state },
      el(
        "button",
        {
          class: `weapon-pick ${selected ? "on" : ""}`,
          "aria-pressed": String(selected),
          "aria-label": `${name}: ${status.text}`,
          title: key === null ? name : `${name} [${key}]`,
          onclick: () => (key === null ? this.selectUtility(i) : this.host.runKey(`Digit${key}`)),
        },
        el("span", { class: "weapon-number" }, key === null ? "" : `${key}`),
        el("span", { class: "weapon-name" }, name),
        createIcon("utility"),
        BADGE[status.state] ? el("span", { class: "slot-badge", "data-badge": BADGE[status.state], "aria-hidden": "true" }) : null,
        el("span", { "data-status": "" }, status.text),
        status.reload ? rechargeBar(status.reload) : null,
      ),
    );
  }

  // The press on slot i. Nothing happens while a turn plays or on an empty slot.
  selectUtility(i: number): void {
    if (this.host.getTurnPhase() !== null) return;
    const w = this.host.world();
    const part = utilitySlots(w)[i];
    if (!part) return;
    if (playerVehicle(w).utilityOrders[part.id]) return this.clearOrder(w, part);
    if (orderKindOf(part) === "self") return this.useSelf(w, part);
    this.togglePick(w, part);
  }

  // Selects a point utility to wait for its target click, or drops the selection on a repeat press. A part
  // that cannot aim (aimBlock) is not selected. The slot already shows why.
  private togglePick(w: World, part: PartInstance): void {
    const repeat = this.host.selectedUtility() === part.id;
    this.host.selectUtility(repeat || aimBlock(w, part) ? null : part.id);
  }

  private clearOrder(w: World, part: PartInstance): void {
    if (this.host.selectedUtility() === part.id) this.host.selectUtility(null);
    this.host.apply(setUtilityOrder(w, part.id, null));
  }

  // A refused use changes nothing. The slot already shows why.
  private useSelf(w: World, part: PartInstance): void {
    if (utilityOrderError(w, playerVehicle(w), part.id, { kind: "self" }) === null)
      this.host.apply(setUtilityOrder(w, part.id, { kind: "self" }));
  }
}

export class WeaponPanel {
  private root = panel("weapons");
  private turn = panel('turn-control');
  private expanded = true;
  readonly utilities: UtilityRow;

  constructor(private host: UiHost) {
    this.utilities = new UtilityRow(host);
  }

  render(): void {
    const w = this.host.world();
    const phase = this.host.getTurnPhase();
    const locked = phase !== null || !playerCanAct(w);
    const head = el(
      "div",
      { class: "weapon-head" },
      el("h3", {}, "Weapons"),
      this.expanded ? this.renderAllButton(locked) : null,
      el("button", { class: "weapon-toggle", "aria-expanded": String(this.expanded), onclick: () => this.host.runKey("KeyX"), title: "Show or hide weapons [X]" }, this.expanded ? "Hide [X]" : "Show [X]"),
    );
    this.root.replaceChildren(head, ...(this.expanded ? [this.renderControls(w, locked)] : []));
    this.turn.replaceChildren(this.renderTurnButton(phase));
  }

  // While turns run on their own, the button shows it and stops them.
  private renderTurnButton(phase: ReturnType<UiHost["getTurnPhase"]>): HTMLElement {
    if (this.host.autoTravel())
      return el('button', {
        class: 'end-turn auto', title: 'Automatic travel. Space or click to stop.',
        'aria-label': 'Stop automatic travel', onpointerdown: (e: Event) => this.pressTurn(e as PointerEvent),
      }, createIcon('turn'), el('span', {}, 'Auto'));
    return el('button', {
      class: 'end-turn', disabled: phase !== null, title: 'End turn [Space]. Hold to fast-forward.',
      'aria-label': phase ? `${phase} in progress` : 'End turn', onpointerdown: (e: Event) => this.pressTurn(e as PointerEvent),
    }, createIcon('turn'), el('span', {}, phase ? `${phase}…` : 'Space'));
  }

  // Presses like Space keydown now and releases like Space keyup when this press ends, even if the button is redrawn.
  private pressTurn(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.host.pressTurn();
    const release = (): void => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      this.host.releaseTurn();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  private renderAllButton(locked: boolean): HTMLElement {
    const all = this.host.selectedWeapon() === null;
    return el(
      "button",
      {
        class: all ? "on" : "",
        "aria-pressed": String(all),
        disabled: locked,
        title: "Aim all weapons with the next click [0]",
        onclick: () => this.host.runKey("Digit0"),
      },
      "All [0]",
    );
  }

  private renderControls(w: World, locked: boolean): HTMLElement {
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    return el(
      "fieldset",
      { disabled: locked },
      createSwitch({
        on: "Auto fire",
        off: "Auto fire off",
        checked: w.player.autoFire,
        key: "Q",
        title: "Auto fire: guns shoot at hostiles on their own [Q]",
        onclick: () => this.host.runKey("KeyQ"),
      }),
      el(
        "div",
        { class: "weapon-slots" },
        ...weapons.map((mw, i) => this.renderSlot(w, mw, i, locked)),
      ),
      weapons.length === 0 ? el("div", { class: "dim" }, "No weapons installed") : null,
      this.utilities.render(w),
    );
  }

  private renderSlot(w: World, mw: MountedWeapon, i: number, locked: boolean): HTMLElement {
    const readout = getWeaponReadout(w, mw);
    const selected = this.host.selectedWeapon() === mw.part.id;
    const chance =
      readout.chance === null ? "" : ` · ${Math.round(readout.chance * 100)}%`;
    const target =
      readout.target?.name ??
      (playerVehicle(w).weaponOrders[mw.part.id]
        ? "target unavailable"
        : "no target");
    return el(
      "div",
      { class: "weapon-slot", "data-weapon": mw.part.id },
      el(
        "button",
        {
          class: `weapon-pick ${selected ? "on" : ""}`,
          "aria-pressed": String(selected),
          'aria-label': `${mw.def.name}: ${readout.status}, ${target}`,
          title: `${mw.def.name}: ${mw.def.rounds} × ${Number((mw.def.round.damage * RULES.weaponDamage).toFixed(1))} damage, pen ${mw.def.round.pen}, range ${meters(mw.def.range)} m, arc ${mw.def.arc}°, fires every ${mw.def.cooldown} turn(s), ${mw.def.magazine} shots, reloads in ${mw.def.reload} turn(s)`,
          onclick: () => this.selectWeapon(selected ? null : mw.part.id),
        },
        el('span', { class: 'weapon-number' }, `${i + 1}`),
        el("span", { class: "weapon-name" }, mw.def.name),
        createIcon(mw.def.look === 'cannon' ? 'cannon' : 'mg'),
        el(
          "span",
          { class: readout.canFire ? "good" : "dim", "data-status": "" },
          readout.status + chance,
        ),
        el("span", { class: "weapon-target" }, target),
      ),
      this.renderAmmo(mw, locked),
    );
  }

  // Rounds left and the button that forces a reload.
  private renderAmmo(mw: MountedWeapon, locked: boolean): HTMLElement {
    const gun = gunOf(mw.part);
    const label = ammoLabel(mw);
    return el(
      "div",
      { class: "weapon-ammo-row" },
      el(
        "span",
        { class: "weapon-ammo", title: label },
        el("span", { class: "sr-only" }, label),
        ...ammoCells(mw.def.magazine, gun.ammo, gun.reloadWork, mw.def.reload).map((state) =>
          el("span", { class: `ammo-cell ${state}`, "aria-hidden": "true" })),
      ),
      el(
        "button",
        {
          class: "weapon-hold",
          title: "Hold fire: stop auto fire and clear this gun's target",
          onclick: () => this.holdWeapon(mw.part.id),
        },
        "Hold",
      ),
      el(
        "button",
        {
          class: "weapon-reload",
          disabled: locked || !canForceReload(mw),
          title: `Reload: drop the magazine and refill it in ${turns(mw.def.reload)}`,
          "aria-label": `Reload ${mw.def.name}`,
          onclick: () => this.forceReload(mw.part.id),
        },
        createIcon("reload"),
      ),
    );
  }

  private forceReload(weaponId: string): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.apply(reloadWeapon(this.host.world(), weaponId));
  }

  private holdWeapon(weaponId: string): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.apply(
      setWeaponOrder(setAutoFire(this.host.world(), false), weaponId, null),
    );
  }

  selectWeapon(id: string | null): void {
    if (this.host.getTurnPhase() !== null) return;
    this.host.selectWeapon(id);
  }

  // Number key n: the gun at that place, or past the guns the utility slot after them.
  pressKey(n: number): void {
    const w = this.host.world();
    const guns = vehicleStats(w, playerVehicle(w)).weapons.length;
    if (n <= guns) this.selectIndex(n - 1);
    else this.utilities.selectUtility(n - guns - 1);
  }

  // A digit key picks the weapon at that index, and picks all again when it is already selected.
  selectIndex(i: number): void {
    const w = this.host.world();
    const all = vehicleStats(w, playerVehicle(w)).weapons;
    if (i < 0 || i >= all.length) return;
    const id = all[i].part.id;
    this.selectWeapon(this.host.selectedWeapon() === id ? null : id);
  }

  toggleVisible(): void {
    this.expanded = !this.expanded;
    this.render();
  }

  toggleAuto(): void {
    if (this.host.getTurnPhase() !== null) return;
    const w = this.host.world();
    this.host.apply(setAutoFire(w, !w.player.autoFire));
  }
}

export function weaponsForClick(
  world: World,
  selected: string | null,
): MountedWeapon[] {
  const all = vehicleStats(world, playerVehicle(world)).weapons;
  return selected ? all.filter((m) => m.part.id === selected) : all;
}

// Keeps a hover alive for a short delay after the pointer leaves the hovered truck, and while the pointer is over the
// panel that truck opened, so the pointer can travel from a truck to its panel.
export class HoverHold {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private apply: (id: string | null) => void, private delayMs: number) {}

  // Passes a new hover on at once. The pointer leaving a hovered truck passes on after the delay, unless the pointer
  // arrives on the panel or hovers again first.
  move(next: string | null, current: string | null): void {
    if (next !== null || current === null) return this.now(next);
    this.timer ??= setTimeout(() => this.now(null), this.delayMs);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private now(id: string | null): void {
    this.cancel();
    this.apply(id);
  }

  // The panel holds the hover while the pointer is on it and ends it when the pointer leaves.
  watch(panel: EventTarget): void {
    panel.addEventListener("mouseenter", () => this.cancel());
    panel.addEventListener("mouseleave", () => this.now(null));
  }
}
