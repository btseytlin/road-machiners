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

export function toggleTarget(w: World, weapons: MountedWeapon[], target: Vehicle): World {
  const orders = playerVehicle(w).weaponOrders;
  const aimed = weapons.length > 0 && weapons.every((mw) => orders[mw.part.id]?.targetId === target.id);
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
    w = setWeaponOrder(w, mw.part.id, { targetId: target.id, aim: aimed ? "body" : partId });
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
    );
  }

  private renderSlot(w: World, mw: MountedWeapon, i: number, locked: boolean): HTMLElement {
    const readout = getWeaponReadout(w, mw);
    const selected = this.host.selectedWeapon() === mw.part.id;
    const chance =
      readout.chance === null ? "" : `, ${Math.round(readout.chance * 100)}%`;
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
