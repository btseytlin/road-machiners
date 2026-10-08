// The Save and Load panels. Save lists the manual slots and writes the world into the one clicked. Load lists every
// filled slot, newest first, and loads the one clicked. Save writes at once. Load asks first, since it drops progress.
// Save also downloads the game or the run log as a file.

import type { SlotId, SlotInfo } from "../three/save-slots";
import { slotLabel } from "../three/save-slots";
import { bindAttr, say } from "../text/language";
import { date, t, type Msg } from "../text/msg";
import { el, panel } from "./dom";
import { clock } from "./format";

export type SavePanelActions = {
  list: () => SlotInfo[];
  manualSlots: () => SlotId[];
  save: (slot: SlotId) => void;
  reboot: (slot: SlotId) => void;
  exportSave: () => void;
  exportLog: () => void;
};

// The game time a save was made at, and the real time when the save has one.
function savedText(info: SlotInfo): Msg {
  if (info.turn === null) return t("save.damaged");
  const when = clock(info.turn).full;
  return info.savedAt > 0 ? t("save.savedAt", { when, real: date(info.savedAt) }) : when;
}

export class SavePanel {
  private root: HTMLElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code !== "Escape") return;
    e.stopPropagation();
    this.close();
  };

  constructor(private actions: SavePanelActions) {}

  isOpen(): boolean {
    return this.root !== null;
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    window.removeEventListener("keydown", this.onKey, true);
  }

  openSave(): void {
    const infos = new Map(this.actions.list().map((info) => [info.slot, info]));
    const rows = this.actions.manualSlots().map((slot) => this.row(slot, infos.get(slot) ?? null, () => this.saveInto(slot)));
    const exports = el(
      "div",
      { class: "save-exports" },
      el("button", { onclick: () => this.actions.exportSave(), title: t("save.exportSaveTitle") }, t("save.exportSave")),
      el("button", { onclick: () => this.actions.exportLog(), title: t("save.exportLogTitle") }, t("save.exportLog")),
    );
    this.show(t("menu.save"), [...rows, exports]);
  }

  openLoad(): void {
    const rows = this.actions.list().map((info) => this.row(info.slot, info, () => this.loadFrom(info.slot)));
    this.show(t("menu.load"), rows.length > 0 ? rows : [el("div", { class: "dim" }, t("save.none"))]);
  }

  private saveInto(slot: SlotId): void {
    this.actions.save(slot);
    this.openSave();
  }

  private loadFrom(slot: SlotId): void {
    if (!window.confirm(say(t("save.confirmLoad")))) return;
    this.actions.reboot(slot);
  }

  private row(slot: SlotId, info: SlotInfo | null, onclick: () => void): HTMLElement {
    const detail = info === null ? t("save.empty") : savedText(info);
    return el("button", { class: "save-row", "data-slot": slot, onclick }, el("b", {}, slotLabel(slot)), el("span", {}, detail));
  }

  private show(title: Msg, rows: HTMLElement[]): void {
    this.close();
    this.root = panel("save-panel");
    this.root.setAttribute("role", "dialog");
    bindAttr(this.root, "aria-label", title);
    this.root.append(el("h3", {}, title), ...rows, el("button", { class: "close", onclick: () => this.close() }, t("menu.close")));
    window.addEventListener("keydown", this.onKey, true);
  }
}
