import { partDef } from "../data/parts";
import { fireBlock, gunOf, hitOdds, roundDamage, type FireBlock } from "../sim/combat";
import { gaveUp, isKnockedOut } from "../sim/defeat";
import { findPart, playerVehicle, vehicleById } from "../sim/damage";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Aim, PartInstance, UtilityOrder, Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { workOf } from "../sim/states";
import { playerCanAct, reloadWeapon, setAutoFire, setUtilityOrder, setWeaponOrder } from "../sim/world";
import { chargeOf, chargedParts, orderKindOf, utilityBlock, utilityOrderError, wornReload } from "../sim/utility";
import { oilShort } from "../sim/hazards";
import { bottomLeft, el, panel } from "./dom";
import { meters } from "./units";
import type { UiHost } from "./host";
import { createIcon, createItemIcon } from './cards';
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

export const BLOCK_SHORT: Record<FireBlock, string> = {
  disabled: "broken",
  cooldown: "wait",
  empty: "load",
  range: "range",
  arc: "arc",
  blocked: "blocked",
  noTarget: "",
  unseen: "unseen",
  covered: "cover",
  talking: "radio",
  out: "out",
  unmounted: "stowed",
  shutDown: "off",
  lineOut: "line",
};

export const WEAPONS_PER_ROW = 5;

export function weaponGrid(count: number): { cols: number; small: boolean } {
  if (count <= WEAPONS_PER_ROW) return { cols: count, small: false };
  return { cols: Math.ceil(count / 2), small: true };
}

export type WeaponMark = { slot: number; look: "mg" | "cannon"; status: string; ready: boolean };
export type JobMark = { label: string; progress: number };
export type VehicleMark = { weapons: WeaponMark[]; radio: boolean; job: JobMark | null; out: boolean; gaveUp: boolean };

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
  markSeenNpcs(w, markOf);
  return marks;
}

function markSeenNpcs(w: World, markOf: (id: string) => VehicleMark): void {
  for (const v of w.vehicles.filter((x) => x.brain && playerSees(w, x.pos))) {
    const job = seenNpcJob(w, v);
    if (job) markOf(v.id).job = job;
    if (isKnockedOut(v)) {
      markOf(v.id).out = true;
      markOf(v.id).gaveUp = gaveUp(v);
    }
  }
}

function seenNpcJob(w: World, v: Vehicle): JobMark | null {
  const work = workOf(w, v);
  return work && { label: workLabel(w, v, work), progress: workProgress(work) };
}

export function aimsBody(w: World, weapons: MountedWeapon[], targetId: string): boolean {
  const orders = playerVehicle(w).weaponOrders;
  return weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === targetId && orders[mw.part.id].aim === "body");
}

// Names the chosen guns as the panel numbers them.
export function gunsLabel(w: World, selected: string | null): string {
  if (!selected) return "all guns";
  const i = vehicleStats(w, playerVehicle(w)).weapons.findIndex((mw) => mw.part.id === selected);
  return i < 0 ? "all guns" : `gun ${i + 1}`;
}

export type AimState = { guns: string; body: number[]; bodyAimed: boolean; locked: boolean; hasGuns: boolean };

// What the aim line shows for a truck. Locked while a turn plays or the player cannot act.
export function aimStateOf(w: World, selected: string | null, locked: boolean, targetId: string): AimState {
  const weapons = weaponsForClick(w, selected);
  return { guns: gunsLabel(w, selected), body: bodyMarks(w, targetId), bodyAimed: aimsBody(w, weapons, targetId), locked, hasGuns: weapons.length > 0 };
}

type AimHost = { world: () => World; selected: () => string | null; canAim: () => boolean; apply: (w: World) => void };

// The card's aim controls. Aim orders wait for a turn that is not playing and a player who can act.
export function aimActions(h: AimHost) {
  const guns = () => weaponsForClick(h.world(), h.selected());
  return {
    aimState: (id: string) => aimStateOf(h.world(), h.selected(), !h.canAim(), id),
    aimBody: (id: string) => h.canAim() && h.apply(toggleBodyAim(h.world(), guns(), vehicleById(h.world(), id))),
    aimPart: (id: string, partId: string) => h.canAim() && h.apply(aimAtPart(h.world(), guns(), vehicleById(h.world(), id), partId)),
  };
}

// The line above the card's diagram. It holds the Body chip, whose tooltip names the chosen guns. It is missing for a player without guns.
export function aimLine(state: AimState, onBody: () => void): HTMLElement | null {
  if (!state.hasGuns) return null;
  const chip = el(
    "button",
    {
      class: "aim-body",
      "aria-pressed": String(state.bodyAimed),
      disabled: state.locked,
      title: `Body shot with ${state.guns}: rounds hit whatever part they reach. Click again to stop.`,
      onclick: onBody,
    },
    "Body",
    ...(state.body.length ? [el("span", { class: "condition-aim" }, state.body.join(" "))] : []),
  );
  return el("div", { class: "aim-line dim" }, chip);
}

// The Body chip aims the chosen guns at a vehicle's body. When all of them already do, it clears them. A gun on a part moves to the body.
export function toggleBodyAim(w: World, weapons: MountedWeapon[], target: Vehicle): World {
  const aimed = aimsBody(w, weapons, target.id);
  if (w.player.autoFire) w = setAutoFire(w, false);
  for (const mw of weapons)
    w = setWeaponOrder(w, mw.part.id, aimed ? null : { targetId: target.id, aim: "body" });
  return w;
}

export function aimAtPart(w: World, weapons: MountedWeapon[], target: Vehicle, partId: string): World {
  const orders = playerVehicle(w).weaponOrders;
  const aimed = weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === target.id && orders[mw.part.id].aim === partId);
  if (w.player.autoFire) w = setAutoFire(w, false);
  for (const mw of weapons)
    w = setWeaponOrder(w, mw.part.id, aimed ? null : { targetId: target.id, aim: partId });
  return w;
}

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

export function bodyMarks(w: World, targetId: string): number[] {
  const orders = playerVehicle(w).weaponOrders;
  const marks: number[] = [];
  vehicleStats(w, playerVehicle(w)).weapons.forEach((mw, i) => {
    const order = orders[mw.part.id];
    if (order?.targetId === targetId && order.aim === "body") marks.push(i + 1);
  });
  return marks;
}

export function aimName(target: Vehicle, aim: Aim): string {
  const part = aim === "body" ? null : findPart(target, aim);
  return part ? partDef(part.defId).name : "body shot";
}

function turns(n: number): string {
  return `${n} ${n === 1 ? "turn" : "turns"}`;
}

export function blockText(mw: MountedWeapon, block: FireBlock): string {
  const gun = gunOf(mw.part);
  if (block === "cooldown") return `ready in ${turns(gun.cooldown)}`;
  if (block === "empty") return `reloading ${turns(mw.def.reload - gun.reloadWork)}`;
  return BLOCK_TEXT[block];
}

export function ammoText(mw: MountedWeapon): string {
  return `${gunOf(mw.part).ammo}/${mw.def.magazine}`;
}

export type AmmoCell = "loaded" | "spent" | "reloading";

export function ammoCells(magazine: number, ammo: number, reloadWork: number, reload: number): AmmoCell[] {
  const spent = magazine - ammo;
  const filled = reloadWork > 0 ? Math.min(spent, Math.ceil((reloadWork / reload) * magazine)) : 0;
  return Array.from({ length: magazine }, (_, i) =>
    i < ammo ? "loaded" : i < ammo + filled ? "reloading" : "spent");
}

export function ammoLabel(mw: MountedWeapon): string {
  const gun = gunOf(mw.part);
  if (gun.reloadWork > 0) return `reloading, ${turns(mw.def.reload - gun.reloadWork)} left`;
  return `${gun.ammo}/${mw.def.magazine} rounds`;
}

export function canForceReload(mw: MountedWeapon): boolean {
  const ammo = gunOf(mw.part).ammo;
  return mw.part.hp > 0 && ammo > 0 && ammo < mw.def.magazine;
}

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
    block,
  };
}

export const UTILITY_SLOTS = 4;
export const SLOT_KEYS = 9;

export function utilityKey(w: World, i: number): number | null {
  const key = vehicleStats(w, playerVehicle(w)).weapons.length + i + 1;
  return key <= SLOT_KEYS ? key : null;
}

const PICK_TEXT: Record<"point", string> = { point: "aim: click the ground" };
const FIRES_TEXT = "fires this turn";

export type UtilityState = "ready" | "aiming" | "set" | "armed" | "recharging" | "blocked";
export type UtilityStatus = { state: UtilityState; text: string; reload?: { left: number; total: number } };

export function utilitySlots(w: World): PartInstance[] {
  return chargedParts(playerVehicle(w)).slice(0, UTILITY_SLOTS);
}

export function utilityStatus(w: World, part: PartInstance, selected: boolean): UtilityStatus {
  const kind = orderKindOf(part);
  if (kind === null) throw new Error(`${partDef(part.defId).name} is passive and has no slot`);
  const order = playerVehicle(w).utilityOrders[part.id];
  if (order) return { state: "set", text: FIRES_TEXT };
  if (chargeOf(part).armed) return { state: "armed", text: "armed" };
  return aimingStatus(w, part, kind, selected) ?? idleStatus(w, part);
}

function aimingStatus(w: World, part: PartInstance, kind: UtilityOrder["kind"], selected: boolean): UtilityStatus | null {
  if (!selected || kind === "self" || aimBlock(w, part) !== null) return null;
  return { state: "aiming", text: PICK_TEXT[kind] };
}

function idleStatus(w: World, part: PartInstance): UtilityStatus {
  const block = utilityBlock(w, playerVehicle(w), part);
  if (block === "cooldown") return { state: "recharging", text: utilityBlockText(part, block), reload: { left: chargeOf(part).reload, total: wornReload(part) } };
  if (block) return { state: "blocked", text: utilityBlockText(part, block) };
  return noFuel(w, part) ? { state: "blocked", text: "no fuel" } : { state: "ready", text: "ready" };
}

function noFuel(w: World, part: PartInstance): boolean {
  const def = partDef(part.defId);
  return def.kind === "utility" && def.effect.type === "oil" && oilShort(w, playerVehicle(w), def.effect.fuel);
}

export function aimBlock(w: World, part: PartInstance): FireBlock | null {
  return utilityBlock(w, playerVehicle(w), part);
}

export function utilityBlockText(part: PartInstance, block: FireBlock): string {
  if (block === "cooldown") return `recharging ${turns(chargeOf(part).reload)}`;
  return block === "disabled" ? "broken" : BLOCK_TEXT[block];
}

const BADGE: Partial<Record<UtilityState, string>> = { aiming: "crosshair", set: "check", armed: "fuse" };

function rechargeBar(reload: { left: number; total: number }): HTMLElement {
  const share = Math.max(0, (reload.total - reload.left) / reload.total);
  return el("span", { class: "recharge-bar", "aria-hidden": "true" }, el("span", { style: `width:${Math.round(share * 100)}%` }));
}

export class UtilityRow {
  constructor(private host: UiHost) {}

  render(w: World): HTMLElement | null {
    const parts = utilitySlots(w);
    if (parts.length === 0) return null;
    const row = el("div", { class: "weapon-slots utility-slots" }, ...parts.map((part, i) => this.renderSlot(w, part, i)));
    row.style.setProperty("--weapon-cols", String(parts.length));
    return row;
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

  selectUtility(i: number): void {
    if (this.host.getTurnPhase() !== null) return;
    const w = this.host.world();
    const part = utilitySlots(w)[i];
    if (!part) return;
    if (playerVehicle(w).utilityOrders[part.id]) return this.clearOrder(w, part);
    if (orderKindOf(part) === "self") return this.useSelf(w, part);
    this.togglePick(w, part);
  }

  private togglePick(w: World, part: PartInstance): void {
    const repeat = this.host.selectedUtility() === part.id;
    this.host.selectUtility(repeat || aimBlock(w, part) ? null : part.id);
  }

  private clearOrder(w: World, part: PartInstance): void {
    if (this.host.selectedUtility() === part.id) this.host.selectUtility(null);
    this.host.apply(setUtilityOrder(w, part.id, null));
  }

  private useSelf(w: World, part: PartInstance): void {
    if (utilityOrderError(w, playerVehicle(w), part.id, { kind: "self" }) === null)
      this.host.apply(setUtilityOrder(w, part.id, { kind: "self" }));
  }
}

export function shortStatus(mw: MountedWeapon, readout: ReturnType<typeof getWeaponReadout>): string {
  if (readout.chance !== null) return `${Math.round(readout.chance * 100)}%`;
  const { block } = readout;
  if (block === null) return "";
  const gun = gunOf(mw.part);
  if (block === "cooldown") return `${BLOCK_SHORT[block]} ${gun.cooldown}`;
  if (block === "empty") return `${BLOCK_SHORT[block]} ${mw.def.reload - gun.reloadWork}`;
  return BLOCK_SHORT[block];
}

function canHold(w: World, mw: MountedWeapon): boolean {
  return w.player.autoFire || playerVehicle(w).weaponOrders[mw.part.id] !== undefined;
}

export class WeaponPanel {
  private root = panel("weapons", bottomLeft());
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
      this.expanded ? this.renderAutoButton(w, locked) : null,
      this.expanded ? this.renderAllButton(locked) : null,
      el("button", { class: "weapon-toggle", "aria-expanded": String(this.expanded), onclick: () => this.host.runKey("KeyX"), title: "Show or hide weapons [X]" }, this.expanded ? "Hide [X]" : "Show [X]"),
    );
    this.root.replaceChildren(head, ...(this.expanded ? [this.renderControls(w, locked)] : []));
    this.turn.replaceChildren(this.renderTurnButton(phase));
  }

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

  private renderAutoButton(w: World, locked: boolean): HTMLElement {
    return el(
      "button",
      {
        class: w.player.autoFire ? "on" : "",
        "aria-pressed": String(w.player.autoFire),
        disabled: locked,
        title: "Auto fire: guns shoot at hostiles on their own [Q]",
        onclick: () => this.host.runKey("KeyQ"),
      },
      "Auto fire [Q]",
    );
  }

  private renderAllButton(locked: boolean): HTMLElement {
    const all = this.host.selectedWeapon() === null;
    return el(
      "button",
      {
        class: all ? "on" : "",
        "aria-pressed": String(all),
        disabled: locked,
        title: "Aim all weapons [0]",
        onclick: () => this.host.runKey("Digit0"),
      },
      "All [0]",
    );
  }

  private renderControls(w: World, locked: boolean): HTMLElement {
    const weapons = vehicleStats(w, playerVehicle(w)).weapons;
    const { cols, small } = weaponGrid(weapons.length);
    const slots = el(
      "div",
      { class: small ? "weapon-slots two-rows" : "weapon-slots" },
      ...weapons.map((mw, i) => this.renderSlot(w, mw, i, locked)),
    );
    slots.style.setProperty("--weapon-cols", String(cols));
    return el(
      "fieldset",
      { disabled: locked },
      slots,
      weapons.length === 0 ? el("div", { class: "dim" }, "No weapons installed") : null,
      this.utilities.render(w),
    );
  }

  private renderSlot(w: World, mw: MountedWeapon, i: number, locked: boolean): HTMLElement {
    const readout = getWeaponReadout(w, mw);
    const selected = this.host.selectedWeapon() === mw.part.id;
    const order = playerVehicle(w).weaponOrders[mw.part.id];
    const target = readout.target?.name ?? (order ? "target unavailable" : "no target");
    return el(
      "div",
      { class: mw.part.hp <= 0 ? "weapon-slot broken" : "weapon-slot", "data-weapon": mw.part.id },
      el(
        "button",
        {
          class: `weapon-pick ${selected ? "on" : ""}`,
          "aria-pressed": String(selected),
          'aria-label': `${mw.def.name}: ${readout.status}, ${target}`,
          title: `${mw.def.name}: ${mw.def.rounds} × ${Number(roundDamage(w, mw.def).toFixed(1))} damage, pen ${mw.def.round.pen}, range ${meters(mw.def.range)} m, arc ${mw.def.arc}°, fires every ${mw.def.cooldown} turn(s), ${mw.def.magazine} shots, reloads in ${mw.def.reload} turn(s). ${readout.status}, ${target}`,
          onclick: () => this.selectWeapon(selected ? null : mw.part.id),
        },
        el('span', { class: 'weapon-number' }, `${i + 1}`),
        el("span", { class: readout.canFire ? "good" : "dim", "data-status": "" }, shortStatus(mw, readout)),
        createItemIcon(mw.part.defId),
        this.renderAmmo(mw),
      ),
      this.renderActions(mw, locked, canHold(w, mw)),
    );
  }

  private renderAmmo(mw: MountedWeapon): HTMLElement {
    const gun = gunOf(mw.part);
    const label = ammoLabel(mw);
    return el(
      "span",
      { class: "weapon-ammo", title: label },
      el("span", { class: "sr-only" }, label),
      ...ammoCells(mw.def.magazine, gun.ammo, gun.reloadWork, mw.def.reload).map((state) =>
        el("span", { class: `ammo-cell ${state}`, "aria-hidden": "true" })),
    );
  }

  private renderActions(mw: MountedWeapon, locked: boolean, canHold: boolean): HTMLElement {
    return el(
      "div",
      { class: "weapon-actions" },
      el(
        "button",
        {
          class: "weapon-hold",
          disabled: !canHold,
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

  pressKey(n: number): void {
    const w = this.host.world();
    const guns = vehicleStats(w, playerVehicle(w)).weapons.length;
    if (n <= guns) this.selectIndex(n - 1);
    else this.utilities.selectUtility(n - guns - 1);
  }

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

export class HoverHold {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private apply: (id: string | null) => void, private delayMs: number) {}

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

  watch(panel: EventTarget): void {
    panel.addEventListener("mouseenter", () => this.cancel());
    panel.addEventListener("mouseleave", () => this.now(null));
  }
}

// The truck whose inspection card a click pinned. Hover is transient and aim is a weapon order; the pin is only a selection.
export class InspectPin {
  private current: string | null = null;

  private seen = false;

  constructor(
    private readonly onChange: () => void,
    private readonly visible: (v: Vehicle) => boolean,
  ) {}

  get id(): string | null {
    return this.current;
  }

  // Pins a truck. A click on the pinned truck keeps it, and a click on another truck switches the pin.
  click(id: string): void {
    if (id === "") throw new Error("InspectPin.click needs a vehicle id");
    this.set(id);
  }

  clear(): void {
    this.set(null);
  }

  // Called once per truck in a frame's pass. Only the pinned truck, when still in the world, is tested for sight.
  note(v: Vehicle, inWorld: boolean): void {
    if (v.id === this.current && inWorld && this.visible(v)) this.seen = true;
  }

  // Ends the frame's pass: drops the pin when its truck was not seen.
  settle(): void {
    if (this.current !== null && !this.seen) this.set(null);
    this.seen = false;
  }

  private set(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    this.onChange();
  }
}
