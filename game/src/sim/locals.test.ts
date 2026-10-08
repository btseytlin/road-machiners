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
import { UNITS } from '../data/units';
import { cloneWorld } from './world';

const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function parkedAt(town: string): World {
  return emptyWorld(sitePads(site(town))[0]);
}

function talk(w: World, quest: string, picks: readonly string[]): World {
  return picks.reduce((at, pick) => chooseQuestOption(at, QUESTS, pickIndex(at, pick)), startQuest(w, QUESTS, quest, 'start'));
}

function pickIndex(w: World, text: string): number {
  const index = questView(w, QUESTS).choices.indexOf(text);
  if (index < 0) throw new Error(`No choice ${text} in ${questView(w, QUESTS).choices.join(', ')}`);
  return index;
}

const choices = (w: World, quest: string) => questView(startQuest(w, QUESTS, quest, 'start'), QUESTS).choices;
const lastLine = (w: World) => questView(w, QUESTS).lines.at(-1)?.text;

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
    expect(choices(w, 'nose_kovac')).toEqual(['What is this place?', 'Who runs Nose?', WORK, 'Anything off the books?', WAGON, WAGON_FOUND, 'Goodbye.']);
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
    expect(questView(offer, QUESTS).lines.at(-1)).toEqual({ text: 'Could be. Interested?', tags: ['work_offer'] });
  });

  it('passes over a haul the truck has no room for', () => {
    const w = parkedAt('bowl');
    w.shops.bowl.contracts = [haul('ct-small', 100), { ...haul('ct-huge', 300), units: 999 }];

    expect(townWork(w)?.id).toBe('ct-small');
  });

  it('says the board holds nothing the truck can take, rather than nothing at all', () => {
    const w = parkedAt('nose');
    w.shops.nose.contracts = [{ ...haul('ct-huge', 300), shop: 'nose', to: 'bowl', units: 999 }];

    expect(lastLine(talk(w, 'nose_kovac', [WORK]))).toBe('Nothing on the board fits you right now.');
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

describe('the depot leak at Nose', () => {
  const OPEN = ['Anything off the books?', 'I will look into it.'];
  const LEDGER = 'Read the depot ledgers.';
  const GATE = 'Check the gate log for the same nights.';
  const SABINE = 'Talk to the trader by the gate.';
  const PAY = 'Pay her 20 M to talk.';
  const SOLID_CASE = [...OPEN, LEDGER, GATE, 'Talk to Pell, the fuel clerk.', 'Watch the depot all night.'];
  const vars = (w: World) => w.player.quests.local.nose_depot_leak ?? {};

  it('shows the depot quest as pages with its numbers and the facts found so far', () => {
    const w = parkedAt('nose');
    const view = questView(talk(w, 'nose_kovac', [...OPEN, LEDGER]), QUESTS);

    expect(view.view).toBe('page');
    expect(view.stats).toEqual([
      { label: 'Watches', value: '4' },
      { label: 'Money', value: `${w.player.money / UNITS.centsPerM} M` },
      { label: 'Talk', value: 'quiet' },
    ]);
    expect(view.facts).toEqual([expect.stringContaining('Ledger: cans went missing')]);
    expect(view.lines.filter((l) => l.tags.includes('row')).map((l) => l.text)).toEqual(['3rd; 2 cans; Pell', '7th; 3 cans; Pell', '11th; 2 cans; Pell']);
  });

  it('opens from Kovac and pays for naming the thief with proof, which changes what Nose says after', () => {
    const w = parkedAt('nose');
    const proof = talk(w, 'nose_kovac', SOLID_CASE);
    expect(vars(proof)).toMatchObject({ gate_checked: true, saw_swap: true, saw_handoff: true, watches: 1 });

    const done = talk(w, 'nose_kovac', [...SOLID_CASE, 'Go to Kovac with a name.', 'Corporal Vance.']);

    expect(done.player.money - w.player.money).toBe(150 * UNITS.centsPerM);
    expect(done.player.quests.world).toEqual({ depot_thief: 'vance' });
    expect(done.player.quests.session).toBeNull();
    expect(questView(startQuest(done, QUESTS, 'nose_kovac', 'start'), QUESTS).lines[0].text).toContain('The depot is quiet these days.');
    expect(choices(done, 'nose_kovac')).not.toContain('Anything off the books?');
    expect(lastLine(talk(done, 'nose_ibo', ['Heard about the depot business?']))).toContain('He sat at my table');
  });

  it('turns Kovac away from a name with no proof, and locks up the wrong man on the ledger alone', () => {
    const w = parkedAt('nose');
    const early = talk(w, 'nose_kovac', [...OPEN, 'Go to Kovac with a name.', 'Corporal Vance.']);
    expect(vars(early)).toMatchObject({ alarm: 1 });
    expect(early.player.quests.world).toEqual({ depot_thief: 'open' });
    expect(questView(talk(w, 'nose_kovac', [...OPEN, 'Go to Kovac with a name.', 'Pell, the clerk.']), QUESTS).ended).toBe(false);

    const weak = talk(w, 'nose_kovac', [...OPEN, LEDGER, GATE, 'Go to Kovac with a name.', 'Corporal Vance.']);
    expect(weak.player.quests.world).toEqual({ depot_thief: 'open' });

    const wrong = talk(w, 'nose_kovac', [...OPEN, LEDGER, 'Go to Kovac with a name.', 'Pell, the clerk.']);
    expect(wrong.player.money).toBe(w.player.money);
    expect(wrong.player.quests.world).toEqual({ depot_thief: 'pell' });
  });

  it('sells out for the envelope, or loses the trail to too much noise', () => {
    const w = parkedAt('nose');
    const sold = talk(w, 'nose_kovac', [...OPEN, LEDGER, GATE, SABINE, 'Let her see what you know.', 'Take the envelope.']);
    expect(sold.player.money - w.player.money).toBe(60 * UNITS.centsPerM);
    expect(sold.player.quests.world).toEqual({ depot_thief: 'bought' });

    const loud = talk(w, 'nose_kovac', [...OPEN, LEDGER, GATE, "Search Vance's bunk.", SABINE, 'Lean on her.']);
    expect(loud.player.quests.world).toEqual({ depot_thief: 'lost' });
    expect(questView(loud, QUESTS).ended).toBe(true);
  });

  it('charges the cost of a paid lead, and locks it with less money in hand', () => {
    const w = parkedAt('nose');
    const at = talk(w, 'nose_kovac', [...OPEN, SABINE]);
    const index = pickIndex(at, PAY);
    expect(questView(at, QUESTS)).toMatchObject({ costs: expect.arrayContaining([20]), locked: [false, false, false] });
    const paid = chooseQuestOption(at, QUESTS, index);
    expect(w.player.money - paid.player.money).toBe(20 * UNITS.centsPerM);
    expect(vars(paid)).toMatchObject({ knows_scar: true });

    const broke = cloneWorld(w);
    broke.player.money = 19 * UNITS.centsPerM;
    const short = talk(broke, 'nose_kovac', [...OPEN, SABINE]);
    expect(questView(short, QUESTS).locked[pickIndex(short, PAY)]).toBe(true);
    expect(() => chooseQuestOption(short, QUESTS, pickIndex(short, PAY))).toThrow('costs 20 M, more than the player holds');
  });

  it('runs out of watches into a last call', () => {
    const w = parkedAt('nose');
    const slow = talk(w, 'nose_kovac', [...OPEN, 'Talk to Pell, the fuel clerk.', LEDGER, 'Watch the depot all night.', GATE, SABINE, 'Leave her be.']);
    expect(vars(slow)).toMatchObject({ watches: 0, alarm: 1 });
    expect(questView(slow, QUESTS).choices).toEqual(['Name Corporal Vance.', 'Name Pell, the clerk.', 'Let it go.']);
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
