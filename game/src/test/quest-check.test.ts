import { describe, expect, it } from 'vitest';
import { START_KITS } from '../data/start';
import { defaultSetup } from '../sim/settings';
import { newWorld } from '../sim/world';
import { TEST_MAP } from './map';
import { checkQuests, QUEST_STATE_LIMIT, type QuestReport } from './quest-check';
import { readQuestSources, type QuestSources } from './quest-compile';

const WORLD = 'VAR heard = false\nEXTERNAL money()\nEXTERNAL give_money(amount)\n';
const LIMIT = 200;

const world = () => newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'), false);

function check(quest: string, worldInk = WORLD): string[] {
  const sources: QuestSources = { 'world.ink': worldInk, 'q.ink': `INCLUDE world.ink\n${quest}` };
  return checkQuests(sources, world(), LIMIT).flatMap((report: QuestReport) => report.problems);
}

describe('checkQuests', () => {
  it('passes the game quests', () => {
    const reports = checkQuests(readQuestSources('src/data/quests'), world(), QUEST_STATE_LIMIT);
    expect(reports.flatMap((r) => r.problems)).toEqual([]);
    expect(reports.find((r) => r.quest === 'sample_bowl')?.states).toBeGreaterThan(2);
  });

  it('passes a quest with a hub that loops back and an exit', () => {
    expect(check('=== start ===\n# checkpoint: start\n- (hub)\n+ [Ask again.] Sure. -> hub\n+ [Bye.] -> END\n')).toEqual([]);
  });

  it('fails a missing divert target', () => {
    expect(check('=== start ===\n# checkpoint: start\nHi.\n-> nowhere\n').join('\n')).toMatch(/q: .*nowhere/);
  });

  it('fails a section that runs out of content without an end', () => {
    expect(check('=== start ===\n# checkpoint: start\nHi.\n').join('\n')).toMatch(/loose end|ran out of content/i);
  });

  it('fails a loop the player can never leave and names the picks that reach it', () => {
    const problems = check('=== start ===\n# checkpoint: start\n+ [Stay.] -> trap\n+ [Leave.] -> END\n= trap\n- (loop)\n+ [Again.] -> loop\n');
    expect(problems).toContain('q: after Stay.: no choice leads to an end from here');
  });

  it('fails a checkpoint tag on the wrong section', () => {
    expect(check('=== start ===\n# checkpoint: begin\nHi.\n-> END\n').join('\n')).toContain('Section start carries the checkpoint tag of begin');
  });

  it('fails a list variable', () => {
    expect(check('LIST moods = calm, angry\n=== start ===\n# checkpoint: start\nHi.\n-> END\n').join('\n')).toContain('List moods cannot be saved');
  });

  it('fails an external with no game function behind it', () => {
    expect(check('=== start ===\n# checkpoint: start\nHi.\n-> END\n', `${WORLD}EXTERNAL teleport()\n`)).toContain('External function teleport has no query or effect in src/sim/quests.ts');
  });

  it('fails a section no checkpoint ever reaches', () => {
    expect(check('=== start ===\n# checkpoint: start\nHi.\n-> END\n=== attic ===\nDust.\n-> END\n')).toContain('q: section attic is never reached');
  });

  it('fails an effect that throws on the way and names the picks', () => {
    const problems = check('=== start ===\n# checkpoint: start\n+ [Take it.]\n  ~ give_money(-1)\n  -> END\n');
    expect(problems.join('\n')).toContain('q: after Take it.: give_money takes no negative amount');
  });

  it('fails a checkpoint that a load would replay with an effect, and names the picks', () => {
    const problems = check('=== start ===\n# checkpoint: start\n+ [Pay me.] -> paid\n+ [Bye.] -> END\n= paid\n# checkpoint: start.paid\n~ give_money(1)\nHere.\n+ [Bye.] -> END\n');
    expect(problems.join('\n')).toContain('q: after Pay me.: a load here fails: Effect give_money ran while loading checkpoint start.paid');
  });

  it('fails a quest whose states outgrow the limit instead of passing it', () => {
    const problems = check('VAR n = 0\n=== start ===\n# checkpoint: start\n- (hub)\n+ [More.]\n  ~ n += 1\n  -> hub\n+ [Bye.] -> END\n');
    expect(problems).toContain(`q: stopped after ${LIMIT} states, so loops and reach are unchecked`);
  });
});
