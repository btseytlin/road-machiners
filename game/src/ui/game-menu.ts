// The Menu button. Its dropdown offers New Game, Save, Load and Help. Save and Load open the slot panels, New Game opens the
// setup screen, and Help shows the controls. While the dropdown is open it owns the keys and the pointer.

import { ERROR_REPORT_URL } from "../config";
import { el, isBrowserChord, panel, topRight } from "./dom";
import { versionLabel } from "./hud-readout";
import { isNewGameOpen, openNewGame, type NewGameActions } from "./new-game";
import { SavePanel, type SavePanelActions } from "./save-panel";
import type { TipSwitch } from "./tips";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

export type MenuEntry = "new" | "save" | "load" | "tips" | "help";

const ENTRIES: { entry: MenuEntry; label: string }[] = [
  { entry: "new", label: "New Game" },
  { entry: "save", label: "Save" },
  { entry: "load", label: "Load" },
  { entry: "tips", label: "Show tips" },
  { entry: "help", label: "Help" },
];

type Control = { keys: string[]; on?: string; does: string };
type ControlGroup = { title: string; controls: Control[] };

export const CONTROLS: ControlGroup[] = [
  {
    title: "Drive",
    controls: [
      { keys: ["Click"], on: "ground", does: "Drive by road" },
      { keys: ["Shift", "Click"], on: "ground", does: "Stop there" },
      { keys: ["Space"], does: "Drive or pause" },
      { keys: ["Hold Space"], does: "Fast-forward" },
      { keys: ["Click"], on: "your truck", does: "Brake" },
      { keys: ["R"], does: "Manual driving" },
      { keys: ["P"], does: "Auto patch" },
    ],
  },
  {
    title: "Places and talk",
    controls: [
      { keys: ["Click"], on: "town or site", does: "Stop at its pad" },
      { keys: ["E"], on: "pad", does: "Trade, repair or loot" },
      { keys: ["T"], does: "Radio the inspected truck" },
      { keys: ["1", "9"], does: "Reply" },
      { keys: ["H"], does: "Honk" },
    ],
  },
  {
    title: "Fight",
    controls: [
      { keys: ["Click"], on: "truck", does: "Inspect or aim" },
      { keys: ["1", "4"], does: "Pick a weapon" },
      { keys: ["0"], does: "All weapons" },
      { keys: ["Q"], does: "Auto fire" },
      { keys: ["X"], does: "Show weapons" },
    ],
  },
  {
    title: "View",
    controls: [
      { keys: ["W", "A", "S", "D"], does: "Pan" },
      { keys: ["Right drag"], does: "Pan" },
      { keys: ["Wheel"], does: "Zoom" },
      { keys: ["F"], does: "Center" },
      { keys: ["V"], does: "Camera" },
      { keys: ["M"], does: "Mute" },
      { keys: ["I"], does: "Inventory" },
      { keys: ["C"], does: "Character" },
      { keys: ["J"], does: "Journal" },
    ],
  },
];

function controlKeys(c: Control): HTMLElement {
  const range = c.keys.length === 2 && /^\d$/.test(c.keys[0]!) && /^\d$/.test(c.keys[1]!);
  const cap = (k: string) => el("kbd", { class: "key" }, k);
  const caps = range ? [cap(c.keys[0]!), el("span", { class: "help-on" }, "to"), cap(c.keys[1]!)] : c.keys.map(cap);
  return el("span", { class: "help-keys" }, ...caps, ...(c.on ? [el("span", { class: "help-on" }, c.on)] : []));
}

function controlGroup(group: ControlGroup): HTMLElement {
  return el(
    "div",
    { class: "help-group" },
    el("div", { class: "help-title" }, group.title),
    ...group.controls.flatMap((c) => [controlKeys(c), el("span", { class: "help-does" }, c.does)]),
  );
}

export function entryEnabled(entry: MenuEntry, busy: boolean, hasSave: boolean): boolean {
  if (entry === "help" || entry === "tips") return true;
  if (entry === "load") return !busy && hasSave;
  return !busy;
}

export function entryReason(entry: MenuEntry, busy: boolean, hasSave: boolean): string | null {
  if (entryEnabled(entry, busy, hasSave)) return null;
  return busy ? "Wait for the turn" : "No saves yet";
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
    const root = panel("help dialog");
    root.setAttribute("aria-label", "Controls");
    const notes = [versionLabel(), this.setup(), ...(ERROR_REPORT_URL ? ["Game errors are sent to the developers with your save."] : [])];
    root.append(
      el("button", { class: "close btn-s", onclick: () => this.close() }, "Close [Esc]"),
      el("div", { class: "help-groups" }, ...CONTROLS.map(controlGroup)),
      el("div", { class: "help-notes" }, ...notes.map((note) => el("div", {}, note))),
    );
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

  constructor(private actions: GameMenuActions, private isBusy: () => boolean, setup: () => string, private tips: TipSwitch) {
    this.help = new HelpPanel(setup);
    this.savePanel = new SavePanel(actions);
    for (const { entry, label } of ENTRIES) {
      const role = entry === "tips" ? "menuitemcheckbox" : "menuitem";
      const item = el("button", { role, onclick: () => this.choose(entry) }, label) as HTMLButtonElement;
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
    for (const { entry } of ENTRIES) this.setReason(this.items[entry], entryReason(entry, busy, saved));
    const on = this.tips.isOn();
    this.items.tips.setAttribute("aria-checked", String(on));
    this.items.tips.textContent = `${on ? "✓ " : ""}Show tips`;
  }

  private setReason(item: HTMLButtonElement, reason: string | null): void {
    if (reason === null) {
      item.removeAttribute("aria-disabled");
      item.removeAttribute("data-reason");
      return;
    }
    item.setAttribute("aria-disabled", "true");
    item.setAttribute("data-reason", reason);
  }

  toggle(): void {
    if (this.list.hidden) this.openList();
    else this.closeList(true);
  }

  private allItems(): HTMLButtonElement[] {
    return ENTRIES.map((e) => this.items[e.entry]);
  }

  private enabledItems(): HTMLButtonElement[] {
    return this.allItems().filter((b) => !b.hasAttribute("aria-disabled"));
  }

  private moveFocus(code: string, step: number): void {
    const items = this.allItems();
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
    if (this.items[entry].hasAttribute("aria-disabled")) return;
    this.closeList(false);
    if (entry === "save") this.savePanel.openSave();
    else if (entry === "load") this.savePanel.openLoad();
    else if (entry === "tips") {
      this.tips.setOn(!this.tips.isOn());
      this.refresh();
    } else if (entry === "help") this.help.toggle();
    else this.newGame();
  }

  private newGame(): void {
    openNewGame(this.actions.newGame, () => this.refresh());
  }
}
