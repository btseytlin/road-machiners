// The Menu button. Its dropdown offers New Game, Save, Load, Options and Help. Save and Load open the slot panels, New Game
// opens the setup screen, Options opens the settings with the language, and Help shows the controls. While the dropdown
// or a panel it opened is up, it owns the keys and the pointer.

import { ERROR_REPORT_URL } from "../config";
import { bindAttr } from "../text/language";
import { t, verbatim, type Msg } from "../text/msg";
import { el, isBrowserChord, panel, topLeft, topRight } from "./dom";
import { versionLabel } from "./hud-readout";
import { isNewGameOpen, openNewGame, type NewGameActions } from "./new-game";
import { OptionsPanel } from "./options";
import { SavePanel, type SavePanelActions } from "./save-panel";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

const GUIDE = ["hud.guide.drive", "hud.guide.space", "hud.guide.manual", "hud.guide.pads", "hud.guide.radio", "hud.guide.combat", "hud.guide.keys", "hud.guide.camera"] as const;

export type MenuEntry = "new" | "save" | "load" | "options" | "help";

const ENTRIES: { entry: MenuEntry; label: Msg }[] = [
  { entry: "new", label: t("menu.newGame") },
  { entry: "save", label: t("menu.save") },
  { entry: "load", label: t("menu.load") },
  { entry: "options", label: t("menu.options") },
  { entry: "help", label: t("menu.help") },
];

export function entryEnabled(entry: MenuEntry, busy: boolean, hasSave: boolean): boolean {
  if (entry === "help" || entry === "options") return true;
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
    bindAttr(root, "aria-label", t("help.title"));
    root.append(
      el("h3", {}, t("help.title")),
      el("button", { class: "close", onclick: () => this.close() }, t("menu.close")),
      ...GUIDE.map((key) => el("div", {}, t(key))),
      el("div", { class: "version" }, verbatim(versionLabel())),
      el("div", { class: "version world-setup" }, verbatim(this.setup())),
    );
    if (ERROR_REPORT_URL) root.append(el("div", { class: "version" }, t("help.errorsSent")));
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
    t("menu.menu"),
  ) as HTMLButtonElement;
  private list = el("div", { id: "game-menu-list", role: "menu", "aria-label": t("menu.menu"), hidden: true });
  private items = {} as Record<MenuEntry, HTMLButtonElement>;
  private savePanel: SavePanel;
  private help: HelpPanel;
  private options = new OptionsPanel(() => this.button.focus());

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
      const item = el("button", { role: "menuitem", "data-entry": entry, onclick: () => this.choose(entry) }, label) as HTMLButtonElement;
      this.items[entry] = item;
      this.list.append(item);
    }
    this.root.append(this.button, this.list);
    this.refresh();
  }

  isOpen(): boolean {
    return !this.list.hidden || this.savePanel.isOpen() || this.options.isOpen() || isNewGameOpen();
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
    else if (entry === "options") this.options.open();
    else if (entry === "help") this.help.toggle();
    else this.newGame();
  }

  private newGame(): void {
    openNewGame(this.actions.newGame, () => this.refresh());
  }
}
