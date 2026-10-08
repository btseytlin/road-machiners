// The one owner of how an amount of the currency reaches the player. The sim calls it money; players call it M's.
// Text surfaces use moneyText and balanceText. HTML surfaces use moneyEl and balanceEl, which show the coin glyph
// beside the number and carry the full text in title and aria-label, so value never rests on the icon alone.
// The coin is owned here and sized in em by the text it sits in. It has no tooltip, so it never shadows the amount's.

import { el } from "./dom";
import { moneyAmount, moneyText } from "./units";

export { moneyText };

// Money is cents in the sim. The number reads in whole M.
export function moneyNumber(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`Not a currency amount: ${cents}`);
  return moneyAmount(cents);
}

// Negative money is debt. It shows as a positive amount owed.
export function balanceNumber(money: number): string {
  return money < 0 ? `Debt ${moneyNumber(-money)}` : moneyNumber(money);
}

export function balanceText(money: number): string {
  return money < 0 ? `Debt ${moneyText(-money)}` : moneyText(money);
}

// The M is 60% of its first size and the gold is muted, by committee request.
const COIN_SVG =
  '<svg viewBox="0 0 40 40" focusable="false"><circle cx="20" cy="20" r="17" fill="#4a4338" stroke="#a08a55" stroke-width="3"/><path d="M15.2 24.8V15.2l4.8 6 4.8-6v9.6" fill="none" stroke="#c5b981" stroke-width="2.16" stroke-linejoin="round" stroke-linecap="round"/></svg>';

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
