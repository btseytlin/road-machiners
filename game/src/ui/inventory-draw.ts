// Drawing pieces of the inventory view: the grid, item boxes, labels and the items a running refit moves.

import { GOODS } from "../data/goods";
import { partDef, type WeaponDef } from "../data/parts";
import { gunBlockers, gunSpans, type FireSpan } from "../sim/armor";
import { maxHp } from "../sim/wear";
import { facingOf, itemCells, itemSize, type Cell, type Grid } from "../sim/grid";
import type { GridItem, PartInstance, Rot, RefitJob, RefitMove, Vehicle, World } from "../sim/types";
import { playerVehicle } from "../sim/damage";
import { el } from "./dom";
import { truckOutline } from "./plans";
import { wearLabel } from "./format";
import { gridItemIcon, toneStyle } from "./cards";
import { hp, kg } from "./units";

const CELL_TITLE: Record<Cell, string> = {
  D: "deck mount for a weapon, scanner, utility, cargo frame or store",
  E: "engine mount",
  F: "front armor mount",
  B: "back armor mount",
  L: "left armor mount",
  R: "right armor mount",
  X: "built-in part",
  ".": "",
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
  return el("div", { class: "inv-cell c-dead", style: pos(x, y, 1, 1, cell), title: "Broken cargo rows. Repair the cargo part to use them." });
}

export function cellEl(c: Cell, x: number, y: number, cell: number): HTMLElement {
  return el("div", { class: `inv-cell c-${c === "." ? "plain" : c}`, style: pos(x, y, 1, 1, cell), title: CELL_TITLE[c] });
}

export function turnedIcon(it: GridItem, cell: number): HTMLElement {
  const icon = gridItemIcon(it);
  const gun = weaponDefOf(it);
  if (gun) icon.style.cssText += `;position:absolute;left:50%;top:50%;width:${gun.w * cell}px;height:${gun.h * cell}px;transform:translate(-50%,-50%) rotate(${facingOf(it)}deg)`;
  return icon;
}

export function itemBox(it: GridItem, chassisId: string, mounted: boolean, cell: number): HTMLElement {
  const cells = itemCells(it);
  const x = Math.min(...cells.map((c) => c.x));
  const y = Math.min(...cells.map((c) => c.y));
  const size = itemSize(it);
  const id = it.kind === "part" ? it.part.defId : it.good;
  const icon = turnedIcon(it, cell);
  const node = el(
    "div",
    { class: itemClass(it, mounted), "data-item-id": it.id, style: `${pos(x, y, size.w, size.h, cell)};${toneStyle(id)}`, title: itemTitle(it, mounted), tabindex: 0, role: "button", "aria-label": itemTitle(it, mounted) },
    icon,
    el("span", { class: "inv-item-name" }, itemLabel(it).short),
  );
  if (it.kind === "part") node.append(conditionBar(it.part));
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

export function itemLabel(it: GridItem): { short: string } {
  if (it.kind === "good") return { short: GOODS[it.good].name.slice(0, 5) };
  return { short: partDef(it.part.defId).name };
}

export function itemTitle(it: GridItem, mounted: boolean): string {
  if (it.kind === "good") return GOODS[it.good].name;
  if (partDef(it.part.defId).kind === "core")
    return `${partTitle(it.part)}\nBuilt in`;
  return `${partTitle(it.part)}\n${mounted ? "Mounted" : "Spare"}`;
}

export function conditionBar(p: PartInstance): HTMLElement {
  const max = maxHp(p);
  return el(
    "div",
    { class: `inv-hp${p.hp > 0 ? "" : " broken"}` },
    el("div", { style: `width:${(p.hp / max) * 100}%` }),
  );
}

export function partTitle(p: PartInstance): string {
  const d = partDef(p.defId);
  return `${d.name} (${d.kind}) ${wearLabel(p)}, ${hp(p.hp)}/${hp(maxHp(p))} HP, ${d.w}x${d.h}`;
}

export function itemName(it: GridItem): string {
  return it.kind === "good" ? GOODS[it.good].name : partDef(it.part.defId).name;
}

export function itemState(it: GridItem, mounted: boolean): string {
  if (it.kind === "good") return `Cargo, ${kg(GOODS[it.good].mass)}`;
  if (partDef(it.part.defId).kind === "core") return "Built in";
  return mounted ? "Mounted" : "Spare";
}

const SVG = "http://www.w3.org/2000/svg";

export function nextRot(it: GridItem): Rot {
  if (weaponDefOf(it)) return ((it.rot + 1) % 4) as Rot;
  return it.rot === 0 ? 1 : 0;
}

export function weaponDefOf(it: GridItem): WeaponDef | null {
  if (it.kind !== "part") return null;
  const def = partDef(it.part.defId);
  return def.kind === "weapon" ? def : null;
}

export function blockerIds(v: Vehicle, it: GridItem): string[] {
  return gunBlockers(v, it).map((b) => b.id);
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
  for (const span of gunSpans(v, it)) {
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
