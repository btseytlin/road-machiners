// Drawing pieces of the inventory view: the grid, item boxes, labels and the items a running refit moves.

import { CRATE_MASS } from "../data/goods";
import { partDef, type WeaponDef } from "../data/parts";
import { fireSpans, reachedSides, sideBlockers, SIDES, type FireSpan } from "../sim/armor";
import { itemCells, itemSize, type Cell, type Grid } from "../sim/grid";
import type { GridItem, PartInstance, RefitJob, RefitMove, Vehicle, World } from "../sim/types";
import { playerVehicle } from "../sim/damage";
import { el } from "./dom";
import { truckOutline } from "./plans";
import { conditionMeter, gridItemIcon, toneStyle } from "./cards";
import { kg } from "./units";
import { byId, t, type Msg } from "../text/msg";
import { goodName, partName } from "../text/names";

const CELL_TITLE: Record<Cell, Msg | undefined> = {
  D: t("cell.deck"),
  E: t("cell.engine"),
  F: t("cell.front"),
  B: t("cell.back"),
  L: t("cell.left"),
  R: t("cell.right"),
  X: t("cell.builtIn"),
  ".": undefined,
};

export function storageItem(part: PartInstance): GridItem {
  return { id: `store-${part.id}`, x: 0, y: 0, rot: 0, kind: "part", part };
}

export function lootPartItem(part: PartInstance): GridItem {
  return { id: `loot-${part.id}`, x: 0, y: 0, rot: 0, kind: "part", part };
}

export function lootGoodItem(good: string): GridItem {
  return { id: `loot-${good}`, x: 0, y: 0, rot: 0, kind: "good", good };
}

export function gridEl(g: Grid, chassisId: string, cell: number): HTMLElement {
  const grid = el("div", { class: "inv-grid", style: `width:${g.w * cell}px;height:${g.h * cell}px` });
  grid.addEventListener("contextmenu", (e) => e.preventDefault());
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const node = gridCellEl(g, x, y, cell);
      if (node) grid.append(node);
    }
  grid.append(truckOutline(chassisId, cell));
  return grid;
}

function gridCellEl(g: Grid, x: number, y: number, cell: number): HTMLElement | null {
  const c = g.cells[y][x];
  if (c !== null) return cellEl(c, x, y, cell);
  if (y < g.deadFrom) return null;
  return el("div", { class: "inv-cell c-dead", style: pos(x, y, 1, 1, cell), title: t("cell.deadRows") });
}

export function cellEl(c: Cell, x: number, y: number, cell: number): HTMLElement {
  return el("div", { class: `inv-cell c-${c === "." ? "plain" : c}`, style: pos(x, y, 1, 1, cell), title: CELL_TITLE[c] });
}

export function itemBox(it: GridItem, chassisId: string, mounted: boolean, cell: number): HTMLElement {
  const cells = itemCells(it);
  const x = Math.min(...cells.map((c) => c.x));
  const y = Math.min(...cells.map((c) => c.y));
  const size = itemSize(it);
  const id = it.kind === "part" ? it.part.defId : it.good;
  const node = el(
    "div",
    { class: itemClass(it, mounted), "data-item-id": it.id, style: `${pos(x, y, size.w, size.h, cell)};${toneStyle(id)}`, title: itemName(it), tabindex: 0, role: "button", "aria-label": itemName(it) },
    gridItemIcon(it),
    el("span", { class: "inv-item-name" }, itemLabel(it).short),
  );
  if (it.kind === "part") node.append(conditionMeter(it.part));
  return node;
}

function itemClass(it: GridItem, mounted: boolean): string {
  if (it.kind === "good") return "inv-item";
  if (partDef(it.part.defId).kind === "core") return "inv-item fixed";
  return mounted ? "inv-item mounted" : "inv-item spare";
}

export function removalIds(w: World, target: Vehicle): Set<string> {
  const job = playerVehicle(w).job;
  if (job?.kind !== "refit" || job.pickup?.from !== "truck" || job.pickup.vehicleId !== target.id) return new Set();
  const partId = job.pickup.partId;
  return new Set(target.items.filter((it) => it.kind === "part" && it.part.id === partId).map((it) => it.id));
}

function pos(x: number, y: number, w: number, h: number, cell: number): string {
  return `left:${x * cell}px;top:${y * cell}px;width:${w * cell}px;height:${h * cell}px`;
}

export function refitItems(w: World, v: Vehicle): GridItem[] {
  if (v.job?.kind !== "refit") return [];
  return [...v.job.moves.map((move) => movedItem(v, move)), ...pickupItem(w, v.job)];
}

function movedItem(v: Vehicle, move: RefitMove): GridItem {
  const item = v.items.find((it) => it.id === move.itemId);
  if (!item) throw new Error(`Refit moves missing item ${move.itemId}`);
  return { ...item, ...move.to };
}

function pickupItem(w: World, job: RefitJob): GridItem[] {
  const pickup = job.pickup;
  if (!pickup) return [];
  const part = pickup.from === 'stock'
    ? w.salvage.find((stock) => stock.id === pickup.stockId)?.parts.find((p) => p.id === pickup.partId)
    : w.vehicles.find((v) => v.id === pickup.vehicleId)?.items.flatMap((it) => (it.kind === 'part' ? [it.part] : [])).find((p) => p.id === pickup.partId);
  return part ? [{ kind: "part", id: pickup.itemId, part, ...pickup.to }] : [];
}

export function footprint(it: GridItem): { w: number; h: number } {
  const cells = itemCells({ ...it, x: 0, y: 0 });
  return {
    w: Math.max(...cells.map((c) => c.x)) + 1,
    h: Math.max(...cells.map((c) => c.y)) + 1,
  };
}

export function itemLabel(it: GridItem): { short: Msg } {
  if (it.kind === "good") return { short: byId(`good.${it.good}.short`) };
  return { short: partName(it.part.defId) };
}

export function itemName(it: GridItem): Msg {
  return it.kind === "good" ? goodName(it.good) : partName(it.part.defId);
}

export function itemState(it: GridItem, mounted: boolean): Msg {
  if (it.kind === "good") return t("item.cargo", { mass: kg(CRATE_MASS) });
  if (partDef(it.part.defId).kind === "core") return t("item.builtIn");
  return mounted ? t("item.mounted") : t("item.spare");
}

const SVG = "http://www.w3.org/2000/svg";

export function weaponDefOf(it: GridItem): WeaponDef | null {
  if (it.kind !== "part") return null;
  const def = partDef(it.part.defId);
  return def.kind === "weapon" ? def : null;
}

export function blockerIds(v: Vehicle, it: GridItem, def: WeaponDef): string[] {
  const blockers = sideBlockers(v, it);
  return reachedSides(def).flatMap((side) => {
    const b = blockers[side];
    return b ? [b.id] : [];
  });
}

export function fanSvg(v: Vehicle, it: GridItem, def: WeaponDef, size: { w: number; h: number }, cell: number): SVGSVGElement {
  const { w, h } = itemSize(it);
  const cx = (it.x + w / 2) * cell;
  const cy = (it.y + h / 2) * cell;
  const radius = Math.max(size.w, size.h) * cell;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "inv-fan");
  svg.setAttribute("width", String(size.w * cell));
  svg.setAttribute("height", String(size.h * cell));
  const open = SIDES.filter((side) => !sideBlockers(v, it)[side]);
  for (const span of fireSpans(def.arc, open)) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", spanPath(cx, cy, radius, span));
    svg.append(path);
  }
  return svg;
}

function spanPath(cx: number, cy: number, r: number, span: FireSpan): string {
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  };
  if (span.to - span.from >= 360) return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
  const large = span.to - span.from > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${at(span.from)} A ${r} ${r} 0 ${large} 1 ${at(span.to)} Z`;
}

export function clearFan(grid: HTMLElement): void {
  grid.querySelector(".inv-fan")?.remove();
  for (const node of grid.querySelectorAll(".blocking")) node.classList.remove("blocking");
}
