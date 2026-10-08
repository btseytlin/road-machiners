// The New game screen, the one way to start a new game from the menu, the death screen and the boot save screen. The
// player picks a game mode and may change its world settings. Nothing is written until Start: Start confirms, leaves
// a boot request with the picked setup and reloads, and boot then deletes the autosaves and builds the world.

import { GAME_MODES, WORLD_SETTINGS } from "../data/modes";
import { defaultSetup, parseSetup } from "../sim/settings";
import type { GameModeId, WorldSettings, WorldSetup } from "../sim/types";
import type { BootRequest } from "../three/save-slots";
import { bindAttr, say, setText } from "../text/language";
import { t, type Msg } from "../text/msg";
import { modeDescription, modeName, settingDescription, settingName } from "../text/names";
import { el, panel } from "./dom";

export const CONFIRM_NEW_GAME = t("save.confirmNew");

const share = (value: number): Msg => t("setting.percent", { n: Math.round(value * 100) });

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
  private readonly modes = el("div", { class: "mode-list", role: "radiogroup", "aria-label": t("newGame.mode") });
  private readonly settingsButton = el("button", { class: "settings-toggle", "aria-expanded": "false", onclick: () => this.toggleSettings() }, t("newGame.settings"));
  private readonly settings = el("div", { class: "world-settings", hidden: true });
  private readonly startButton = el("button", { class: "start", onclick: () => this.start() }, t("newGame.start"));
  private readonly onKey = (e: Event) => {
    if ((e as KeyboardEvent).code !== "Escape") return;
    e.stopPropagation();
    this.close();
  };

  constructor(private actions: NewGameActions, private onClose: () => void) {
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    bindAttr(this.root, "aria-label", t("menu.newGame"));
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if ((e as KeyboardEvent).code === "Tab") this.wrapFocus(e as KeyboardEvent);
    });
    this.root.append(
      el("h3", {}, t("menu.newGame")),
      this.modes,
      this.settingsButton,
      this.settings,
      el("div", { class: "new-game-buttons" }, el("button", { class: "back", onclick: () => this.close() }, t("newGame.back")), this.startButton),
    );
    this.render();
    window.addEventListener("keydown", this.onKey, true);
    this.startButton.focus();
  }

  private render(): void {
    this.modes.replaceChildren(...MODE_IDS.map((id) => this.modeCard(id)));
    this.settings.replaceChildren(
      ...SETTING_IDS.map((id) => this.settingRow(id)),
      el("button", { class: "reset", onclick: () => this.reset() }, t("newGame.reset")),
    );
  }

  private modeCard(id: GameModeId): HTMLElement {
    const selected = this.draft.mode === id;
    return el(
      "button",
      { class: `mode-card${selected ? " selected" : ""}`, role: "radio", "aria-checked": String(selected), "data-mode": id, onclick: () => this.pickMode(id) },
      el("b", {}, modeName(id)),
      el("span", {}, modeDescription(id)),
    );
  }

  private settingRow(id: SettingId): HTMLElement {
    const def = WORLD_SETTINGS[id];
    const value = this.draft.settings[id];
    const label = el("span", { class: "setting-value" }, share(value));
    const input = el("input", {
      type: "range", id: `setting-${id}`, min: def.min, max: def.max, step: def.step, value,
      "aria-valuetext": share(value),
      oninput: (e) => {
        const next = Number((e.target as HTMLInputElement).value);
        this.draft.settings[id] = next;
        setText(label, share(next));
        bindAttr(input, "aria-valuetext", share(next));
      },
    });
    return el(
      "div",
      { class: "setting-row", "data-setting": id },
      el("label", { for: `setting-${id}` }, el("b", {}, settingName(id)), label, el("span", { class: "dim" }, t("newGame.default", { pct: share(def.default) }))),
      el("div", { class: "dim" }, settingDescription(id)),
      el("div", { class: "setting-input" }, el("span", { class: "dim" }, share(def.min)), input, el("span", { class: "dim" }, share(def.max))),
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
    if (!this.actions.confirm(say(CONFIRM_NEW_GAME))) return;
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
