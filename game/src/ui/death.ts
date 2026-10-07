// The fullscreen death screen. A dead run takes no more turns or commands, so it covers the whole game.
// Load save opens the Load panel, and New game reloads the page with a boot request that deletes the autosaves.

import { bindAttr } from "../text/language";
import { t } from "../text/msg";
import { el, panel } from "./dom";
import { startNewGame } from "./game-menu";
import { SavePanel, type SavePanelActions } from "./save-panel";
import type { BootRequest } from "../three/save-slots";

export type DeathActions = SavePanelActions & {
  hasSave: () => boolean;
  requestBoot: (request: BootRequest) => void;
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
    bindAttr(this.root, "aria-label", t("death.title"));
    this.root.append(
      el("h3", {}, t("death.title")),
      el("div", { class: "dim" }, t("death.epitaph")),
      el(
        "div",
        { class: "death-buttons" },
        el("button", { onclick: () => this.savePanel.openLoad(), disabled: !saved }, t("menu.loadSave")),
        el("button", { onclick: () => startNewGame(this.actions.requestBoot) }, t("menu.newGame")),
      ),
    );
  }
}
