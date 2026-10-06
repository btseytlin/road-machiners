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
  tradeReady,
  truckGoodPrice,
  truckPartPrice,
  truckGoodsForSale,
  truckSupplyForSale,
  truckSupplyPrice,
  type Supply,
} from "../sim/economy";
import { freeCells, goodsCount, MOUNT_CELLS, mountedParts } from "../sim/grid";
import { moneyLabel } from "./hud-readout";
import { spareParts } from "../sim/inventory";
import { acceptContract, deliverContract, fitsFetch, shopAt, shopState, type Contract, type ShopState } from "../sim/market";
import { REGION } from "../data/region";
import type { PartInstance, Vehicle, World } from "../sim/types";
import { chassisMap, chassisStats, compareBase, createIcon, diffStats, goodIcon, partCard, statGrid, type IconName } from "./cards";
import { el, panel } from "./dom";
import { contractDue, contractSummary, contractWindow, ESTIMATE_HELP, ESTIMATE_HELP_TITLE, GOODS_COLUMNS, heldLines, heldReadout, lotTitle } from "./format";
import { InventoryView, truckChips } from "./inventory";
import type { UiHost } from "./host";
import { fuelLiters } from "./units";
import { fuelCap, suppliesCap } from "../sim/stats";
import { npcName } from "../sim/spawn";

type Tab = "market" | "buyParts" | "sellParts" | "trucks" | "contracts";

// The part stock filter. Core parts are built in, so no shop sells them.
type StockFilter = "all" | Exclude<PartKind, "core">;

const STOCK_FILTERS: StockFilter[] = ["all", "weapon", "engine", "armor", "cargo", "scanner", "store"];

const GARAGE_ONLY: Tab[] = ["trucks"];

// A price is pushed away from the shop's usual factor once trading has moved it this far, worth
// calling out over the plain make/need read. Scaled against PRESSURE_MAX (0.6) in src/data/market.ts.
const PRESSURE_HINT_AT = 0.2;

export class TownScreen {
  private root = panel("modal");
  private tab: Tab = "market";
  private stockFilter: StockFilter = "all";
  private error = "";

  private inventory: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("town-screen");
    this.root.style.display = "none";
    // The truck grid fits its cells to the window height, so a resize lays the screen out again.
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
    this.render();
  }

  // Closed windows drop their contents, so hidden copies never answer clicks or drops.
  close(): void {
    this.inventory.clearSelection();
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
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
      el("h3", {}, siteName(shopId), truckChips(w)),
      el("div", { class: "town-split" }, truck, el("div", { class: "town-shop" }, ...shop)),
    );
    this.inventory.fitTo(truck);
  }

  // A garage-only tab left over from a garage falls back to Market at a stall.
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
            this.render();
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
      sellParts: () => this.sellParts(w, def),
      trucks: () => this.trucks(w),
      contracts: () => this.contracts(w, shopId),
    };
    return body[this.tab]();
  }

  // Runs a command; a thrown rule error shows in the screen instead of changing the world.
  private run(cmd: (w: World) => World): void {
    try {
      this.host.apply(cmd(this.host.world()));
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.render();
  }

  private button(label: string, cmd: (w: World) => World, disabled = false, title = ""): HTMLElement {
    return el("button", { disabled, title, onclick: () => this.run(cmd) }, label);
  }

  // Mount cells for a hovered card's part kind light up on the truck grid.
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
        goodsHead(),
        ...def.goods.map((g) => this.goodRow(w, shopId, def, state, g)),
      ),
      goodsHelp(),
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
        createIcon(goodIcon(g)),
        el("b", {}, GOODS[g].name),
        hint ? el("span", { class: `tag ${hint.cls}` }, hint.text) : null,
      ),
      el(
        "div",
        { class: "trade buy" },
        tradeCaption(GOODS_COLUMNS.buy),
        priceEl(buyPrice(w, shopId, g)),
        this.button("+1", (x) => buyGood(x, g, 1)),
        this.button("+5", (x) => buyGood(x, g, 5), false, lotTitle("buy", 5, getLotTradePrice(w, playerVehicle(w), shopId, g, 5, "buy"))),
      ),
      el(
        "div",
        { class: "trade sell" },
        tradeCaption(GOODS_COLUMNS.sell),
        priceEl(sell),
        this.button("−1", (x) => sellGood(x, g, 1), held === 0),
        this.button("All", (x) => sellGood(x, g, held), held === 0, held ? lotTitle("sell", held, getLotTradePrice(w, playerVehicle(w), shopId, g, held, "sell")) : ""),
      ),
      heldCell(held, sell, w.player.costBasis[g]),
    );
  }

  private buyParts(w: World, shopId: string): HTMLElement {
    const me = playerVehicle(w);
    const stock = shopState(w, shopId).stock;
    const shown = stock.filter((p) => this.stockFilter === "all" || partDef(p.defId).kind === this.stockFilter);
    const cards = shown.map((p) => {
      const kind = partDef(p.defId).kind;
      const price = partTradePrice(w, me, p, "buy");
      return partCard({
        part: p,
        base: compareBase(this.inventory.selectedPart(), p),
        action: this.button(`Buy ${price}`, (x) => buyStockPart(x, p.id), w.player.money < price),
        onHover: this.hintMounts(kind),
      });
    });
    return el(
      "div",
      {},
      el("div", { class: "tabs sub" }, ...this.stockFilterButtons(stock)),
      cards.length
        ? el("div", { class: "cards" }, ...cards)
        : el("div", { class: "dim" }, stock.length ? "No parts of this kind in stock." : "No parts in stock."),
    );
  }

  // One button per part kind with its stock count. A kind with nothing in stock is disabled.
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
            this.render();
          },
        },
        f === "all" ? "All" : createIcon(FILTER_ICON[f]),
        el("span", { class: "count" }, `${count}`),
      );
    });
  }

  // Spares sell at any shop, stored parts only at a garage, as sellPart() accepts.
  private sellParts(w: World, def: ShopDef): HTMLElement {
    const me = playerVehicle(w);
    const garage = def.kind === "garage";
    const sellable: PartInstance[] = [...(garage ? w.player.storage : []), ...spareParts(me)];
    const cards = sellable.map((p) => {
      const kind = partDef(p.defId).kind;
      return partCard({
        part: p,
        base: compareBase(this.inventory.selectedPart(), p),
        action: this.button(`Sell ${partTradePrice(w, me, p, "sell")}`, (x) => sellPart(x, p.id)),
        onHover: this.hintMounts(kind),
      });
    });
    return el(
      "div",
      {},
      el("h3", {}, garage ? "Sell spare and stored parts" : "Sell spare parts"),
      cards.length
        ? el("div", { class: "cards" }, ...cards)
        : el("div", { class: "dim" }, garage ? "No spare or stored parts." : "No spare parts."),
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
      el("span", { class: "dim" }, fuel ? `${price} per ${amount(1)}` : `${price} each`),
      this.button(`+${amount(1)}`, (x) => buySupply(x, k, 1), afford < 1),
      this.button(`Fill ${amount(afford)}`, (x) => buySupply(x, k, afford), afford < 1),
    );
  }

  // Shop repairs beside the truck: the built-in parts alone, or every part.
  private repairBar(w: World): HTMLElement {
    const broken = mountedParts(playerVehicle(w)).filter((p) => p.hp === 0).length;
    const basics = basicsRepairCost(w);
    const all = repairCost(w);
    return el(
      "div",
      { class: "town-repair" },
      createIcon("tools"),
      el("span", { class: broken ? "bad" : "dim" }, broken ? `${broken} broken` : "Nothing broken"),
      this.button(basics === 0 ? "Basics fine" : `Repair basics ${basics}`, repairBasics, basics === 0),
      this.button(all === 0 ? "No repairs" : `Repair all ${all}`, repairAll, all === 0),
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
        chassisMap(id),
        el(
          "div",
          { class: "truck-body" },
          el("div", { class: "card-name" }, el("b", {}, chassisDef(id).name)),
          statGrid(diffStats(chassisStats(id), own ? null : mine)),
          el(
            "div",
            { class: "card-foot" },
            el("span", { class: "dim" }, own ? "Your truck" : `vs ${chassisDef(me.chassisId).name}`),
            own ? null : this.button(cost >= 0 ? `Swap ${cost}` : `Swap, get ${-cost} back`, (x) => buyChassis(x, id), w.player.money < cost),
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
        `Your truck trades in for ${tradeIn}.`,
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
    if (c.kind === "bounty") return el("span", { class: "dim" }, "Pays on defeat");
    const destination = c.kind === "haul" ? c.to : c.shop;
    if (destination !== shopId) return el("span", { class: "dim" }, `Deliver at ${siteName(destination)}`);
    if (!canDeliver(w, c)) return el("span", { class: "dim" }, c.kind === "haul" ? "Not enough cargo yet" : "Needs the part");
    return this.button("Deliver", (x) => deliverContract(x, c.id));
  }
}

const STOCK_FILTER_LABEL: Record<StockFilter, string> = {
  all: "All",
  weapon: "Weapons",
  engine: "Engines",
  armor: "Armor",
  cargo: "Cargo",
  scanner: "Scanners",
  store: "Stores",
};

const FILTER_ICON: Record<Exclude<StockFilter, "all">, IconName> = {
  weapon: "cannon",
  engine: "engine",
  armor: "armor",
  cargo: "cargo",
  scanner: "scanner",
  store: "supplies",
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

const CONTRACT_ICON: Record<Contract["kind"], IconName> = {
  haul: "cargo",
  fetch: "parts",
  bounty: "cannon",
};

function priceEl(price: number): HTMLElement {
  return el("span", { class: "price" }, createIcon("money"), `${price}`);
}

const HELD_TONE_CLASS = { count: "held-count", gain: "delta better", loss: "delta worse", even: "delta same", dim: "dim" } as const;

// The count in the truck and the worded sale estimate against the average cost.
function heldCell(held: number, sell: number, basis: number | undefined): HTMLElement {
  const lines = heldLines(heldReadout(held, sell, basis));
  return el("div", { class: "held" }, ...lines.map((l) => el("span", { class: HELD_TONE_CLASS[l.tone] }, l.text)));
}

function tradeCaption(text: string): HTMLElement {
  return el("span", { class: "trade-caption" }, text);
}

function goodsHead(): HTMLElement {
  const c = GOODS_COLUMNS;
  return el("div", { class: "goods-head dim" }, el("span", {}, c.good), el("span", {}, c.buy), el("span", {}, c.sell), el("span", {}, c.held));
}

function goodsHelp(): HTMLElement {
  return el("details", { class: "goods-help dim" }, el("summary", {}, ESTIMATE_HELP_TITLE), ...ESTIMATE_HELP.map((line) => el("div", {}, line)));
}

function bar(share: number): HTMLElement {
  return el("div", { class: "meter" }, el("div", { style: `width:${Math.max(0, Math.min(1, share)) * 100}%` }));
}

// An offer on the board shows how long it gives from acceptance. A held contract shows when it is due.
function contractRow(w: World, c: Contract, action: HTMLElement, posted = false): HTMLElement {
  const clock = posted
    ? el("span", { class: "price", title: `${c.window} turns from acceptance` }, createIcon("clock"), contractWindow(c))
    : el("span", { class: "price", title: `${c.deadline - w.turn} turns left` }, createIcon("clock"), contractDue(c));
  return el(
    "div",
    { class: "job" },
    createIcon(CONTRACT_ICON[c.kind]),
    el("span", {}, contractSummary(c)),
    el("span", { class: "price" }, createIcon("money"), `${c.reward}`),
    clock,
    action,
  );
}

// "cheap here" / "dear here" read the shop's make/need profile; "flooded" / "short" read standing
// pressure once trading has moved a price far enough to notice. cls says whether it favors buying or selling.
function pressureHint(def: ShopDef, state: ShopState, good: string): { text: string; cls: "buy" | "sell" } | null {
  const pressure = state.pressure[good] ?? 0;
  if (pressure >= PRESSURE_HINT_AT) return { text: "short", cls: "sell" };
  if (pressure <= -PRESSURE_HINT_AT) return { text: "flooded", cls: "buy" };
  if (def.makes.includes(good)) return { text: "cheap here", cls: "buy" };
  if (def.needs.includes(good)) return { text: "dear here", cls: "sell" };
  return null;
}


// True when the player already holds what a haul or fetch contract needs to hand in.
function canDeliver(w: World, c: Contract): boolean {
  const me = playerVehicle(w);
  if (c.kind === "haul") return (goodsCount(me)[c.good] ?? 0) >= c.units;
  if (c.kind === "fetch")
    return spareParts(me).some((p) => fitsFetch(c, p)) || w.player.storage.some((p) => fitsFetch(c, p));
  return false;
}

function siteName(id: string): string {
  const site = [...REGION.towns, ...REGION.locations].find((s) => s.id === id);
  if (!site) throw new Error(`Unknown site ${id}`);
  return site.name;
}

// Trade with an NPC truck parked beside the player, laid out like the town screen. Leaving ends the trade, so the
// driver drives on.
type TradeTab = "goods" | "parts" | "supplies";

const TRADE_TAB_LABEL: Record<TradeTab, string> = { goods: "Goods", parts: "Parts", supplies: "Fuel & supplies" };

const TRADE_TAB_ICON: Record<TradeTab, IconName> = { goods: "salt", parts: "parts", supplies: "fuel" };

// A step between one unit and the whole amount, for filling a tank in a few clicks.
const SUPPLY_STEP = 10;

export class TruckTradeScreen {
  private root = panel("modal");
  private tab: TradeTab = "goods";
  private npcId: string | null = null;
  private error = "";
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

  // Opens on the driver the player can trade with now. False when there is none.
  openIfReady(): boolean {
    const npc = tradeReady(this.host.world());
    if (!npc) return false;
    this.npcId = npc.id;
    this.root.style.display = "";
    this.error = "";
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
        { class: this.tab === t ? "on" : "", onclick: () => { this.tab = t; this.render(); } },
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

  // Runs a command. A thrown rule error shows in the screen instead of changing the world.
  private run(cmd: (w: World) => World): void {
    try {
      this.host.apply(cmd(this.host.world()));
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.render();
  }

  private button(label: string, cmd: (w: World) => World, disabled = false): HTMLElement {
    return el("button", { disabled, onclick: () => this.run(cmd) }, label);
  }

  private hintMounts(kind: PartKind): (on: boolean) => void {
    return (on) => this.inventory.hintMounts(on ? MOUNT_CELLS[kind] : null);
  }

  // Goods either truck carries. The driver's count leaves out what it keeps for itself.
  private goods(w: World, npc: Vehicle): HTMLElement {
    const mine = goodsCount(playerVehicle(w));
    const listed = GOOD_IDS.filter((g) => truckGoodsForSale(npc, g) > 0 || (mine[g] ?? 0) > 0);
    if (listed.length === 0) return el("div", { class: "dim" }, "Neither truck carries goods to trade.");
    return el(
      "div",
      {},
      el("div", { class: "goods" }, goodsHead(), ...listed.map((g) => this.goodRow(w, npc, g, mine[g] ?? 0))),
      goodsHelp(),
    );
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
        createIcon(goodIcon(g)),
        el("b", {}, GOODS[g].name),
        el("span", { class: "dim" }, theirs ? `×${theirs} on offer` : "none on offer"),
      ),
      el(
        "div",
        { class: "trade buy" },
        tradeCaption(GOODS_COLUMNS.buy),
        priceEl(truckGoodPrice(w, g, "buy")),
        this.button("+1", (x) => buyTruckGood(x, npc.id, g, 1), theirs < 1),
        this.button("All", (x) => buyTruckGood(x, npc.id, g, theirs), theirs < 1),
      ),
      el(
        "div",
        { class: "trade sell" },
        tradeCaption(GOODS_COLUMNS.sell),
        priceEl(sell),
        this.button("−1", (x) => sellTruckGood(x, npc.id, g, 1), held === 0),
        this.button("All", (x) => sellTruckGood(x, npc.id, g, held), held === 0),
      ),
      heldCell(held, sell, w.player.costBasis[g]),
    );
  }

  private parts(w: World, npc: Vehicle): HTMLElement {
    const me = playerVehicle(w);
    const card = (p: PartInstance, action: HTMLElement) => {
      const kind = partDef(p.defId).kind;
      return partCard({ part: p, base: compareBase(this.inventory.selectedPart(), p), action, onHover: this.hintMounts(kind) });
    };
    const theirs = spareParts(npc).map((p) => {
      const price = truckPartPrice(w, p, "buy");
      return card(p, this.button(`Buy ${price}`, (x) => buyTruckPart(x, npc.id, p.id), w.player.money < price));
    });
    const mine = spareParts(me).map((p) => {
      const price = truckPartPrice(w, p, "sell");
      return card(p, this.button(`Sell ${price}`, (x) => sellTruckPart(x, npc.id, p.id), npc.resources!.money < price));
    });
    return el(
      "div",
      {},
      el("h3", {}, "Their spare parts"),
      theirs.length ? el("div", { class: "cards" }, ...theirs) : el("div", { class: "dim" }, "Nothing spare."),
      el("h3", {}, "Your spare parts"),
      mine.length ? el("div", { class: "cards" }, ...mine) : el("div", { class: "dim" }, "Nothing spare."),
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
      el("span", { class: "dim" }, `${fuel ? `${price} per ${amount(1)}` : `${price} each`}, ${amount(offer)} on offer`),
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
    el("span", { class: "chip", title: "Their money" }, createIcon("money"), moneyLabel(npc.resources!.money)),
    el("span", { class: "chip", title: "Their free cargo cells" }, createIcon("cells"), `${freeCells(npc)} free`),
  );
}
