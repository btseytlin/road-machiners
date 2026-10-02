// The fullscreen death screen. A dead run takes no more turns or commands, so it covers the whole game.
// Load save opens the Load panel, and New game reloads the page with a boot request that deletes the autosaves.

import { el, panel } from "./dom";
import { startNewGame } from "./game-menu";
import { SavePanel, type SavePanelActions } from "./save-panel";
import type { BootRequest } from "../three/save-slots";

export type DeathActions = SavePanelActions & {
  hasSave: () => boolean;
  reboot: (request: BootRequest) => void;
};

export class DeathScreen {
  private root: HTMLElement | null = null;

  private savePanel: SavePanel;

  constructor(private actions: DeathActions) {
    this.savePanel = new SavePanel(actions);
  }

  isShown(): boolean {
    return this.root !== null;
  }

  show(): void {
    if (this.root) return;
    const saved = this.actions.hasSave();
    this.root = panel("death");
    this.root.setAttribute("role", "alertdialog");
    this.root.setAttribute("aria-label", "You died");
    this.root.append(
      el("h3", {}, "You died"),
      el("div", { class: "dim" }, "The life of a great machiner has ended"),
      el(
        "div",
        { class: "death-buttons" },
        el("button", { onclick: () => this.savePanel.openLoad(), disabled: !saved }, "Load save"),
        el("button", { onclick: () => startNewGame(this.actions.reboot) }, "New game"),
      ),
    );
  }
}
