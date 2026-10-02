// Every item and chassis has one icon in item-icons.json, and each stored hash matches the current models, weapon picks
// and icon style. A stale hash means something an icon draws changed after the last npm run icons.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from './chassis';
import { GOODS } from './goods';
import { PARTS } from './parts';
import { iconCatalog, ICON_WEAPON_PICKS } from '../render/partLooks';
import type { ModelName } from '../three/render/models';
import { iconHash, iconView, ICON_VIEWS } from '../three/icons/render';
import ICONS from './item-icons.json';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?url&inline', import: 'default' });
const DATA_URL = 'data:model/gltf-binary;base64,';
const STALE = 'Run npm run icons.';

const catalog = iconCatalog(PARTS, GOODS, CHASSIS, ICON_WEAPON_PICKS);
const items = catalog.filter((e) => e.section !== 'chassis');
const chassis = catalog.filter((e) => e.section === 'chassis');

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

  it('shows parts and chassis top-down and goods diagonal', () => {
    const view = (id: string): string => {
      const entry = catalog.find((e) => e.id === id);
      if (!entry) throw new Error(`No catalog entry ${id}`);
      return iconView(entry);
    };
    expect(['mg', 'steelPlate', 'stockEngine', 'scrap', 'scout'].map(view)).toEqual(['top', 'top', 'top', 'diagonal', 'top']);
  });

  it.each(Object.entries(ICONS.items))('item %s has a drawn extent inside its cell', (_id, icon) => {
    const [x, y, w, h] = icon.box;
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1);
    expect(y + h).toBeLessThanOrEqual(1);
  });

  it('gives every icon its own cell', () => {
    for (const sheet of [ICONS.items, ICONS.chassis]) {
      const cells = Object.values(sheet).map((e) => e.index);
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it.each(items.map((e) => [e.id, e] as const))('item %s matches its models and pick', (id, entry) => {
    const stored: Record<string, { hash: string }> = ICONS.items;
    expect(stored[id]?.hash, STALE).toBe(iconHash(entry, iconView(entry), read));
  });

  it.each(chassis.map((e) => [e.id, e] as const))('chassis %s matches its model', (id, entry) => {
    const stored: Record<string, { hash: string }> = ICONS.chassis;
    expect(stored[id]?.hash, STALE).toBe(iconHash(entry, iconView(entry), read));
  });
});
