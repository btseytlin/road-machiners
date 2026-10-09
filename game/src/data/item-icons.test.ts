// Every item and chassis has one icon in item-icons.json, and each stored hash matches the current models, weapon picks
// and icon style. A stale hash means something an icon draws changed after the last
// npm run icons.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from './chassis';
import { GOODS } from './goods';
import { PARTS } from './parts';
import { ITEM_TONES } from '../render/palette';
import { iconCatalog, itemTone, ICON_WEAPON_PICKS } from '../render/partLooks';
import type { ModelName } from '../three/render/models';
import { blueprintColors, iconHash, iconView, ICON_VIEWS } from '../three/icons/render';
import ICONS from './item-icons.json';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?url&inline', import: 'default' });
const DATA_URL = 'data:model/gltf-binary;base64,';
const STALE = 'Run npm run icons.';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
const items = catalog.filter((e) => e.section !== 'chassis');
const chassis = catalog.filter((e) => e.section === 'chassis');

type Cell = { index: number; hash: string; box: number[] };
const storedItems: Record<string, Cell> = ICONS.items;
const storedChassis: Record<string, Cell> = ICONS.chassis;

const bytes = new Map<string, Uint8Array>();
for (const name of new Set(catalog.flatMap((e) => e.models))) {
  const load = FILES[`/public/models/${name}.glb`];
  if (load === undefined) throw new Error(`Model public/models/${name}.glb is missing`);
  const url = await load();
  if (!url.startsWith(DATA_URL)) throw new Error(`Model ${name}.glb did not inline as base64 data`);
  bytes.set(name, Uint8Array.from(atob(url.slice(DATA_URL.length)), (c) => c.charCodeAt(0)));
}
const read = (name: ModelName): Uint8Array => {
  const b = bytes.get(name);
  if (!b) throw new Error(`Model ${name} was not read`);
  return b;
};

describe('item icons', () => {
  it('has an item icon for every non-body part and every good, and nothing else', () => {
    expect(Object.keys(ICONS.items).sort(), STALE).toEqual(items.map((e) => e.id).sort());
  });

  it('has a portrait for every chassis, and nothing else', () => {
    expect(Object.keys(ICONS.chassis).sort(), STALE).toEqual(chassis.map((e) => e.id).sort());
  });

  it('was drawn in the views the game shows', () => {
    expect(ICONS.views, STALE).toEqual(ICON_VIEWS);
  });

  it('shows every item and chassis diagonal', () => {
    const view = (id: string): string => {
      const entry = catalog.find((e) => e.id === id);
      if (!entry) throw new Error(`No catalog entry ${id}`);
      return iconView(entry);
    };
    expect(['mg', 'steelPlate', 'stockEngine', 'scrap', 'scout'].map(view)).toEqual(['diagonal', 'diagonal', 'diagonal', 'diagonal', 'diagonal']);
  });

  it('gives every item one cell and no lying cell, so a gun turns with its box', () => {
    for (const icon of Object.values(storedItems)) expect(Object.keys(icon).sort(), STALE).toEqual(['box', 'hash', 'index']);
  });

  it('gives every chassis a drawn extent', () => {
    for (const icon of Object.values(storedChassis)) expect(icon.box, STALE).toHaveLength(4);
  });

  const boxes = [
    ...Object.entries(storedItems).map(([id, icon]) => [`item ${id}`, icon.box] as const),
    ...Object.entries(storedChassis).map(([id, icon]) => [`chassis ${id}`, icon.box] as const),
  ];
  it.each(boxes)('%s has a drawn extent inside its cell', (_name, box) => {
    const [x, y, w, h] = box;
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1);
    expect(y + h).toBeLessThanOrEqual(1);
  });

  it('gives every icon its own cell', () => {
    const cells = Object.values(storedItems).map((e) => e.index);
    expect(new Set(cells).size).toBe(cells.length);
    const portraits = Object.values(storedChassis).map((e) => e.index);
    expect(new Set(portraits).size).toBe(portraits.length);
  });

  it.each(Object.entries(ITEM_TONES))('keeps the blueprint line readable on the %s tone', (tone, color) => {
    const entry = items.find((e) => itemTone(e.id) === tone);
    if (!entry) throw new Error(`No item has the ${tone} tone`);
    const background = `#${color.toString(16).padStart(6, '0')}`;
    expect(contrast(blueprintColors(entry).line, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(items.map((e) => [e.id, e] as const))('item %s matches its models and pick', (id, entry) => {
    expect(storedItems[id]?.hash, STALE).toBe(iconHash(entry, iconView(entry), read));
  });

  it.each(chassis.map((e) => [e.id, e] as const))('chassis %s matches its model', (id, entry) => {
    expect(storedChassis[id]?.hash, STALE).toBe(iconHash(entry, iconView(entry), read));
  });
});
