// Old saves render in every language. A save from before the text ids migrates, and every goal reason, open call,
// contract and truck title it holds reads in English and Russian without a missing key or param.
import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import type { Contract } from '../sim/market';
import { addVehicle, npcBrain } from '../sim/testkit';
import type { CallVars, World } from '../sim/types';
import { newWorld } from '../sim/world';
import { TEST_MAP } from '../test/map';
import FORMAT_2_19 from '../three/save-fixtures/format-2-19.json';
import { loadWorld, saveOf } from '../three/save';
import { MIGRATIONS, SAVE_FORMAT } from '../three/save-migrations';
import { GOAL_REASONS_2_19, LINES_2_19 } from '../three/save-text-2-19';
import { lineText } from '../ui/dialogue';
import { contractSummary } from '../ui/format';
import { LOCALES } from './msg';
import { goalText, vehicleTitle } from './names';
import { resolve } from './resolve';

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

// Every word an old save can show, in every language.
function renderAll(world: World): string[] {
  const words: string[] = [];
  const contracts: Contract[] = [...world.player.contracts, ...Object.values(world.shops).flatMap((s) => s.contracts)];
  for (const locale of LOCALES) {
    for (const v of [...world.vehicles, ...world.removed]) {
      words.push(resolve(vehicleTitle(world, v), locale));
      for (const goal of v.brain?.goals ?? []) words.push(resolve(goalText(goal.reason), locale));
    }
    for (const c of contracts) words.push(resolve(contractSummary(c), locale));
    const call = world.player.call;
    if (call) words.push(resolve(lineText(call.line.line, call.line.vars), locale));
  }
  return words;
}

// The English a save of minor format 19 held where the sim now keeps ids.
const ENGLISH_REASON = new Map(Object.entries(GOAL_REASONS_2_19).map(([phrase, id]) => [id, phrase]));
const ENGLISH_LINE = new Map(Object.entries(LINES_2_19).map(([text, id]) => [id, text]));

describe('old saves in every language', () => {
  it('the 2.19 fixture migrates and every goal, call, contract and title reads in both languages', () => {
    const migrated = MIGRATIONS[19](FORMAT_2_19) as unknown as World;
    const world = { ...migrated, player: { ...migrated.player, vehicleId: 'player' } } as World;
    const words = renderAll(world);
    expect(words.length).toBeGreaterThan(10);
    expect(words).toContain('Busy');
    expect(words).toContain('Занят');
    expect(words).toContain('Trader Ada Stone');
  });

  it('a whole save from before the text ids loads and renders in both languages', () => {
    const world = newWorld(1337, startKit('standard'), TEST_MAP);
    const npc = addVehicle(world, 'traders', 'hauler', ['stockEngine'], { x: 300, y: 300 });
    npc.brain = { ...npcBrain('trader', npc.pos, ['trader']), driver: 'Cal Reed' };
    npc.brain.goals = [{ kind: 'trade', targetId: 'bowl', destination: { x: 80, y: 470 }, phase: 'travel', reason: 'buyCargo' }];
    const deal: CallVars = { deal: { kind: 'deal', deal: 'free', patcher: 'npc', price: 0, parts: 1, turns: 2 } };
    world.player.call = { with: npc.id, topic: 'patch', node: 'terms', vars: deal, line: { line: 'dealTerms', vars: deal } };
    const saved = JSON.parse(JSON.stringify(saveOf(world).world)) as Record<string, unknown> & { vehicles: Record<string, unknown>[]; player: { call: { line: { line: string; vars: CallVars } } } };
    // Turn it back into a save of minor format 19: English reasons and lines, and truck names.
    for (const v of saved.vehicles) {
      v.name = 'Old name';
      const brain = v.brain as { goals: { reason: string }[] } | null;
      for (const goal of brain?.goals ?? []) goal.reason = ENGLISH_REASON.get(goal.reason)!;
    }
    const line = saved.player.call.line;
    saved.player.call.line = { text: ENGLISH_LINE.get(line.line)!, vars: line.vars } as never;
    const storage = makeStorage();
    storage.setItem('roam.save', JSON.stringify({ format: { major: SAVE_FORMAT.major, minor: 19 }, world: saved }));
    const loaded = loadWorld(storage, 'auto', TEST_MAP)!;
    expect(loaded.player.call?.line.line).toBe('dealTerms');
    const words = renderAll(loaded);
    expect(words).toContain('Buy profitable cargo');
    expect(words).toContain('Купить выгодный груз');
    expect(words).toContain('I will do it for nothing. 1 part of mine.');
  });
});
