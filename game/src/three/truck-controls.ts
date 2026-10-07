// The player's truck switches (manual driving, auto patch, overdrive, headlights, dousing the engine) and the E-key context action.

import type { Msg } from '../text/msg';
import { readyAid, startAid } from "../sim/aid";
import { playerVehicle } from "../sim/damage";
import { canDouse, douseEngine } from "../sim/engine-heat";
import { isBusy } from "../sim/jobs";
import { canLoot, canScavenge, canUseOasis, scavenge, useOasis } from "../sim/locations";
import { shopAt } from "../sim/market";
import type { World } from "../sim/types";
import { playerCanAct, setAutoRepair, setDirect, setHeadlights, setOverdrive } from "../sim/world";
import { combatBlocked, type ContextAction, type ContextTarget } from "../ui/hud";
import { ContextPicker, getContextActions } from "../ui/hud-readout";

export type ControlsHost = {
  world: () => World;
  apply: (next: World) => void;
  commit: (next: World) => void; // sets the world without pausing travel, for switches no turn reads
  refreshPlan: () => void;
  doused: () => void; // plays the steam cloud and logs the douse
  revved: () => void; // plays the engine rev when overdrive comes on
};

export class TruckControls {
  constructor(private host: ControlsHost) {}

  // Manual mode drives straight at the click, so the preview must rerun with the new driver.
  toggleManual(): void {
    const w = this.host.world();
    if (!playerCanAct(w)) return;
    this.host.apply(setDirect(w, !playerVehicle(w).direct));
    this.host.refreshPlan();
  }

  toggleAutoRepair(): void {
    const w = this.host.world();
    this.host.apply(setAutoRepair(w, !w.player.autoRepair));
  }

  // Overdrive changes speed, so the preview must rerun.
  toggleOverdrive(): void {
    const w = this.host.world();
    if (!playerCanAct(w)) return;
    const on = !w.player.overdrive;
    this.host.apply(setOverdrive(w, on));
    this.host.refreshPlan();
    if (on) this.host.revved();
  }

  // The lamps change no rule, so they switch at any time, even while a turn plays or the truck travels on its own.
  toggleHeadlights(): void {
    const w = this.host.world();
    this.host.commit(setHeadlights(w, !w.player.headlights));
  }

  douseEngine(): void {
    const w = this.host.world();
    if (!playerCanAct(w) || !canDouse(w)) return;
    this.host.apply(douseEngine(w));
    this.host.doused();
  }
}

export type ContextHost = {
  world: () => World;
  playing: () => boolean;
  apply: (next: World) => void;
  pushEvents: () => void;
  note: (text: Msg) => void;
  openTrade: () => void;
  openTown: () => void;
  openDowned: (vehicleId: string) => void;
  openLoot: (stockId: string) => void;
};

// The E key. The HUD shows one of the actions in reach, the arrow keys choose which, and E runs the shown one.
export class TruckContext {
  private readonly picker = new ContextPicker();

  constructor(private host: ContextHost) {}

  // The action the box shows, with how many there are and its place among them.
  shown(): { action: ContextAction | null; count: number; index: number } {
    const actions = getContextActions(this.host.world(), this.host.playing());
    const action = this.picker.pick(actions);
    return { action, count: actions.length, index: Math.max(0, actions.findIndex((a) => a === action)) };
  }

  cycle(step: 1 | -1): void {
    this.picker.cycle(getContextActions(this.host.world(), this.host.playing()), step);
  }

  use(): void {
    const w = this.host.world();
    if (this.host.playing() || !playerCanAct(w)) return;
    const action = this.picker.pick(getContextActions(w, false));
    if (action) this.run(action);
  }

  private run(action: ContextAction): void {
    const target: ContextTarget = action.target;
    const h = this.host;
    const handlers: { [K in ContextTarget['kind']]: () => void } = {
      aid: () => this.startAid(),
      trade: h.openTrade,
      shop: () => shopAt(h.world()) && h.openTown(),
      downed: () => 'id' in target && h.openDowned(target.id),
      oasis: () => this.refill(),
      stock: () => 'id' in target && this.useStock(target.id, action.combat),
      empty: () => undefined,
    };
    handlers[target.kind]();
  }

  private startAid(): void {
    const aid = readyAid(this.host.world());
    if (!aid) return;
    this.host.apply(startAid(this.host.world(), aid.holder));
    this.host.pushEvents();
  }

  private refill(): void {
    const w = this.host.world();
    if (isBusy(playerVehicle(w)) || !canUseOasis(w)) return;
    this.host.apply(useOasis(w));
    this.host.pushEvents();
  }

  // A search that combat blocks says so in the log, with the turns left.
  private useStock(stockId: string, combat: number | undefined): void {
    const w = this.host.world();
    if (isBusy(playerVehicle(w))) return;
    if (combat !== undefined) this.host.note(combatBlocked(combat));
    else if (canScavenge(w, stockId)) {
      this.host.apply(scavenge(w, stockId));
      this.host.pushEvents();
    } else if (canLoot(w, stockId)) this.host.openLoot(stockId);
  }
}
