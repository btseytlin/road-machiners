// Vehicle instruments, critical resources, event history and inspection.

import { DialoguePanel, type DialogueHost } from "./dialogue";
import type { Vehicle, World } from "../sim/types";
import { setupLabel } from "../sim/settings";
import { workOf, type Work } from "../sim/states";
import { isAutoPatch } from "../sim/jobs";
import { bottomLeft, disabledWith, el, isBrowserChord, panel, rightDock, topCenter, topLeft, topRight } from "./dom";
import { LogPanel } from "./log";
import {
  heldContractDue,
  contractSummary,
  eventText,
  workLabel,
  workProgress,
  formatNpcCargo,
  formatNpcMark,
  formatNpcTraits,
  formatVehicleState,
  type LogLine,
} from "./format";
import { bugReportUrl, featureRequestUrl, getHudReadout, getRescueReadout, overdriveSwitch, versionLabel, type RescueReadout, type TipLine } from "./hud-readout";
import { createIcon, createSpeedDial } from "./cards";
import { aimMarks, TURN_PLAYING, type AimState } from "./weapons";
import { token } from "./tokens";
import { createSwitch } from "./switch";
import { Tips } from "./tips";
import { moneyEl } from "./units";
import { playerVehicle } from "../sim/damage";
import { affordableRanks, pendingPerkPairs } from "../sim/progress";
import { douseBlock } from "../sim/engine-heat";
import { ENGINE_HEAT } from "../data/wear";
import type { RadioPanel } from "./radio";
import { type ConditionAim, TruckConditionView } from "./truck-condition-view";

export type ContextTarget =
  | { kind: 'aid'; id: string }
  | { kind: 'trade'; id: string }
  | { kind: 'shop' }
  | { kind: 'downed'; id: string }
  | { kind: 'oasis' }
  | { kind: 'stock'; id: string }
  | { kind: 'loot'; id: string }
  | { kind: 'empty' }
  | { kind: 'outpost' };
export type ContextAction = { label: string; ready: boolean; target: ContextTarget; hint?: string; combat?: number };

export function contextKey(target: ContextTarget): string {
  return 'id' in target ? `${target.kind}:${target.id}` : target.kind;
}

function actionTitle(action: ContextAction): string {
  if (action.hint) return action.hint;
  if (action.combat !== undefined) return combatBlocked(action.combat);
  return action.ready ? "" : "Stop to use";
}

export const combatBlocked = (turns: number): string => `In combat, ${turns} ${turns === 1 ? "turn" : "turns"} left`;

type HudActions = {
  openInventory: () => void;
  openCharacter: () => void;
  toggleManual: () => void;
  toggleAutoRepair: () => void;
  toggleOverdrive: () => void;
  toggleHeadlights: () => void;
  headlightsOn: () => boolean;
  douseEngine: () => void;
  unhitch: () => void;
  setBeacon: (on: boolean) => void;
  endRun: () => void;
  isBusy: () => boolean;
  autoTravel: () => boolean;
  dialogue: DialogueHost;
  recenter: () => void;
  aimPart: (vehicleId: string, partId: string) => void;
  aimState: (vehicleId: string) => AimState;
};
export type CameraMode = "centered" | "auto";

const TOAST_MS = 3500;

const TONE_CLASS: Record<TipLine['tone'], string> = { base: 'dim', bad: 'bad', good: 'good', plain: '' };

export class MaxSpeedView {
  private readonly text = el('span', { class: 'speed-max-text' });
  private readonly lines = el('div', { class: 'speed-lines' });
  readonly root = el(
    'span',
    { class: 'speed-max', tabindex: 0, 'aria-describedby': 'speed-breakdown' },
    this.text,
    el('div', { class: 'speed-tip tooltip', id: 'speed-breakdown', role: 'tooltip' }, this.lines),
  );

  private shown = '';

  render(maxSpeed: string, lines: TipLine[]): void {
    this.text.textContent = `${maxSpeed} km/h`;
    const key = lines.map((line) => `${line.label}|${line.value}|${line.tone}`).join('\n');
    if (key === this.shown) return;
    this.shown = key;
    this.lines.replaceChildren(
      ...lines.map((line) => el('div', { class: 'speed-line' }, el('span', {}, line.label), el('span', { class: `num ${TONE_CLASS[line.tone]}` }, line.value))),
    );
  }
}

export class Hud {
  private top = panel("instruments", bottomLeft());
  private clockSlot = el("div", { class: "instrument-clock", role: "timer", title: "Day and time" });
  private dialSlot = el("div", { class: "speed-dial-slot" });
  private maxSpeed = new MaxSpeedView();
  private speedSlot = el("div", { class: "speedometer" }, this.dialSlot, this.maxSpeed.root);
  private readoutSlot = el("div", { class: "readouts" });
  private actionSlot = el("div", { class: "instrument-actions" });
  private condition = new TruckConditionView();
  private inspected = new TruckConditionView(true);
  private inspectedDraw = el("div", { class: "info-draw" }, this.inspected.root);
  private infoColumn = el("div", { class: "info-column" });
  private contracts = panel("contracts dock-panel", rightDock());
  private log = new LogPanel();
  private info = panel("info");
  private infoBody = el("div", { class: "info-content" });
  private feedback = panel("feedback", topLeft());
  private action = panel("action");
  private toastBox = panel("toast");
  private rescue = panel("rescue notice", topCenter());
  private knockedOut = panel("status-mark", topCenter());
  private truckStack = el("div", { class: "truck-stack" });
  private stranded = panel("stranded notice", this.truckStack);
  private recenter = panel("recenter", bottomLeft());
  private cameraSwitch = panel("camera-mode", topRight());
  private tips = new Tips(window.localStorage, topCenter());
  cameraMode: CameraMode = "auto";
  private toastTimer: number | null = null;

  private readonly dialogue: DialoguePanel;

  private placeInfo = (): void => {
    if (this.info.style.display === "none") return;
    const gap = parseFloat(token("--hud-gap"));
    const top = topRight().getBoundingClientRect().bottom + gap;
    this.info.style.top = `${top}px`;
    this.info.style.height = `${this.radio.root.getBoundingClientRect().top - gap - top}px`;
    this.inspected.fitTo(this.inspectedDraw);
  };

  constructor(private actions: HudActions, private radio: RadioPanel) {
    this.truckStack.append(this.condition.root);
    bottomLeft().append(this.truckStack);
    this.dialogue = new DialoguePanel(actions.dialogue);
    this.info.style.display = "none";
    this.info.append(this.infoBody);
    this.contracts.style.display = "none";
    new ResizeObserver(this.placeInfo).observe(rightDock());
    window.addEventListener("resize", this.placeInfo);
    this.toastBox.style.display = "none";
    this.rescue.style.display = "none";
    this.knockedOut.style.display = "none";
    this.knockedOut.append(el("span", { class: "bad" }, "Knocked out"));
    this.stranded.style.display = "none";
    this.recenter.style.display = "none";
    this.recenter.append(el("button", { onclick: () => actions.recenter() }, "Center on truck (F)"));
    this.showCameraMode();
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyV" && !isBrowserChord(e) && !document.activeElement?.matches("input, select, textarea")) this.toggleCameraMode();
    });
    const setup = setupLabel(this.actions.dialogue.world().setup);
    const feedbackMenu = el("details", {});
    const feedbackLink = (href: string, text: string) =>
      el(
        "a",
        {
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          onclick: () => feedbackMenu.removeAttribute("open"),
        },
        text,
      );
    feedbackMenu.append(
      el(
        "summary",
        { title: "Report a bug or request a feature", "aria-label": "Report a bug or request a feature" },
        "!",
      ),
      feedbackLink(bugReportUrl(`${versionLabel()}, ${setup}`), "Report a bug"),
      feedbackLink(featureRequestUrl(), "Request a feature"),
    );
    this.feedback.append(feedbackMenu);
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Escape") return;
      feedbackMenu.removeAttribute("open");
    });
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === "auto" ? "centered" : "auto";
    this.showCameraMode();
  }

  private showCameraMode(): void {
    this.cameraSwitch.replaceChildren(
      createSwitch({
        on: "Cam auto",
        off: "Centered",
        checked: this.cameraMode === "auto",
        key: "V",
        title: "Camera mode: lead toward the order point, or stay centered on the truck [V]",
        onclick: () => this.toggleCameraMode(),
      }),
    );
  }

  showRecenter(on: boolean): void {
    this.recenter.style.display = on ? "" : "none";
  }

  getInspectionRoot(): HTMLElement {
    return this.info;
  }

  getExchangeRoot(): HTMLElement {
    return this.infoColumn;
  }

  private toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.style.display = "";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => (this.toastBox.style.display = "none"),
      TOAST_MS,
    );
  }

  renderAction(
    action: ContextAction | null,
    count: number,
    index: number,
    world: World,
    onUse: () => void,
    onCycle: (step: 1 | -1) => void,
  ): void {
    const me = playerVehicle(world);
    const shown = shownWork(action, workOf(world, me));
    this.action.style.display = action || shown ? "" : "none";
    if (shown) this.renderWork(shown, workLabel(world, me, shown));
    else if (action) this.renderActionButton(action, count, index, onUse, onCycle);
  }

  private renderWork(work: Work, label: string): void {
    const progress = Math.round(workProgress(work) * 100);
    this.action.replaceChildren(
      el(
        "span",
        { class: "job-label" },
        `${label}, ${work.turnsLeft} ${work.turnsLeft === 1 ? 'turn' : 'turns'} left`,
      ),
      el(
        "span",
        {
          class: "job-bar meter progress",
          role: "progressbar",
          "aria-label": `${label} progress`,
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(progress),
        },
        el("span", { style: `width:${progress}%` }),
      ),
    );
  }

  private renderActionButton(action: ContextAction, count: number, index: number, onUse: () => void, onCycle: (step: 1 | -1) => void): void {
    const use = el(
      "button",
      {
        ...disabledWith(action.ready ? null : actionTitle(action), onUse),
        class: action.combat !== undefined ? "btn-danger" : "",
      },
      action.hint ? action.label : `[E] ${action.label}`,
    );
    const cycle = (step: 1 | -1, glyph: string, key: string) =>
      el("button", { class: "cycle", title: `[${key}]`, onclick: () => onCycle(step) }, glyph);
    this.action.replaceChildren(
      ...(count > 1
        ? [cycle(-1, "‹", "←"), use, el("span", { class: "count" }, `${index + 1}/${count}`), cycle(1, "›", "→")]
        : [use]),
    );
  }

  renderRescue(w: World): void {
    this.dialogue.render(w);
    const r = getRescueReadout(w);
    this.knockedOut.style.display = rescueOf(r, "knockedOut") ? "" : "none";
    this.renderMiddle(rescueOf(r, "towed"));
    this.renderStranded(rescueOf(r, "stranded"));
  }

  private renderMiddle(r: Extract<RescueReadout, { kind: "towed" }> | null): void {
    this.rescue.style.display = r ? "" : "none";
    if (!r) return this.rescue.replaceChildren();
    this.rescue.replaceChildren(
      el("h3", {}, "Under tow"),
      el("div", {}, `${r.tower} tows you to ${r.town}`),
      el("div", { class: "dim" }, "Fee ", moneyEl(r.fee)),
      el(
        "div",
        { class: "rescue-buttons" },
        el("button", { onclick: () => this.actions.unhitch() }, "Unhitch"),
      ),
    );
  }

  private renderStranded(r: Extract<RescueReadout, { kind: "stranded" }> | null): void {
    this.stranded.style.display = r ? "" : "none";
    if (!r) return this.stranded.replaceChildren();
    this.stranded.replaceChildren(
      el("h3", {}, "Stranded"),
      ...(r.beacon || !r.reason ? [] : [el("div", { class: "dim" }, r.reason)]),
      el(
        "div",
        { class: "rescue-buttons" },
        r.canEnd
          ? el("button", { class: "btn-danger", onclick: () => this.actions.endRun() }, "End run")
          : createSwitch({
              on: "Beacon on",
              off: "Beacon off",
              checked: r.beacon,
              title: "Call for a tow by radio.",
              onclick: () => this.actions.setBeacon(!r.beacon),
            }),
      ),
    );
  }

  private renderContracts(w: World): void {
    if (w.player.contracts.length === 0) {
      this.contracts.style.display = "none";
      return;
    }
    this.contracts.style.display = "";
    this.contracts.replaceChildren(
      el("h3", { class: "panel-title" }, "Contracts"),
      ...w.player.contracts.map((c) =>
        el(
          "div",
          { class: "contract-line" },
          el("span", {}, contractSummary(c)),
          el("span", { class: "num" }, heldContractDue(c)),
        ),
      ),
    );
  }

  private engineButtons(w: World, busy: boolean): HTMLElement[] {
    const od = overdriveSwitch(w);
    const lock = busy ? TURN_PLAYING : null;
    const headlights = createSwitch({
      on: "Lights",
      off: "Off",
      checked: this.actions.headlightsOn(),
      key: "L",
      title: "Headlights [L]",
      onclick: () => this.actions.toggleHeadlights(),
    });
    const overdrive = createSwitch({
      on: "Overdrive",
      off: "Normal",
      checked: od.checked,
      key: "O",
      reason: lock ?? od.reason,
      title: od.title,
      onclick: () => this.actions.toggleOverdrive(),
    });
    const douseReason = lock ?? douseBlock(w);
    const douse = el(
      "button",
      {
        class: "instrument-button",
        "aria-disabled": douseReason === null ? undefined : "true",
        onclick: () => douseReason === null && this.actions.douseEngine(),
        title: douseReason ?? `Costs ${ENGINE_HEAT.douseSupplies} supplies [G]`,
      },
      "Cool [G]",
    );
    return [headlights, overdrive, douse];
  }

  private characterButton(w: World, busy: boolean): HTMLElement {
    const marked = pendingPerkPairs(w).length > 0 || affordableRanks(w).length > 0;
    return el(
      "button",
      {
        class: "instrument-button",
        "aria-disabled": busy ? "true" : undefined,
        onclick: () => !busy && this.actions.openCharacter(),
        title: busy ? TURN_PLAYING : marked ? "XP to spend or a perk to pick [C]" : "Driver and skills [C]",
      },
      createIcon("driver"),
      marked ? "! [C]" : "[C]",
    );
  }

  renderTop(w: World): void {
    const readout = getHudReadout(w);
    const busy = this.actions.isBusy();
    this.condition.render(playerVehicle(w));
    this.renderContracts(w);
    this.tips.update(w, this.actions.autoTravel());
    if (!this.top.firstChild) this.top.append(this.clockSlot, this.speedSlot, this.readoutSlot, this.actionSlot);
    this.renderClock(readout.clock);
    this.renderSpeedometer(readout, busy);
    this.renderReadouts(readout);
    this.renderActions(w, readout.manual, busy);
  }

  private renderClock(clock: string): void {
    const timeStart = clock.lastIndexOf(" ");
    this.clockSlot.setAttribute("aria-label", `Time: ${clock}`);
    this.clockSlot.replaceChildren(el("span", { class: "clock-day" }, clock.slice(0, timeStart)), el("span", { class: "clock-time" }, clock.slice(timeStart + 1)));
  }

  private renderSpeedometer(readout: ReturnType<typeof getHudReadout>, busy: boolean): void {
    const dial = el(
      "button",
      {
        class: "truck-instrument",
        title: "Truck inventory [I]",
        "aria-label": "Open truck inventory",
        disabled: busy,
        onclick: () => this.actions.openInventory(),
      },
      createSpeedDial(Number(readout.speed), Number(readout.maxSpeed)),
      el("span", { class: "speed-value" }, readout.speed),
      createIcon("truck"),
    );
    this.dialSlot.replaceChildren(dial);
    this.maxSpeed.render(readout.maxSpeed, readout.maxSpeedTip);
  }

  private renderReadouts(readout: ReturnType<typeof getHudReadout>): void {
    this.readoutSlot.replaceChildren(
      ...readout.resources.map((resource) =>
        el(
          "span",
          {
            class: `resource ${resource.warning ? "alert" : ""}`,
            title: "tip" in resource ? resource.tip : resource.label,
            "data-resource": resource.label,
          },
          resource.icon ? createIcon(resource.icon) : null,
          el("strong", {}, "balance" in resource && resource.balance !== undefined ? moneyEl(resource.balance) : resource.value),
        ),
      ),
      ...readout.survival.map((entry) =>
        el(
          "span",
          {
            class: `resource ${entry.warning ? "alert" : ""}`,
            title: entry.label,
            "data-resource": entry.label,
          },
          entry.label === "Engine" ? createIcon("engine") : null,
          el("strong", {}, entry.value),
          "progress" in entry && entry.progress !== undefined
            ? el(
                "span",
                {
                  class: "meter s progress",
                  role: "progressbar",
                  "aria-label": "Engine heat",
                  "aria-valuenow": String(Math.round(entry.progress * 100)),
                },
                el("span", { style: `width:${Math.round(entry.progress * 100)}%` }),
              )
            : null,
        ),
      ),
    );
  }

  private renderActions(w: World, manual: boolean, busy: boolean): void {
    this.actionSlot.replaceChildren(
      createSwitch({
        on: "Manual",
        off: "Route",
        checked: manual,
        key: "R",
        reason: busy ? TURN_PLAYING : null,
        title: "Manual drives straight at the point, route follows the roads [R]",
        onclick: () => this.actions.toggleManual(),
      }),
      createSwitch({
        on: "Patch",
        off: "Off",
        checked: w.player.autoRepair,
        key: "P",
        reason: busy ? TURN_PLAYING : null,
        title: "Patch damaged parts while parked [P]",
        onclick: () => this.actions.toggleAutoRepair(),
      }),
      ...this.engineButtons(w, busy),
      this.characterButton(w, busy),
    );
  }

  flushHorn(): void {
    this.dialogue.flushHorn();
  }

  pushEvents(w: World): void {
    const lines: LogLine[] = [];
    for (const e of w.events) {
      const line = eventText(w, e);
      if (!line) continue;
      lines.push(line);
      if (e.t === "skillUp" || e.t === "discover") this.toast(line.text);
    }
    this.log.add(w.turn, lines);
    this.radio.hear(w);
  }

  logTexts(): string[] {
    return this.log.texts;
  }

  note(w: World, text: string, cls: string): void {
    this.log.add(w.turn, [{ text, cls }]);
  }

  private aimOf(w: World, v: Vehicle): ConditionAim | undefined {
    if (v.id === playerVehicle(w).id) return undefined;
    if (this.actions.aimState(v.id).locked) return undefined;
    return { marks: aimMarks(w, v.id), pick: (partId) => this.actions.aimPart(v.id, partId) };
  }

  showInfo(w: World, v: Vehicle | null, hostile: boolean): void {
    if (!v) {
      this.info.style.display = "none";
      return;
    }
    this.inspected.render(v, this.aimOf(w, v));
    this.info.style.display = "";
    this.infoBody.replaceChildren(
      infoHead(v, hostile),
      el("div", { class: "info-state" }, formatVehicleState(w, v)),
      ...quietLines(w, v).map((line) => el("div", { class: "info-state info-quiet" }, line)),
      el("div", { class: "info-body" }, this.inspectedDraw, this.infoColumn),
    );
    this.placeInfo();
  }
}

function rescueOf<K extends RescueReadout["kind"]>(r: RescueReadout | null, kind: K): Extract<RescueReadout, { kind: K }> | null {
  return r?.kind === kind ? (r as Extract<RescueReadout, { kind: K }>) : null;
}

function infoHead(v: Vehicle, hostile: boolean): HTMLElement {
  const quiet = [v.brain ? v.name : null, v.faction].filter((part) => part !== null).join(", ");
  return el(
    "div",
    { class: "info-head" },
    el("span", { class: "info-name" }, v.brain ? v.brain.driver : v.name),
    el("span", { class: "info-quiet" }, quiet),
    ...(v.faction === "player" ? [] : [el("span", { class: `tag ${hostile ? "bad" : "dim"}` }, hostile ? "hostile" : "neutral")]),
  );
}

function quietLines(w: World, v: Vehicle): string[] {
  if (!v.brain) return [];
  return [formatNpcTraits(w, v), formatNpcCargo(w, v), formatNpcMark(w, v)].filter((line) => line !== null);
}

function shownWork(action: ContextAction | null, work: Work | null): Work | null {
  const blocks = work?.from === "job" && !isAutoPatch(work.job);
  return action && !action.hint && !blocks ? null : work;
}
