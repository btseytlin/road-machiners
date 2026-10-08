import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { UNITS } from '../data/units';
import { TEST_MAP } from '../test/map';
import { chooseQuestOption, fittingQuestVars, leaveQuest, questProblems, questView, restoreQuest, startQuest } from './quests';
import { defaultSetup } from './settings';
import type { QuestBundle } from '../data/quests';
import { compileBundle, readQuestSources } from '../test/quest-compile';
import type { World } from './types';
import { newWorld } from './world';

const QUESTS = compileBundle(readQuestSources('src/test/quests'));
const RUMORS = 'Heard any rumors?';
const COIN = 'Can you spare some coin for the road?';
const LEAVE = 'Leave.';

function world(): World {
  return newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'), false);
}

function play(w: World, quest: string, checkpoint: string, picks: readonly string[]): World {
  return picks.reduce((at, pick) => chooseQuestOption(at, QUESTS, pickIndex(at, pick)), startQuest(w, QUESTS, quest, checkpoint));
}

function pickIndex(w: World, text: string): number {
  const index = questView(w).choices.indexOf(text);
  if (index < 0) throw new Error(`No choice ${text} in ${questView(w).choices.join(', ')}`);
  return index;
}

describe('startQuest', () => {
  it('plays the checkpoint lines and offers its choices', () => {
    const w = startQuest(world(), QUESTS, 'sample_bowl', 'start');
    expect(questView(w)).toEqual({
      quest: 'sample_bowl',
      lines: [{ text: 'Hattie sets her bucket down by the well.', tags: [] }],
      choices: ['Heard any rumors?', 'Leave.'],
      ended: false,
    });
    expect(w.player.quests.session).toMatchObject({ quest: 'sample_bowl', checkpoint: 'start.talk' });
  });

  it('refuses a second quest while one is open', () => {
    const w = startQuest(world(), QUESTS, 'sample_bowl', 'start');
    expect(() => startQuest(w, QUESTS, 'sample_nose', 'start')).toThrow('Quest sample_bowl is open');
  });

  it('refuses a section that is no checkpoint', () => {
    expect(() => startQuest(world(), QUESTS, 'sample_bowl', 'middle')).toThrow('Quest sample_bowl has no checkpoint middle');
  });
});

describe('chooseQuestOption', () => {
  it('stores a world variable that another quest reads', () => {
    const bowl = play(world(), 'sample_bowl', 'start', [RUMORS, LEAVE]);
    expect(bowl.player.quests.world).toEqual({ sample_wagon_heard: true });
    const nose = startQuest(bowl, QUESTS, 'sample_nose', 'start');
    expect(questView(nose).choices).toContain('About that scavenger with the Army radio.');
  });

  it('keeps a quest own variable apart from the world', () => {
    const w = play(world(), 'sample_bowl', 'start', [RUMORS]);
    expect(w.player.quests.local).toEqual({ sample_bowl: { trust: 1 } });
  });

  it('pays money through the give_money effect in whole M', () => {
    const before = world();
    const after = play(before, 'sample_bowl', 'start', [RUMORS, COIN]);
    expect(after.player.money - before.player.money).toBe(5 * UNITS.centsPerM);
  });

  it('closes the session at the end and keeps the last lines on view', () => {
    const done = play(world(), 'sample_bowl', 'start', [RUMORS, LEAVE]);
    expect(done.player.quests.session).toBeNull();
    expect(questView(done)).toEqual({ quest: 'sample_bowl', lines: [], choices: [], ended: true });
  });

  it('leaves the world unchanged when a pick is out of range', () => {
    const w = startQuest(world(), QUESTS, 'sample_bowl', 'start');
    const before = JSON.stringify(w);
    expect(() => chooseQuestOption(w, QUESTS, 7)).toThrow('No choice 7');
    expect(JSON.stringify(w)).toBe(before);
  });

  it('gives the same lines, choices and variables for the same world and picks', () => {
    const a = play(world(), 'sample_bowl', 'start', [RUMORS, COIN]);
    const b = play(world(), 'sample_bowl', 'start', [RUMORS, COIN]);
    expect(b.player.quests).toEqual(a.player.quests);
  });
});

function inlineBundle(quest: string): QuestBundle {
  const sources = { 'world.ink': 'EXTERNAL money()\nEXTERNAL give_money(amount)\n', 'q.ink': `INCLUDE world.ink\n${quest}` };
  return compileBundle(sources);
}

function withoutLive(w: World): World {
  const copy = structuredClone(w);
  copy.player.quests.live = null;
  return copy;
}

describe('restoreQuest', () => {
  it('rebuilds a session without ink state at its last checkpoint with the variables kept', () => {
    const restored = withoutLive(play(world(), 'sample_bowl', 'start', [RUMORS]));
    restoreQuest(restored, QUESTS);
    expect(questView(restored).choices).toEqual([COIN, LEAVE]);
    expect(restored.player.quests.world).toEqual({ sample_wagon_heard: true });
  });

  it('gives back the same choices and variables for a save taken right after a checkpoint', () => {
    const w = play(world(), 'sample_bowl', 'start', [RUMORS]);
    const restored = withoutLive(w);
    restoreQuest(restored, QUESTS);
    expect(questView(restored).choices).toEqual(questView(w).choices);
    expect(restored.player.quests).toEqual({ ...w.player.quests, live: restored.player.quests.live });
  });
  it('refuses a checkpoint whose opening pays, since every load would pay again', () => {
    const bundle = inlineBundle('=== start ===\n# checkpoint: start\n~ give_money(2)\nTake this.\n+ [Thanks.] -> END\n');
    const restored = withoutLive(startQuest(world(), bundle, 'q', 'start'));
    expect(() => restoreQuest(restored, bundle)).toThrow('Effect give_money ran while loading checkpoint start');
  });

  it('refuses a checkpoint whose opening changes a variable, since every load would change it again', () => {
    const bundle = inlineBundle('VAR n = 0\n=== start ===\n# checkpoint: start\n~ n += 1\nCounted.\n+ [Done.] -> END\n');
    const restored = withoutLive(startQuest(world(), bundle, 'q', 'start'));
    expect(() => restoreQuest(restored, bundle)).toThrow('Loading checkpoint start changed its variables');
  });

  it('does nothing without an open session', () => {
    const w = world();
    restoreQuest(w, QUESTS);
    expect(w.player.quests.live).toBeNull();
  });
});

describe('leaveQuest', () => {
  it('closes an open quest midway and keeps the variables it set', () => {
    const left = leaveQuest(play(world(), 'sample_bowl', 'start', [RUMORS]));
    expect(left.player.quests).toEqual({ world: { sample_wagon_heard: true }, local: { sample_bowl: { trust: 1 } }, session: null, live: null });
  });

  it('clears the last lines of an ended quest', () => {
    expect(leaveQuest(play(world(), 'sample_bowl', 'start', [LEAVE])).player.quests.live).toBeNull();
  });

  it('refuses when no quest is on view', () => {
    expect(() => leaveQuest(world())).toThrow('No quest is on view');
  });
});

describe('fittingQuestVars', () => {
  it('keeps the variables that still fit and lists the rest as lost', () => {
    const carried = {
      world: { sample_wagon_heard: true, retired_flag: true },
      local: { sample_bowl: { trust: 2, paid: 'yes' }, gone_quest: { n: 1 } },
    };
    expect(fittingQuestVars(carried, QUESTS)).toEqual({
      world: { sample_wagon_heard: true },
      local: { sample_bowl: { trust: 2 } },
      lost: ['retired_flag', 'sample_bowl.paid', 'gone_quest.n'],
    });
  });
});

describe('questProblems', () => {
  it('lists stored names the bundle does not declare', () => {
    const w = world();
    w.player.quests = { world: { gone: 1 }, local: { sample_bowl: { trust: 'x' }, lost: {} }, session: { quest: 'sample_bowl', checkpoint: 'nowhere', seed: 1 }, live: null };
    expect(questProblems(w.player.quests, QUESTS)).toEqual([
      'World variable gone is not declared',
      'Variable trust of quest sample_bowl holds a string, not a number',
      'Quest lost does not exist',
      'Quest sample_bowl has no checkpoint nowhere',
    ]);
  });

  it('finds nothing in a new game', () => {
    expect(questProblems(world().player.quests, QUESTS)).toEqual([]);
  });
});
