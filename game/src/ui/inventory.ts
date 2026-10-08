// Dredge-style inventory grid: drag items to arrange them, R or right click rotates while dragging.
// In a town the garage storage shows beside the grid.

import { GOODS } from "../data/goods";
import { chassisDef } from "../data/chassis";
import { partDef } from "../data/parts";
import { STRIP } from "../data/salvage";
import { isJunk, maxHp } from "../sim/wear";
import { playerVehicle } from "../sim/damage";
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
  storePart,
  takeFromStorage,
} from "../sim/inventory";
import { cancelRefit, isParkedForWork, startRepair, startStrip, startWeld, stripYield } from "../sim/jobs";
import { vehicleHasPerk } from "../sim/progress";
import { PERK_NUMBERS } from "../data/skills";
import { repairPlan, type RepairPlan } from "../sim/repair";
import { townAt } from "../sim/sites";
import { downedHere, takeAllLoot, takeLoot, takeStores } from "../sim/locations";
import { hasStores, takeFromTruck } from "../sim/salvage";
import { gaveUp, isKnockedOut } from "../sim/defeat";
import { REGION } from "../data/region";
import type {
  GridItem,
  PartInstance,
  SalvageStock,
  Vehicle,
  World,
} from "../sim/types";
import { el, panel } from "./dom";
import type { UiHost } from "./host";
import { baselinePart, conditionMeter, createIcon, diffStats, footprint as footprintEl, partIcon, partStats, statGrid } from "./cards";
import { vehicleMass } from "../sim/mass";
import {
  blockerIds,
  clearFan,
  fanSvg,
  weaponDefOf,
  getItemIcon,
  gridEl,
  itemBox,
  itemLabel,
  itemName,
  itemState,
  KIND_CLASS,
  lootGoodItem,
  lootPartItem,
  partTitle,
  refitItems,
  removalIds,
  storageItem,
  footprint,
} from "./inventory-draw";
import { fuelLiters, kg } from "./units";
import { moneyLabel } from "./hud-readout";
import {
  doubleClickCommand,
  HOLD_TO_DRAG_MS,
  isDoubleClick,
  needsHold,
  selectionAfterClick,
  type ClickedItem,
  type ItemSource,
  type LastClick,
} from "./inventory-moves";
import { npcName } from "../sim/spawn";

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
  private error = "";
  private gridEl: HTMLElement | null = null;
  private root: HTMLElement = el("div");
  private inspection = el("div", { class: "inv-inspection" });
  private selectedItem: string | null = null;
  private loot: string | null = null;
  private truck: string | null = null;
  private cell = CELL_PX;

  constructor(
    private host: UiHost,
    private onChange: () => void,
    private dumpZone: boolean,
  ) {
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onDrop(e));
    this.root.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button, .inv-inspection, .inv-item, .inv-chip")) return;
      this.select(null);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() !== "r" || e.repeat) return;
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
    const rows = gridOf(playerVehicle(this.host.world())).h;
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
    const me = playerVehicle(w);
    const g = gridOf(me);
    this.showSelection(w);
    const grid = gridEl(g, this.cell);
    grid.append(...this.gridItems(w, me));
    this.gridEl = grid;
    this.showFan(me, this.selectedGun(me));
    const inTown = townAt(w) !== null;
    this.root.replaceChildren(
      el(
        "div",
        { class: "inv-wrap" },
        el(
          "div",
          { class: "inv-truck" },
          el(
            "div",
            { class: "truck-shell" },
            el("div", { class: "truck-nose", "aria-hidden": "true" }),
            grid,
          ),
          this.legend(),
        ),
        el(
          "div",
          { class: "inv-side" },
          ...this.refitBanner(me),
          this.loot
            ? this.lootEl(w, this.loot)
            : inTown
              ? this.storageEl(w)
              : el(
                  "div",
                  { class: "dim" },
                  "Park to install or remove parts.",
                ),
          ...(this.dumpZone ? [el("div", { class: "inv-dump", "data-drop": "dump" }, "Drop here to dump")] : []),
          this.inspection,
        ),
        ...(this.truck ? [this.truckEl(w, this.truck)] : []),
      ),
      this.error ? el("div", { class: "bad" }, this.error) : el("div"),
    );
    return this.root;
  }

  private legend(): HTMLElement {
    return el(
      "details",
      { class: "dim inv-legend" },
      el("summary", {}, "Mounts & controls"),
      el(
        "div",
        {},
        "Top view, nose up. D: deck mounts for weapons, scanners and cargo frames. E: engine mount. F B L R: armor mounts on the front, back, left and right.",
      ),
      el(
        "div",
        {},
        "A part works only when it lies fully on one of its letters. The marks on a gun show its blocked sides.",
      ),
      el(
        "div",
        {},
        "Drag to move or swap. R or right click turns an item.",
      ),
    );
  }

  private itemEl(w: World, it: GridItem): HTMLElement {
    const me = playerVehicle(w);
    const mounted = it.kind === "part" && isMounted(me.chassisId, it);
    const core = it.kind === "part" && partDef(it.part.defId).kind === "core";
    const node = itemBox(it, mounted, this.cell);
    node.setAttribute("aria-pressed", String(this.selectedItem === it.id));
    node.classList.toggle("selected", this.selectedItem === it.id);
    const inspect = () => this.showItem(w, it, mounted);
    const click = () => this.clickItem(this.clicked("grid", it.id, it));
    node.addEventListener("click", (e) => {
      if (core || e.detail === 0) click();
    });
    node.addEventListener("focus", inspect);
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

  private gridItems(w: World, v: Vehicle): HTMLElement[] {
    const moving = refitItems(w, v);
    const staying = v.items.filter((it) => !moving.some((m) => m.id === it.id));
    return [...staying.map((it) => this.itemEl(w, it)), ...moving.map((it) => this.refittingEl(w, v, it))];
  }

  private refittingEl(w: World, v: Vehicle, item: GridItem): HTMLElement {
    const node = this.itemEl(w, item);
    const left = v.job?.kind === "refit" ? v.job.turnsLeft : 0;
    node.classList.add("refitting");
    node.title = `Refit: ${left === 1 ? "1 turn" : `${left} turns`} left`;
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
    for (const id of blockerIds(me, it, def)) grid.querySelector(`[data-item-id="${id}"]`)?.classList.add("blocking");
  }

  private selection(w: World): { item: GridItem; mounted: boolean; own: boolean } | null {
    const id = this.selectedItem;
    if (id === null) return null;
    const me = playerVehicle(w);
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
      this.inspection.replaceChildren(
        el("h3", {}, "Equipment"),
        el("p", {}, "Select a part or cargo to inspect it."),
      );
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
    const cmd = double ? doubleClickCommand(this.host.world(), c) : null;
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

  private refitBanner(me: Vehicle): HTMLElement[] {
    if (me.job?.kind !== "refit") return [];
    const left = me.job.turnsLeft;
    return [
      el(
        "div",
        { class: "inv-refit" },
        el("span", {}, `Refit: ${left === 1 ? "1 turn" : `${left} turns`} left`),
        el("button", { title: "Stop the refit and leave every part where it was", onclick: () => this.run(cancelRefit) }, "Cancel refit"),
      ),
    ];
  }

  private showItem(w: World, item: GridItem, mounted: boolean): void {
    this.inspection.replaceChildren(
      el("div", { class: "card-head" }, createIcon(getItemIcon(item)), el("div", { class: "card-name" }, el("b", {}, itemName(item)), el("span", { class: "dim" }, itemState(item, mounted)))),
      ...(item.kind === "part" ? partDetails(playerVehicle(w), item.part, mounted) : []),
      ...(item.kind === "part" && !townAt(w) ? [el("p", { class: "dim" }, "Drag onto a mount or off it to start a refit.")] : []),
      el("div", { class: "inv-actions" }, ...this.itemActions(w, item, mounted)),
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
      townAt(w) ? this.repairButton(w, item.part) : null,
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
    if (!fieldPatchable(part)) return townOnlyPatch(part);
    const plan = repairPlan(w, me, part.id);
    if (plan.needed === 0) return null;
    const reason = patchBlocker(w, me, plan);
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: reason !== null,
        title:
          reason ??
          `Patch: ${plan.turns} turns, ${plan.parts} of ${plan.needed} parts, +${Math.round(plan.hp)} HP`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startRepair(world, part.id));
        },
      },
      reason ? `Patch (${reason})` : `Patch ${plan.turns}t/${plan.parts}p`,
    );
  }

  private repairButton(w: World, part: PartInstance): HTMLElement | null {
    if (!isJunk(part)) return this.garageButton(w, part, "Repair", `Restore to ${maxHp(part)} HP`);
    return canRebuild(w, part) ? this.garageButton(w, part, "Rebuild", "Rebuild to the last wear step, once per part") : null;
  }

  private garageButton(w: World, part: PartInstance, action: string, title: string): HTMLElement | null {
    const cost = partRepairCost(w, part);
    if (cost === 0) return null;
    return el(
      "button",
      {
        class: "inv-patch",
        disabled: w.player.money < cost,
        title: w.player.money < cost ? "Not enough money" : title,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => repairPart(world, part.id));
        },
      },
      `${action} ${cost}`,
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
        title: reason ?? `Strip: ${STRIP.turns} turns for ${stripYield(part)} parts`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startStrip(world, part.id));
        },
      },
      reason ? "Strip" : `Strip ${STRIP.turns}t/${stripYield(part)}p`,
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
        title: reason ?? `Weld: ${turns} turns for a ${partDef(PERK_NUMBERS.welder.part).name}, spends ${scrap} scrap metal`,
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          this.run((world) => startWeld(world));
        },
      },
      reason ? `Weld (${reason})` : `Weld ${turns}t`,
    );
  }

  private storageEl(w: World): HTMLElement {
    const chips = w.player.storage.map((p) => {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        createIcon(partIcon(p)),
        el("span", {}, d.name),
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
      el("h3", {}, "Garage storage"),
      ...(chips.length
        ? chips
        : [el("div", { class: "dim" }, "Drop parts here to store them.")]),
    );
  }

  private lootPartChips(stock: SalvageStock): HTMLElement[] {
    const chips: HTMLElement[] = [];
    for (const p of stock.parts) {
      const d = partDef(p.defId);
      const chip = el(
        "div",
        { class: `inv-chip ${KIND_CLASS[d.kind]}`, title: partTitle(p) },
        createIcon(partIcon(p)),
        el("span", {}, d.name),
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
        { class: "inv-chip k-good" },
        createIcon(getItemIcon(item)),
        `${GOODS[good].name} x${count}`,
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
        `Take fuel ${fuelLiters(stock.fuel ?? 0)} L, supplies ${(stock.supplies ?? 0).toFixed(1)}`,
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
      el("h3", {}, `Salvage${site ? `: ${site.name}` : ""}`),
      ...(chips.length
        ? chips
        : [el("div", { class: "dim" }, "Nothing left here.")]),
      ...(chips.length
        ? [
            el(
              "button",
              {
                onclick: () => this.run((world) => takeAllLoot(world, stockId)),
              },
              "Take all that fits",
            ),
          ]
        : []),
      el(
        "div",
        { class: "dim" },
        "Drag items onto the grid.",
      ),
    );
  }

  private truckEl(w: World, truckId: string): HTMLElement {
    const target = w.vehicles.find((v) => v.id === truckId);
    if (!target || !isKnockedOut(target))
      return el("div", { class: "inv-truck inv-target" }, el("h3", {}, "The truck got away"));
    const grid = gridEl(gridOf(target), this.cell);
    const removing = removalIds(w, target);
    grid.append(...target.items.map((it) => this.truckItemEl(w, target, it, grid, removing.has(it.id))));
    return el(
      "div",
      { class: "inv-truck inv-target" },
      el("h3", {}, `${npcName(target)}, ${gaveUp(target) ? "gave up" : "knocked out"}`),
      el("div", { class: "truck-shell" }, el("div", { class: "truck-nose", "aria-hidden": "true" }), grid),
      el("div", { class: "dim" }, "Drag items onto your grid."),
    );
  }

  private truckItemEl(w: World, target: Vehicle, it: GridItem, grid: HTMLElement, removing: boolean): HTMLElement {
    const mounted = it.kind === "part" && isMounted(target.chassisId, it);
    const node = itemBox(it, mounted, this.cell);
    node.classList.toggle("refitting", removing);
    this.markSelected(node, it);
    node.addEventListener("focus", () => this.showTruckItem(w, it, mounted));
    if (it.kind === "part" && partDef(it.part.defId).kind === "core") {
      node.addEventListener("click", () => this.clickItem(this.clicked("truck", it.id, it)));
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
      el("div", { class: "card-head" }, createIcon(getItemIcon(item)), el("div", { class: "card-name" }, el("b", {}, itemName(item)), el("span", { class: "dim" }, itemState(item, mounted)))),
      ...(item.kind === "part" ? partDetails(playerVehicle(w), item.part, false) : []),
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
    this.error = "";
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
      rot: this.drag.item.rot === 0 ? 1 : 0,
    };
    this.drag.grab = { x: 0, y: 0 };
    if (this.lastPointer) this.onMove(this.lastPointer);
  }

  private rotateSelected(): void {
    if (!this.gridEl?.isConnected || this.selectedItem === null) return;
    const item = playerVehicle(this.host.world()).items.find(
      (it) => it.id === this.selectedItem,
    );
    if (!item || item.kind !== "part") return;
    const id = item.id;
    this.run((w) =>
      moveItem(w, id, { x: item.x, y: item.y, rot: item.rot === 0 ? 1 : 0 }),
    );
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
    const g = this.gridEl?.getBoundingClientRect();
    const ok = onGrid && this.placementProblem(d) === null;
    d.ghost.className = `inv-ghost ${onGrid ? (ok ? "ok" : "no") : ""}`;
    d.ghost.textContent = itemLabel(d.item).short;
    d.ghost.style.width = `${size.w * this.cell}px`;
    d.ghost.style.height = `${size.h * this.cell}px`;
    if (onGrid && g) {
      d.ghost.style.left = `${g.left + d.item.x * this.cell}px`;
      d.ghost.style.top = `${g.top + d.item.y * this.cell}px`;
    } else {
      d.ghost.style.left = `${e.clientX - this.cell / 2}px`;
      d.ghost.style.top = `${e.clientY - this.cell / 2}px`;
    }
  }

  private placementProblem(d: Drag): string | null {
    const me = playerVehicle(this.host.world());
    if (d.source === "grid")
      return planItemMove(me, d.id, {
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
    if (d.source === "grid") return moveItem(w, d.id, to);
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
    const item = drag.source === "grid" ? playerVehicle(this.host.world()).items.find((entry) => entry.id === drag.id) : drag.item;
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

  private run(cmd: (w: World) => World, quiet = false): void {
    try {
      const next = cmd(this.host.world());
      if (next !== this.host.world()) this.host.apply(next);
      this.error = "";
    } catch (err) {
      this.error = quiet ? "" : (err as Error).message;
    }
    this.onChange();
  }
}

function offGridCommand(target: string | null | undefined, itemId: string): (w: World) => World {
  if (target === "storage") return (w) => storePart(w, itemId);
  return target === "dump" ? (w) => dumpItem(w, itemId) : (w) => w;
}

export class InventoryScreen {
  private root = panel("modal");
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

  openDowned(world: World): boolean {
    const downed = downedHere(world);
    if (!downed) return false;
    this.view.setTruck(downed.id);
    this.root.style.display = "";
    this.render();
    return true;
  }

  close(): void {
    this.view.clearSelection();
    this.root.style.display = "none";
    this.root.replaceChildren();
  }

  render(): void {
    if (!this.isOpen()) return;
    const truck = el("div", { class: "inv-body" }, this.view.render());
    this.root.replaceChildren(
      el("button", { class: "close", onclick: () => this.close() }, "Close [I]"),
      el("h3", {}, "Inventory", truckChips(this.host.world())),
      truck,
    );
    this.view.fitTo(truck);
  }
}

export function truckChips(w: World): HTMLElement {
  const me = playerVehicle(w);
  const mass = vehicleMass(me);
  const rated = chassisDef(me.chassisId).ratedMass;
  return el(
    "span",
    { class: "chips" },
    el("span", { class: "chip" }, createIcon("truck"), chassisDef(me.chassisId).name),
    el("span", { class: `chip${w.player.money < 0 ? " bad" : ""}`, title: "Money" }, createIcon("money"), moneyLabel(w.player.money)),
    el("span", { class: "chip", title: "Free cargo cells" }, createIcon("cells"), `${freeCells(me)} free`),
    el(
      "span",
      { class: `chip${mass > rated ? " bad" : ""}`, title: "Mass against rated load" },
      createIcon("load"),
      `${kg(mass)} / ${kg(rated)}`,
    ),
  );
}

function patchBlocker(w: World, me: Vehicle, plan: RepairPlan): string | null {
  if (!isParkedForWork(w, me)) return "Stop to patch";
  return plan.parts === 0 ? "No parts" : null;
}

function stripBlocker(w: World, me: Vehicle): string | null {
  if (!isParkedForWork(w, me)) return "Stop to strip";
  if (me.job) return "Busy";
  return null;
}

function weldBlocker(w: World, me: Vehicle): string | null {
  if (!isParkedForWork(w, me)) return "Stop to weld";
  if (me.job) return "Busy";
  const scrap = PERK_NUMBERS.welder.scrap;
  return (goodsCount(me).scrap ?? 0) < scrap ? `Needs ${scrap} scrap` : null;
}

function fieldPatchable(part: PartInstance): boolean {
  const def = partDef(part.defId);
  return def.kind !== "armor" || def.fieldRepair !== "none";
}

function townOnlyPatch(part: PartInstance): HTMLElement | null {
  return part.hp < maxHp(part) ? el("button", { class: "inv-patch", disabled: true }, "Patch (town only)") : null;
}

function partDetails(me: Vehicle, part: PartInstance, mounted: boolean): HTMLElement[] {
  const kind = partDef(part.defId).kind;
  const base = mounted ? null : baselinePart(me, kind);
  return [
    conditionMeter(part),
    statGrid(diffStats(partStats(part), base ? partStats(base) : null)),
    base ? el("p", { class: "dim" }, `Against ${partDef(base.defId).name}`) : el("span"),
  ];
}
