// What a click or double click on an inventory item does. Pure choices, so the view only wires events.

import { partDef } from "../data/parts";
import { playerVehicle } from "../sim/damage";
import { instantMoveItem } from "../sim/cheats";
import { isMounted } from "../sim/grid";
import { installSpot, moveItem, storePart, stowSpot, takeFromStorage } from "../sim/inventory";
import { takeFromTruck } from "../sim/salvage";
import { takeLoot } from "../sim/locations";
import { shopAt } from "../sim/market";
import type { GridItem, World } from "../sim/types";

export const HOLD_TO_DRAG_MS = 300;

export const DOUBLE_CLICK_MS = 350;

export type ItemSource = "grid" | "storage" | "loot" | "truck";

export type ClickedItem = {
  source: ItemSource;
  item: GridItem;
  id: string;
  stockId: string | null;
  truckId: string | null;
};

export type LastClick = { id: string; at: number } | null;

export function isDoubleClick(last: LastClick, id: string, now: number): boolean {
  return last !== null && last.id === id && now - last.at <= DOUBLE_CLICK_MS;
}

export function selectionAfterClick(selected: string | null, clicked: string): string | null {
  return selected === clicked ? null : clicked;
}

export function needsHold(chassisId: string, item: GridItem): boolean {
  return item.kind === "part" && partDef(item.part.defId).kind !== "core" && isMounted(chassisId, item);
}

export function doubleClickCommand(w: World, c: ClickedItem, instant = false): ((w: World) => World) | null {
  if (c.source === "grid") return gridDoubleClick(w, c, instant);
  if (c.source === "storage") return storageCommand(w, c);
  return takeCommand(w, c);
}

function storageCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  if (c.item.kind !== "part") return null;
  const spot = installSpot(playerVehicle(w), c.item);
  return spot ? (next) => takeFromStorage(next, c.id, spot) : null;
}

function takeCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  const spot = stowSpot(playerVehicle(w), c.item);
  if (!spot) return null;
  if (c.source === "truck") return (next) => takeFromTruck(next, c.truckId!, c.id, spot);
  const pick = c.item.kind === "part" ? ({ kind: "part", partId: c.id } as const) : ({ kind: "good", good: c.id } as const);
  return (next) => takeLoot(next, c.stockId!, pick, spot);
}

function gridCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  const me = playerVehicle(w);
  const item = me.items.find((it) => it.id === c.id);
  if (!item || item.kind !== "part" || partDef(item.part.defId).kind === "core") return null;
  if (isMounted(me.chassisId, item)) return (next) => storePart(next, item.id);
  const spot = installSpot(me, item);
  return spot ? (next) => moveItem(next, item.id, spot) : null;
}

function gridDoubleClick(w: World, c: ClickedItem, instant: boolean): ((w: World) => World) | null {
  if (instant) return instantGridCommand(w, c);
  return shopAt(w) ? gridCommand(w, c) : null;
}

function instantGridCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  const me = playerVehicle(w);
  const item = me.items.find((it) => it.id === c.id);
  if (!item || item.kind !== "part" || partDef(item.part.defId).kind === "core") return null;
  const spot = isMounted(me.chassisId, item) ? stowSpot(me, item) : installSpot(me, item);
  return spot ? (next) => instantMoveItem(next, item.id, spot) : null;
}
