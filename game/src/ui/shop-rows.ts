import { ECONOMY } from "../data/goods";
import { playerVehicle } from "../sim/damage";
import { basicsRepairCost, repairCost, supplyRoom, type Supply } from "../sim/economy";
import { mountedParts } from "../sim/grid";
import { fuelCap, suppliesCap } from "../sim/stats";
import type { World } from "../sim/types";
import { createIcon } from "./cards";
import { el } from "./dom";
import { GOODS_COLUMNS } from "./format";
import { coinEl, fuelLiters, moneyEl, moneyNumber, moneyText } from "./units";

export type ShopCommand = (w: World) => World;

export type ShopButtons = {
  button(label: string, cmd: ShopCommand, reason?: string, key?: string, title?: string): HTMLElement;
  priceButton(w: World, verb: string, price: number, cmd: ShopCommand, reason?: string, key?: string): HTMLElement;
};

export const NOTHING_TO_REPAIR = "Nothing to repair";

export function repairBar(w: World, buttons: ShopButtons, repair: { basics: ShopCommand; all: ShopCommand }): HTMLElement {
  const broken = mountedParts(playerVehicle(w)).filter((p) => p.hp === 0).length;
  const button = (verb: string, cost: number, cmd: ShopCommand) =>
    cost === 0 ? buttons.button(verb, cmd, NOTHING_TO_REPAIR) : buttons.priceButton(w, verb, cost, cmd);
  return el(
    "div",
    { class: "town-repair" },
    createIcon("tools"),
    broken ? el("span", { class: "bad" }, `${broken} broken`) : null,
    button("Repair basics", basicsRepairCost(w), repair.basics),
    button("Repair all", repairCost(w), repair.all),
  );
}

export function supplyRow(w: World, k: Supply, buttons: ShopButtons, buy: (w: World, k: Supply, n: number) => World): HTMLElement {
  const room = supplyRoom(w, k);
  const price = ECONOMY.supplyPrice[k];
  const afford = Math.min(room, Math.floor(w.player.money / price));
  const amount = supplyAmount(k);
  const reason = room < 1 ? "Full" : shortBy(w.player.money, price);
  return supplyLine(k, w.player[k], supplyCap(w, k), null, price, shortBy(w.player.money, price) === "", [
    buttons.button(`+${amount(1)}`, (x) => buy(x, k, 1), reason),
    buttons.button(afford > 0 ? `Fill ${amount(afford)}` : "Fill", (x) => buy(x, k, afford), reason),
  ]);
}

export type PriceHint = { tone: "good" | "bad" | ""; title: string };

export function priceHead(label: string): HTMLElement {
  return el("span", { class: "price-head" }, label, coinEl());
}

export function shortBy(have: number, price: number): string {
  return have >= price ? "" : `Need ${moneyText(price - have)} more`;
}

export function supplyCap(w: World, k: Supply): number {
  return k === "fuel" ? fuelCap(playerVehicle(w)) : suppliesCap(playerVehicle(w));
}

export function supplyAmount(k: Supply): (n: number) => string {
  return (n) => (k === "fuel" ? `${fuelLiters(n)} L` : `${Math.round(n * 10) / 10}`);
}

export function supplyUnit(k: Supply): string {
  return k === "fuel" ? `Per ${supplyAmount(k)(1)}` : "Each";
}

export function supplyLine(k: Supply, have: number, cap: number, theirs: HTMLElement | null, price: number, payable: boolean, buttons: HTMLElement[]): HTMLElement {
  const amount = supplyAmount(k);
  return el(
    "div",
    { class: "good-row row" },
    el(
      "div",
      { class: "good-name supply" },
      createIcon(k),
      el("div", { class: "service-meter" }, el("span", {}, `${amount(have)} / ${amount(cap)}`), bar(have / cap)),
    ),
    theirs,
    el("div", { class: "trade buy wide" }, caption(GOODS_COLUMNS.buy, true), priceEl(price, payable, { tone: "", title: supplyUnit(k) }), ...buttons),
  );
}

export function priceSpan(price: number, payable: boolean): HTMLElement {
  return el("span", { class: payable ? "" : "bad" }, moneyEl(price));
}

export function setIf(node: HTMLElement, name: string, value: string | false): void {
  if (value) node.setAttribute(name, value);
}

export function reasonButton(label: (Node | string)[], click: () => void, reason: string, key = "", title = ""): HTMLElement {
  const button = el("button", { class: "btn-s", onclick: () => reason || click() }, ...label);
  setIf(button, "aria-disabled", reason && "true");
  setIf(button, "title", reason || title);
  setIf(button, "data-key", key);
  return button;
}

export function priceEl(price: number, payable = true, hint: PriceHint | null = null): HTMLElement {
  return el("span", { class: `price ${priceTone(payable, hint)}`.trim(), title: hint?.title }, moneyNumber(price));
}

export function priceTone(payable: boolean, hint: PriceHint | null): string {
  return payable ? (hint?.tone ?? "") : "bad";
}

export function caption(text: string, coin = false): HTMLElement {
  return el("span", { class: "cap" }, text, coin ? coinEl() : null);
}

export function keepFocus(root: HTMLElement, render: () => void): void {
  const key = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
  render();
  if (!key) return;
  root.querySelector<HTMLElement>(`button[data-key="${key}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

export function bar(share: number): HTMLElement {
  return el("div", { class: "meter" }, el("div", { style: `width:${Math.max(0, Math.min(1, share)) * 100}%` }));
}
