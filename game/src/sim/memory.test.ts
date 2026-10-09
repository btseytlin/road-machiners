import { describe, expect, it } from 'vitest';
import { MEMORY } from '../data/npcs';
import { forgetOld, recall, remember, subjectOf } from './memory';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import type { MemoryFact, Vehicle, World } from './types';
import { endTurn } from './world';

const SOURCES = import.meta.glob<string>('../**/*.ts', { query: '?raw', import: 'default', eager: true });

function driver(w: World): Vehicle {
  const v = addVehicle(w, 'traders', 'hauler', [], { x: 60, y: 60 });
  v.brain = npcBrain('trader', v.pos, ['trader']);
  return v;
}

function prices(shop: string, salt = 0): MemoryFact {
  return { kind: 'prices', shop, pressure: { salt } };
}

describe('driver memory', () => {
  it('names a price memory by its shop', () => {
    expect(subjectOf(prices('bowl'))).toBe('prices:bowl');
  });

  it('keeps a price and a stripped memory of one id apart', () => {
    const w = emptyWorld();
    const v = driver(w);
    expect(subjectOf({ kind: 'stripped', stock: 'bowl' })).toBe('stripped:bowl');
    remember(w, v, prices('bowl'));
    remember(w, v, { kind: 'stripped', stock: 'bowl' });
    expect(v.brain!.memories).toHaveLength(2);
  });

  it('appends new memories in turn order', () => {
    const w = emptyWorld();
    const v = driver(w);
    w.turn = 3;
    remember(w, v, prices('bowl'));
    w.turn = 5;
    remember(w, v, prices('nose'));
    expect(v.brain!.memories.map((m) => [m.turn, subjectOf(m.fact)])).toEqual([[3, 'prices:bowl'], [5, 'prices:nose']]);
  });

  it('replaces an older memory of the same subject and moves it to the end', () => {
    const w = emptyWorld();
    const v = driver(w);
    w.turn = 3;
    remember(w, v, prices('bowl', 0.1));
    w.turn = 4;
    remember(w, v, prices('nose'));
    w.turn = 7;
    remember(w, v, prices('bowl', 0.3));
    expect(v.brain!.memories).toEqual([
      { turn: 4, fact: prices('nose') },
      { turn: 7, fact: prices('bowl', 0.3) },
    ]);
  });

  it('keeps a memory until its lifetime runs out', () => {
    const w = emptyWorld();
    const v = driver(w);
    remember(w, v, prices('bowl'));
    w.turn += MEMORY.turns.prices - 1;
    forgetOld(w);
    expect(v.brain!.memories).toHaveLength(1);
    w.turn += 1;
    forgetOld(w);
    expect(v.brain!.memories).toEqual([]);
  });

  it('recalls memories of one kind, newest first', () => {
    const w = emptyWorld();
    const v = driver(w);
    remember(w, v, prices('bowl'));
    w.turn += 1;
    remember(w, v, prices('nose'));
    expect(recall(v, 'prices').map((m) => m.fact.shop)).toEqual(['nose', 'bowl']);
  });

  it('refuses a vehicle without a brain', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'traders', 'hauler', [], { x: 60, y: 60 });
    expect(() => remember(w, v, prices('bowl'))).toThrow();
    expect(() => recall(v, 'prices')).toThrow();
  });

  it('forgets expired memories as turns pass', () => {
    let w = emptyWorld();
    const v = driver(w);
    remember(w, v, prices('bowl'));
    remember(w, v, prices('nose'));
    v.brain!.memories[0].turn -= MEMORY.turns.prices;
    w = endTurn(w, testDrive);
    expect(w.vehicles.find((x) => x.id === v.id)!.brain!.memories.map((m) => subjectOf(m.fact))).toEqual(['prices:nose']);
  });

  it('lets no file but memory.ts write driver memories', () => {
    const write = /\.memories\s*(?:=(?!=)|\.(?:push|splice|unshift|pop|shift|sort|reverse)\()/;
    const writers = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('.test.ts') && path !== './memory.ts' && path !== '../three/save-migrations.ts')
      .filter(([, source]) => write.test(source))
      .map(([path]) => path);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(writers).toEqual([]);
  });
});
