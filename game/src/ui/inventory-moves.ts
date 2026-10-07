// What a click or double click on an inventory item does. Pure choices, so the view only wires events.

import { partDef } from "../data/parts";
import { playerVehicle } from "../sim/damage";
import { isMounted } from "../sim/grid";
import { installSpot, moveItem, storePart, stowSpot, takeFromStorage } from "../sim/inventory";
import { takeFromTruck } from "../sim/salvage";
import { takeLoot } from "../sim/locations";
import { shopAt } from "../sim/market";
import type { GridItem, World } from "../sim/types";

// A mounted part must be held this long before a drag starts. A plain press or click only selects it, so a
// slip of the mouse cannot start a refit by tearing a working part out of the truck.
export const HOLD_TO_DRAG_MS = 300;

// Two clicks on one item this close together are a double click. The view redraws after each click, so the
// browser's own dblclick event would never see one element.
export const DOUBLE_CLICK_MS = 350;

export type ItemSource = "grid" | "storage" | "loot" | "truck";

export type ClickedItem = {
  source: ItemSource;
  item: GridItem; // for storage and loot chips, the chip's own item, whose id is prefixed
  id: string; // the id the sim commands use: grid item id, stored part id, loot part or good id, truck item id
  stockId: string | null; // the loot stock shown, for a loot chip
  truckId: string | null; // the knocked-out truck shown, for a truck item
};

export type LastClick = { id: string; at: number } | null;

export function isDoubleClick(last: LastClick, id: string, now: number): boolean {
  return last !== null && last.id === id && now - last.at <= DOUBLE_CLICK_MS;
}

// A click selects an item, or clears the selection when it is already selected.
export function selectionAfterClick(selected: string | null, clicked: string): string | null {
  return selected === clicked ? null : clicked;
}

// The item is an installed part the player must hold before dragging it.
export function needsHold(chassisId: string, item: GridItem): boolean {
  return item.kind === "part" && partDef(item.part.defId).kind !== "core" && isMounted(chassisId, item);
}

// The command a double click runs, or null when the double click does nothing here.
// At a shop it swaps installed and stored parts. Elsewhere it only moves an item into the truck's own storage.
export function doubleClickCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  if (c.source === "grid") return shopAt(w) ? gridCommand(w, c) : null;
  if (c.source === "storage") return storageCommand(w, c);
  return takeCommand(w, c);
}

function storageCommand(w: World, c: ClickedItem): ((w: World) => World) | null {
  if (c.item.kind !== "part") return null;
  const spot = installSpot(playerVehicle(w), c.item);
  return spot ? (next) => takeFromStorage(next, c.id, spot) : null;
}

// A loot pile item or a looted truck's item goes to a free plain cell of the truck.
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
