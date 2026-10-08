// The player's truck switches (manual driving, auto patch, overdrive, headlights, dousing the engine) and the E-key context action.

import { readyAid, startAid } from "../sim/aid";
import { playerVehicle } from "../sim/damage";
import { canDouse, douseEngine } from "../sim/engine-heat";
import { isBusy } from "../sim/jobs";
import { canOverdrive, inOverdrive } from "../sim/stats";
import { canLoot, canScavenge, scavenge } from "../sim/locations";
import { shopAt } from "../sim/market";
import type { World } from "../sim/types";
import { playerCanAct, setAutoRepair, setDirect, setHeadlights, setOverdrive } from "../sim/world";
import { combatBlocked, type ContextAction, type ContextTarget } from "../ui/hud";
import { ContextPicker, getContextActions } from "../ui/hud-readout";

export type ControlsHost = {
  world: () => World;
  apply: (next: World) => void;
  commit: (next: World) => void;
  refreshPlan: () => void;
  doused: () => void;
  revved: () => void;
};

export class TruckControls {
  constructor(private host: ControlsHost) {}

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

  toggleOverdrive(): void {
    const w = this.host.world();
    if (!playerCanAct(w)) return;
    const me = playerVehicle(w);
    const on = !inOverdrive(w, me);
    if (on && !canOverdrive(me)) return;
    this.host.apply(setOverdrive(w, on));
    this.host.refreshPlan();
    if (on) this.host.revved();
  }

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
  note: (text: string) => void;
  openTrade: (npcId: string) => void;
  openTown: () => void;
  openDowned: (vehicleId: string) => void;
  openLoot: (stockId: string) => void;
};

export class TruckContext {
  private readonly picker = new ContextPicker();

  constructor(private host: ContextHost) {}

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
      aid: () => 'id' in target && this.startAid(target.id),
      trade: () => 'id' in target && h.openTrade(target.id),
      shop: () => shopAt(h.world()) && h.openTown(),
      downed: () => 'id' in target && h.openDowned(target.id),
      stock: () => 'id' in target && this.searchStock(target.id, action.combat),
      loot: () => 'id' in target && this.lootStock(target.id),
      empty: () => undefined,
    };
    handlers[target.kind]();
  }

  private startAid(npcId: string): void {
    const aid = readyAid(this.host.world());
    if (aid?.holder !== npcId) return;
    this.host.apply(startAid(this.host.world(), npcId));
    this.host.pushEvents();
  }

  private searchStock(stockId: string, combat: number | undefined): void {
    const w = this.host.world();
    if (isBusy(playerVehicle(w))) return;
    if (combat !== undefined) this.host.note(combatBlocked(combat));
    else if (canScavenge(w, stockId)) {
      this.host.apply(scavenge(w, stockId));
      this.host.pushEvents();
    }
  }

  private lootStock(stockId: string): void {
    const w = this.host.world();
    if (!isBusy(playerVehicle(w)) && canLoot(w, stockId)) this.host.openLoot(stockId);
  }
}
