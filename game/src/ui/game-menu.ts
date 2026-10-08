// Save, load and new game buttons. Save and Load open the slot panels. Load and new game reload the page, and boot reads the request they leave.

import { CONFIRM_NEW_GAME } from "./save-screen";
import type { BootRequest } from "../three/save-slots";
import { el, panel, topRight } from "./dom";
import { SavePanel, type SavePanelActions } from "./save-panel";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  requestBoot: (request: BootRequest) => void;
};

export function startNewGame(requestBoot: (request: "new") => void): void {
  requestBoot("new");
  window.location.reload();
}

export class GameMenu {
  private root = panel("game-menu", topRight());
  private saveButton = el("button", { onclick: () => this.savePanel.openSave() }, "Save") as HTMLButtonElement;
  private loadButton = el("button", { onclick: () => this.savePanel.openLoad() }, "Load") as HTMLButtonElement;
  private newButton = el("button", { onclick: () => this.newGame() }, "New game") as HTMLButtonElement;
  private savePanel: SavePanel;

  constructor(private actions: GameMenuActions, private isBusy: () => boolean) {
    this.savePanel = new SavePanel(actions);
    this.root.append(this.saveButton, this.loadButton, this.newButton);
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
    if (!window.confirm(CONFIRM_NEW_GAME)) return;
    startNewGame(this.actions.requestBoot);
  }
}
