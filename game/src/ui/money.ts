// The one owner of how an amount of the currency reaches the player. The sim calls it money; players call it M's.
// Text surfaces use moneyText and balanceText. HTML surfaces use moneyEl and balanceEl, which show the coin glyph
// beside the number and carry the full text in title and aria-label, so value never rests on the icon alone.
// The coin is owned here and sized in em by the text it sits in. It has no tooltip, so it never shadows the amount's.

import { UNITS } from "../data/units";
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

const COIN_SVG =
  '<svg viewBox="0 0 40 40" focusable="false"><circle cx="20" cy="20" r="17" fill="#4a4338" stroke="#e8c76a" stroke-width="3"/><path d="M12 28V12l8 10 8-10v16" fill="none" stroke="#f4e3a8" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';

function coinEl(): HTMLElement {
  const coin = el("span", { class: "coin", "aria-hidden": "true" });
  coin.innerHTML = COIN_SVG;
  return coin;
}

function amountEl(number: string, text: string): HTMLElement {
  return el("span", { class: "amount", title: text, "aria-label": text }, coinEl(), number);
}

export function moneyEl(amount: number): HTMLElement {
  return amountEl(moneyNumber(amount), moneyText(amount));
}

export function balanceEl(money: number): HTMLElement {
  return amountEl(balanceNumber(money), balanceText(money));
}

// An action word followed by its price, for a button label: "Buy" 40.
export function pricedEl(action: string, amount: number): HTMLElement {
  return el("span", { class: "priced" }, `${action} `, moneyEl(amount));
}
