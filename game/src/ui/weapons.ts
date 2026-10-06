import { partDef } from "../data/parts";
import { RULES } from "../data/rules";
import { fireBlock, gunOf, hitOdds, type FireBlock } from "../sim/combat";
import { gaveUp, isKnockedOut } from "../sim/defeat";
import { findPart, playerVehicle } from "../sim/damage";
import { vehicleStats, type MountedWeapon } from "../sim/stats";
import type { Aim, Vehicle, World } from "../sim/types";
import { playerSees } from "../sim/vision";
import { workOf } from "../sim/states";
import { playerCanAct, reloadWeapon, setAutoFire, setWeaponOrder } from "../sim/world";
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

// True when every chosen gun already has a body or part order on this target.
export function aimsAt(w: World, weapons: MountedWeapon[], targetId: string): boolean {
  const orders = playerVehicle(w).weaponOrders;
  return weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === targetId);
}

// Names the chosen guns as the panel numbers them.
export function gunsLabel(w: World, selected: string | null): string {
  if (!selected) return "all guns";
  const i = vehicleStats(w, playerVehicle(w)).weapons.findIndex((mw) => mw.part.id === selected);
  return i < 0 ? "all guns" : `gun ${i + 1}`;
}

// The Aim button aims the weapons at a vehicle. When all of them already aim at it, the button clears them.
export function toggleTarget(w: World, weapons: MountedWeapon[], target: Vehicle): World {
  const aimed = aimsAt(w, weapons, target.id);
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

export class WeaponPanel {
  private root = panel("weapons");
  private turn = panel('turn-control');
  private expanded = true;

  constructor(private host: UiHost) {}

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
        title: "Aim all weapons [0]",
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

// The truck whose inspection card a click pinned. Hover is transient and aim is a weapon order; the pin is only a selection.
export class InspectPin {
  private current: string | null = null;

  constructor(private readonly onChange: () => void) {}

  get id(): string | null {
    return this.current;
  }

  // Pins a truck. A click on the pinned truck unpins it.
  click(id: string): void {
    if (id === "") throw new Error("InspectPin.click needs a vehicle id");
    this.set(id === this.current ? null : id);
  }

  clear(): void {
    this.set(null);
  }

  // Keeps the pin while its truck is seen, and drops it otherwise.
  keepIf(seen: boolean): void {
    if (!seen) this.set(null);
  }

  private set(id: string | null): void {
    if (id === this.current) return;
    this.current = id;
    this.onChange();
  }
}
