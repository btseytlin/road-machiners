// The shop part list: compact rows that open in place, one at a time. It owns which row is open and keeps the
// reader's scroll and keyboard place across the screens' full redraws.

import { partDef } from "../data/parts";
import type { PartInstance } from "../sim/types";
import { conditionTag, createIcon, footprint, headlineStat, partDetail, partIconEl, statChip, toneStyle } from "./cards";
import { el } from "./dom";
import { conditionStatus, conditionTier } from "./format";

export type PartRow = {
  part: PartInstance;
  base: PartInstance | null; // the part it is weighed against, or null for plain stats
  price: number;
  payable: boolean; // false when the action would be disabled for lack of money
  unpaidTitle: string;
  action: HTMLElement; // the Buy or Sell button, built with its disabled state
  onHover: (on: boolean) => void;
};

// The row that should hold focus after a redraw: the same one, else the next one that survived, else the
// nearest one before it.
export function focusAfter(before: string[], focused: string, after: string[]): string | null {
  const at = before.indexOf(focused);
  if (at < 0) throw new Error(`Focused part row ${focused} was not in the list`);
  const kept = new Set(after);
  if (kept.has(focused)) return focused;
  const next = before.slice(at + 1).find((id) => kept.has(id));
  if (next !== undefined) return next;
  return before.slice(0, at).reverse().find((id) => kept.has(id)) ?? null;
}

const ROW = "[data-part-row]";

type Place = {
  scrolls: [HTMLElement, number][];
  order: string[];
  focused: string | null;
  top: number;
};

export class PartRows {
  private open: string | null = null;
  private reveal = false;

  constructor(private onChange: () => void) {}

  collapse(): void {
    this.open = null;
  }

  list(rows: PartRow[]): HTMLElement {
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.part.id)) throw new Error(`Part ${r.part.id} is listed twice`);
      seen.add(r.part.id);
    }
    return el("ul", { class: "part-rows" }, ...rows.map((r) => this.row(r)));
  }

  private row(r: PartRow): HTMLElement {
    const id = r.part.id;
    const isOpen = this.open === id;
    const detailId = `part-detail-${id}`;
    const head = el(
      "button",
      { type: "button", class: "part-sum", "aria-expanded": String(isOpen), "aria-controls": detailId },
      partIconEl(r.part),
      this.nameCell(r.part),
      statChip(headlineStat(r.part, r.base)),
      footprint(partDef(r.part.defId).w, partDef(r.part.defId).h),
      el("span", { class: `price${r.payable ? "" : " bad"}`, title: r.payable ? "" : r.unpaidTitle }, createIcon("money"), `${r.price}`),
      el("span", { class: "chevron" }),
    );
    head.addEventListener("click", () => {
      head.focus({ preventScroll: true });
      this.toggle(id);
    });
    if (!r.payable) r.action.title = r.unpaidTitle;
    const li = el(
      "li",
      { class: `part-row toned k-${partDef(r.part.defId).kind}`, style: toneStyle(r.part.defId), "data-part-row": id },
      head,
      isOpen ? el("div", { class: "part-detail", id: detailId }, ...partDetail(r.part, r.base, r.action)) : null,
    );
    li.addEventListener("mouseenter", () => r.onHover(true));
    li.addEventListener("mouseleave", () => r.onHover(false));
    return li;
  }

  private nameCell(part: PartInstance): HTMLElement {
    const status = conditionStatus(part);
    const showStatus = status.tone === "bad" || conditionTier(part) === "junk";
    return el(
      "span",
      { class: "part-name" },
      el("b", {}, partDef(part.defId).name),
      conditionTag(part),
      showStatus ? el("span", { class: status.tone }, status.text) : null,
    );
  }

  private toggle(id: string): void {
    this.open = this.open === id ? null : id;
    this.reveal = this.open !== null;
    this.onChange();
  }

  // Runs a redraw and puts scroll and focus back where the reader had them.
  keepPlace(root: HTMLElement, draw: () => void): void {
    const place = this.record(root);
    draw();
    this.restore(root, place);
  }

  // A tab or filter change shows its new list from the top.
  toTop(root: HTMLElement): void {
    const box = root.querySelector<HTMLElement>(".town-shop");
    if (box) box.scrollTop = 0;
  }

  private record(root: HTMLElement): Place {
    const active = document.activeElement;
    const focusedRow = active instanceof HTMLElement && root.contains(active) ? active.closest<HTMLElement>(ROW) : null;
    return {
      scrolls: scrollBoxes(root).map((b) => [b, b.scrollTop]),
      order: rowIds(root),
      focused: focusedRow?.dataset.partRow ?? null,
      top: focusedRow?.getBoundingClientRect().top ?? 0,
    };
  }

  private restore(root: HTMLElement, place: Place): void {
    const boxes = scrollBoxes(root);
    place.scrolls.forEach(([, top], i) => {
      if (boxes[i]) boxes[i].scrollTop = top;
    });
    if (place.focused !== null) this.refocus(root, place);
    const detail = this.open === null ? null : root.querySelector(`[id="part-detail-${this.open}"]`);
    if (this.reveal && detail) detail.scrollIntoView({ block: "nearest" });
    this.reveal = false;
  }

  private refocus(root: HTMLElement, place: Place): void {
    if (place.focused === null) return;
    const target = focusAfter(place.order, place.focused, rowIds(root));
    const row = target === null ? null : rowById(root, target);
    if (!row) return;
    row.querySelector<HTMLElement>(".part-sum")?.focus({ preventScroll: true });
    if (target === place.focused) {
      const box = scrollerOf(row);
      if (box) box.scrollTop += row.getBoundingClientRect().top - place.top;
    }
  }
}

// The shop column scrolls on wide screens and the whole split below 720px.
function scrollBoxes(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".town-shop, .town-split")];
}

function rowIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>(ROW)].map((r) => r.dataset.partRow ?? "");
}

function rowById(root: HTMLElement, id: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(ROW)].find((r) => r.dataset.partRow === id);
}

function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let p = node.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
