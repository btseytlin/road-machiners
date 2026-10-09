import { GOODS } from "../data/goods";
import { partDef, type PartKind } from "../data/parts";
import { playerVehicle } from "../sim/damage";
import { reachedOutpostAt, type Outpost } from "../sim/fury-road";
import { goodsCount, MOUNT_CELLS } from "../sim/grid";
import { canStowPart } from "../sim/inventory";
import { outpostBuyGood, outpostBuyPart, outpostBuySupply, outpostGoodPrice, outpostGoodRoom, outpostPartPrice, outpostRepairAll, outpostRepairBasics } from "../sim/outposts";
import type { PartInstance, World } from "../sim/types";
import { compareBase, createItemIcon } from "./cards";
import { el, panel } from "./dom";
import { GOODS_COLUMNS } from "./format";
import type { UiHost } from "./host";
import { InventoryView, truckChips } from "./inventory";
import { PartRows, type PartRow } from "./part-rows";
import { caption, keepFocus, priceEl, priceHead, priceSpan, reasonButton, repairBar, shortBy, supplyRow, type ShopCommand } from "./shop-rows";

const REPAIR_GOOD = "parts";
const GOOD_LOT = 4;

function goodsHead(): HTMLElement {
  const c = GOODS_COLUMNS;
  return el("div", { class: "goods-head row dim" }, el("span", {}, c.good), priceHead(c.buy), el("span", {}), el("span", { class: "end" }, c.held), el("span", {}));
}

export class OutpostScreen {
  private root = panel("modal dialog");
  private error = "";
  private rows = new PartRows(() => this.render());
  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen", "outpost-screen");
    this.root.style.display = "none";
    window.addEventListener("resize", () => this.render());
    this.inventory = new InventoryView(host, () => this.render(), false);
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    this.root.style.display = "";
    this.error = "";
    this.rows.collapse();
    this.render();
  }

  close(): void {
    this.inventory.clearSelection();
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    this.rows.keepPlace(this.root, () => this.draw());
  }

  button(label: string, cmd: ShopCommand, reason = "", key = "", title = ""): HTMLElement {
    return reasonButton([label], () => this.run(cmd), reason, key, title);
  }

  priceButton(w: World, verb: string, price: number, cmd: ShopCommand, reason = "", key = ""): HTMLElement {
    const short = shortBy(w.player.money, price);
    return reasonButton([verb, " ", priceSpan(price, short === "")], () => this.run(cmd), reason || short, key);
  }

  private draw(): void {
    const w = this.host.world();
    const post = reachedOutpostAt(w);
    if (!post) return this.close();
    const truck = el("div", { class: "town-truck" }, repairBar(w, this, { basics: outpostRepairBasics, all: outpostRepairAll }), this.inventory.render());
    const shop = el(
      "div",
      { class: "town-shop" },
      this.error ? el("div", { class: "bad" }, this.error) : null,
      el("div", { class: "goods" }, goodsHead(), supplyRow(w, "fuel", this, outpostBuySupply), supplyRow(w, "supplies", this, outpostBuySupply), this.goodRow(w)),
      this.stock(w, post),
    );
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, post.name, truckChips(w)),
      el("div", { class: "town-split" }, truck, shop),
    );
    this.inventory.fitTo(truck);
  }

  private run(cmd: ShopCommand): void {
    keepFocus(this.root, () => {
      try {
        this.host.apply(cmd(this.host.world()));
        this.error = "";
        this.rows.collapse();
      } catch (e) {
        this.error = (e as Error).message;
      }
      this.render();
    });
  }

  private goodRow(w: World): HTMLElement {
    const me = playerVehicle(w);
    const price = outpostGoodPrice();
    const room = outpostGoodRoom(me);
    const reason = (n: number) => shortBy(w.player.money, price * n) || (room < n ? "No room" : "");
    const held = goodsCount(me)[REPAIR_GOOD] ?? 0;
    return el(
      "div",
      { class: "good-row row" },
      el("div", { class: "good-name" }, createItemIcon(REPAIR_GOOD), el("b", {}, GOODS[REPAIR_GOOD].name)),
      el(
        "div",
        { class: "trade buy wide" },
        caption(GOODS_COLUMNS.buy, true),
        priceEl(price, shortBy(w.player.money, price) === ""),
        this.button("+1", (x) => outpostBuyGood(x, 1), reason(1), `${REPAIR_GOOD}:buy1`),
        this.button(`+${GOOD_LOT}`, (x) => outpostBuyGood(x, GOOD_LOT), reason(GOOD_LOT), `${REPAIR_GOOD}:buy${GOOD_LOT}`),
      ),
      el("div", { class: "count held" }, caption(GOODS_COLUMNS.held), el("span", { class: held === 0 ? "num dim" : "num" }, `${held}`)),
    );
  }

  private stock(w: World, post: Outpost): HTMLElement {
    if (post.stock.length === 0) return el("div", { class: "dim" }, "Sold out");
    return this.rows.list(post.stock.map((p) => this.partRow(w, p)));
  }

  private partRow(w: World, p: PartInstance): PartRow {
    const price = outpostPartPrice(w, p);
    const short = shortBy(w.player.money, price);
    const reason = short || (canStowPart(playerVehicle(w), p) ? "" : "No room");
    return {
      world: w,
      part: p,
      base: compareBase(this.inventory.selectedPart(), p),
      price,
      payable: short === "",
      action: this.button("Buy", (x) => outpostBuyPart(x, p.id), reason),
      onHover: this.hintMounts(partDef(p.defId).kind),
    };
  }

  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }
}
