// The fullscreen death screen. A dead run takes no more turns or commands, so it covers the whole game.
// Load save opens the Load panel, and New game opens the New game screen over it.

import { abandonRun, canAbandonRun, runEarnings } from "../sim/fury-road";
import type { RunLossCause, World } from "../sim/types";
import { bindAttr, say } from "../text/language";
import { t, type Msg } from "../text/msg";
import { modeName, siteName } from "../text/names";
import { outpostId } from "../sim/highway";
import { disabledWith, el, panel } from "./dom";
import { CONFIRM_NEW_GAME, openNewGame, type NewGameActions } from "./new-game";
import { SavePanel, type SavePanelActions } from "./save-panel";
import { distanceText } from "./units";

export type DeathActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

const RUN_TITLE: Record<RunLossCause, Msg> = { wrecked: t("death.wrecked"), abandoned: t("death.stranded") };
export const CONFIRM_END_RUN = t("hud.confirmEndRun");

export function confirmedEndRun(world: World): World | null {
  return canAbandonRun(world) && window.confirm(say(CONFIRM_END_RUN)) ? abandonRun(world) : null;
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
    bindAttr(this.root, "aria-label", title);
    this.root.append(
      el("h3", {}, title),
      runCaption(world) ?? el("div", { class: "dim" }, t("death.epitaph")),
      el(
        "div",
        { class: "death-buttons" },
        el("button", disabledWith(saved ? null : t("save.none"), () => this.savePanel.openLoad()), t("menu.loadSave")),
        world.furyRoad ? el("button", { onclick: () => this.restart(world) }, t("death.restartRun")) : null,
        el("button", { onclick: () => openNewGame(this.actions.newGame, () => {}) }, t("menu.newGame")),
      ),
    );
  }

  private restart(world: World): void {
    const { newGame } = this.actions;
    if (!newGame.confirm(say(CONFIRM_NEW_GAME))) return;
    newGame.requestBoot({ new: world.setup });
    newGame.reload();
  }
}

function lossCause(world: World): RunLossCause {
  const lost = world.events.find((e) => e.t === "runLost");
  return lost?.t === "runLost" ? lost.cause : "wrecked";
}

function deathTitle(world: World): Msg {
  return world.furyRoad ? RUN_TITLE[lossCause(world)] : t("death.title");
}

function runCaption(world: World): HTMLElement | null {
  if (!world.furyRoad) return null;
  const { reached, north } = runEarnings(world);
  const caption = reached > 0 ? t("death.runReached", { mode: modeName("furyRoad"), site: siteName(outpostId(reached)), north: distanceText(north) }) : t("death.runStart", { mode: modeName("furyRoad"), north: distanceText(north) });
  return el("div", { class: "death-caption" }, caption);
}
