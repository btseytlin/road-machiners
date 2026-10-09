// The full shop: a debug screen the console's fullshop command opens anywhere, in combat too. It lists every part in
// the game, pristine and free to take, beside the truck grid, where parts fit at once as in a garage. It is for trying
// gear quickly, so it skips prices, stock and the refit rules, and never touches a real shop.

import { PARTS, type PartDef, type PartKind } from "../data/parts";
import { CheatError, give } from "../sim/cheats";
import { chargeFor, gunFor } from "../sim/factory";
import { MOUNT_CELLS } from "../sim/grid";
import type { PartInstance, World } from "../sim/types";
import { maxHp } from "../sim/wear";
import { compareBase, createIcon, partCard } from "./cards";
import { el, panel } from "./dom";
import type { UiHost } from "./host";
import { InventoryView, truckChips } from "./inventory";
import { FILTER_ICON, STOCK_FILTER_LABEL, STOCK_FILTERS, type StockFilter } from "./town";

const KIND_ORDER = STOCK_FILTERS.filter((f): f is Exclude<StockFilter, "all"> => f !== "all");

function shopParts(): PartDef[] {
  const rank = (d: PartDef) => KIND_ORDER.indexOf(d.kind as Exclude<StockFilter, "all">);
  return Object.values(PARTS)
    .filter((d) => d.kind !== "core")
    .sort((a, b) => rank(a) - rank(b) || a.tier - b.tier || a.name.localeCompare(b.name));
}

function sample(defId: string): PartInstance {
  const part: PartInstance = { id: `fullshop-${defId}`, defId, hp: 0, wear: 0, ...gunFor(defId), ...chargeFor(defId) };
  return { ...part, hp: maxHp(part) };
}

export class FullShopScreen {
  private root = panel("modal dialog");
  private filter: StockFilter = "all";
  private error = "";
  private readonly inventory: InventoryView;
  private readonly parts = shopParts();

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen");
    this.root.style.display = "none";
    window.addEventListener("resize", () => this.render());
    this.inventory = new InventoryView(host, () => this.render(), true, true);
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "";
    this.error = "";
    this.render();
  }

  close(): void {
    this.inventory.clearSelection();
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const w = this.host.world();
    const truck = el("div", { class: "town-truck" }, this.inventory.render());
    const shop = el(
      "div",
      { class: "town-shop" },
      el("div", { class: "tabs sub" }, ...this.filterButtons()),
      this.error ? el("div", { class: "bad" }, this.error) : null,
      el("div", { class: "cards" }, ...this.cards(w)),
    );
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, "Full shop: every part, free", truckChips(w)),
      el("div", { class: "town-split" }, truck, shop),
    );
    this.inventory.fitTo(truck);
  }

  private cards(w: World): HTMLElement[] {
    const shown = this.parts.filter((d) => this.filter === "all" || d.kind === this.filter);
    return shown.map((d) => {
      const part = sample(d.id);
      return partCard({
        world: w,
        part,
        base: compareBase(this.inventory.selectedPart(), part),
        action: el("button", { onclick: () => this.take(w, d.id) }, "Take"),
        onHover: this.hintMounts(d.kind),
      });
    });
  }

  private take(w: World, defId: string): void {
    try {
      this.host.apply(give(w, defId, 1));
      this.error = "";
    } catch (err) {
      if (!(err instanceof CheatError)) throw err;
      this.error = err.message;
    }
    this.render();
  }

  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }

  private filterButtons(): HTMLElement[] {
    return STOCK_FILTERS.map((f) =>
      el(
        "button",
        {
          class: this.filter === f ? "on" : "",
          title: STOCK_FILTER_LABEL[f],
          onclick: () => {
            this.filter = f;
            this.render();
          },
        },
        f === "all" ? "All" : createIcon(FILTER_ICON[f]),
        el("span", { class: "count" }, `${this.parts.filter((d) => f === "all" || d.kind === f).length}`),
      ),
    );
  }
}
