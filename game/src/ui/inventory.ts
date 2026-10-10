// Dredge-style inventory grid: drag items to arrange them, R or right click rotates while dragging.
// At a shop the garage storage shows beside the grid.

import { chassisDef } from "../data/chassis";
import { partDef } from "../data/parts";
import { STRIP } from "../data/salvage";
import { isJunk, maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
import { instantMoveItem } from "../sim/cheats";
import { canRebuild, partRepairCost, repairPart } from "../sim/economy";
import {
  freeCells,
  goodsCount,
  gridOf,
  isMounted,
  placementError,
  type Cell,
  type Spot,
} from "../sim/grid";
import {
  dumpItem,
  moveItem,
  planItemMove,
  plannedRefitTurns,
  startRefit,
  storePart,
  takeFromStorage,
  type RefitLayout,
} from "../sim/inventory";
import { cancelRefit, isParkedForWork, startRepair, startStrip, startWeld, stripYield } from "../sim/jobs";
import { vehicleHasPerk } from "../sim/progress";
import { PERK_NUMBERS } from "../data/skills";
import { repairPlan, type RepairPlan } from "../sim/repair";
import { shopAt } from "../sim/market";
import { atGarage } from "../sim/garage";
import { needsSearch, takeAllLoot, takeLoot, takeStores } from "../sim/locations";
import { canLootTruck, hasStores, hiddenUnits, takeFromTruck } from "../sim/salvage";
import { gaveUp, isKnockedOut } from "../sim/defeat";
import { REGION } from "../data/region";
import type {
  GridItem,
  PartInstance,
  SalvageStock,
  Vehicle,
  World,
} from "../sim/types";
import { el, isBrowserChord, panel } from "./dom";
import type { UiHost } from "./host";
import { baselinePart, conditionMeter, conditionRow, conditionTag, createIcon, diffStats, footprint as footprintEl, itemIconEl, partIconEl, partStats, statGrid, toneStyle } from "./cards";
import { vehicleMass } from "../sim/mass";
import {
  blockerIds,
  clearFan,
  fanSvg,
  nextRot,
  weaponDefOf,
  gridEl,
  itemBox,
  itemName,
  itemState,
  lootGoodItem,
  lootPartItem,
  refitItems,
  removalIds,
  storageItem,
  footprint,
  turnedIcon,
} from "./inventory-draw";
import { fuelLiters, kg, moneyEl, moneyMsg, pricedEl } from "./units";
import { maxSpeedSteps } from "../sim/stats";
import { getSearchAction, powerChip } from "./hud-readout";
import {
  doubleClickCommand,
  planAfterMove,
  plannedVehicle,
  HOLD_TO_DRAG_MS,
  isDoubleClick,
  needsHold,
  selectionAfterClick,
  type ClickedItem,
  type ItemSource,
  type LastClick,
} from "./inventory-moves";
import type { Refusal } from "../sim/types";
import { bindAttr, setText } from "../text/language";
import { t, type Msg } from "../text/msg";
import { chassisName, goodName, partName, siteName, vehicleTitle } from "../text/names";
import { commandFailure } from "./format";

const CELL_PX = 42;
const MIN_CELL_PX = 28;

type Drag = {
  source: ItemSource;
  id: string;
  item: GridItem;
  grab: { x: number; y: number };
  ghost: HTMLElement;
  start: { x: number; y: number };
  moved: boolean;
};

type Press = { timer: number; source: ItemSource; id: string; item: GridItem; grab: { x: number; y: number } };

export class InventoryView {
  private drag: Drag | null = null;
  private press: Press | null = null;
  private lastClick: LastClick = null;
  private lastPointer: PointerEvent | null = null;
  private error: Msg | null = null;
  private gridEl: HTMLElement | null = null;
  private root: HTMLElement = el("div");
  private inspection = el("div", { class: "inv-inspection" });
  private selectedItem: string | null = null;
  private loot: string | null = null;
  private truck: string | null = null;
  private cell = CELL_PX;
  private plan: RefitLayout = {};

  constructor(
    private host: UiHost,
    private onChange: () => void,
    private dumpZone: boolean,
    private instant = false,
  ) {
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onDrop(e));
    this.root.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button, .inv-inspection, .inv-item, .inv-chip")) return;
      this.select(null);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "r" || e.repeat || isBrowserChord(e)) return;
      if (this.drag) this.rotate();
      else this.rotateSelected();
    });
    window.addEventListener("contextmenu", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      this.rotate();
    });
  }

  fitTo(box: HTMLElement): void {
    this.cell = CELL_PX;
    this.render();
    const truck = this.root.querySelector(".inv-truck");
    if (!truck) throw new Error("Inventory view is not rendered");
    const over = truck.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (over <= 0) return;
    const rows = gridOf(this.shown(this.host.world())).h;
    this.cell = Math.max(MIN_CELL_PX, Math.floor(this.cell - over / rows));
    this.render();
  }

  setLoot(stockId: string | null): void {
    this.loot = stockId;
    this.truck = null;
  }

  setTruck(vehicleId: string | null): void {
    this.truck = vehicleId;
    this.loot = null;
  }

  render(): HTMLElement {
    const w = this.host.world();
    const me = this.shown(w);
    const g = gridOf(me);
    this.showSelection(w);
    const grid = gridEl(g, me.chassisId, this.cell);
    grid.append(...this.gridItems(w, me));
    this.gridEl = grid;
    this.showFan(me, this.selectedGun(me));
    this.root.replaceChildren(
      el(
        "div",
        { class: "inv-wrap" },
        el(
          "div",
          { class: "inv-truck" },
          el("div", { class: "truck-shell" }, grid),
        ),
        el(
          "div",
          { class: "inv-side" },
          ...this.refitBanner(w),
          this.sideList(w),
          ...(this.dumpZone ? [el("div", { class: "inv-dump", "data-drop": "dump" }, t("inv.dumpShort"))] : []),
          this.inspection,
        ),
        ...(this.truck ? [this.truckEl(w, this.truck)] : []),
      ),
      this.error ? el("div", { class: "bad" }, this.error) : el("div"),
    );
    return this.root;
  }

  private itemEl(w: World, it: GridItem): HTMLElement {
    const me = this.shown(w);
    const mounted = it.kind === "part" && isMounted(me.chassisId, it);
    const core = it.kind === "part" && partDef(it.part.defId).kind === "core";
    const node = itemBox(it, me.chassisId, mounted, this.cell);
    node.setAttribute("aria-pressed", String(this.selectedItem === it.id));
    node.classList.toggle("selected", this.selectedItem === it.id);
    const click = () => this.clickItem(this.clicked("grid", it.id, it));
    node.addEventListener("click", (e) => {
      if (core || e.detail === 0) click();
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") click();
    });
    this.hoverFan(node, me, it, mounted);
    if (!core)
      node.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        if (!this.gridEl) throw new Error("Grid item pressed without a grid");
        const r = this.gridEl.getBoundingClientRect();
        const grab = {
          x: Math.floor((e.clientX - r.left) / this.cell) - it.x,
          y: Math.floor((e.clientY - r.top) / this.cell) - it.y,
        };
        if (needsHold(me.chassisId, it)) this.startPress(e, "grid", it.id, it, grab);
        else this.startDrag(e, "grid", it.id, it, grab);
      });
    return node;
  }

  private shown(w: World): Vehicle {
    return plannedVehicle(playerVehicle(w), this.plan);
  }

  private gridItems(w: World, v: Vehicle): HTMLElement[] {
    const moving = v.job?.kind === "refit" ? refitItems(w, v) : v.items.filter((it) => this.plan[it.id]);
    const staying = v.items.filter((it) => !moving.some((m) => m.id === it.id));
    return [...staying.map((it) => this.itemEl(w, it)), ...moving.map((it) => this.refittingEl(w, v, it))];
  }

  private refittingEl(w: World, v: Vehicle, item: GridItem): HTMLElement {
    const node = this.itemEl(w, item);
    node.classList.add("refitting");
    if (v.job?.kind === "refit") bindAttr(node, "title", t("inv.itemRefit", { item: itemName(item), n: v.job.turnsLeft }));
    return node;
  }

  private selectedGun(me: Vehicle): GridItem | null {
    const it = me.items.find((item) => item.id === this.selectedItem);
    return it && it.kind === "part" && weaponDefOf(it) && isMounted(me.chassisId, it) ? it : null;
  }

  private hoverFan(node: HTMLElement, me: Vehicle, it: GridItem, mounted: boolean): void {
    if (!mounted || !weaponDefOf(it)) return;
    node.addEventListener("mouseenter", () => this.showFan(me, it));
    node.addEventListener("mouseleave", () => this.showFan(me, this.selectedGun(me)));
  }

  private showFan(me: Vehicle, it: GridItem | null): void {
    if (!this.gridEl) return;
    clearFan(this.gridEl);
    if (it) this.drawFan(this.gridEl, me, it);
  }

  private drawFan(grid: HTMLElement, me: Vehicle, it: GridItem): void {
    const def = weaponDefOf(it);
    if (!def) return;
    grid.append(fanSvg(me, it, def, gridOf(me), this.cell));
    for (const id of blockerIds(me, it)) grid.querySelector(`[data-item-id="${id}"]`)?.classList.add("blocking");
  }

  private selection(w: World): { item: GridItem; mounted: boolean; own: boolean } | null {
    const id = this.selectedItem;
    if (id === null) return null;
    const me = this.shown(w);
    const own = me.items.find((it) => it.id === id);
    if (own) return { item: own, mounted: own.kind === "part" && isMounted(me.chassisId, own), own: true };
    const item = this.otherItems(w).find((it) => it.id === id);
    return item ? { item, mounted: false, own: false } : null;
  }

  private otherItems(w: World): GridItem[] {
    const stock = this.loot ? w.salvage.find((s) => s.id === this.loot) : undefined;
    const target = this.truck ? w.vehicles.find((v) => v.id === this.truck) : undefined;
    return [
      ...w.player.storage.map(storageItem),
      ...(stock ? [...stock.parts.map(lootPartItem), ...Object.keys(stock.goods).map(lootGoodItem)] : []),
      ...(target ? target.items : []),
    ];
  }

  private showSelection(w: World): void {
    const selection = this.selection(w);
    if (!selection) {
      this.selectedItem = null;
      this.inspection.replaceChildren();
    } else if (selection.own) this.showItem(w, selection.item, selection.mounted);
    else this.showTruckItem(w, selection.item, false);
  }

  selectedPart(): PartInstance | null {
    const item = this.selection(this.host.world())?.item;
    return item?.kind === "part" ? item.part : null;
  }

  clearSelection(): void {
    this.selectedItem = null;
    this.lastClick = null;
  }

  private select(id: string | null): void {
    if (this.selectedItem === id) return;
    this.selectedItem = id;
    this.onChange();
  }

  private clickItem(c: ClickedItem): void {
    const now = Date.now();
    const double = isDoubleClick(this.lastClick, c.item.id, now);
    this.lastClick = double ? null : { id: c.item.id, at: now };
    const cmd = double ? doubleClickCommand(this.host.world(), c, this.instant) : null;
    if (cmd) {
      this.selectedItem = null;
      this.run(cmd);
      return;
    }
    this.selectedItem = double ? c.item.id : selectionAfterClick(this.selectedItem, c.item.id);
    this.onChange();
  }

  private clicked(source: ItemSource, id: string, item: GridItem): ClickedItem {
    return { source, id, item, stockId: this.loot, truckId: this.truck };
  }

  private refitBanner(w: World): HTMLElement[] {
    const me = playerVehicle(w);
    if (me.job?.kind === "refit") return [this.bannerEl(t("inv.refitLeft", { n: me.job.turnsLeft }), t("inv.cancelRefit"), () => this.run(cancelRefit), t("inv.cancelRefitTitle"))];
    if (Object.keys(this.plan).length === 0) return [];
    return [this.bannerEl(t("inv.refitPlanned", { n: plannedRefitTurns(w, me, this.plan) }), t("inv.cancelPlan"), () => this.cancelPlan())];
  }

  private bannerEl(text: Msg, label: Msg, onclick: () => void, title?: Msg): HTMLElement {
    return el("div", { class: "inv-refit" }, el("span", {}, text), el("button", { title, onclick }, label));
  }

  private cancelPlan(): void {
    this.plan = {};
    this.onChange();
  }

  commitPlan(): void {
    if (Object.keys(this.plan).length === 0) return;
    const layout = this.plan;
    this.plan = {};
    this.host.apply(startRefit(this.host.world(), layout));
  }

  private sideList(w: World): HTMLElement | null {
    if (this.loot) return this.lootEl(w, this.loot);
    return !this.instant && atGarage(w) ? this.storageEl(w) : null;
  }

  private showItem(w: World, item: GridItem, mounted: boolean): void {
    this.inspection.replaceChildren(
      el("div", { class: "card-head" }, itemIconEl(item), el("div", { class: "card-name" }, el("b", {}, itemName(item)), el("span", { class: "dim" }, itemState(item, mounted)))),
      el("div", { class: "inv-actions" }, ...this.itemActions(w, item, mounted)),
      ...(item.kind === "part" ? partDetails(w, playerVehicle(w), item.part, mounted) : []),
    );
  }

  hintMounts(cells: readonly Cell[] | null): void {
    if (!this.gridEl) return;
    if (cells) this.gridEl.dataset.hint = cells.join(" ");
    else delete this.gridEl.dataset.hint;
  }

  private itemActions(w: World, item: GridItem, mounted: boolean): HTMLElement[] {
    if (item.kind !== "part") return this.goodActions(w, item.good);
    const buttons: (HTMLElement | null)[] = [
      mounted ? this.patchButton(w, playerVehicle(w), item.part) : null,
      shopAt(w) ? this.repairButton(w, item.part) : null,
      !mounted && partDef(item.part.defId).kind !== "core"
        ? this.stripButton(w, playerVehicle(w), item.part)
        : null,
    ];
    return buttons.filter((b): b is HTMLElement => b !== null);
  }

  private patchButton(
    w: World,
    me: Vehicle,
    part: PartInstance,
  ): HTMLElement | null {
    if (isJunk(part)) return null;
    if (!fieldPatchable(part)) return shopOnlyPatch(part);
    const plan = repairPlan(w, me, part.id);
    if (plan.needed === 0) return null;
    const reason = patchBlocker(w, me, plan);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title: reason ?? t("inv.patchYield", { parts: plan.parts, needed: plan.needed, hp: Math.round(plan.hp) }),
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startRepair(world, part.id));
        },
      },
      t("inv.patchLabel", { turns: plan.turns, parts: plan.parts }),
    );
  }

  private repairButton(w: World, part: PartInstance): HTMLElement | null {
    if (!isJunk(part)) return this.garageButton(w, part, "repair", t("inv.repairTitle", { hp: maxHp(part) }));
    return canRebuild(w, part) ? this.garageButton(w, part, "rebuild", t("inv.rebuildTitle")) : null;
  }

  private garageButton(w: World, part: PartInstance, action: "repair" | "rebuild", title: Msg): HTMLElement | null {
    const cost = partRepairCost(w, part);
    if (cost === 0) return null;
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: w.player.money < cost,
        title: w.player.money < cost ? t("trade.needMore", { price: moneyMsg(cost - w.player.money) }) : title,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => repairPart(world, part.id));
        },
      },
      pricedEl(t(`inv.verb.${action}`), cost),
    );
  }

  private stripButton(
    w: World,
    me: Vehicle,
    part: PartInstance,
  ): HTMLElement {
    const reason = stripBlocker(w, me);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title: reason ?? undefined,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startStrip(world, part.id));
        },
      },
      t("inv.stripLabel", { turns: STRIP.turns, parts: stripYield(me, part) }),
    );
  }

  private goodActions(w: World, good: string): HTMLElement[] {
    const me = playerVehicle(w);
    return good === "scrap" && vehicleHasPerk(w, me, "welder") ? [this.weldButton(w, me)] : [];
  }

  private weldButton(w: World, me: Vehicle): HTMLElement {
    const { scrap, turns } = PERK_NUMBERS.welder;
    const reason = weldBlocker(w, me);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title: reason ?? t("inv.weldSpends", { scrap }),
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startWeld(world));
        },
      },
      t("inv.weldLabel", { part: partName(PERK_NUMBERS.welder.part), turns }),
    );
  }

  private storageEl(w: World): HTMLElement {
    const chips = w.player.storage.map((p) => {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: "inv-chip", style: toneStyle(p.defId) },
        partIconEl(p),
        el("span", {}, partName(d.id)),
        conditionTag(p),
        footprintEl(d.w, d.h),
        conditionMeter(p),
      );
      const item = storageItem(p);
      this.markSelected(chip, item);
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "storage", p.id, item, { x: 0, y: 0 }),
      );
      return chip;
    });
    return el(
      "div",
      { class: "inv-storage", "data-drop": "storage" },
      el("h3", {}, t("inv.storage")),
      ...chips,
    );
  }

  private lootPartChips(stock: SalvageStock): HTMLElement[] {
    const chips: HTMLElement[] = [];
    for (const p of stock.parts) {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: "inv-chip", style: toneStyle(p.defId) },
        partIconEl(p),
        el("span", {}, partName(d.id)),
        conditionTag(p),
        footprintEl(d.w, d.h),
        conditionMeter(p),
      );
      const item = lootPartItem(p);
      this.markSelected(chip, item);
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "loot", p.id, item, { x: 0, y: 0 }),
      );
      chips.push(chip);
    }
    return chips;
  }

  private lootGoodChips(stock: SalvageStock): HTMLElement[] {
    const chips: HTMLElement[] = [];
    for (const [good, count] of Object.entries(stock.goods)) {
      if (count <= 0) continue;
      const item = lootGoodItem(good);
      const chip = el(
        "div",
        { class: "inv-chip", style: toneStyle(good) },
        itemIconEl(item),
        t("inv.goodCount", { good: goodName(good), n: count }),
      );
      this.markSelected(chip, item);
      chip.addEventListener("pointerdown", (e) =>
        this.startDrag(e, "loot", good, item, { x: 0, y: 0 }),
      );
      chips.push(chip);
    }
    return chips;
  }

  private lootStoresButton(stock: SalvageStock): HTMLElement[] {
    if (!hasStores(stock)) return [];
    return [
      el(
        "button",
        { onclick: () => this.run((world) => takeStores(world, stock.id)) },
        t("inv.takeStores", { fuel: fuelLiters(stock.fuel ?? 0), supplies: stock.supplies ?? 0 }),
      ),
    ];
  }

  private lootEl(w: World, stockId: string): HTMLElement {
    const stock = w.salvage.find((s) => s.id === stockId);
    if (!stock) throw new Error(`Unknown salvage ${stockId}`);
    const site = REGION.locations.find((l) => l.id === stockId);
    const chips = [
      ...this.lootPartChips(stock),
      ...this.lootGoodChips(stock),
      ...this.lootStoresButton(stock),
    ];
    return el(
      "div",
      { class: "inv-storage inv-loot" },
      el("h3", {}, site ? t("inv.salvageAt", { site: siteName(site.id) }) : t("inv.salvage")),
      ...(chips.length
        ? chips
        : [el("div", { class: "dim" }, hiddenUnits(stock) > 0 ? t("inv.nothingFound") : t("inv.nothingLeft"))]),
      ...(needsSearch(w, stock) ? [this.searchButton(w, stock)] : []),
      ...(chips.length
        ? [
            el(
              "button",
              {
                onclick: () => this.run((world) => takeAllLoot(world, stockId)),
              },
              t("inv.takeAll"),
            ),
          ]
        : []),
    );
  }

  private searchButton(w: World, stock: SalvageStock): HTMLElement {
    const action = getSearchAction(w, stock);
    return el(
      "button",
      { class: "inv-search", disabled: !action.ready && action.combat === undefined, onclick: () => this.host.searchStock(stock.id) },
      t("inv.searchMore"),
    );
  }

  private truckEl(w: World, truckId: string): HTMLElement {
    const target = w.vehicles.find((v) => v.id === truckId);
    if (!target || !isKnockedOut(target))
      return el("div", { class: "inv-truck inv-target" }, el("h3", {}, t("inv.truckGone")));
    const grid = gridEl(gridOf(target), target.chassisId, this.cell);
    const removing = removalIds(w, target);
    grid.append(...target.items.map((it) => this.truckItemEl(w, target, it, grid, removing.has(it.id))));
    return el(
      "div",
      { class: "inv-truck inv-target" },
      el("h3", {}, gaveUp(target) ? t("inv.truckGaveUp", { truck: vehicleTitle(w, target) }) : t("inv.truckOut", { truck: vehicleTitle(w, target) })),
      el("div", { class: "truck-shell" }, grid),
    );
  }

  private truckItemEl(w: World, target: Vehicle, it: GridItem, grid: HTMLElement, removing: boolean): HTMLElement {
    const mounted = it.kind === "part" && isMounted(target.chassisId, it);
    const node = itemBox(it, target.chassisId, mounted, this.cell);
    node.classList.toggle("refitting", removing);
    this.markSelected(node, it);
    const select = () => this.clickItem(this.clicked("truck", it.id, it));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter") select();
    });
    if (it.kind === "part" && partDef(it.part.defId).kind === "core") {
      node.addEventListener("click", select);
      return node;
    }
    node.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = grid.getBoundingClientRect();
      this.startDrag(e, "truck", it.id, it, { x: Math.floor((e.clientX - r.left) / this.cell) - it.x, y: Math.floor((e.clientY - r.top) / this.cell) - it.y });
    });
    return node;
  }

  private showTruckItem(w: World, item: GridItem, mounted: boolean): void {
    this.inspection.replaceChildren(
      el("div", { class: "card-head" }, itemIconEl(item), el("div", { class: "card-name" }, el("b", {}, itemName(item)), el("span", { class: "dim" }, itemState(item, mounted)))),
      ...(item.kind === "part" ? partDetails(w, playerVehicle(w), item.part, false) : []),
    );
  }

  private startDrag(
    e: PointerEvent,
    source: Drag["source"],
    id: string,
    item: GridItem,
    grab: { x: number; y: number },
  ): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.beginDrag(e, source, id, item, grab);
  }

  private startPress(e: PointerEvent, source: ItemSource, id: string, item: GridItem, grab: Press["grab"]): void {
    e.preventDefault();
    e.stopPropagation();
    this.endPress();
    (e.currentTarget as HTMLElement).classList.add("holding");
    const timer = window.setTimeout(() => {
      this.press = null;
      this.beginDrag(this.lastPointer ?? e, source, id, item, grab);
      this.drag?.ghost.classList.add("held");
    }, HOLD_TO_DRAG_MS);
    this.press = { timer, source, id, item, grab };
    this.lastPointer = e;
  }

  private endPress(): Press | null {
    const press = this.press;
    if (press) window.clearTimeout(press.timer);
    this.press = null;
    return press;
  }

  private beginDrag(at: PointerEvent, source: Drag["source"], id: string, item: GridItem, grab: { x: number; y: number }): void {
    const ghost = el("div", { class: "inv-ghost" });
    document.body.append(ghost);
    this.drag = {
      source,
      id,
      item: { ...item },
      grab,
      ghost,
      start: { x: at.clientX, y: at.clientY },
      moved: false,
    };
    this.error = null;
    this.onMove(at);
  }

  private markSelected(node: HTMLElement, item: GridItem): void {
    node.classList.toggle("selected", this.selectedItem === item.id);
  }

  private rotate(): void {
    if (!this.drag) return;
    this.drag.moved = true;
    this.drag.item = {
      ...this.drag.item,
      rot: nextRot(this.drag.item),
    };
    this.drag.grab = { x: 0, y: 0 };
    if (this.lastPointer) this.onMove(this.lastPointer);
  }

  private rotateSelected(): void {
    if (!this.gridEl?.isConnected || this.selectedItem === null) return;
    const item = this.shown(this.host.world()).items.find(
      (it) => it.id === this.selectedItem,
    );
    if (!item || item.kind !== "part") return;
    const id = item.id;
    let turned = item;
    for (let i = 0; i < 3; i++) {
      turned = { ...turned, rot: nextRot(turned) };
      const to = { x: item.x, y: item.y, rot: turned.rot };
      const last = i === 2;
      let fits = true;
      this.run((w) => {
        try {
          return this.moveGridItem(w, id, to);
        } catch (err) {
          fits = false;
          if (last) throw err;
          return w;
        }
      }, !last);
      if (fits) return;
    }
  }

  private onMove(e: PointerEvent): void {
    this.lastPointer = e;
    if (!this.drag) return;
    if (
      Math.hypot(
        e.clientX - this.drag.start.x,
        e.clientY - this.drag.start.y,
      ) >=
      this.cell / 4
    )
      this.drag.moved = true;
    const spot = this.spotAt(e.clientX, e.clientY);
    if (spot) this.drag.item = { ...this.drag.item, x: spot.x, y: spot.y };
    this.paintGhost(e, spot !== null);
  }

  private paintGhost(e: PointerEvent, onGrid: boolean): void {
    const d = this.drag!;
    const size = footprint(d.item);
    d.ghost.className = `inv-ghost ${this.ghostTone(d, onGrid)}`;
    d.ghost.replaceChildren(turnedIcon(d.item, this.cell));
    this.ghostFan(d, onGrid);
    d.ghost.style.width = `${size.w * this.cell}px`;
    d.ghost.style.height = `${size.h * this.cell}px`;
    const at = this.ghostCorner(e, d, onGrid);
    d.ghost.style.left = `${at.x}px`;
    d.ghost.style.top = `${at.y}px`;
  }

  private ghostTone(d: Drag, onGrid: boolean): string {
    if (!onGrid) return "";
    return this.placementProblem(d) === null ? "ok" : "no";
  }

  private ghostFan(d: Drag, onGrid: boolean): void {
    if (!this.gridEl) return;
    clearFan(this.gridEl);
    if (onGrid) this.drawFan(this.gridEl, this.shown(this.host.world()), d.item);
  }

  private ghostCorner(e: PointerEvent, d: Drag, onGrid: boolean): { x: number; y: number } {
    const g = this.gridEl?.getBoundingClientRect();
    if (onGrid && g) return { x: g.left + d.item.x * this.cell, y: g.top + d.item.y * this.cell };
    return { x: e.clientX - this.cell / 2, y: e.clientY - this.cell / 2 };
  }

  private placementProblem(d: Drag): Refusal | null {
    const me = playerVehicle(this.host.world());
    if (d.source === "grid")
      return planItemMove(this.shown(this.host.world()), d.id, {
        x: d.item.x,
        y: d.item.y,
        rot: d.item.rot,
      }).error;
    const others = me.items.filter((it) => it.id !== d.id);
    return placementError(
      gridOf({ ...me, items: [...others, d.item] }),
      others,
      d.item,
      null,
    );
  }

  private spotAt(cx: number, cy: number): Spot | null {
    if (!this.gridEl || !this.drag) return null;
    const r = this.gridEl.getBoundingClientRect();
    if (cx < r.left || cy < r.top || cx >= r.right || cy >= r.bottom)
      return null;
    const x = Math.floor((cx - r.left) / this.cell) - this.drag.grab.x;
    const y = Math.floor((cy - r.top) / this.cell) - this.drag.grab.y;
    return { x, y, rot: this.drag.item.rot };
  }

  private onDrop(e: PointerEvent): void {
    const press = this.endPress();
    if (press) return this.clickItem(this.clicked(press.source, press.id, press.item));
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    const shown = this.shown(this.host.world());
    this.showFan(shown, this.selectedGun(shown));
    if (this.finishSelection(d)) return;
    this.run(this.dropCommand(e, d), true);
  }

  private dropCommand(e: PointerEvent, d: Drag): (w: World) => World {
    if (this.gridEl !== null && this.inside(e)) return (w) => this.dropOnGrid(w, d);
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-drop]")?.getAttribute("data-drop");
    return d.source === "grid" ? offGridCommand(target, d.id) : (w) => w;
  }

  private dropOnGrid(w: World, d: Drag): World {
    const to = { x: d.item.x, y: d.item.y, rot: d.item.rot };
    if (d.source === "grid") return this.moveGridItem(w, d.id, to);
    if (d.source === "storage") return takeFromStorage(w, d.id, to);
    if (d.source === "truck") return takeFromTruck(w, this.truck!, d.id, to);
    return takeLoot(
      w,
      this.loot!,
      d.item.kind === "part"
        ? { kind: "part", partId: d.id }
        : { kind: "good", good: d.id },
      to,
    );
  }

  private finishSelection(drag: Drag): boolean {
    if (drag.moved) return false;
    const item = drag.source === "grid" ? this.shown(this.host.world()).items.find((entry) => entry.id === drag.id) : drag.item;
    if (item) this.clickItem(this.clicked(drag.source, drag.id, item));
    return true;
  }

  private inside(e: PointerEvent): boolean {
    const r = this.gridEl!.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientY >= r.top &&
      e.clientX < r.right &&
      e.clientY < r.bottom
    );
  }

  private moveGridItem(w: World, itemId: string, to: Spot): World {
    if (this.instant) return instantMoveItem(w, itemId, to);
    if (atGarage(w)) return moveItem(w, itemId, to);
    this.planMove(w, itemId, to);
    return w;
  }

  private planMove(w: World, itemId: string, to: Spot): void {
    const next = planAfterMove(playerVehicle(w), this.plan, itemId, to);
    if (Object.keys(next).length > 0) startRefit(w, next);
    this.plan = next;
  }

  private run(cmd: (w: World) => World, quiet = false): void {
    try {
      const w = this.host.world();
      const next = cmd(w);
      if (next !== w) {
        this.plan = {};
        this.host.apply(next);
      }
      this.error = null;
    } catch (err) {
      this.error = quiet ? null : commandFailure(this.host.world(), err);
    }
    this.onChange();
  }
}

function offGridCommand(target: string | null | undefined, itemId: string): (w: World) => World {
  if (target === "storage") return (w) => storePart(w, itemId);
  return target === "dump" ? (w) => dumpItem(w, itemId) : (w) => w;
}

export class InventoryScreen {
  private root = panel("modal dialog");
  private view: InventoryView;

  constructor(private host: UiHost) {
    this.root.classList.add("inventory-screen");
    this.root.style.display = "none";
    window.addEventListener("resize", () => this.render());
    this.view = new InventoryView(host, () => this.render(), true);
  }

  isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  toggle(): void {
    if (this.isOpen()) return this.close();
    this.view.setLoot(null);
    this.root.style.display = "";
    this.render();
  }

  openLoot(stockId: string): void {
    this.view.setLoot(stockId);
    this.root.style.display = "";
    this.render();
  }

  openDowned(world: World, vehicleId: string): boolean {
    const downed = world.vehicles.find((v) => v.id === vehicleId);
    if (!downed || !canLootTruck(world, playerVehicle(world), downed)) return false;
    this.view.setTruck(downed.id);
    this.root.style.display = "";
    this.render();
    return true;
  }

  close(): void {
    this.view.clearSelection();
    this.root.style.display = "none";
    this.root.replaceChildren();
    this.view.commitPlan();
  }

  render(): void {
    if (!this.isOpen()) return;
    const truck = el("div", { class: "inv-body" }, this.view.render());
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, t("inv.close")),
      el("h3", {}, t("inv.title"), truckChips(this.host.world())),
      truck,
    );
    this.view.fitTo(truck);
  }
}

export function truckChips(w: World, opts: { freeCells: boolean } = { freeCells: true }): HTMLElement {
  const me = playerVehicle(w);
  const mass = vehicleMass(me);
  const rated = chassisDef(me.chassisId).ratedMass;
  return el(
    "span",
    { class: "chips" },
    el("span", { class: "chip" }, createIcon("truck"), chassisName(chassisDef(me.chassisId).id)),
    el("span", { class: "chip" }, moneyEl(w.player.money)),
    opts.freeCells ? el("span", { class: "chip", title: t("inv.freeCellsTitle") }, createIcon("cells"), t("inv.freeCells", { n: freeCells(me) })) : null,
    el(
      "span",
      { class: `chip${mass > rated ? " bad" : ""}`, title: t("inv.loadTitle") },
      createIcon("load"),
      t("speed.loadChip", { mass: kg(mass), rated: kg(rated) }),
    ),
    powerChipNode(w, me),
  );
}

function powerChipNode(w: World, me: Vehicle): HTMLElement {
  const chip = powerChip(maxSpeedSteps(w, me), me);
  return el("span", { class: `chip${chip.over ? " bad" : ""}`, title: chip.detail, "aria-label": chip.detail }, createIcon("power"), chip.text);
}

// Why a Patch button is disabled, or null when the patch can start.
function patchBlocker(w: World, me: Vehicle, plan: RepairPlan): Msg | null {
  if (!isParkedForWork(w, me)) return t("inv.stopToPatch");
  return plan.parts === 0 ? t("inv.noParts") : null;
}

// Why a Strip button is disabled, or null when stripping can start.
function stripBlocker(w: World, me: Vehicle): Msg | null {
  if (!isParkedForWork(w, me)) return t("inv.stopToStrip");
  if (me.job) return t("inv.busy");
  return null;
}

// Why a Weld button is disabled, or null when welding can start.
function weldBlocker(w: World, me: Vehicle): Msg | null {
  if (!isParkedForWork(w, me)) return t("inv.stopToWeld");
  if (me.job) return t("inv.busy");
  const scrap = PERK_NUMBERS.welder.scrap;
  return (goodsCount(me).scrap ?? 0) < scrap ? t("inv.needsScrap", { n: scrap }) : null;
}

function fieldPatchable(part: PartInstance): boolean {
  const def = partDef(part.defId);
  return def.kind !== "armor" || def.fieldRepair !== "none";
}

function shopOnlyPatch(part: PartInstance): HTMLElement | null {
  return part.hp < maxHp(part) ? el("button", { class: "inv-patch", disabled: true, title: t("inv.shopOnly") }, t("inv.verb.patch")) : null;
}

function partDetails(w: World, me: Vehicle, part: PartInstance, mounted: boolean): HTMLElement[] {
  const kind = partDef(part.defId).kind;
  const base = mounted ? null : baselinePart(me, kind);
  const row = conditionRow(part);
  return [
    ...(row ? [row] : []),
    conditionMeter(part),
    statGrid(diffStats(partStats(w, part), base ? partStats(w, base) : null)),
    base ? el("p", { class: "dim" }, t("inv.against", { part: partName(base.defId) }), conditionTag(base)) : el("span"),
  ];
}
