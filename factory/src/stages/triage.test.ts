import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import { runStage } from './triage';
import type { AgentRun, Card, Ctx } from '../types';

let home = '';
let calls: string[] = [];
let prompt = '';
let effort: string | undefined;
let related = '';
let releaseInput = '';
// The board the stage sees. Issue 7 is the card under triage.
let cards: Card[] = [];

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-triage-');
  calls = [];
  prompt = '';
  related = '';
  cards = [card(7, 'Triage')];
  writeState(`${home}/state.json`, structuredClone(EMPTY_STATE));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(verdict: string | null, labels: string[] = [], earlier: string[] = []): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', triageEffort: 'low', repo: 'o/r', committeeChat: 'chat' },
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    telegram: { sendMessage: record('message') },
    log: () => undefined,
    github: {
      issue: async (number: number) => ({ number, title: number === 7 ? 'Big horn' : `Horn idea ${number}`, body: number === 7 ? 'Add a horn' : `Body of ${number}`, labels: number === 7 ? labels : [], createdAt: '', state: 'OPEN', author: 'anna', thumbsUp: [] }),
      comments: async () => earlier.map((body) => ({ login: 'bot', body })),
      cards: async () => cards,
      comment: record('comment'), addLabel: record('addLabel'), close: record('close'), move: record('move'),
    },
    container: {
      agent: async (run: AgentRun) => {
        calls.push(`agent ${run.model}`);
        effort = run.effort;
        related = readFileSync(`${run.clone}/${run.dir}/.factory/related.md`, 'utf8');
        releaseInput = readFileSync(`${run.clone}/${run.dir}/.factory/release.md`, 'utf8');
        prompt = run.prompt;
        if (verdict !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/triage.json`, verdict);
      },
    },
    repo: {
      fetch: record('fetch'), push: record('push'), fetchFromWork: record('fetchFromWork'),
      mergeLog: async () => ['Merge issue #5: Night driving', 'Merge main into dev'],
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
    },
  };
  return fake as unknown as Ctx;
}

const verdict = (over: Record<string, unknown>): string => JSON.stringify({ verdict: 'ready', reason: 'Clear goal', questions: [], hotfix: false, releaseFix: false, complexity: 'intermediate', complexityReason: 'Touches the horn code and the audio module.', bundle: [], ...over });
const card = (issue: number, column: Card['column'], labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });

describe('triage stage', () => {
  it('comments and moves to Design when ready', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(calls).toContain('agent sonnet');
    expect(effort).toBe('low');
    expect(calls.find((call) => call.startsWith('comment 7 Triage passed: Clear goal'))).toContain('Model routing from triage: intermediate, default models');
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(prompt).not.toContain('{{');
    expect(calls.filter((call) => call.startsWith('push') || call.startsWith('message') || call.startsWith('addLabel'))).toEqual([]);
  });

  it('explains the 20/80 model target and the routing effects without replacing the complexity rubric', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(prompt).toContain('20% Opus and 80% Sonnet');
    expect(prompt).toContain('`trivial` moves design to Sonnet');
    expect(prompt).toContain('`hard` moves implementation to Opus');
    expect(prompt).toContain('Do not change a complexity rating to chase the target');
  });

  it('labels a hotfix, warns the committee and moves to Design', async () => {
    await runStage(fakeCtx(verdict({ hotfix: true, reason: 'Saves from 0.3 fail to load.' })), 7);
    expect(calls.slice(-4)).toEqual([
      'addLabel 7 hotfix',
      expect.stringContaining('comment 7 Triage passed as a hotfix: Saves from 0.3 fail to load.\n\nIt branches from main, and its approval ships it to main and itch.io at once.\n\nModel routing from triage:'),
      'message chat ⚠️ Triage marked #7 Big horn as a hotfix.\nSaves from 0.3 fail to load.\nIt skips dev. Its approval will merge into main and ship to itch.io at once. Remove the label hotfix on GitHub if it can wait for a release.',
      'move 7 Design',
    ]);
  });

  it('adds design-sonnet for a trivial task and records the rationale', async () => {
    await runStage(fakeCtx(verdict({ complexity: 'trivial', complexityReason: 'One constant in one file.' })), 7);
    expect(calls).toContain('addLabel 7 design-sonnet');
    expect(calls.find((call) => call.startsWith('comment 7 Triage passed'))).toContain('Model routing from triage: trivial, label design-sonnet. One constant in one file.');
  });

  it('adds implementation-opus for a hard task', async () => {
    await runStage(fakeCtx(verdict({ complexity: 'hard', complexityReason: 'Pathing, combat and saves interact.' })), 7);
    expect(calls).toContain('addLabel 7 implementation-opus');
    expect(calls).not.toContain('addLabel 7 design-sonnet');
  });

  it('adds no label for an intermediate task, and triage itself runs on the build model', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(calls.filter((call) => call.startsWith('addLabel'))).toEqual([]);
    expect(calls).toContain('agent sonnet');
  });

  it('leaves labels a member set, even against its own rating', async () => {
    await runStage(fakeCtx(verdict({ complexity: 'hard' }), ['design-sonnet']), 7);
    expect(calls.filter((call) => call.startsWith('addLabel'))).toEqual([]);
    expect(calls.find((call) => call.startsWith('comment 7 Triage passed'))).toContain('left as set on the issue (design-sonnet)');
  });

  it('does not relabel on a later run after a member removed the label', async () => {
    await runStage(fakeCtx(verdict({ complexity: 'trivial' }), [], ['Triage passed: x\n\nModel routing from triage: trivial, label design-sonnet. y']), 7);
    expect(calls.filter((call) => call.startsWith('addLabel'))).toEqual([]);
  });

  it.each([
    [{ complexity: 'huge' }, 'complexity as trivial'],
    [{ complexityReason: ' ' }, 'complexityReason'],
  ])('throws on bad complexity %#', async (over, message) => {
    await expect(runStage(fakeCtx(verdict(over)), 7)).rejects.toThrow(message);
  });

  it('refuses, labels, closes and moves to Done on wont-do', async () => {
    await runStage(fakeCtx(verdict({ verdict: 'wont-do', reason: 'Against the design.' })), 7);
    expect(calls).toContain('comment 7 Against the design.');
    expect(calls).toContain('addLabel 7 wont-do');
    expect(calls).toContain('close 7 not planned');
    expect(calls.at(-1)).toBe('move 7 Done');
  });

  it('asks the author and leaves the card when unclear', async () => {
    await runStage(fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?', 'How loud?'] })), 7);
    const post = calls.find((call) => call.startsWith('comment 7 ## Questions from the factory')) ?? '';
    expect(post).toContain('@anna');
    expect(post).toContain('1. Which horn?');
    expect(post).toContain('2. How loud?');
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.filter((call) => call.startsWith('move'))).toEqual([]);
  });

  it('notifies the committee once, with stage, issue link and reply place, and no question text', async () => {
    await runStage(fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?'] })), 7);
    const messages = calls.filter((call) => call.startsWith('message'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('❓ Triage needs answers on #7');
    expect(messages[0]).toContain('https://github.com/o/r/issues/7');
    expect(messages[0]).toContain('Answer there. Replies in this chat do not reach the stage.');
    expect(messages[0]).not.toContain('Which horn?');
    expect(messages[0]).not.toContain('Big horn');
  });

  it('adds no second notice while the earlier question set is unanswered', async () => {
    const asked = '## Questions from the factory\n\n1. Old?\n\n<!-- roam-factory -->';
    await runStage(fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?'] }), [], [asked]), 7);
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.filter((call) => call.startsWith('message'))).toEqual([]);
  });

  it('notifies again for a new set after the author answered', async () => {
    const asked = ['## Questions from the factory\n\n1. Old?\n\n<!-- roam-factory -->', 'This one'];
    await runStage(fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?'] }), [], asked), 7);
    expect(calls.filter((call) => call.startsWith('message'))).toHaveLength(1);
  });

  it('keeps the questions and label when Telegram fails', async () => {
    const ctx = fakeCtx(verdict({ verdict: 'unclear', reason: 'Vague', questions: ['Which horn?'] }));
    (ctx.telegram as { sendMessage: unknown }).sendMessage = async () => { throw new Error('down'); };
    await runStage(ctx, 7);
    expect(calls).toContain('addLabel 7 needs-info');
  });

  it('throws when triage.json is missing', async () => {
    await expect(runStage(fakeCtx(null), 7)).rejects.toThrow('no .factory/triage.json');
  });

  it.each([
    ['not json', 'Unexpected'],
    ['[]', 'unknown verdict'],
    [verdict({ verdict: 'maybe' }), 'unknown verdict: maybe'],
    [verdict({ reason: '' }), 'reason'],
    [verdict({ verdict: 'unclear', questions: [] }), 'at least one'],
    [verdict({ verdict: 'unclear', questions: [3] }), 'at least one'],
    [JSON.stringify({ verdict: 'unclear', reason: 'x' }), 'at least one'],
    [JSON.stringify({ verdict: 'ready', reason: 'x' }), 'hotfix as true or false'],
    [verdict({ hotfix: 'yes' }), 'hotfix as true or false'],
    [JSON.stringify({ verdict: 'ready', reason: 'x', hotfix: false, releaseFix: false, complexity: 'intermediate', complexityReason: 'y' }), 'bundle as a list of issue numbers'],
    [verdict({ bundle: ['9'] }), 'bundle as a list of issue numbers'],
    [verdict({ bundle: [11] }), 'bundles #11, which is not an offered Triage card'],
    [verdict({ bundle: [9, 9] }), 'bundles an issue twice'],
    [verdict({ bundle: [9], hotfix: true }), 'bundles issues into a hotfix'],
    [verdict({ releaseFix: 'yes' }), 'releaseFix as true or false'],
    [verdict({ releaseFix: true }), 'no release takes fixes now'],
  ])('throws on a bad triage.json %#', async (text, message) => {
    cards = [card(7, 'Triage'), card(9, 'Triage')];
    await expect(runStage(fakeCtx(text), 7)).rejects.toThrow(message);
    expect(calls.filter((call) => /^(comment|move|close|addLabel)/.test(call))).toEqual([]);
    expect(readState(`${home}/state.json`).bundles).toEqual({});
  });
});

describe('triage release fixes', () => {
  const release = { issue: 40, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };
  const openRelease = (postId: number | null) => writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), release: { ...release, postId } });

  it('tells the agent that no release takes fixes when none is open', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(releaseInput).toContain('No release takes fixes now.');
  });

  it('lists the features of a release that has no candidate post yet', async () => {
    openRelease(null);
    await runStage(fakeCtx(verdict({})), 7);
    expect(releaseInput).toContain('Release 2026-09-29 takes fixes.');
    expect(releaseInput).toContain('- #5 Night driving');
    expect(releaseInput).not.toContain('Merge main');
  });

  it('takes no fixes once the candidate is posted', async () => {
    openRelease(123);
    await expect(runStage(fakeCtx(verdict({ releaseFix: true })), 7)).rejects.toThrow('no release takes fixes now');
    expect(releaseInput).toContain('No release takes fixes now.');
  });

  it('labels a release fix as a release task, names the release and drops the dev clone', async () => {
    openRelease(null);
    await runStage(fakeCtx(verdict({ releaseFix: true, reason: 'Fixes the headlights of #5.' })), 7);
    expect(calls).toContain('addLabel 7 release-task');
    expect(calls.find((call) => call.startsWith('comment 7 Triage passed as a fix for release 2026-09-29: Fixes the headlights of #5.'))).toContain('It branches from release/2026-09-29');
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(existsSync(`${home}/work/issue-7`)).toBe(false);
  });

  it('keeps the dev clone of a normal card for Design', async () => {
    openRelease(null);
    await runStage(fakeCtx(verdict({})), 7);
    expect(calls).not.toContain('addLabel 7 release-task');
    expect(existsSync(`${home}/work/issue-7`)).toBe(true);
  });

  it('drops the dev clone of a hotfix, so Design branches it from main', async () => {
    await runStage(fakeCtx(verdict({ hotfix: true })), 7);
    expect(existsSync(`${home}/work/issue-7`)).toBe(false);
  });

  it('refuses a hotfix that is also a release fix', async () => {
    openRelease(null);
    await expect(runStage(fakeCtx(verdict({ hotfix: true, releaseFix: true })), 7)).rejects.toThrow('marks a hotfix as a release fix');
  });
});

describe('triage bundles', () => {
  it('offers only free Triage cards: not itself, not stuck, waiting, hotfix, bundled, a lead or busy', async () => {
    cards = [
      card(7, 'Triage'), card(9, 'Triage'), card(10, 'Triage', ['needs-info']), card(11, 'Design'), card(12, 'Triage', ['factory-stuck']),
      card(13, 'Triage', ['hotfix']), card(14, 'Triage'), card(15, 'Triage'), card(16, 'Done', ['bundled']),
    ];
    writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), bundles: { '14': [16] }, jobs: [{ id: 'triage-15', stage: 'triage', issue: 15, pid: 1, startedAt: '', log: '' }] });
    await runStage(fakeCtx(verdict({})), 7);
    expect(related).toContain('# #9 Horn idea 9\n\nBody of 9');
    expect(related.match(/^# #/gm)).toHaveLength(1);
    expect(related).toContain('UNTRUSTED USER TEXT');
  });

  it('says so when no other request waits in Triage', async () => {
    await runStage(fakeCtx(verdict({})), 7);
    expect(related).toContain('No other request waits in Triage.');
  });

  it('folds the chosen cards into the lead, records the bundle and names it on the lead', async () => {
    cards = [card(7, 'Triage'), card(9, 'Triage'), card(10, 'Triage')];
    await runStage(fakeCtx(verdict({ bundle: [9, 10], reason: 'Both ask for a horn.' })), 7);
    expect(calls).toContain('comment 9 Triage bundled this into #7, which carries it from here: Both ask for a horn.\n\nIt closes when #7 ships.');
    expect(calls).toContain('addLabel 9 bundled');
    expect(calls).toContain('move 9 Done');
    expect(calls).toContain('move 10 Done');
    // The routing note follows the reason and the bundle line.
    expect(calls.find((call) => call.startsWith('comment 7 Triage passed:'))).toMatch(/^comment 7 Triage passed: Both ask for a horn\.\n\nThis card also carries #9, #10\.\n\n/);
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(readState(`${home}/state.json`).bundles).toEqual({ '7': [9, 10] });
  });

  describe('visual-reference gate for a new location', () => {
    const ask = verdict({ verdict: 'unclear', reason: 'A new location needs a reference image.', questions: ['Can you upload a reference image of the junkyard on this issue?'] });

    it('tells the agent to ask for an image when a new location has none, without wont-do', async () => {
      await runStage(fakeCtx(ask), 7);
      expect(prompt).toContain('Visual-reference gate.');
      expect(prompt).toContain('NEW authored gameplay location or landmark');
      expect(prompt).toContain('the verdict is `unclear`. Ask one short question');
      expect(prompt).toContain('Never pick `wont-do` only because the image is missing.');
      expect(prompt).toContain('upload it again');
    });

    it('comments the question, labels needs-info and keeps the card in Triage', async () => {
      await runStage(fakeCtx(ask), 7);
      expect(calls.find((call) => call.startsWith('comment 7 ## Questions from the factory'))).toContain('1. Can you upload a reference image of the junkyard on this issue?');
      expect(calls).toContain('addLabel 7 needs-info');
      expect(calls.filter((call) => /^(move|close)/.test(call))).toEqual([]);
    });

    it('proceeds to Design with normal triage once an image exists, and never asks again', async () => {
      await runStage(fakeCtx(verdict({})), 7);
      expect(prompt).toContain('never ask for one again');
      expect(calls.at(-1)).toBe('move 7 Design');
      expect(calls).not.toContain('addLabel 7 needs-info');
    });

    it('leaves repairs, biome changes and unrelated requests out of the gate', async () => {
      await runStage(fakeCtx(verdict({})), 7);
      expect(prompt).toContain('It does not apply to a repair or adjustment of an existing location, a generic biome or procedural-system change, or any other request.');
      expect(calls.at(-1)).toBe('move 7 Design');
    });
  });
});
