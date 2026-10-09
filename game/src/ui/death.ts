
import { abandonRun, canAbandonRun, outpostName, runEarnings } from "../sim/gauntlet";
import type { RunLossCause, World } from "../sim/types";
import { disabledWith, el, panel } from "./dom";
import { CONFIRM_NEW_GAME, openNewGame, type NewGameActions } from "./new-game";
import { SavePanel, type SavePanelActions } from "./save-panel";
import { distanceText } from "./units";

export type DeathActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

const NO_SAVE = "No saves yet";
const RUN_TITLE: Record<RunLossCause, string> = { wrecked: "Wrecked", abandoned: "Stranded" };
export const CONFIRM_END_RUN = "End the run here? It cannot be undone.";

export function confirmedEndRun(world: World): World | null {
  return canAbandonRun(world) && window.confirm(CONFIRM_END_RUN) ? abandonRun(world) : null;
}

export class DeathScreen {
  private root: HTMLElement | null = null;

  private savePanel: SavePanel;

  constructor(private actions: DeathActions) {
    this.savePanel = new SavePanel(actions);
  }

  isShown(): boolean {
    return this.root !== null;
  }

  show(world: World): void {
    if (this.root) return;
    const saved = this.actions.hasSave();
    const title = deathTitle(world);
    this.root = panel("death");
    this.root.setAttribute("role", "alertdialog");
    this.root.setAttribute("aria-label", title);
    this.root.append(
      el("h3", {}, title),
      ...runCaption(world),
      el(
        "div",
        { class: "death-buttons" },
        el("button", disabledWith(saved ? null : NO_SAVE, () => this.savePanel.openLoad()), "Load save"),
        world.gauntlet ? el("button", { onclick: () => this.restart(world) }, "Restart run") : null,
        el("button", { onclick: () => openNewGame(this.actions.newGame, () => {}) }, "New game"),
      ),
    );
  }

  private restart(world: World): void {
    const { newGame } = this.actions;
    if (!newGame.confirm(CONFIRM_NEW_GAME)) return;
    newGame.requestBoot({ new: world.setup });
    newGame.reload();
  }
}

function lossCause(world: World): RunLossCause {
  const lost = world.events.find((e) => e.t === "runLost");
  return lost?.t === "runLost" ? lost.cause : "wrecked";
}

function deathTitle(world: World): string {
  return world.gauntlet ? RUN_TITLE[lossCause(world)] : "You died";
}

function runCaption(world: World): HTMLElement[] {
  if (!world.gauntlet) return [];
  const { reached, north } = runEarnings(world);
  const where = reached > 0 ? `Reached ${outpostName(reached)}` : "Stretch 1";
  return [el("div", { class: "death-caption" }, `${where}, ${distanceText(north)} north`)];
}
