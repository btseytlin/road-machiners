// The one owner of how an amount of the currency reaches the player. The sim calls it money; players call it M's.
// Text surfaces use moneyText and balanceText. HTML surfaces use moneyEl and balanceEl, which show the coin glyph
// beside the number and carry the full text in title and aria-label, so value never rests on the icon alone.

import { UNITS } from "../data/units";
import { createIcon } from "./cards";
import { el } from "./dom";

const GROUPING = new Intl.NumberFormat("en-US");

export function moneyNumber(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Not a currency amount: ${amount}`);
  return GROUPING.format(amount);
}

export function moneyText(amount: number): string {
  return `${moneyNumber(amount)} ${amount === 1 ? UNITS.currency.one : UNITS.currency.many}`;
}

// Negative money is debt. It shows as a positive amount owed.
export function balanceNumber(money: number): string {
  return money < 0 ? `Debt ${moneyNumber(-money)}` : moneyNumber(money);
}

export function balanceText(money: number): string {
  return money < 0 ? `Debt ${moneyText(-money)}` : moneyText(money);
}

function glyphEl(number: string, text: string): HTMLElement {
  return el("span", { class: "price", title: text, "aria-label": text }, createIcon("money"), number);
}

export function moneyEl(amount: number): HTMLElement {
  return glyphEl(moneyNumber(amount), moneyText(amount));
}

export function balanceEl(money: number): HTMLElement {
  return glyphEl(balanceNumber(money), balanceText(money));
}

// An action word followed by its price, for a button label: "Buy" 40.
export function pricedEl(action: string, amount: number): HTMLElement {
  return el("span", { class: "priced" }, `${action} `, moneyEl(amount));
}
