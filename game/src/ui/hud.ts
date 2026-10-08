// Vehicle instruments, critical resources, event history and inspection.

import { DialoguePanel, type DialogueHost } from "./dialogue";
import type { Vehicle, World } from "../sim/types";
import { workOf, type Work } from "../sim/states";
import { isAutoPatch } from "../sim/jobs";
import type { SpeedRow } from "./hud-readout";
import { bottomLeft, el, isBrowserChord, overlaps, panel, rightDock, topLeft, topRight } from "./dom";
import { LogPanel } from "./log";
import {
  heldContractDue,
  contractSummary,
  eventText,
  formatNpcActivity,
  workLabel,
  workProgress,
  formatNpcCargo,
  formatNpcMark,
  formatNpcStates,
  formatNpcTraits,
  type LogLine,
} from "./format";
import { bugReportUrl, featureRequestUrl, getHudReadout, getRescueReadout, overdriveSwitch, versionLabel, type RescueReadout } from "./hud-readout";
import { createIcon, createSpeedDial } from "./cards";
import { aimLine, aimMarks, type AimState } from "./weapons";
import { createSwitch } from "./switch";
import { Tips } from "./tips";
import { kph, moneyMsg } from "./units";
import { playerVehicle } from "../sim/damage";
import { affordableRanks, pendingPerkPairs } from "../sim/progress";
import { canDouse } from "../sim/engine-heat";
import { ENGINE_HEAT } from "../data/wear";
import type { RadioPanel } from "./radio";
import { type ConditionAim, TruckConditionView } from "./truck-condition-view";
import { bindAttr, say, setText } from "../text/language";
import { num, t, type Msg } from "../text/msg";
import { driverName, factionName, setupText, templateName, vehicleTitle } from "../text/names";

export type ContextTarget =
  | { kind: 'aid'; id: string }
  | { kind: 'trade'; id: string }
  | { kind: 'shop' }
  | { kind: 'downed'; id: string }
  | { kind: 'oasis' }
  | { kind: 'stock'; id: string }
  | { kind: 'loot'; id: string }
  | { kind: 'empty' };
export type ContextAction = { label: Msg; ready: boolean; target: ContextTarget; hint?: Msg; combat?: number };

export function contextKey(target: ContextTarget): string {
  return 'id' in target ? `${target.kind}:${target.id}` : target.kind;
}

function actionTitle(action: ContextAction): Msg | undefined {
  if (action.hint) return action.hint;
  if (action.combat !== undefined) return combatBlocked(action.combat);
  return action.ready ? undefined : t("hud.stopToUse");
}

export const combatBlocked = (turns: number): Msg => t("hud.combatBlocked", { n: turns });

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
  isBusy: () => boolean;
  autoTravel: () => boolean;
  dialogue: DialogueHost;
  recenter: () => void;
  aimPart: (vehicleId: string, partId: string) => void;
  aimBody: (vehicleId: string) => void;
  aimState: (vehicleId: string) => AimState;
};
// Centered keeps the truck in the middle of the screen. Auto shifts the view ahead of it.
export type CameraMode = "centered" | "auto";

const TOAST_MS = 3500;

export class MaxSpeedView {
  private readonly text = el('span', { class: 'speed-max-text' });
  private readonly rows = el('div', { class: 'speed-rows' });
  private readonly notes = el('div', { class: 'speed-notes' });
  readonly root = el(
    'span',
    { class: 'speed-max', tabindex: 0, 'aria-describedby': 'speed-breakdown' },
    this.text,
    el('div', { class: 'speed-tip', id: 'speed-breakdown', role: 'tooltip' }, this.rows, this.notes),
  );

  private shown = '';

  render(maxSpeed: number, rows: SpeedRow[], notes: Msg[]): void {
    setText(this.text, t("hud.maxSpeed", { n: maxSpeed }));
    // The breakdown changes rarely, so most refreshes leave its nodes alone.
    const key = JSON.stringify([rows, notes]);
    if (key === this.shown) return;
    this.shown = key;
    this.rows.replaceChildren(
      ...rows.map((row) =>
        el('div', { class: `speed-row${row.total ? ' total' : ''}` }, el('span', {}, row.label), el('span', {}, row.effect), el('span', {}, num(row.kph, 'int'))),
      ),
    );
    this.notes.replaceChildren(...notes.map((note) => el('p', {}, note)));
  }
}

export class Hud {
  private top = panel("instruments", bottomLeft());
  private clockSlot = el("div", { class: "instrument-clock", role: "timer", title: t("hud.clockTitle") });
  private dialSlot = el("div", { class: "speed-dial-slot" });
  private maxSpeed = new MaxSpeedView();
  private speedSlot = el("div", { class: "speedometer" }, this.dialSlot, this.maxSpeed.root);
  private readoutSlot = el("div", { class: "readouts" });
  private actionSlot = el("div", { class: "instrument-actions" });
  private condition = new TruckConditionView();
  private inspected = new TruckConditionView();
  private contracts = panel("contracts", rightDock());
  private log = new LogPanel();
  private info = panel("info");
  private infoBody = el("div");
  private feedback = panel("feedback", topLeft());
  private action = panel("action");
  private toastBox = panel("toast");
  private rescue = panel("rescue");
  private stranded = panel("stranded", this.condition.root);
  private recenter = panel("recenter", bottomLeft());
  private cameraSwitch = panel("camera-mode", topRight());
  private tips = new Tips(window.localStorage);
  cameraMode: CameraMode = "auto";
  private toastTimer: number | null = null;

  private readonly dialogue: DialoguePanel;

  private keepRadioClear = (): void => {
    const shown = this.info.style.display !== "none";
    const away = shown && overlaps(this.info.getBoundingClientRect(), this.radio.root.getBoundingClientRect());
    this.radio.root.classList.toggle("away", away);
  };

  constructor(private actions: HudActions, private radio: RadioPanel) {
    bottomLeft().append(this.condition.root);
    this.dialogue = new DialoguePanel(actions.dialogue);
    this.info.style.display = "none";
    this.info.append(this.infoBody);
    this.contracts.style.display = "none";
    const observer = new ResizeObserver(this.keepRadioClear);
    observer.observe(this.info);
    observer.observe(rightDock());
    window.addEventListener("resize", this.keepRadioClear);
    this.toastBox.style.display = "none";
    this.rescue.style.display = "none";
    this.stranded.style.display = "none";
    this.recenter.style.display = "none";
    this.recenter.append(el("button", { onclick: () => actions.recenter() }, t("hud.recenter")));
    this.showCameraMode();
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyV" && !isBrowserChord(e) && !document.activeElement?.matches("input, select, textarea")) this.toggleCameraMode();
    });
    const setup = say(setupText(this.actions.dialogue.world().setup));
    const feedbackMenu = el("details", {});
    const feedbackLink = (href: string, text: Msg) =>
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
        { title: t("hud.feedbackTitle"), "aria-label": t("hud.feedbackTitle") },
        t("hud.feedbackMark"),
      ),
      feedbackLink(bugReportUrl(`${versionLabel()}, ${setup}`), t("hud.reportBug")),
      feedbackLink(featureRequestUrl(), t("hud.requestFeature")),
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
        on: t("hud.camAuto"),
        off: t("hud.camCentered"),
        checked: this.cameraMode === "auto",
        key: "V",
        title: t("hud.camTitle"),
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

  private toast(text: Msg): void {
    setText(this.toastBox, text);
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

  private renderWork(work: Work, label: Msg): void {
    const progress = Math.round(workProgress(work) * 100);
    this.action.replaceChildren(
      el(
        "span",
        { class: "job-label" },
        t("hud.workLeft", { label, n: work.turnsLeft }),
      ),
      el(
        "span",
        {
          class: "job-bar",
          role: "progressbar",
          "aria-label": t("hud.workProgress", { label }),
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
        onclick: onUse,
        disabled: !action.ready,
        class: action.combat !== undefined ? "combat" : "",
        title: actionTitle(action),
      },
      action.hint ? action.label : t("hud.actionKey", { label: action.label }),
    );
    // With several actions in reach, arrow buttons and a count show that the arrow keys choose between them.
    const cycle = (step: 1 | -1, glyph: Msg, key: string) =>
      el("button", { class: "cycle", title: t("hud.cycleKey", { key }), onclick: () => onCycle(step) }, glyph);
    this.action.replaceChildren(
      ...(count > 1
        ? [cycle(-1, t("hud.prevMark"), "←"), use, el("span", { class: "count" }, t("hud.count", { n: index + 1, of: count })), cycle(1, t("hud.nextMark"), "→")]
        : [use]),
    );
  }

  renderRescue(w: World): void {
    this.dialogue.render(w);
    const r = getRescueReadout(w);
    this.renderMiddle(r?.kind === "stranded" ? null : r);
    this.renderStranded(r?.kind === "stranded" ? r : null);
  }

  private renderMiddle(r: Exclude<RescueReadout, { kind: "stranded" }> | null): void {
    this.rescue.style.display = r ? "" : "none";
    if (!r) return this.rescue.replaceChildren();
    if (r.kind === "knockedOut")
      return this.rescue.replaceChildren(el("h3", { class: "bad" }, t("hud.knockedOut")));
    this.rescue.replaceChildren(
      el("h3", {}, t("hud.underTow")),
      el("div", {}, t("hud.towsYou", { who: r.tower, town: r.town })),
      el("div", { class: "dim" }, t("hud.towFee", { fee: moneyMsg(r.fee) })),
      el(
        "div",
        { class: "rescue-buttons" },
        el("button", { onclick: () => this.actions.unhitch() }, t("hud.unhitch")),
      ),
    );
  }

  private renderStranded(r: Extract<RescueReadout, { kind: "stranded" }> | null): void {
    this.stranded.style.display = r ? "" : "none";
    if (!r) return this.stranded.replaceChildren();
    this.stranded.replaceChildren(
      el("h3", {}, t("hud.stranded")),
      el("div", { class: "dim" }, r.beacon ? t("hud.callingTow") : r.reason),
      el(
        "div",
        { class: "rescue-buttons" },
        createSwitch({
          on: t("hud.beaconOn"),
          off: t("hud.beaconOff"),
          checked: r.beacon,
          title: t("hud.beaconTitle"),
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
      el("h3", {}, t("hud.contracts")),
      ...w.player.contracts.map((c) =>
        el(
          "div",
          { class: "contract-line" },
          t("hud.contractLine", { what: contractSummary(c), due: heldContractDue(c) }),
        ),
      ),
    );
  }

  private engineButtons(w: World, busy: boolean): HTMLElement[] {
    const od = overdriveSwitch(w);
    const headlights = createSwitch({
      on: t("hud.lightsOn"),
      off: t("hud.lightsOff"),
      checked: this.actions.headlightsOn(),
      key: "L",
      title: t("hud.lightsTitle"),
      onclick: () => this.actions.toggleHeadlights(),
    });
    const overdrive = createSwitch({
      on: t("hud.overdrive"),
      off: t("hud.normal"),
      checked: od.checked,
      key: "O",
      disabled: busy || od.blocked,
      title: od.title,
      onclick: () => this.actions.toggleOverdrive(),
    });
    const douse = el(
      "button",
      {
        class: "instrument-button",
        disabled: busy || !canDouse(w),
        onclick: () => this.actions.douseEngine(),
        title: t("hud.douseTitle", { n: ENGINE_HEAT.douseSupplies }),
      },
      t("hud.douse"),
    );
    return [headlights, overdrive, douse];
  }

  private characterButton(w: World, busy: boolean): HTMLElement {
    const marked = pendingPerkPairs(w).length > 0 || affordableRanks(w).length > 0;
    return el(
      "button",
      {
        class: "instrument-button",
        disabled: busy,
        onclick: () => this.actions.openCharacter(),
        title: marked ? t("hud.characterMarked") : t("hud.character"),
      },
      createIcon("driver"),
      marked ? t("hud.characterKeyMarked") : t("hud.characterKey"),
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

  private renderClock(clock: ReturnType<typeof getHudReadout>["clock"]): void {
    bindAttr(this.clockSlot, "aria-label", t("hud.clockLabel", { when: clock.full }));
    this.clockSlot.replaceChildren(el("span", { class: "clock-day" }, clock.day), el("span", { class: "clock-time" }, clock.time));
  }

  private renderSpeedometer(readout: ReturnType<typeof getHudReadout>, busy: boolean): void {
    const dial = el(
      "button",
      {
        class: "truck-instrument",
        title: t("hud.inventoryTitle"),
        "aria-label": t("hud.inventoryLabel"),
        disabled: busy,
        onclick: () => this.actions.openInventory(),
      },
      createSpeedDial(readout.speed, readout.maxSpeed),
      el("span", { class: "speed-value" }, num(readout.speed, "int")),
      createIcon("truck"),
    );
    this.dialSlot.replaceChildren(dial);
    this.maxSpeed.render(readout.maxSpeed, readout.maxSpeedRows, readout.maxSpeedNotes);
  }

  private renderReadouts(readout: ReturnType<typeof getHudReadout>): void {
    this.readoutSlot.replaceChildren(
      ...readout.resources.map((resource) =>
        el(
          "span",
          {
            class: `resource ${resource.warning ? "bad" : ""}`,
            title: resource.label,
            "aria-label": resource.warning ? t("hud.readoutWarning", { label: resource.label, value: resource.value }) : t("hud.readout", { label: resource.label, value: resource.value }),
            "data-resource": resource.id,
          },
          el("small", {}, resource.label),
          el("strong", {}, resource.warning ? t("hud.warned", { value: resource.value }) : resource.value),
        ),
      ),
      ...readout.survival.map((entry) =>
        el(
          "span",
          {
            class: `resource ${entry.warning ? "bad" : ""}`,
            title: entry.label,
            "data-resource": entry.id,
          },
          el("small", {}, entry.label),
          el("strong", {}, entry.value),
          entry.progress !== undefined
            ? el(
                "span",
                {
                  class: "job-bar",
                  role: "progressbar",
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
        on: t("hud.manual"),
        off: t("hud.route"),
        checked: manual,
        key: "R",
        disabled: busy,
        title: t("hud.manualTitle"),
        onclick: () => this.actions.toggleManual(),
      }),
      createSwitch({
        on: t("hud.autoPatch"),
        off: t("hud.noPatch"),
        checked: w.player.autoRepair,
        key: "P",
        disabled: busy,
        title: t("hud.autoPatchTitle"),
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
      if (e.t === "knockout" || e.t === "skillUp" || e.t === "discover") this.toast(line.text);
    }
    this.log.add(w.turn, lines);
    this.radio.hear(w);
  }

  logTexts(): string[] {
    return this.log.texts;
  }

  // A log line from the UI itself, not from a sim event.
  note(w: World, text: Msg, cls: string): void {
    this.log.add(w.turn, [{ text, cls }]);
  }

  private aimOf(w: World, v: Vehicle): ConditionAim | undefined {
    if (v.id === playerVehicle(w).id) return undefined;
    if (this.actions.aimState(v.id).locked) return undefined;
    return { marks: aimMarks(w, v.id), pick: (partId) => this.actions.aimPart(v.id, partId) };
  }

  // The aim line above the diagram, for another truck only.
  private aimControls(w: World, v: Vehicle): HTMLElement[] {
    if (v.id === playerVehicle(w).id) return [];
    const line = aimLine(this.actions.aimState(v.id), () => this.actions.aimBody(v.id));
    return line ? [line] : [];
  }

  showInfo(w: World, v: Vehicle | null, hostile: boolean): void {
    if (!v) {
      this.info.style.display = "none";
      return;
    }
    this.inspected.render(v, this.aimOf(w, v));
    this.info.style.display = "";
    this.infoBody.replaceChildren(
      ...infoHeading(w, v),
      el("div", { class: hostile ? "bad" : "dim" }, stanceText(v, hostile)),
      el("div", {}, t("hud.speed", { n: kph(v.speed) })),
      ...npcLines(w, v),
      ...this.aimControls(w, v),
      this.inspected.root,
    );
  }
}

// A truck's faction and how it stands toward the player.
function stanceText(v: Vehicle, hostile: boolean): Msg {
  const faction = factionName(v.faction);
  if (v.faction === "player") return faction;
  return hostile ? t("hud.hostile", { faction }) : t("hud.neutral", { faction });
}

// An NPC reads as its driver's name, what it is doing now, then its template name. The player's truck keeps its own
// name.
function infoHeading(w: World, v: Vehicle): HTMLElement[] {
  if (!v.brain) return [el("h3", {}, vehicleTitle(w, v))];
  const activity = formatNpcActivity(w, v);
  return [
    el("h3", {}, driverName(v)),
    ...(activity ? [el("div", { class: "npc-activity" }, activity)] : []),
    el("div", { class: "dim" }, templateName(v.brain.templateId)),
  ];
}

function npcLines(w: World, v: Vehicle): HTMLElement[] {
  if (!v.brain) return [];
  const traits = formatNpcTraits(w, v);
  const cargo = formatNpcCargo(w, v);
  const mark = formatNpcMark(w, v);
  return [
    ...(traits ? [el("div", { class: "npc-traits" }, traits)] : []),
    ...(cargo ? [el("div", { class: "npc-cargo" }, cargo)] : []),
    ...(mark ? [el("div", { class: "npc-mark" }, mark)] : []),
    ...formatNpcStates(w, v).map((line) =>
      el("div", { class: "npc-state" }, line),
    ),
  ];
}

function shownWork(action: ContextAction | null, work: Work | null): Work | null {
  const blocks = work?.from === "job" && !isAutoPatch(work.job);
  return action && !action.hint && !blocks ? null : work;
}
