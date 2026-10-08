// Converts sim units to real units for the player to read.
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { UNITS } from '../data/units';
import { num, t, type Msg } from '../text/msg';

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

export function kg(mass: number): Msg {
  return t('units.kg', { n: Math.round(mass) });
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

export function moneyM(cents: number): number {
  const whole = Math.round(cents);
  if (whole === 0) return 0;
  return Math.sign(whole) * Math.ceil(Math.abs(whole) / UNITS.centsPerM);
}

export function moneyAmount(cents: number): string {
  const m = moneyM(cents);
  return m === 0 ? '0' : WHOLE_M.format(m);
}

export function moneyText(cents: number): string {
  return `${moneyAmount(cents)} M`;
}

export function moneyNum(cents: number): Msg {
  return num(moneyM(cents), 'int');
}

export function moneyMsg(cents: number): Msg {
  return t('money.m', { n: moneyM(cents) });
}
