import { describe, expect, it } from 'vitest';
import type { NoteId } from '../data/locals';
import { CONTRACTS } from '../data/market';
import { REGION } from '../data/region';
import { WAGON_SEVEN } from '../data/salvage';
import { holdsNote, learnNote, localsAt, townWork } from './dialogue-rules';
import { acceptContract, type Contract } from './market';
import { chooseQuestOption, QUESTS, questView, startQuest } from './quests';
import { sitePads } from './sites';
import { compileBundle, readQuestSources } from '../test/quest-compile';
import { emptyWorld } from './testkit';
import type { World } from './types';

const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function parkedAt(town: string): World {
  return emptyWorld(sitePads(site(town))[0]);
}

function talk(w: World, quest: string, picks: readonly string[]): World {
  return picks.reduce((at, pick) => chooseQuestOption(at, QUESTS, pickIndex(at, pick)), startQuest(w, QUESTS, quest, 'start'));
}

function pickIndex(w: World, text: string): number {
  const index = questView(w).choices.indexOf(text);
  if (index < 0) throw new Error(`No choice ${text} in ${questView(w).choices.join(', ')}`);
  return index;
}

const choices = (w: World, quest: string) => questView(startQuest(w, QUESTS, quest, 'start')).choices;
const lastLine = (w: World) => questView(w).lines.at(-1)?.text;

function untouched(w: World): unknown {
  return { ...w, player: { ...w.player, notes: null, quests: null }, events: null };
}

const haul = (id: string, reward: number): Extract<Contract, { kind: 'haul' }> => ({ id, shop: 'bowl', kind: 'haul', good: 'salt', units: 1, to: 'nose', reward, deadline: 500, window: 500, rush: false, tier: 1 });

const WAGON = 'About that scavenger with the Army radio.';
const WAGON_FOUND = 'We found wagon Seven.';
const WORK = 'Any work?';

describe('settlement locals', () => {
  it('lists three locals at each town and none at a stall', () => {
    expect(localsAt('bowl').map((l) => l.id)).toEqual(['ruben', 'hattie', 'dag']);
    expect(localsAt('nose').map((l) => l.id)).toEqual(['kovac', 'lena', 'ibo']);
    expect(localsAt('salvage-yard')).toEqual([]);
  });

  it('opens a question only once its fact holds', () => {
    const w = parkedAt('nose');
    expect(choices(w, 'nose_ibo')).not.toContain('What happened at Burnt Convoy?');
    expect(choices(w, 'nose_kovac')).not.toContain(WAGON);
    expect(choices(w, 'nose_kovac')).not.toContain(WAGON_FOUND);

    w.player.discovered.push('burnt-convoy');
    w.player.notes.push({ id: 'wagonBowl', turn: 0 });
    w.player.scavenged.push(WAGON_SEVEN);

    expect(choices(w, 'nose_ibo')).toContain('What happened at Burnt Convoy?');
    expect(choices(w, 'nose_kovac')).toEqual(['What is this place?', 'Who runs Nose?', WORK, WAGON, WAGON_FOUND, 'Goodbye.']);
  });

  it('opens the Fallen Sun question once the crater is found', () => {
    const w = parkedAt('bowl');
    expect(choices(w, 'bowl_ruben')).not.toContain('What is the Fallen Sun really?');
    w.player.discovered.push('fallen-sun');
    expect(choices(w, 'bowl_ruben')).toContain('What is the Fallen Sun really?');
  });

  it('writes a rumor into the journal and changes nothing else', () => {
    const w = parkedAt('bowl');
    w.turn = 77;

    const next = talk(w, 'bowl_hattie', ['Heard any rumors?']);

    expect(next.player.notes).toEqual([{ id: 'wagonBowl', turn: 77 }]);
    expect(next.events).toEqual([{ t: 'note', id: 'wagonBowl' }]);
    expect(untouched(next)).toEqual(untouched(w));
  });

  it('answers a lore question with no note and no change', () => {
    const w = parkedAt('bowl');

    const next = talk(w, 'bowl_ruben', ['Tell me about the Old World.']);

    expect(next.player.notes).toEqual([]);
    expect(next.events).toEqual([]);
    expect(untouched(next)).toEqual(untouched(w));
  });
});

describe('the lost wagon chain', () => {
  it('leads from Hattie at Bowl to Kovac at Nose, and closes once the wagon is searched', () => {
    let w = talk(parkedAt('bowl'), 'bowl_hattie', ['Heard any rumors?', 'Goodbye.']);
    w.vehicles[0].pos = { ...sitePads(site('nose'))[0] };

    w = talk(w, 'nose_kovac', [WAGON, 'Goodbye.']);
    expect(choices(w, 'nose_kovac')).not.toContain(WAGON_FOUND);
    w.player.scavenged.push(WAGON_SEVEN);
    w = talk(w, 'nose_kovac', [WAGON_FOUND, 'Goodbye.']);

    expect(w.player.notes.map((n) => n.id)).toEqual(['wagonBowl', 'wagonNose', 'wagonFound']);
  });

  it('asks again with no second note', () => {
    const once = talk(parkedAt('bowl'), 'bowl_hattie', ['Heard any rumors?']);

    const twice = chooseQuestOption(once, QUESTS, pickIndex(once, 'Heard any rumors?'));

    expect(twice.player.notes.map((n) => n.id)).toEqual(['wagonBowl']);
    expect(twice.events).toEqual([]);
  });
});

describe('work by talk', () => {
  it('offers the best-paying open offer on the town board', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-low', 100), haul('ct-high', 300), { ...haul('ct-gone', 900), deadline: -1 }];

    expect(townWork(w)?.id).toBe('ct-high');
    const offer = talk(w, 'bowl_dag', [WORK]);
    expect(questView(offer).lines.at(-1)).toEqual({ text: 'Could be. Interested?', tags: ['work_offer'] });
  });

  it('passes over a haul the truck has no room for', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-small', 100), { ...haul('ct-huge', 300), units: 999 }];

    expect(townWork(w)?.id).toBe('ct-small');
  });

  it('says so when the board is empty or the player holds the most contracts', () => {
    const empty = parkedAt('bowl');
    empty.shops.bowl.contracts = [];
    const full = parkedAt('bowl');
    full.shops.bowl.contracts = [haul('ct-high', 300)];
    full.player.contracts = Array.from({ length: CONTRACTS.maxActive }, (_, k) => haul(`held${k}`, 10));

    expect(lastLine(talk(empty, 'bowl_dag', [WORK]))).toBe('Nothing on the board today. Come back in a couple of days.');
    expect(lastLine(talk(full, 'bowl_dag', [WORK]))).toBe('You are carrying enough promises already. Finish a few first.');
  });

  it('takes the offer exactly as the board does', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-low', 100), haul('ct-high', 300)];

    const taken = talk(w, 'bowl_dag', [WORK, 'I will take it.']);
    const board = acceptContract(w, 'ct-high');

    expect(taken.player.contracts).toEqual(board.player.contracts);
    expect(taken.shops).toEqual(board.shops);
    expect(taken.vehicles).toEqual(board.vehicles);
    expect(taken.events).toEqual(board.events);
  });
});

describe('journal notes', () => {
  it('starts a new player with no notes', () => {
    expect(emptyWorld().player.notes).toEqual([]);
  });

  it('keeps a learned note with the turn it was learned and tells the log once', () => {
    const w = emptyWorld();
    w.turn = 42;

    learnNote(w, 'greenPit');

    expect(w.player.notes).toEqual([{ id: 'greenPit', turn: 42 }]);
    expect(w.events).toEqual([{ t: 'note', id: 'greenPit' }]);
    expect(holdsNote(w, 'greenPit')).toBe(true);
    expect(holdsNote(w, 'glassTank')).toBe(false);
  });

  it('learns a held note again without a change or an event', () => {
    const w = emptyWorld();
    w.turn = 5;
    learnNote(w, 'greenPit');
    w.events = [];
    w.turn += 10;

    learnNote(w, 'greenPit');

    expect(w.player.notes).toEqual([{ id: 'greenPit', turn: 5 }]);
    expect(w.events).toEqual([]);
  });

  it('refuses a note id it does not know', () => {
    const w = emptyWorld();

    expect(() => learnNote(w, 'nonsense' as NoteId)).toThrow(/nonsense/);
    expect(w.player.notes).toEqual([]);
  });

  it('refuses a quest that names a note, site or wreck that does not exist', () => {
    const w = parkedAt('bowl');
    const bad = (text: string) => `INCLUDE world.ink\n=== start ===\n# checkpoint: start\n{${text}: yes}\n+ [Bye.] -> END\n`;
    for (const [text, error] of [['has_note("nonsense")', /names no note nonsense/], ['found("atlantis")', /names no town or location atlantis/], ['searched("story-none")', /No story wreck stock story-none/]] as const) {
      const bundle = compileBundle({ 'world.ink': readQuestSources('src/data/quests')['world.ink'], 'q.ink': bad(text) });
      expect(() => startQuest(w, bundle, 'q', 'start')).toThrow(error);
    }
  });
});
