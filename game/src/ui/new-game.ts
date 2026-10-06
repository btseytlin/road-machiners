// The one New game flow. The setup screen asks, and the caller starts. The screen never touches storage or the world.

import { el, panel } from "./dom";

export const CONFIRM_NEW_GAME = "Start a new game? The autosaves are deleted. Your save slots stay.";

// A new game is a page reload with a boot request. Boot deletes the autosaves and keeps the manual slots.
export function startNewGame(requestBoot: (request: "new") => void): void {
  requestBoot("new");
  window.location.reload();
}

let open = false;

// Shows the setup screen. Resolves true after a confirmed Start, and false on Back or Escape.
export function chooseNewGame(): Promise<boolean> {
  if (open) throw new Error("New game setup is already open");
  open = true;
  return new Promise((resolve) => {
    const root = panel("save-panel new-game");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "New game");
    const finish = (start: boolean) => {
      window.removeEventListener("keydown", onKey, true);
      root.remove();
      open = false;
      resolve(start);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.stopPropagation();
      finish(false);
    };
    const back = el("button", { onclick: () => finish(false) }, "Back");
    root.append(
      el("h3", {}, "New game"),
      el("div", { class: "mode" }, "Mode: Roaming"),
      el("div", { class: "dim" }, "The autosaves are deleted. Your save slots stay."),
      el(
        "div",
        { class: "new-game-buttons" },
        back,
        el("button", { onclick: () => { if (window.confirm(CONFIRM_NEW_GAME)) finish(true); } }, "Start"),
      ),
    );
    window.addEventListener("keydown", onKey, true);
    back.focus();
  });
}
