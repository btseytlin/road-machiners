// The New game screen, the one way to start a new game from the menu, the death screen and the boot save screen. The
// player picks a game mode and may change its world settings. Nothing is written until Start: Start confirms, leaves
// a boot request with the picked setup and reloads, and boot then deletes the autosaves and builds the world.

import { GAME_MODES, WORLD_SETTINGS } from "../data/modes";
import { defaultSetup, parseSetup, percent } from "../sim/settings";
import type { GameModeId, WorldSettings, WorldSetup } from "../sim/types";
import type { BootRequest } from "../three/save-slots";
import { el, panel } from "./dom";

export const CONFIRM_NEW_GAME = "Start a new game? The autosaves are deleted. Your save slots stay.";

export type NewGameActions = {
  requestBoot: (request: BootRequest) => void;
  reload: () => void;
  confirm: (text: string) => boolean;
};

type SettingId = keyof WorldSettings;
const SETTING_IDS = Object.keys(WORLD_SETTINGS) as SettingId[];
const MODE_IDS = Object.keys(GAME_MODES) as GameModeId[];

export function browserNewGame(requestBoot: (request: BootRequest) => void): NewGameActions {
  return { requestBoot, reload: () => window.location.reload(), confirm: (text) => window.confirm(text) };
}

let shown: NewGameScreen | null = null;

export function isNewGameOpen(): boolean {
  return shown !== null;
}

export function openNewGame(actions: NewGameActions, onClose: () => void): void {
  if (shown) return;
  shown = new NewGameScreen(actions, onClose);
}

class NewGameScreen {
  private draft: WorldSetup = defaultSetup("roaming");
  private readonly opener = document.activeElement as HTMLElement | null;
  private readonly block = panel("new-game-block");
  private readonly root = panel("new-game");
  private readonly modes = el("div", { class: "mode-list", role: "radiogroup", "aria-label": "Game mode" });
  private readonly settingsButton = el("button", { class: "settings-toggle", "aria-expanded": "false", onclick: () => this.toggleSettings() }, "World Settings");
  private readonly settings = el("div", { class: "world-settings", hidden: true });
  private readonly startButton = el("button", { class: "start", onclick: () => this.start() }, "Start");
  private readonly onKey = (e: Event) => {
    if ((e as KeyboardEvent).code !== "Escape") return;
    e.stopPropagation();
    this.close();
  };

  constructor(private actions: NewGameActions, private onClose: () => void) {
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", "New game");
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if ((e as KeyboardEvent).code === "Tab") this.wrapFocus(e as KeyboardEvent);
    });
    this.root.append(
      el("h3", {}, "New game"),
      this.modes,
      this.settingsButton,
      this.settings,
      el("div", { class: "new-game-buttons" }, el("button", { class: "back", onclick: () => this.close() }, "Back"), this.startButton),
    );
    this.render();
    window.addEventListener("keydown", this.onKey, true);
    this.startButton.focus();
  }

  private render(): void {
    this.modes.replaceChildren(...MODE_IDS.map((id) => this.modeCard(id)));
    this.settings.replaceChildren(
      ...SETTING_IDS.map((id) => this.settingRow(id)),
      el("button", { class: "reset", onclick: () => this.reset() }, "Reset to defaults"),
    );
  }

  private modeCard(id: GameModeId): HTMLElement {
    const selected = this.draft.mode === id;
    const mode = GAME_MODES[id];
    return el(
      "button",
      { class: `mode-card${selected ? " selected" : ""}`, role: "radio", "aria-checked": String(selected), "data-mode": id, onclick: () => this.pickMode(id) },
      el("b", {}, mode.name),
      el("span", {}, mode.description),
    );
  }

  private settingRow(id: SettingId): HTMLElement {
    const def = WORLD_SETTINGS[id];
    const value = this.draft.settings[id];
    const label = el("span", { class: "setting-value" }, percent(value));
    const input = el("input", {
      type: "range", id: `setting-${id}`, min: def.min, max: def.max, step: def.step, value,
      "aria-valuetext": percent(value),
      oninput: (e) => {
        const next = Number((e.target as HTMLInputElement).value);
        this.draft.settings[id] = next;
        label.textContent = percent(next);
        input.setAttribute("aria-valuetext", percent(next));
      },
    });
    return el(
      "div",
      { class: "setting-row", "data-setting": id },
      el("label", { for: `setting-${id}` }, el("b", {}, def.name), label, el("span", { class: "dim" }, `default ${percent(def.default)}`)),
      el("div", { class: "dim" }, def.description),
      el("div", { class: "setting-input" }, el("span", { class: "dim" }, percent(def.min)), input, el("span", { class: "dim" }, percent(def.max))),
    );
  }

  private wrapFocus(e: KeyboardEvent): void {
    const controls = [...this.root.querySelectorAll<HTMLElement>("button, input")].filter((c) => c.offsetParent !== null);
    const edge = e.shiftKey ? controls[0] : controls[controls.length - 1];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    (e.shiftKey ? controls[controls.length - 1] : controls[0]).focus();
  }

  private pickMode(id: GameModeId): void {
    if (this.draft.mode === id) return;
    this.draft = defaultSetup(id);
    this.render();
  }

  private toggleSettings(): void {
    const open = this.settings.hidden;
    this.settings.hidden = !open;
    this.settingsButton.setAttribute("aria-expanded", String(open));
  }

  private reset(): void {
    this.draft = defaultSetup(this.draft.mode);
    this.render();
  }

  private start(): void {
    if (!this.actions.confirm(CONFIRM_NEW_GAME)) return;
    this.actions.requestBoot({ new: parseSetup(this.draft) });
    this.actions.reload();
  }

  private close(): void {
    this.root.remove();
    this.block.remove();
    window.removeEventListener("keydown", this.onKey, true);
    shown = null;
    this.opener?.focus();
    this.onClose();
  }
}
