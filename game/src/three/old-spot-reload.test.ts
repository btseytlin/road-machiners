// A scavenger on its way to an old-world loot spot, saved and reloaded: the goal and the stock carry over, and the loot
// adds up once the search is done.

import { describe, expect, it } from 'vitest';
import { NPCS } from '../data/npcs';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { advanceFar } from '../sim/far';
import { goodsCount } from '../sim/grid';
import { topGoal } from '../sim/npc-activities';
import { nearestRoadPoint, oldSpotOf, oldSpotPicks, oldStockId } from '../sim/old-places';
import { isFree } from '../sim/spawn';
import { addVehicle, forceOption, npcBrain } from '../sim/testkit';
import type { Vec } from '../sim/vec';
import type { World } from '../sim/types';
import { dist } from '../sim/vec';
import { endTurn, newWorld } from '../sim/world';
import { loadWorld, saveOf } from './save';

const picks = oldSpotPicks(TEST_MAP);
const pick = picks.filter((p) => p.type !== 'hulks').reduce((a, b) => (dist(b.pos, nearestRoadPoint(b.pos)) < dist(a.pos, nearestRoadPoint(a.pos)) ? b : a));
const moveFar = (w: World): void => w.vehicles.forEach((v) => v.brain && advanceFar(w, v));

// Scrap and the parts good across the stock and every truck.
function held(w: World, stockId: string): number {
  const stock = w.salvage.find((s) => s.id === stockId)!;
  return (stock.goods.scrap ?? 0) + (stock.goods.parts ?? 0) + w.vehicles.reduce((n, v) => n + (goodsCount(v).scrap ?? 0) + (goodsCount(v).parts ?? 0), 0);
}

function freeNear(w: World, p: Vec): Vec {
  for (let r = 0; r < 6; r += 0.5)
    for (let k = 0; k < 8; k++) {
      const at = { x: p.x + Math.cos((k / 8) * 2 * Math.PI) * r, y: p.y + Math.sin((k / 8) * 2 * Math.PI) * r };
      if (isFree(w, at, 1, null)) return at;
    }
  throw new Error(`No free ground near ${p.x},${p.y}`);
}

function storageWith(save: string): Storage {
  const values = new Map<string, string>([['roam.save', save]]);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('a scavenger bound for an old-world loot spot', () => {
  it('keeps its goal and the loot whole across a save and reload on the way', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP);
    w.vehicles = w.vehicles.filter((v) => v.faction === 'player');
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    forceOption('salvageSeen', 'keep');
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], freeNear(w, nearestRoadPoint(pick.pos)));
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    const stockId = oldStockId(pick);
    const stock = w.salvage.find((s) => s.id === stockId)!;
    stock.goods = { ...stock.goods, scrap: 2, parts: 1 };
    npc.brain.goals = [{ kind: 'scavenge', targetId: stockId, destination: { ...pick.pos }, phase: 'travel', reason: 'search an old ruin' }];
    const before = held(w, stockId);

    let next = w;
    for (let turn = 0; turn < 3; turn++) next = endTurn(next, moveFar);
    expect(topGoal(next.vehicles.find((v) => v.id === npc.id)!)?.targetId).toBe(stockId);
    next = loadWorld(storageWith(JSON.stringify(saveOf(next))), 'auto', TEST_MAP)!;
    expect(next.salvage.filter((s) => oldSpotOf(s))).toHaveLength(picks.length);

    let searched = false;
    for (let turn = 0; turn < 60; turn++) {
      next = endTurn(next, moveFar);
      expect(next.events.filter((e) => e.t === 'stall')).toEqual([]);
      const me = next.vehicles.find((v) => v.id === npc.id)!;
      if (me.job?.kind === 'search' && me.job.stockId === stockId) searched = true;
      if (topGoal(me)?.targetId !== stockId) break;
    }
    expect(searched).toBe(true);
    expect(held(next, stockId)).toBe(before);
  }, 120_000);
});
