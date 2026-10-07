// Every gun on a deck spot stands on the model, or on a riser post whose foot stands on the model, inside the gun's footprint.

import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../../data/chassis';
import { PARTS } from '../../data/parts';
import { CLIP_TOLERANCE, cellRect, highestUnder, restOn } from '../../sim/body';
import { baseGrid, itemCells } from '../../sim/grid';
import type { GridItem } from '../../sim/types';
import { loadModels } from './models';
import { footprint, postColumn, standingY, weaponStand, wouldFloat } from './vehicle';
import { budget } from '../../test/budget';

const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });
await loadModels(async (name) => {
  const url = FILES[`/public/models/${name}.glb`];
  if (!url) throw new Error(`Missing model file for ${name}`);
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
});

const GUNS = Object.values(PARTS).filter((def) => def.kind === 'weapon');

describe('gun risers', () => {
  it.each(Object.keys(CHASSIS))('%s: a gun on any deck spot stands on the model or on a post that does', (id) => {
    const cells = baseGrid(id).cells;
    const problems: string[] = [];
    for (const def of GUNS) {
      for (const rot of [0, 1] as const) {
        for (let y = 0; y < cells.length; y++) {
          for (let x = 0; x < cells[y].length; x++) {
            const item = { id: 'g', kind: 'part', x, y, rot, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } } as unknown as GridItem;
            if (!itemCells(item).every((c) => cells[c.y]?.[c.x] === 'D')) continue;
            const { at: { pos }, bottom, top } = weaponStand({ chassisId: id }, item);
            const rect = cellRect(id, itemCells(item));
            const label = `${def.id} rot ${rot} at ${x},${y}`;
            const surface = highestUnder(id, postColumn(pos));
            if (!Number.isFinite(surface)) problems.push(`${label}: no surface under the post`);
            else if (bottom - surface > CLIP_TOLERANCE) problems.push(`${label}: base ${bottom.toFixed(2)} over surface ${surface.toFixed(2)}`);
            else if (bottom < top && Math.abs(bottom - surface) > 1e-9) problems.push(`${label}: post starts at ${bottom.toFixed(2)} over surface ${surface.toFixed(2)}`);
            if (bottom > top) problems.push(`${label}: post starts at ${bottom.toFixed(2)} above its mount at ${top.toFixed(2)}`);
            if (top < restOn(id, rect).y - 1e-9) problems.push(`${label}: mount at ${top.toFixed(2)} below its rest`);
            if (pos.x < rect.x0 || pos.x > rect.x1 || pos.z < rect.z0 || pos.z > rect.z1) problems.push(`${label}: post at ${pos.x.toFixed(2)},${pos.z.toFixed(2)} is outside its rect`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('parts that are always drawn', () => {
  it('never hides a weapon or armor for lack of a surface, on any chassis and cell', () => {
    const kept = Object.values(PARTS).filter((p) => p.kind === 'weapon' || p.kind === 'armor');
    const hidden: string[] = [];
    for (const id of Object.keys(CHASSIS)) {
      const { w, h } = baseGrid(id);
      for (const def of kept) {
        for (let y = 0; y + def.h <= h; y++) {
          for (let x = 0; x + def.w <= w; x++) {
            const item = { id: 'g', kind: 'part', x, y, rot: 0, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } } as unknown as GridItem;
            if (!itemCells(item).every((c) => baseGrid(id).cells[c.y]?.[c.x])) continue;
            if (wouldFloat({ chassisId: id }, item)) hidden.push(`${def.id} on ${id} at ${x},${y}`);
          }
        }
      }
    }
    expect(hidden).toEqual([]);
  });
});

describe('placing any item on any cell', () => {
  it('never throws and always gives a finite spot, on every chassis, ring cell included', () => {
    const problems: string[] = [];
    for (const id of Object.keys(CHASSIS)) {
      const { w, h, cells } = baseGrid(id);
      // One part per kind and size: placement reads nothing else of a part.
      const shapes = [...new Map(Object.values(PARTS).map((def) => [`${def.kind}${def.w}x${def.h}`, def])).values()];
      const items = [
        ...shapes.map((def) => ({ label: def.id, item: (x: number, y: number, rot: 0 | 1) => ({ id: 'g', kind: 'part', x, y, rot, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } }) })),
        { label: 'good', item: (x: number, y: number, rot: 0 | 1) => ({ id: 'g', kind: 'good', x, y, rot, good: 'scrap' }) },
      ];
      for (const { label, item } of items) {
        for (const rot of [0, 1] as const) {
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const it = item(x, y, rot) as unknown as GridItem;
              if (!itemCells(it).every((c) => cells[c.y]?.[c.x])) continue;
              const where = `${label} rot ${rot} at ${x},${y} on ${id}`;
              try {
                wouldFloat({ chassisId: id }, it);
                const y0 = standingY({ chassisId: id }, it);
                const at = footprint({ chassisId: id }, it, y0);
                if (![y0, at.pos.x, at.pos.z, at.scale.x, at.scale.z].every(Number.isFinite)) problems.push(`${where}: not finite`);
                if (label !== 'good' && PARTS[label].kind === 'weapon') {
                  const { bottom, top } = weaponStand({ chassisId: id }, it);
                  if (![bottom, top].every(Number.isFinite)) problems.push(`${where}: stand not finite`);
                }
              } catch (e) {
                problems.push(`${where}: ${(e as Error).message}`);
              }
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, budget(120_000));
});

// Spots that no shape can rest: a three-row gun on column 4 of the Lincoln spans the hood and the greenhouse roof, which
// restOn() cannot trim away along the long axis (issue 149 task file, Conclusion: UK1).
const UNRESTABLE: Record<string, string[]> = {
  lincoln: ['amRifle rot 0 at 4,3', 'recoilless rot 0 at 4,3', 'battleRifle rot 0 at 4,3'],
};

describe('guns on the issue 149 chassis', () => {
  it.each(['lincoln', 'niva', 'bukhanka'])('%s: every gun spot on deck cells rests on the model', (id) => {
    const cells = baseGrid(id).cells;
    const perched: string[] = [];
    for (const def of GUNS) {
      for (const rot of [0, 1] as const) {
        for (let y = 0; y < cells.length; y++) {
          for (let x = 0; x < cells[y].length; x++) {
            const item = { id: 'g', kind: 'part', x, y, rot, part: { id: 'p', defId: def.id, hp: 1, wear: 0 } } as unknown as GridItem;
            const spot = itemCells(item);
            if (!spot.every((c) => cells[c.y]?.[c.x] === 'D')) continue;
            if (restOn(id, cellRect(id, spot)).perched) perched.push(`${def.id} rot ${rot} at ${x},${y}`);
          }
        }
      }
    }
    expect(perched).toEqual(UNRESTABLE[id] ?? []);
  });
});
