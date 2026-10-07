// Save, load and new game buttons, and the language control. Save and Load open the slot panels. Load and new game reload the page, and boot reads the request they leave.

import { CONFIRM_NEW_GAME } from "./save-screen";
import type { BootRequest } from "../three/save-slots";
import { language, say } from "../text/language";
import { LanguageSwitch } from "./language-switch";
import { t } from "../text/msg";
import { el, panel, topRight } from "./dom";
import { SavePanel, type SavePanelActions } from "./save-panel";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  requestBoot: (request: BootRequest) => void;
};

// A new game is a page reload with a boot request. Boot deletes the autosaves and keeps the manual slots.
export function startNewGame(requestBoot: (request: "new") => void): void {
  requestBoot("new");
  window.location.reload();
}

export class GameMenu {
  private root = panel("game-menu", topRight());
  private saveButton = el("button", { onclick: () => this.savePanel.openSave() }, t("menu.save")) as HTMLButtonElement;
  private loadButton = el("button", { onclick: () => this.savePanel.openLoad() }, t("menu.load")) as HTMLButtonElement;
  private newButton = el("button", { onclick: () => this.newGame() }, t("menu.newGame")) as HTMLButtonElement;
  private savePanel: SavePanel;

  constructor(private actions: GameMenuActions, private isBusy: () => boolean) {
    this.savePanel = new SavePanel(actions);
    this.root.append(this.saveButton, this.loadButton, this.newButton);
    // The language control is the menu's last row, so it works in play and over any open screen.
    new LanguageSwitch(this.root, language());
    this.refresh();
  }

  isPanelOpen(): boolean {
    return this.savePanel.isOpen();
  }

  refresh(): void {
    const busy = this.isBusy();
    this.saveButton.disabled = busy;
    this.loadButton.disabled = busy || !this.actions.hasSave();
    this.newButton.disabled = busy;
  }

  private newGame(): void {
    if (!window.confirm(say(CONFIRM_NEW_GAME))) return;
    startNewGame(this.actions.requestBoot);
  }
}
