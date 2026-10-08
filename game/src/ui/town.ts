// Shop screens: every shop the player can park at, town garage or roadside stall, and an NPC truck parked beside
// the player to trade.

import { chassisDef, PLAYER_CHASSIS } from "../data/chassis";
import { ECONOMY, GOOD_IDS, GOODS } from "../data/goods";
import { CONTRACTS, shopDef, type ShopDef } from "../data/market";
import { partDef, type PartKind } from "../data/parts";
import { playerVehicle } from "../sim/damage";
import {
  buyChassis,
  buyGood,
  buyPrice,
  buyStockPart,
  buySupply,
  buyTruckGood,
  buyTruckPart,
  buyTruckSupply,
  chassisTradeIn,
  endTrade,
  enterTown,
  getLotTradePrice,
  partTradePrice,
  basicsRepairCost,
  repairAll,
  repairBasics,
  repairCost,
  sellGood,
  sellPart,
  sellPrice,
  sellTruckGood,
  sellTruckPart,
  supplyRoom,
  canTradeWith,
  truckGoodPrice,
  truckPartPrice,
  truckGoodsForSale,
  truckSupplyForSale,
  truckSupplyPrice,
  type Supply,
} from "../sim/economy";
import { freeCells, goodsCount, MOUNT_CELLS, mountedParts } from "../sim/grid";
import { moneyChipLabel } from "./hud-readout";
import { canStowPart, spareParts } from "../sim/inventory";
import { acceptContract, deliverContract, fitsFetch, shopAt, shopState, type Contract, type ShopState } from "../sim/market";
import { REGION } from "../data/region";
import type { PartInstance, Vehicle, World } from "../sim/types";
import { chassisMap, chassisPortrait, chassisStats, compareBase, createIcon, createItemIcon, diffStats, statGrid, type IconName } from "./cards";
import { PartRows, type PartRow } from "./part-rows";
import { el, panel } from "./dom";
import { contractSummary, contractWindow, estimateText, estimateTitle, GOODS_COLUMNS, heldContractDue, lotTitle, PROFIT_HEAD_TITLE, saleEstimate, type SaleEstimate } from "./format";
import { InventoryView, truckChips } from "./inventory";
import type { UiHost } from "./host";
import { fuelLiters, moneyAmount, moneyText } from "./units";
import { fuelCap, suppliesCap } from "../sim/stats";
import { npcName } from "../sim/spawn";
import { vehicleHasPerk } from "../sim/progress";

type Tab = "market" | "buyParts" | "sellParts" | "trucks" | "contracts";

export type StockFilter = "all" | Exclude<PartKind, "core">;

export const STOCK_FILTERS: StockFilter[] = ["all", "weapon", "engine", "armor", "cargo", "scanner", "store", "utility"];

const GARAGE_ONLY: Tab[] = ["trucks"];

const PRESSURE_HINT_AT = 0.2;

export class TownScreen {
  private root = panel("modal");
  private tab: Tab = "market";
  private stockFilter: StockFilter = "all";
  private error = "";
  private rows = new PartRows(() => this.render());

  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen");
    this.root.style.display = "none";
    window.addEventListener("resize", () => this.render());
    this.inventory = new InventoryView(host, () => this.render(), false);
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  open(): void {
    if (shopAt(this.host.world())) this.host.apply(enterTown(this.host.world()));
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

  private draw(): void {
    const w = this.host.world();
    const shopId = shopAt(w);
    if (!shopId) return this.close();
    const def = shopDef(shopId);
    this.normalizeTab(def);
    const shop = [el("div", { class: "tabs" }, ...this.tabButtons(def))];
    if (this.error) shop.push(el("div", { class: "bad" }, this.error));
    shop.push(this.tabBody(w, shopId, def));
    const truck = el(
      "div",
      { class: "town-truck" },
      this.repairBar(w),
      this.inventory.render(),
    );
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, siteName(shopId), truckChips(w, { freeCells: def.kind !== "garage" })),
      el("div", { class: "town-split" }, truck, el("div", { class: "town-shop" }, ...shop)),
    );
    this.inventory.fitTo(truck);
  }

  private normalizeTab(def: ShopDef): void {
    if (def.kind !== "garage" && GARAGE_ONLY.includes(this.tab)) this.tab = "market";
  }

  private tabButtons(def: ShopDef): HTMLElement[] {
    const tabs: Tab[] = ["market", "buyParts", "sellParts", ...(def.kind === "garage" ? GARAGE_ONLY : []), "contracts"];
    return tabs.map((t) =>
      el(
        "button",
        {
          class: this.tab === t ? "on" : "",
          onclick: () => {
            this.tab = t;
            this.showList();
          },
        },
        createIcon(TAB_ICON[t]),
        TAB_LABEL[t],
      ),
    );
  }

  private tabBody(w: World, shopId: string, def: ShopDef): HTMLElement {
    const body: Record<Tab, () => HTMLElement> = {
      market: () => this.market(w, shopId, def),
      buyParts: () => this.buyParts(w, shopId),
      sellParts: () => this.sellParts(w),
      trucks: () => this.trucks(w),
      contracts: () => this.contracts(w, shopId),
    };
    return body[this.tab]();
  }

  private showList(): void {
    this.rows.collapse();
    this.render();
    this.rows.toTop(this.root);
  }

  private run(cmd: (w: World) => World): void {
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

  private button(label: string, cmd: (w: World) => World, disabled = false, title = "", key = ""): HTMLElement {
    return el("button", { disabled, title, "data-key": key || undefined, onclick: () => this.run(cmd) }, label);
  }

  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }

  private market(w: World, shopId: string, def: ShopDef): HTMLElement {
    const state = shopState(w, shopId);
    return el(
      "div",
      {},
      def.supplies.length ? el("div", { class: "services" }, ...def.supplies.map((k) => this.supplyRow(w, k))) : null,
      el(
        "div",
        { class: "goods" },
        goodsHead(false),
        ...def.goods.map((g) => this.goodRow(w, shopId, def, state, g)),
      ),
    );
  }

  private goodRow(w: World, shopId: string, def: ShopDef, state: ShopState, g: string): HTMLElement {
    const held = goodsCount(playerVehicle(w))[g] ?? 0;
    const sell = sellPrice(w, shopId, g);
    const hint = pressureHint(def, state, g);
    return el(
      "div",
      { class: "good-row" },
      el(
        "div",
        { class: "good-name" },
        createItemIcon(g),
        el("b", {}, GOODS[g].name),
        hint ? el("span", { class: `tag ${hint.cls}` }, hint.text) : null,
      ),
      el(
        "div",
        { class: "trade buy" },
        caption(GOODS_COLUMNS.buy),
        priceEl(buyPrice(w, shopId, g)),
        this.button("+1", (x) => buyGood(x, g, 1), false, "", `${g}:buy1`),
        this.button("+5", (x) => buyGood(x, g, 5), false, lotTitle("buy", 5, getLotTradePrice(w, playerVehicle(w), shopId, g, 5, "buy")), `${g}:buy5`),
      ),
      el(
        "div",
        { class: "trade sell" },
        caption(GOODS_COLUMNS.sell),
        priceEl(sell),
        this.button("−1", (x) => sellGood(x, g, 1), held === 0, "", `${g}:sell1`),
        this.button("All", (x) => sellGood(x, g, held), held === 0, held ? lotTitle("sell", held, getLotTradePrice(w, playerVehicle(w), shopId, g, held, "sell")) : "", `${g}:sellAll`),
      ),
      countCell("held", held),
      profitCell(saleEstimate(held, sell, w.player.costBasis[g])),
    );
  }

  private buyParts(w: World, shopId: string): HTMLElement {
    const me = playerVehicle(w);
    const stock = shopState(w, shopId).stock;
    const shown = stock.filter((p) => this.stockFilter === "all" || partDef(p.defId).kind === this.stockFilter);
    const payable = (price: number) => w.player.money >= price;
    const rows = shown.map((p) => {
      const price = partTradePrice(w, me, p, "buy");
      return this.partRow(w, p, price, payable(price), "Not enough money", "Buy", (x) => buyStockPart(x, p.id), !canStowPart(me, p));
    });
    return el(
      "div",
      {},
      el("div", { class: "tabs sub" }, ...this.stockFilterButtons(stock)),
      rows.length
        ? this.rows.list(rows)
        : el("div", { class: "dim" }, stock.length ? "No parts of this kind in stock." : "No parts in stock."),
    );
  }

  private partRow(w: World, p: PartInstance, price: number, payable: boolean, unpaidTitle: string, verb: string, cmd: (w: World) => World, stored = false): PartRow {
    const button = this.button(`${verb} ${moneyText(price)}`, cmd, !payable);
    return {
      world: w,
      part: p,
      base: compareBase(this.inventory.selectedPart(), p),
      price,
      payable,
      unpaidTitle,
      action: stored ? el("div", { class: "buy-stored" }, button, el("div", { class: "dim" }, "No room: goes to storage")) : button,
      onHover: this.hintMounts(partDef(p.defId).kind),
    };
  }

  private stockFilterButtons(stock: PartInstance[]): HTMLElement[] {
    return STOCK_FILTERS.map((f) => {
      const count = f === "all" ? stock.length : stock.filter((p) => partDef(p.defId).kind === f).length;
      return el(
        "button",
        {
          class: this.stockFilter === f ? "on" : "",
          disabled: count === 0 && f !== "all",
          title: STOCK_FILTER_LABEL[f],
          onclick: () => {
            this.stockFilter = f;
            this.showList();
          },
        },
        f === "all" ? "All" : createIcon(FILTER_ICON[f]),
        el("span", { class: "count" }, `${count}`),
      );
    });
  }

  private sellParts(w: World): HTMLElement {
    const me = playerVehicle(w);
    const sellable: PartInstance[] = [...w.player.storage, ...spareParts(me)];
    const rows = sellable.map((p) =>
      this.partRow(w, p, partTradePrice(w, me, p, "sell"), true, "", "Sell", (x) => sellPart(x, p.id)),
    );
    return el(
      "div",
      {},
      el("h3", {}, "Sell spare and stored parts"),
      rows.length
        ? this.rows.list(rows)
        : el("div", { class: "dim" }, "No spare or stored parts."),
    );
  }

  private supplyRow(w: World, k: Supply): HTMLElement {
    const room = supplyRoom(w, k);
    const price = ECONOMY.supplyPrice[k];
    const afford = Math.min(room, Math.floor(w.player.money / price));
    const fuel = k === "fuel";
    const have = w.player[k];
    const cap = fuel ? fuelCap(playerVehicle(w)) : suppliesCap(playerVehicle(w));
    const amount = (n: number) => (fuel ? `${fuelLiters(n)} L` : `${Math.round(n * 10) / 10}`);
    return el(
      "div",
      { class: "service" },
      createIcon(k),
      el("div", { class: "service-meter" }, el("span", {}, `${amount(have)} / ${amount(cap)}`), bar(have / cap)),
      el("span", { class: "dim" }, fuel ? `${moneyAmount(price)} per ${amount(1)}` : `${moneyAmount(price)} each`),
      this.button(`+${amount(1)}`, (x) => buySupply(x, k, 1), afford < 1),
      this.button(`Fill ${amount(afford)}`, (x) => buySupply(x, k, afford), afford < 1),
    );
  }

  private repairBar(w: World): HTMLElement {
    const broken = mountedParts(playerVehicle(w)).filter((p) => p.hp === 0).length;
    const basics = basicsRepairCost(w);
    const all = repairCost(w);
    return el(
      "div",
      { class: "town-repair" },
      createIcon("tools"),
      broken ? el("span", { class: "bad" }, `${broken} broken`) : null,
      this.button(basics === 0 ? "Basics fine" : `Repair basics ${moneyText(basics)}`, repairBasics, basics === 0),
      this.button(all === 0 ? "No repairs" : `Repair all ${moneyText(all)}`, repairAll, all === 0),
    );
  }

  private trucks(w: World): HTMLElement {
    const me = playerVehicle(w);
    const tradeIn = chassisTradeIn(w);
    const mine = chassisStats(me.chassisId);
    const cards = PLAYER_CHASSIS.map((id) => {
      const cost = chassisDef(id).value - tradeIn;
      const own = me.chassisId === id;
      return el(
        "div",
        { class: `card truck-card${own ? " own" : ""}` },
        el("div", { class: "truck-pics" }, chassisPortrait(id), chassisMap(id)),
        el(
          "div",
          { class: "truck-body" },
          el("div", { class: "card-name" }, el("b", {}, chassisDef(id).name)),
          statGrid(diffStats(chassisStats(id), own ? null : mine)),
          el(
            "div",
            { class: "card-foot" },
            el("span", { class: "dim" }, own ? "Your truck" : `vs ${chassisDef(me.chassisId).name}`),
            own ? null : this.button(cost >= 0 ? `Swap ${moneyText(cost)}` : `Swap, get ${moneyText(-cost)} back`, (x) => buyChassis(x, id), w.player.money < cost),
          ),
        ),
      );
    });
    return el(
      "div",
      {},
      el(
        "div",
        { class: "note" },
        createIcon("money"),
        `Your truck trades in for ${moneyText(tradeIn)}.`,
      ),
      el("div", { class: "cards trucks" }, ...cards),
    );
  }

  private contracts(w: World, shopId: string): HTMLElement {
    const board = shopState(w, shopId).contracts;
    const full = w.player.contracts.length >= CONTRACTS.maxActive;
    const accept = (c: Contract) =>
      this.button("Accept", (x) => acceptContract(x, c.id), full, full ? `You already hold ${CONTRACTS.maxActive} contracts` : "");
    return el(
      "div",
      {},
      el("h3", {}, "Contract board"),
      board.length
        ? el("div", { class: "jobs" }, ...board.map((c) => contractRow(w, c, accept(c), true)))
        : el("div", { class: "dim" }, "No offers."),
      el("h3", {}, `Your contracts ${w.player.contracts.length} / ${CONTRACTS.maxActive}`),
      w.player.contracts.length
        ? el("div", { class: "jobs" }, ...w.player.contracts.map((c) => contractRow(w, c, this.deliverCell(w, shopId, c))))
        : el("div", { class: "dim" }, "You hold no contracts."),
    );
  }

  private deliverCell(w: World, shopId: string, c: Contract): HTMLElement {
    const destination = c.kind === "haul" ? c.to : c.shop;
    const verb = c.kind === "bounty" ? "Claim" : "Deliver";
    if (destination !== shopId) return el("span", { class: "dim" }, `${verb} at ${siteName(destination)}`);
    if (!canDeliver(w, c)) return el("span", { class: "dim" }, c.kind === "bounty" ? bountyPays(w) : NOT_READY[c.kind]);
    return this.button(verb, (x) => deliverContract(x, c.id));
  }
}

function bountyPays(w: World): string {
  return vehicleHasPerk(w, playerVehicle(w), "bountyTalk") ? "Pays on knockout, wreck or give-up" : "Pays on knockout or wreck";
}

export const STOCK_FILTER_LABEL: Record<StockFilter, string> = {
  all: "All",
  weapon: "Weapons",
  engine: "Engines",
  armor: "Armor",
  cargo: "Cargo",
  scanner: "Scanners",
  store: "Stores",
  utility: "Utilities",
};

export const FILTER_ICON: Record<Exclude<StockFilter, "all">, IconName> = {
  weapon: "cannon",
  engine: "engine",
  armor: "armor",
  cargo: "cargo",
  scanner: "scanner",
  store: "supplies",
  utility: "utility",
};

const TAB_LABEL: Record<Tab, string> = {
  market: "Market",
  buyParts: "Buy Parts",
  sellParts: "Sell Parts",
  trucks: "Trucks",
  contracts: "Contracts",
};

const TAB_ICON: Record<Tab, IconName> = {
  market: "salt",
  buyParts: "parts",
  sellParts: "money",
  trucks: "truck",
  contracts: "clock",
};

const NOT_READY: Record<Contract["kind"], string> = {
  haul: "Not enough cargo yet",
  fetch: "Needs the part",
  bounty: "Not met yet",
};

const CONTRACT_ICON: Record<Contract["kind"], IconName> = {
  haul: "cargo",
  fetch: "parts",
  bounty: "cannon",
};

function priceEl(price: number): HTMLElement {
  return el("span", { class: "price" }, createIcon("money"), moneyAmount(price));
}

const PROFIT_TONE = { gain: "better", loss: "worse", even: "same" } as const;

function caption(text: string): HTMLElement {
  return el("span", { class: "cap" }, text);
}

function goodsHead(withTheirs: boolean): HTMLElement {
  const c = GOODS_COLUMNS;
  return el(
    "div",
    { class: "goods-head dim" },
    el("span", {}, c.good),
    withTheirs ? el("span", {}, c.theirs) : null,
    el("span", {}, c.buy),
    el("span", {}, c.sell),
    el("span", {}, c.held),
    el("span", { title: PROFIT_HEAD_TITLE, "aria-label": PROFIT_HEAD_TITLE }, c.profit),
  );
}

function countCell(cls: "theirs" | "held", n: number): HTMLElement {
  return el("div", { class: `count ${cls}` }, caption(GOODS_COLUMNS[cls]), el("span", { class: n === 0 ? "num dim" : "num" }, `${n}`));
}

function profitCell(e: SaleEstimate): HTMLElement {
  if (e.kind === "none") return el("div", { class: "profit" });
  const tone = e.kind === "unrecorded" ? "dim" : `delta ${PROFIT_TONE[e.kind]}`;
  return el("div", { class: "profit", title: estimateTitle(e) }, caption(GOODS_COLUMNS.profit), el("span", { class: `num ${tone}` }, estimateText(e)));
}

function keepFocus(root: HTMLElement, render: () => void): void {
  const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
  render();
  if (!key) return;
  root.querySelector<HTMLElement>(`button[data-key="${key}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

function bar(share: number): HTMLElement {
  return el("div", { class: "meter" }, el("div", { style: `width:${Math.max(0, Math.min(1, share)) * 100}%` }));
}

function contractRow(w: World, c: Contract, action: HTMLElement, posted = false): HTMLElement {
  const met = c.kind === "bounty" && c.fulfilled;
  const clock = posted
    ? el("span", { class: "price", title: `${c.window} turns from acceptance` }, createIcon("clock"), contractWindow(c))
    : el("span", { class: "price", ...(met ? {} : { title: `${c.deadline - w.turn} turns left` }) }, createIcon("clock"), heldContractDue(c));
  return el(
    "div",
    { class: "job" },
    createIcon(CONTRACT_ICON[c.kind]),
    el("span", {}, contractSummary(c)),
    el("span", { class: "price" }, createIcon("money"), moneyAmount(c.reward)),
    clock,
    action,
  );
}

function pressureHint(def: ShopDef, state: ShopState, good: string): { text: string; cls: "buy" | "sell" } | null {
  const pressure = state.pressure[good] ?? 0;
  if (pressure >= PRESSURE_HINT_AT) return { text: "short", cls: "sell" };
  if (pressure <= -PRESSURE_HINT_AT) return { text: "flooded", cls: "buy" };
  if (def.makes.includes(good)) return { text: "cheap here", cls: "buy" };
  if (def.needs.includes(good)) return { text: "dear here", cls: "sell" };
  return null;
}


function canDeliver(w: World, c: Contract): boolean {
  const me = playerVehicle(w);
  if (c.kind === "haul") return (goodsCount(me)[c.good] ?? 0) >= c.units;
  if (c.kind === "fetch")
    return spareParts(me).some((p) => fitsFetch(c, p)) || w.player.storage.some((p) => fitsFetch(c, p));
  return c.fulfilled;
}

function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

type TradeTab = "goods" | "parts" | "supplies";

const TRADE_TAB_LABEL: Record<TradeTab, string> = { goods: "Goods", parts: "Parts", supplies: "Fuel & supplies" };

const TRADE_TAB_ICON: Record<TradeTab, IconName> = { goods: "salt", parts: "parts", supplies: "fuel" };

const SUPPLY_STEP = 10;

export class TruckTradeScreen {
  private root = panel("modal");
  private tab: TradeTab = "goods";
  private npcId: string | null = null;
  private error = "";
  private rows = new PartRows(() => this.render());
  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen");
    this.root.style.display = "none";
    window.addEventListener("resize", () => this.render());
    this.inventory = new InventoryView(host, () => this.render(), true);
  }

  isOpen(): boolean {
    return this.npcId !== null;
  }

  openWith(npcId: string): boolean {
    if (!canTradeWith(this.host.world(), npcId)) return false;
    this.npcId = npcId;
    this.root.style.display = "";
    this.error = "";
    this.rows.collapse();
    this.render();
    return true;
  }

  close(): void {
    if (!this.npcId) return;
    const npcId = this.npcId;
    this.inventory.clearSelection();
    this.npcId = null;
    this.root.style.display = "none";
    this.root.replaceChildren();
    this.host.apply(endTrade(this.host.world(), npcId));
  }

  render(): void {
    if (!this.npcId) return;
    this.rows.keepPlace(this.root, () => this.draw());
  }

  private draw(): void {
    const w = this.host.world();
    const npc = w.vehicles.find((v) => v.id === this.npcId);
    if (!npc) throw new Error(`Trade partner ${this.npcId} is gone`);
    const side = [el("div", { class: "tabs" }, ...this.tabButtons())];
    if (this.error) side.push(el("div", { class: "bad" }, this.error));
    side.push(this.tabBody(w, npc));
    const truck = el("div", { class: "town-truck" }, this.inventory.render());
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Leave [Esc]"),
      el("h3", {}, npcName(npc), truckChips(w), partnerChips(npc)),
      el("div", { class: "town-split" }, truck, el("div", { class: "town-shop" }, ...side)),
    );
    this.inventory.fitTo(truck);
  }

  private tabButtons(): HTMLElement[] {
    return (Object.keys(TRADE_TAB_LABEL) as TradeTab[]).map((t) =>
      el(
        "button",
        { class: this.tab === t ? "on" : "", onclick: () => {
          this.tab = t;
          this.rows.collapse();
          this.render();
          this.rows.toTop(this.root);
        } },
        createIcon(TRADE_TAB_ICON[t]),
        TRADE_TAB_LABEL[t],
      ),
    );
  }

  private tabBody(w: World, npc: Vehicle): HTMLElement {
    if (this.tab === "goods") return this.goods(w, npc);
    if (this.tab === "parts") return this.parts(w, npc);
    return el("div", { class: "services" }, this.supplyRow(w, npc, "fuel"), this.supplyRow(w, npc, "supplies"));
  }

  private run(cmd: (w: World) => World): void {
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

  private button(label: string, cmd: (w: World) => World, disabled = false, key = ""): HTMLElement {
    return el("button", { disabled, "data-key": key || undefined, onclick: () => this.run(cmd) }, label);
  }

  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }

  private goods(w: World, npc: Vehicle): HTMLElement {
    const mine = goodsCount(playerVehicle(w));
    const listed = GOOD_IDS.filter((g) => truckGoodsForSale(npc, g) > 0 || (mine[g] ?? 0) > 0);
    if (listed.length === 0) return el("div", { class: "dim" }, "Neither truck carries goods to trade.");
    return el("div", { class: "goods truck" }, goodsHead(true), ...listed.map((g) => this.goodRow(w, npc, g, mine[g] ?? 0)));
  }

  private goodRow(w: World, npc: Vehicle, g: string, held: number): HTMLElement {
    const theirs = truckGoodsForSale(npc, g);
    const sell = truckGoodPrice(w, g, "sell");
    return el(
      "div",
      { class: "good-row" },
      el(
        "div",
        { class: "good-name" },
        createItemIcon(g),
        el("b", {}, GOODS[g].name),
      ),
      countCell("theirs", theirs),
      el(
        "div",
        { class: "trade buy" },
        caption(GOODS_COLUMNS.buy),
        priceEl(truckGoodPrice(w, g, "buy")),
        this.button("+1", (x) => buyTruckGood(x, npc.id, g, 1), theirs < 1, `${g}:buy1`),
        this.button("All", (x) => buyTruckGood(x, npc.id, g, theirs), theirs < 1, `${g}:buyAll`),
      ),
      el(
        "div",
        { class: "trade sell" },
        caption(GOODS_COLUMNS.sell),
        priceEl(sell),
        this.button("−1", (x) => sellTruckGood(x, npc.id, g, 1), held === 0, `${g}:sell1`),
        this.button("All", (x) => sellTruckGood(x, npc.id, g, held), held === 0, `${g}:sellAll`),
      ),
      countCell("held", held),
      profitCell(saleEstimate(held, sell, w.player.costBasis[g])),
    );
  }

  private parts(w: World, npc: Vehicle): HTMLElement {
    const me = playerVehicle(w);
    const row = (p: PartInstance, price: number, payable: boolean, unpaidTitle: string, verb: string, cmd: (w: World) => World): PartRow => ({
      part: p,
      base: compareBase(this.inventory.selectedPart(), p),
      price,
      world: w,
      payable,
      unpaidTitle,
      action: this.button(`${verb} ${moneyText(price)}`, cmd, !payable),
      onHover: this.hintMounts(partDef(p.defId).kind),
    });
    const theirs = spareParts(npc).map((p) => {
      const price = truckPartPrice(w, p, "buy");
      return row(p, price, w.player.money >= price, "Not enough money", "Buy", (x) => buyTruckPart(x, npc.id, p.id));
    });
    const mine = spareParts(me).map((p) => {
      const price = truckPartPrice(w, p, "sell");
      return row(p, price, npc.resources!.money >= price, "They can't pay that", "Sell", (x) => sellTruckPart(x, npc.id, p.id));
    });
    return el(
      "div",
      {},
      el("h3", {}, "Their spare parts"),
      theirs.length ? this.rows.list(theirs) : el("div", { class: "dim" }, "Nothing spare."),
      el("h3", {}, "Your spare parts"),
      mine.length ? this.rows.list(mine) : el("div", { class: "dim" }, "Nothing spare."),
    );
  }

  private supplyRow(w: World, npc: Vehicle, k: Supply): HTMLElement {
    const price = truckSupplyPrice(w, k);
    const offer = truckSupplyForSale(npc, k);
    const most = Math.min(offer, supplyRoom(w, k), Math.floor(w.player.money / price));
    const fuel = k === "fuel";
    const have = w.player[k];
    const cap = fuel ? fuelCap(playerVehicle(w)) : suppliesCap(playerVehicle(w));
    const amount = (n: number) => (fuel ? `${fuelLiters(n)} L` : `${Math.round(n * 10) / 10}`);
    return el(
      "div",
      { class: "service" },
      createIcon(k),
      el("div", { class: "service-meter" }, el("span", {}, `${amount(have)} / ${amount(cap)}`), bar(have / cap)),
      el("span", { class: "dim" }, `${fuel ? `${moneyAmount(price)} per ${amount(1)}` : `${moneyAmount(price)} each`}, ${amount(offer)} on offer`),
      this.button(`+${amount(SUPPLY_STEP)}`, (x) => buyTruckSupply(x, npc.id, k, SUPPLY_STEP), most < SUPPLY_STEP),
      this.button(`Fill ${amount(most)}`, (x) => buyTruckSupply(x, npc.id, k, most), most < 1),
    );
  }
}

function partnerChips(npc: Vehicle): HTMLElement {
  return el(
    "span",
    { class: "chips" },
    el("span", { class: "dim" }, "Them"),
    el("span", { class: "chip", title: "Their money" }, createIcon("money"), moneyChipLabel(npc.resources!.money)),
    el("span", { class: "chip", title: "Their free cargo cells" }, createIcon("cells"), `${freeCells(npc)} free`),
  );
}
