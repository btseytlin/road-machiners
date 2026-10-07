// Converts sim units to real units for the player to read.
import { PHYSICS } from '../data/physics';
import { RULES } from '../data/rules';
import { UNITS } from '../data/units';

const MS_TO_KPH = 3.6;

export function kph(tilesPerTurn: number): number {
  return Math.round((tilesPerTurn * PHYSICS.metersPerTile) / PHYSICS.turnSeconds * MS_TO_KPH);
}

// Acceleration in tiles per turn per turn, as m/s².
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

// Part HP and player health are fractional in the sim. A working part never reads 0.
export function hp(value: number): number {
  return Math.ceil(value);
}

// Damage is fractional in the sim. Any damage reads at least 1.
export function damage(value: number): number {
  return Math.ceil(value);
}

// Money is integer cents in the sim. It reads in M: no decimals for a whole M, two otherwise.
const WHOLE_M = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const CENT_M = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function moneyAmount(cents: number): string {
  const whole = Math.round(cents);
  if (whole === 0) return '0';
  const format = whole % UNITS.centsPerM === 0 ? WHOLE_M : CENT_M;
  return format.format(whole / UNITS.centsPerM);
}

// Money in running text, with its unit: log lines, talk and titles.
export function moneyText(cents: number): string {
  return `${moneyAmount(cents)} M`;
}
