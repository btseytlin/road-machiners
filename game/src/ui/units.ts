// Converts sim units to real units for the player to read.
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { UNITS } from '../data/units';
import { el } from './dom';

const MS_TO_KPH = 3.6;

export function kph(tilesPerTurn: number): number {
  return Math.round((tilesPerTurn * PHYSICS.metersPerTile) / PHYSICS.turnSeconds * MS_TO_KPH);
}

export function mps2(tilesPerTurn2: number): number {
  return Math.round((tilesPerTurn2 * PHYSICS.metersPerTile) / PHYSICS.turnSeconds ** 2 * 10) / 10;
}

export function meters(tiles: number): number {
  return Math.round(tiles * PHYSICS.metersPerTile);
}

export function liters(cells: number): number {
  return Math.round(cells * RULES.cellMeters * RULES.cellMeters * UNITS.cellDepth * 1000);
}

export function fuelLiters(units: number): number {
  return Math.round(units * UNITS.fuelLiters);
}

export function celsius(heat: number): number {
  return Math.round(UNITS.shadeCelsius + (heat - 1) * UNITS.celsiusPerHeat);
}

export function kg(mass: number): string {
  return `${Math.round(mass).toLocaleString('en-US')} kg`;
}

export function engineCelsius(engineHeat: number): number {
  return Math.round(UNITS.engineColdCelsius + engineHeat * (UNITS.engineHotCelsius - UNITS.engineColdCelsius));
}

export function hp(value: number): number {
  return Math.ceil(value);
}

export function damage(value: number): number {
  return Math.ceil(value);
}

const WHOLE_M = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const MINUS = '\u2212';

export function moneyAmount(cents: number): string {
  const whole = Math.round(cents);
  if (whole === 0) return '0';
  const m = WHOLE_M.format(Math.ceil(Math.abs(whole) / UNITS.centsPerM));
  return whole < 0 ? `${MINUS}${m}` : m;
}

export function moneyText(cents: number): string {
  const amount = moneyAmount(cents);
  return `${amount} ${amount === '1' || amount === `${MINUS}1` ? UNITS.currency.one : UNITS.currency.many}`;
}

export function moneyNumber(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`Not a currency amount: ${cents}`);
  return moneyAmount(cents);
}

const COIN_SVG =
  '<svg viewBox="0 0 40 40" focusable="false"><circle cx="20" cy="20" r="17" stroke-width="3"/><path d="M15.2 24.8V15.2l4.8 6 4.8-6v9.6" fill="none" stroke-width="2.16" stroke-linejoin="round" stroke-linecap="round"/></svg>';

function coinEl(): HTMLElement {
  const coin = el('span', { class: 'coin', 'aria-hidden': 'true' });
  coin.innerHTML = COIN_SVG;
  return coin;
}

export function moneyEl(cents: number): HTMLElement {
  const text = moneyText(cents);
  return el('span', { class: `amount${cents < 0 ? ' bad' : ''}`, title: text, 'aria-label': text }, coinEl(), moneyNumber(cents));
}

export function pricedEl(action: string, cents: number): HTMLElement {
  return el('span', { class: 'priced' }, `${action} `, moneyEl(cents));
}

export function moneyDelta(cents: number): string {
  const text = moneyText(cents);
  return Math.round(cents) > 0 ? `+${text}` : text;
}

export function turnsText(turns: number): string {
  return `${turns} ${turns === 1 ? 'turn' : 'turns'}`;
}
