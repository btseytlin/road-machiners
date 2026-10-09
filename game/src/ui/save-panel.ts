// The Save and Load panels. Save lists the manual slots and writes the world into the one clicked. Load lists every
// filled slot, newest first, and loads the one clicked. Save writes at once. Load asks first, since it drops progress.
// Save also downloads the game or the run log as a file.

import { clockLabel } from "./format";
import type { SlotId, SlotInfo } from "../three/save-slots";
import { slotLabel } from "../three/save-slots";
import { el, panel } from "./dom";

export type SavePanelActions = {
  list: () => SlotInfo[];
  manualSlots: () => SlotId[];
  save: (slot: SlotId) => void;
  reboot: (slot: SlotId) => void;
  exportSave: () => void;
  exportLog: () => void;
};

const DAMAGED = "Old or damaged save";

export function slotDetail(info: SlotInfo | null): { text: string; tone: "dim" | "bad" | "num" } {
  if (info === null) return { text: "Empty", tone: "dim" };
  if (info.turn === null) return { text: DAMAGED, tone: "bad" };
  return { text: clockLabel(info.turn), tone: "num" };
}

export function slotRealTime(info: SlotInfo | null): string {
  return info !== null && info.savedAt > 0 ? new Date(info.savedAt).toLocaleString() : "";
}

function detailEl(info: SlotInfo | null): HTMLElement {
  const { text, tone } = slotDetail(info);
  return el("span", { class: `save-when ${tone}` }, text);
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
      el("button", { onclick: () => this.actions.exportSave(), title: "Download the game as it is now" }, "Export save"),
      el("button", { onclick: () => this.actions.exportLog(), title: "Download what happened this run, one event per line" }, "Export run log"),
    );
    this.show("Save", [...rows, exports]);
  }

  openLoad(): void {
    const rows = this.actions.list().map((info) => this.row(info.slot, info, () => this.loadFrom(info.slot)));
    this.show("Load", rows.length > 0 ? rows : [el("div", { class: "dim" }, "No saves yet")]);
  }

  private saveInto(slot: SlotId): void {
    this.actions.save(slot);
    this.openSave();
  }

  private loadFrom(slot: SlotId): void {
    if (!window.confirm("Load this save? Progress since your last save is lost.")) return;
    this.actions.reboot(slot);
  }

  private row(slot: SlotId, info: SlotInfo | null, onclick: () => void): HTMLElement {
    return el("button", { class: "save-row", "data-slot": slot, title: slotRealTime(info), onclick }, el("b", {}, slotLabel(slot)), detailEl(info));
  }

  private show(title: string, rows: HTMLElement[]): void {
    this.close();
    this.root = panel("save-panel dialog");
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", title);
    this.root.append(el("h3", {}, title), ...rows, el("button", { class: "close", onclick: () => this.close() }, "Close [Esc]"));
    window.addEventListener("keydown", this.onKey, true);
  }
}
