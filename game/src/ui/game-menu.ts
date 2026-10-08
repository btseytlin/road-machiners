// The Menu button. Its dropdown offers New Game, Save, Load and Help. Save and Load open the slot panels, New Game opens the
// setup screen, and Help shows the controls. While the dropdown is open it owns the keys and the pointer.

import { ERROR_REPORT_URL } from "../config";
import { el, isBrowserChord, panel, topLeft, topRight } from "./dom";
import { versionLabel } from "./hud-readout";
import { isNewGameOpen, openNewGame, type NewGameActions } from "./new-game";
import { SavePanel, type SavePanelActions } from "./save-panel";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

export type MenuEntry = "new" | "save" | "load" | "help";

const ENTRIES: { entry: MenuEntry; label: string }[] = [
  { entry: "new", label: "New Game" },
  { entry: "save", label: "Save" },
  { entry: "load", label: "Load" },
  { entry: "help", label: "Help" },
];

export function entryEnabled(entry: MenuEntry, busy: boolean, hasSave: boolean): boolean {
  if (entry === "help") return true;
  if (entry === "load") return !busy && hasSave;
  return !busy;
}

export class HelpPanel {
  constructor(private setup: () => string) {}

  private root: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") this.close();
  };

  isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    const root = panel("help", topLeft());
    topLeft().prepend(root);
    root.setAttribute("aria-label", "Controls");
    root.append(
      el("h3", {}, "Controls"),
      el("button", { class: "close", onclick: () => this.close() }, "Close"),
      el("div", {}, "Click the ground: drive there by road. Shift-click: stop there."),
      el("div", {}, "Space: drive on or pause. Hold Space: fast-forward. Click your truck: brake."),
      el("div", {}, "R: manual driving, straight at the point."),
      el("div", {}, "Click a town or site: stop at its pad. E on a pad: trade, repair or loot."),
      el("div", {}, "T: radio the inspected truck. 1-9: reply. H: honk."),
      el("div", {}, "Click a truck: inspect it, or aim a picked weapon at its body. 1-4: pick a weapon. 0: all. Q: auto fire. X: show weapons."),
      el("div", {}, "P: auto patch. C: character. I: inventory. Esc: close."),
      el("div", {}, "WASD or right-drag: pan. Wheel: zoom. F: center. V: camera. M: mute."),
      el("div", { class: "version" }, versionLabel()),
      el("div", { class: "version world-setup" }, this.setup()),
    );
    if (ERROR_REPORT_URL) root.append(el("div", { class: "version" }, "Game errors are sent to the developers with your save."));
    this.root = root;
    window.addEventListener("keydown", this.onKey);
  }

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    window.removeEventListener("keydown", this.onKey);
  }

  toggle(): void {
    if (this.root) this.close();
    else this.open();
  }
}

export class GameMenu {
  private root = panel("game-menu", topRight());
  private button = el(
    "button",
    { class: "menu-button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": "game-menu-list", onclick: () => this.toggle() },
    "Menu",
  ) as HTMLButtonElement;
  private list = el("div", { id: "game-menu-list", role: "menu", "aria-label": "Menu", hidden: true });
  private items = {} as Record<MenuEntry, HTMLButtonElement>;
  private savePanel: SavePanel;
  private help: HelpPanel;

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") {
      e.stopPropagation();
      this.closeList(true);
      return;
    }
    if (isBrowserChord(e)) return;
    const move = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 }[e.code];
    if (move !== undefined) {
      e.preventDefault();
      this.moveFocus(e.code, move);
    }
    e.stopPropagation();
  };

  private readonly onPointer = (e: PointerEvent) => {
    if (e.target instanceof Node && this.root.contains(e.target)) return;
    this.closeList(false);
    e.stopPropagation();
    e.preventDefault();
  };

  private readonly onFocusOut = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && !this.root.contains(e.relatedTarget)) this.closeList(false);
  };

  constructor(private actions: GameMenuActions, private isBusy: () => boolean, setup: () => string) {
    this.help = new HelpPanel(setup);
    this.savePanel = new SavePanel(actions);
    for (const { entry, label } of ENTRIES) {
      const item = el("button", { role: "menuitem", onclick: () => this.choose(entry) }, label) as HTMLButtonElement;
      this.items[entry] = item;
      this.list.append(item);
    }
    this.root.append(this.button, this.list);
    this.refresh();
  }

  isOpen(): boolean {
    return !this.list.hidden || this.savePanel.isOpen() || isNewGameOpen();
  }

  refresh(): void {
    const busy = this.isBusy();
    const saved = this.actions.hasSave();
    for (const { entry } of ENTRIES) this.items[entry].disabled = !entryEnabled(entry, busy, saved);
  }

  toggle(): void {
    if (this.list.hidden) this.openList();
    else this.closeList(true);
  }

  private enabledItems(): HTMLButtonElement[] {
    return ENTRIES.map((e) => this.items[e.entry]).filter((b) => !b.disabled);
  }

  private moveFocus(code: string, step: number): void {
    const items = this.enabledItems();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = code === "Home" ? 0 : code === "End" ? items.length - 1 : (at + step + items.length) % items.length;
    items[next].focus();
  }

  private openList(): void {
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.refresh();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("pointerdown", this.onPointer, true);
    this.root.addEventListener("focusout", this.onFocusOut);
    this.enabledItems()[0]?.focus();
  }

  private closeList(returnFocus: boolean): void {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("pointerdown", this.onPointer, true);
    this.root.removeEventListener("focusout", this.onFocusOut);
    if (returnFocus) this.button.focus();
  }

  private choose(entry: MenuEntry): void {
    this.closeList(false);
    if (entry === "save") this.savePanel.openSave();
    else if (entry === "load") this.savePanel.openLoad();
    else if (entry === "help") this.help.toggle();
    else this.newGame();
  }

  private newGame(): void {
    openNewGame(this.actions.newGame, () => this.refresh());
  }
}
