// Vehicle instruments, critical resources, event history and inspection.

import { DialoguePanel, type DialogueHost } from "./dialogue";
import type { Vehicle, World } from "../sim/types";
import { workOf, type Work } from "../sim/states";
import { isAutoPatch } from "../sim/jobs";
import { el, panel, topLeft, topRight } from "./dom";
import {
  contractDue,
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
import { bugReportUrl, featureRequestUrl, getHudReadout, getRescueReadout, moneyLabel, versionLabel, type RescueReadout } from "./hud-readout";
import { createIcon, createSpeedDial } from "./cards";
import { aimMarks } from "./weapons";
import { createSwitch } from "./switch";
import { Tips } from "./tips";
import { kph } from "./units";
import { playerVehicle } from "../sim/damage";
import { pendingPerkPairs } from "../sim/progress";
import { canDouse } from "../sim/engine-heat";
import { ENGINE_HEAT } from "../data/wear";
import { type ConditionAim, TruckConditionView } from "./truck-condition-view";

// The E key action. ready is false while the truck must stop first.
// A hint marks an action that can never run here, and says why. combat is the turns of combat left when it blocks the action.
export type ContextAction = { label: string; ready: boolean; hint?: string; combat?: number };

export const combatBlocked = (turns: number): string => `Can't do this while in combat, ${turns} turns left`;

type HudActions = {
  openInventory: () => void;
  openCharacter: () => void;
  toggleManual: () => void;
  toggleAutoRepair: () => void;
  toggleOverdrive: () => void;
  douseEngine: () => void;
  unhitch: () => void;
  setBeacon: (on: boolean) => void;
  isBusy: () => boolean;
  autoTravel: () => boolean;
  dialogue: DialogueHost;
  recenter: () => void;
  aimPart: (vehicleId: string, partId: string) => void;
};
// Centered keeps the truck in the middle of the screen. Auto shifts the view ahead of it.
export type CameraMode = "centered" | "auto";

const LOG_LINES = 14;
const TOAST_MS = 3500;

const WEATHER_NAMES: Record<World["weather"][number]["kind"], string> = {
  storm: "Storm",
  heatwave: "Heat wave",
  overcast: "Overcast",
};

function weatherLabel(w: World): string {
  if (w.weather.length === 0) return "Clear";
  return [...new Set(w.weather.map((e) => WEATHER_NAMES[e.kind]))].join(", ");
}

// A log line led by the turn it happened on.
function turnStamped(turn: number, line: LogLine): LogLine {
  const stamp = `T${turn} `;
  return { ...line, text: stamp + line.text, spans: line.spans && [{ text: stamp, cls: "" }, ...line.spans] };
}

export class Hud {
  private top = panel("instruments");
  private condition = new TruckConditionView();
  private inspected = new TruckConditionView();
  private contracts = panel("contracts");
  private log = panel("log");
  private info = panel("info");
  private infoBody = el("div");
  private help = panel("help", topLeft());
  private feedback = panel("feedback", topLeft());
  private action = panel("action");
  private toastBox = panel("toast");
  private rescue = panel("rescue");
  // Stands on top of the part condition panel.
  private stranded = panel("stranded", this.condition.root);
  // Shows only while a pan has left the truck.
  private recenter = panel("recenter");
  private cameraSwitch = panel("camera-mode", topRight());
  private tips = new Tips(window.localStorage);
  cameraMode: CameraMode = "auto";
  private toastTimer: number | null = null;
  private lines: LogLine[] = [];

  private readonly dialogue: DialoguePanel;

  constructor(private actions: HudActions) {
    this.dialogue = new DialoguePanel(actions.dialogue);
    this.info.style.display = "none";
    this.info.append(this.infoBody);
    this.contracts.style.display = "none";
    this.toastBox.style.display = "none";
    this.rescue.style.display = "none";
    this.stranded.style.display = "none";
    this.recenter.style.display = "none";
    this.recenter.append(el("button", { onclick: () => actions.recenter() }, "Center on truck (F)"));
    this.showCameraMode();
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyV" && !document.activeElement?.matches("input, select, textarea")) this.toggleCameraMode();
    });
    this.log.replaceChildren(
      el("h3", {}, "Log"),
    );
    this.log.setAttribute("aria-label", "Event log");
    const guide = el(
      "details",
      {},
      el("summary", { title: "Driving and combat controls" }, "?"),
    );
    this.help.append(guide);
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
      feedbackLink(bugReportUrl(versionLabel()), "Report a bug"),
      feedbackLink(featureRequestUrl(), "Request a feature"),
    );
    this.feedback.append(feedbackMenu);
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Escape") return;
      guide.removeAttribute("open");
      feedbackMenu.removeAttribute("open");
    });
    guide.append(
      el("div", {}, "Click the ground: drive there by road. Shift-click: stop there."),
      el("div", {}, "Space: drive on or pause. Hold Space: fast-forward. Click your truck: brake."),
      el("div", {}, "R: manual driving, straight at the point."),
      el("div", {}, "Click a town or site: stop at its pad. E on a pad: trade, repair or loot."),
      el("div", {}, "T: radio the truck under the cursor. 1-9: reply. H: honk."),
      el("div", {}, "Click a truck: target it. 1-4: pick a weapon. 0: all. Q: auto fire. X: show weapons."),
      el("div", {}, "P: auto patch. C: character. I: inventory. Esc: close."),
      el("div", {}, "WASD or right-drag: pan. Wheel: zoom. F: center. V: camera. M: mute."),
      el("div", { class: "version" }, versionLabel()),
    );
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

  private toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.style.display = "";
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => (this.toastBox.style.display = "none"),
      TOAST_MS,
    );
  }

  // The context action for the E key, or hidden. An action that needs a stop first shows disabled.
  // Work shows its progress instead, except work that blocks no job, which yields to any action.
  renderAction(
    action: ContextAction | null,
    world: World,
    onUse: () => void,
  ): void {
    const me = playerVehicle(world);
    const shown = shownWork(action, workOf(world, me));
    this.action.style.display = action || shown ? "" : "none";
    if (shown) this.renderWork(shown, workLabel(world, me, shown));
    else if (action) this.renderActionButton(action, onUse);
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
          class: "job-bar",
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

  private renderActionButton(action: ContextAction, onUse: () => void): void {
    this.action.replaceChildren(
      el(
        "button",
        {
          onclick: onUse,
          disabled: !action.ready,
          class: action.combat !== undefined ? "combat" : "",
          title: action.hint ?? (action.combat !== undefined ? combatBlocked(action.combat) : action.ready ? "" : "Stop to use"),
        },
        action.hint ? action.label : `[E] ${action.label}`,
      ),
    );
  }

  // The rescue prompts: an open radio call and the knockout banner or tow in the middle of the screen,
  // and the beacon switch of a stranded truck above the part condition panel.
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
      return this.rescue.replaceChildren(el("h3", { class: "bad" }, "Knocked out"));
    this.rescue.replaceChildren(
      el("h3", {}, "Under tow"),
      el("div", {}, `${r.tower} tows you to ${r.town}.`),
      el("div", { class: "dim" }, `Fee ${moneyLabel(r.fee)} on arrival.`),
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
      el("div", { class: "dim" }, r.beacon ? "Calling for a tow." : r.reason),
      el(
        "div",
        { class: "rescue-buttons" },
        createSwitch({
          on: "Beacon on",
          off: "Beacon off",
          checked: r.beacon,
          title: "Call for a tow by radio.",
          onclick: () => this.actions.setBeacon(!r.beacon),
        }),
      ),
    );
  }

  // Compact list of held contracts and their due times. Hidden while the player holds none.
  private renderContracts(w: World): void {
    if (w.player.contracts.length === 0) {
      this.contracts.style.display = "none";
      return;
    }
    this.contracts.style.display = "";
    this.contracts.replaceChildren(
      el("h3", {}, "Contracts"),
      ...w.player.contracts.map((c) =>
        el(
          "div",
          { class: "contract-line" },
          `${contractSummary(c)} — ${contractDue(c)}`,
        ),
      ),
    );
  }

  // The character button, marked while a perk pair waits for a pick.
  private engineButtons(w: World, busy: boolean): HTMLElement[] {
    const overdrive = createSwitch({
      on: "Overdrive",
      off: "Normal",
      checked: w.player.overdrive,
      key: "O",
      disabled: busy,
      title: "Engine overdrive: faster, but the engine heats fast [O]",
      onclick: () => this.actions.toggleOverdrive(),
    });
    const douse = el(
      "button",
      {
        disabled: busy || !canDouse(w),
        onclick: () => this.actions.douseEngine(),
        title: `Pour ${ENGINE_HEAT.douseSupplies} supplies of water over the engine to cool it [G]`,
      },
      "Cool engine [G]",
    );
    return [overdrive, douse];
  }

  private characterButton(w: World, busy: boolean): HTMLElement {
    const perkOpen = pendingPerkPairs(w).length > 0;
    return el(
      "button",
      {
        disabled: busy,
        onclick: () => this.actions.openCharacter(),
        title: perkOpen ? "Driver and skills: a perk is ready to pick [C]" : "Driver and skills [C]",
      },
      createIcon("driver"),
      perkOpen ? "! [C]" : "[C]",
    );
  }

  renderTop(w: World): void {
    const readout = getHudReadout(w);
    const busy = this.actions.isBusy();
    this.condition.render(playerVehicle(w));
    this.renderContracts(w);
    this.tips.update(w, this.actions.autoTravel());
    this.top.replaceChildren(
      this.condition.root,
      el(
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
        el("span", { class: "speed-unit" }, `km/h, max ${readout.maxSpeed}`),
        createIcon("truck"),
      ),
      el(
        "div",
        { class: "readouts" },
        ...readout.resources.map((resource) =>
          el(
            "span",
            {
              class: `resource ${resource.warning ? "bad" : ""}`,
              title: resource.label,
              "aria-label": `${resource.label}: ${resource.value}${resource.warning ? ", warning" : ""}`,
              "data-resource": resource.label,
            },
            el("small", {}, resource.label),
            el("strong", {}, `${resource.warning ? "! " : ""}${resource.value}`),
          ),
        ),
        ...readout.survival.map((entry) =>
          el(
            "span",
            {
              class: `resource ${entry.warning ? "bad" : ""}`,
              title: entry.label,
              "data-resource": entry.label,
            },
            el("small", {}, entry.label),
            el("strong", {}, entry.value),
            "progress" in entry && entry.progress !== undefined
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
      ),
      el(
        "div",
        { class: "instrument-actions" },
        createSwitch({
          on: "Manual",
          off: "Route",
          checked: readout.manual,
          key: "R",
          disabled: busy,
          title: "Manual driving: straight at the point, or follow the roads [R]",
          onclick: () => this.actions.toggleManual(),
        }),
        createSwitch({
          on: "Auto patch",
          off: "No patch",
          checked: w.player.autoRepair,
          key: "P",
          disabled: busy,
          title: "Patch damaged parts while parked [P]",
          onclick: () => this.actions.toggleAutoRepair(),
        }),
        ...this.engineButtons(w, busy),
        this.characterButton(w, busy),
        ...(readout.broken
          ? [
              el(
                "span",
                { class: "bad", role: "status" },
                `! ${readout.broken} broken`,
              ),
            ]
          : []),
      ),
    );
  }

  // Sends a horn pressed during the turn that just ended.
  flushHorn(): void {
    this.dialogue.flushHorn();
  }

  pushEvents(w: World): void {
    for (const e of w.events) {
      const line = eventText(w, e);
      if (line)
        this.lines.unshift(turnStamped(w.turn, line));
      if (
        line &&
        (e.t === "knockout" || e.t === "skillUp" || e.t === "discover")
      )
        this.toast(line.text);
    }
    this.renderLog();
  }

  // A log line from the UI itself, not from a sim event.
  note(w: World, text: string, cls: string): void {
    this.lines.unshift({ text: `T${w.turn} ${text}`, cls });
    this.renderLog();
  }

  private renderLog(): void {
    this.lines = this.lines.slice(0, LOG_LINES);
    if (this.lines.length === 0) return;
    this.log.replaceChildren(
      el("h3", {}, "Log"),
      el(
        "div",
        { class: "log-lines", tabindex: 0 },
        ...this.lines.map((l) => el("div", { class: l.cls }, ...(l.spans ? l.spans.map((sp) => el("span", { class: sp.cls }, sp.text)) : [l.text]))),
      ),
    );
  }

  // Parts of another truck take clicks that aim the guns.
  private aimOf(w: World, v: Vehicle): ConditionAim | undefined {
    if (v.id === playerVehicle(w).id) return undefined;
    return { marks: aimMarks(w, v.id), pick: (partId) => this.actions.aimPart(v.id, partId) };
  }

  showInfo(w: World, v: Vehicle | null, hostile: boolean): void {
    if (!v) {
      this.info.style.display = "none";
      return;
    }
    this.inspected.render(v, this.aimOf(w, v));
    const stance =
      v.faction === "player" ? "" : hostile ? "hostile" : "neutral";
    this.info.style.display = "";
    this.infoBody.replaceChildren(
      ...infoHeading(w, v),
      el(
        "div",
        { class: hostile ? "bad" : "dim" },
        `${v.faction} ${stance}`.trim(),
      ),
      el("div", {}, `Speed ${kph(v.speed)} km/h`),
      ...npcLines(w, v),
      this.inspected.root,
      ...(this.aimOf(w, v) ? [el("div", { class: "dim" }, "Click a part to aim the selected gun at it")] : []),
    );
  }
}

// An NPC reads as its driver's name, what it is doing now, then its template name. The player's truck keeps its own
// name.
function infoHeading(w: World, v: Vehicle): HTMLElement[] {
  if (!v.brain) return [el("h3", {}, v.name)];
  const activity = formatNpcActivity(w, v);
  return [
    el("h3", {}, v.brain.driver),
    ...(activity ? [el("div", { class: "npc-activity" }, activity)] : []),
    el("div", { class: "dim" }, v.name),
  ];
}

// The NPC's traits, cargo and mark once perks show them, and the states it holds toward the player. The player's own
// truck has none.
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

// Work that blocks no job, like an auto patch or a patch deal, gives way to any usable context action, so the
// player can still act.
function shownWork(action: ContextAction | null, work: Work | null): Work | null {
  const blocks = work?.from === "job" && !isAutoPatch(work.job);
  return action && !action.hint && !blocks ? null : work;
}
