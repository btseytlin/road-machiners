// The world setup: the game mode and world settings picked at New game, saved in the world. This module checks a
// setup and is the only reader of its settings for rules, through the scale queries below.

import { GAME_MODES, WORLD_SETTINGS } from '../data/modes';
import type { GameModeId, World, WorldSettings, WorldSetup } from './types';

type SettingId = keyof WorldSettings;
const SETTING_IDS = Object.keys(WORLD_SETTINGS) as SettingId[];

export function defaultSetup(mode: GameModeId): WorldSetup {
  const settings = Object.fromEntries(SETTING_IDS.map((id) => [id, WORLD_SETTINGS[id].default])) as WorldSettings;
  return { mode, settings };
}

export function parseSetup(raw: unknown): WorldSetup {
  const setup = record(raw, 'World setup');
  onlyKeys(setup, ['mode', 'settings'], 'world setup field');
  if (!isMode(setup.mode)) throw new Error(`Unknown game mode ${String(setup.mode)}`);
  const settings = record(setup.settings, 'World settings');
  onlyKeys(settings, SETTING_IDS, 'world setting');
  const bad = SETTING_IDS.find((id) => !validSetting(id, settings[id]));
  if (bad) throw new Error(`World setting ${bad} is out of bounds or off its step: ${String(settings[bad])}`);
  return { mode: setup.mode, settings: { ...defaultSetup(setup.mode).settings, ...pickSettings(settings) } };
}

export function repairSetup(raw: unknown): { setup: WorldSetup; reset: SettingId[] } {
  const { mode, settings } = knownParts(raw);
  const setup = defaultSetup(mode);
  const reset = SETTING_IDS.filter((id) => !validSetting(id, settings[id]));
  return { setup: { ...setup, settings: { ...setup.settings, ...pickSettings(settings, reset) } }, reset };
}

export function damageScale(world: World): number {
  return world.setup.settings.damage;
}

export function fuelUseScale(world: World): number {
  return world.setup.settings.fuelUse;
}

export function supplyUseScale(world: World): number {
  return world.setup.settings.supplyUse;
}

export function setupLabel(setup: WorldSetup): string {
  const parts = SETTING_IDS.map((id) => `${WORLD_SETTINGS[id].name} ${percent(setup.settings[id])}`);
  return [GAME_MODES[setup.mode].name, ...parts].join(', ');
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function validSetting(id: SettingId, value: unknown): value is number {
  const def = WORLD_SETTINGS[id];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < def.min || value > def.max) return false;
  const steps = (value - def.min) / def.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function knownParts(raw: unknown): { mode: GameModeId; settings: Record<string, unknown> } {
  if (!isRecord(raw) || !isMode(raw.mode)) return { mode: 'roaming', settings: {} };
  return { mode: raw.mode, settings: isRecord(raw.settings) ? raw.settings : {} };
}

function pickSettings(settings: Record<string, unknown>, skip: readonly SettingId[] = []): Partial<WorldSettings> {
  return Object.fromEntries(SETTING_IDS.filter((id) => !skip.includes(id)).map((id) => [id, settings[id]])) as Partial<WorldSettings>;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} must be an object, got ${String(value)}`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) throw new Error(`Unknown ${what} ${unknown}`);
}

function isMode(mode: unknown): mode is GameModeId {
  return typeof mode === 'string' && Object.hasOwn(GAME_MODES, mode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
