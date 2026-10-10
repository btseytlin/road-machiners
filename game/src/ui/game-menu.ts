// The Menu button. Its dropdown offers New Game, Save, Load, Options and Help. Save and Load open the slot panels, New Game
// opens the setup screen, Options opens the settings with the language, and Help shows the controls. While the dropdown
// or a panel it opened is up, it owns the keys and the pointer.

import { ERROR_REPORT_URL } from "../config";
import { bindAttr, setText, unbindAttr } from "../text/language";
import { t, verbatim, type Msg } from "../text/msg";
import { el, isBrowserChord, panel, topRight } from "./dom";
import { versionLabel } from "./hud-readout";
import { isNewGameOpen, openNewGame, type NewGameActions } from "./new-game";
import { OptionsPanel } from "./options";
import { SavePanel, type SavePanelActions } from "./save-panel";
import type { TipSwitch } from "./tips";

export type GameMenuActions = SavePanelActions & {
  hasSave: () => boolean;
  newGame: NewGameActions;
};

export type MenuEntry = "new" | "save" | "load" | "options" | "tips" | "help";

const ENTRIES: { entry: MenuEntry; label: Msg }[] = [
  { entry: "new", label: t("menu.newGame") },
  { entry: "save", label: t("menu.save") },
  { entry: "load", label: t("menu.load") },
  { entry: "options", label: t("menu.options") },
  { entry: "tips", label: t("menu.showTips") },
  { entry: "help", label: t("menu.help") },
];

type KeyCap = string | Msg;
type Control = { keys: KeyCap[]; on?: Msg; does: Msg };
type ControlGroup = { title: Msg; controls: Control[] };

const click = t("help.key.click");

export const CONTROLS: ControlGroup[] = [
  {
    title: t("help.group.drive"),
    controls: [
      { keys: [click], on: t("help.on.ground"), does: t("help.does.driveByRoad") },
      { keys: [t("help.key.shift"), click], on: t("help.on.ground"), does: t("help.does.stopThere") },
      { keys: [t("help.key.space")], does: t("help.does.driveOrPause") },
      { keys: [t("help.key.holdSpace")], does: t("help.does.fastForward") },
      { keys: [click], on: t("help.on.yourTruck"), does: t("help.does.brake") },
      { keys: ["R"], does: t("help.does.manual") },
      { keys: ["P"], does: t("help.does.autoPatch") },
    ],
  },
  {
    title: t("help.group.places"),
    controls: [
      { keys: [click], on: t("help.on.townOrSite"), does: t("help.does.stopAtPad") },
      { keys: ["E"], on: t("help.on.pad"), does: t("help.does.padWork") },
      { keys: ["T"], does: t("help.does.radio") },
      { keys: ["1", "9"], does: t("help.does.reply") },
      { keys: ["H"], does: t("help.does.honk") },
    ],
  },
  {
    title: t("help.group.fight"),
    controls: [
      { keys: [click], on: t("help.on.truck"), does: t("help.does.inspectOrAim") },
      { keys: ["1", "4"], does: t("help.does.pickWeapon") },
      { keys: ["0"], does: t("help.does.allWeapons") },
      { keys: ["Q"], does: t("help.does.autoFire") },
      { keys: ["X"], does: t("help.does.showWeapons") },
    ],
  },
  {
    title: t("help.group.view"),
    controls: [
      { keys: ["W", "A", "S", "D"], does: t("help.does.pan") },
      { keys: [t("help.key.rightDrag")], does: t("help.does.pan") },
      { keys: [t("help.key.wheel")], does: t("help.does.zoom") },
      { keys: ["F"], does: t("help.does.center") },
      { keys: ["V"], does: t("help.does.camera") },
      { keys: ["M"], does: t("help.does.mute") },
      { keys: ["I"], does: t("help.does.inventory") },
      { keys: ["C"], does: t("help.does.character") },
      { keys: ["J"], does: t("help.does.journal") },
    ],
  },
];

function controlKeys(c: Control): HTMLElement {
  const range = c.keys.length === 2 && c.keys.every((k) => typeof k === "string" && /^\d$/.test(k));
  const cap = (k: KeyCap) => el("kbd", { class: "key" }, typeof k === "string" ? verbatim(k) : k);
  const caps = range ? [cap(c.keys[0]!), el("span", { class: "help-on" }, t("help.to")), cap(c.keys[1]!)] : c.keys.map(cap);
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
  if (entry === "help" || entry === "tips" || entry === "options") return true;
  if (entry === "load") return !busy && hasSave;
  return !busy;
}

export function entryReason(entry: MenuEntry, busy: boolean, hasSave: boolean): Msg | null {
  if (entryEnabled(entry, busy, hasSave)) return null;
  return busy ? t("menu.waitForTurn") : t("save.none");
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
    bindAttr(root, "aria-label", t("help.title"));
    const notes = [verbatim(versionLabel()), verbatim(this.setup()), ...(ERROR_REPORT_URL ? [t("help.errorsSent")] : [])];
    root.append(
      el("button", { class: "close btn-s", onclick: () => this.close() }, t("menu.closeEsc")),
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

  constructor(private actions: GameMenuActions, private isBusy: () => boolean, setup: () => string, private tips: TipSwitch) {
    this.help = new HelpPanel(setup);
    this.savePanel = new SavePanel(actions);
    for (const { entry, label } of ENTRIES) {
      const role = entry === "tips" ? "menuitemcheckbox" : "menuitem";
      const item = el("button", { role, "data-entry": entry, onclick: () => this.choose(entry) }, label) as HTMLButtonElement;
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
    for (const { entry } of ENTRIES) this.setReason(this.items[entry], entryReason(entry, busy, saved));
    const on = this.tips.isOn();
    this.items.tips.setAttribute("aria-checked", String(on));
    setText(this.items.tips, t(on ? "menu.showTipsOn" : "menu.showTips"));
  }

  private setReason(item: HTMLButtonElement, reason: Msg | null): void {
    if (reason === null) {
      item.removeAttribute("aria-disabled");
      unbindAttr(item, "data-reason");
      return;
    }
    item.setAttribute("aria-disabled", "true");
    bindAttr(item, "data-reason", reason);
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
    else if (entry === "options") this.options.open();
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
