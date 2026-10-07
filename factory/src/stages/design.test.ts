import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStage } from './design';
import { EMPTY_STATE, readState, writeState } from '../state';
import { TASK_FILE, type AgentRun, type Ctx } from '../types';

let home = '';
let calls: string[] = [];
let diff = '';
let labels: string[] = [];
let bases: string[] = [];
let earlier: string[] = [];

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-design-');
  calls = [];
  diff = '';
  labels = [];
  bases = [];
  earlier = [];
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(agent: (run: AgentRun) => void): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', designEffort: 'medium', repo: 'o/r', committeeChat: 'chat' },
    telegram: { sendMessage: record('message') },
    log: () => undefined,
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    github: {
      issue: async (number: number) => ({ number, title: number === 7 ? 'Big horn' : 'Louder horn', body: number === 7 ? 'Add a horn' : 'Make it louder', labels, createdAt: '', state: 'OPEN', author: 'anna', thumbsUp: [] }),
      comments: async () => [{ login: 'a', body: 'yes please' }, ...earlier.map((body) => ({ login: 'bot', body }))],
      comment: record('comment'), addLabel: record('addLabel'), removeLabel: record('removeLabel'), close: record('close'), move: record('move'),
    },
    container: { agent: async (run: AgentRun) => { calls.push('agent'); agent(run); } },
    repo: {
      fetch: record('fetch'), push: record('push'), fetchFromWork: async () => 'w1', untrackFactoryFiles: async () => [],
      mergeBranchIntoWork: async () => ({ commit: null, conflicts: [] }),
      prepareWorkClone: async (_b: string, base: string, dir: string) => { bases.push(`prepare ${base}`); mkdirSync(dir, { recursive: true }); },
      diff: async (base: string) => { bases.push(`diff ${base}`); return diff; },
    },
  };
  return fake as unknown as Ctx;
}

const PLAN = '# Task\n\n## Plan\n- step one\n\n## Verify\n';

describe('design stage with a bundle', () => {
  const bundled = (): void => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), bundles: { '7': [9] } });

  it('gives the agent every bundled issue after the lead, all as untrusted text', async () => {
    bundled();
    let input = '';
    await runStage(fakeCtx((run) => {
      input = readFileSync(`${run.clone}/${run.dir}/.factory/issue.md`, 'utf8');
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/${TASK_FILE(7)}`, PLAN);
    }), 7);
    expect(input.startsWith('UNTRUSTED USER TEXT')).toBe(true);
    expect(input).toContain('# Big horn\n\nAdd a horn\n\n## Comment by a\n\nyes please');
    expect(input).toContain('# Bundled issue #9\n\n## Louder horn\n\nMake it louder\n\n### Comment by a\n\nyes please');
    expect(input.indexOf('# Big horn')).toBeLessThan(input.indexOf('# Bundled issue #9'));
  });

  it('sends the bundled issues back to Triage on their own when the lead will not be built', async () => {
    bundled();
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'Against the design.\n')), 7);
    expect(calls).toContain('comment 9 #7 will not be built, so this issue goes back to triage on its own.');
    expect(calls).toContain('removeLabel 9 bundled');
    expect(calls.at(-1)).toBe('move 9 Triage');
    expect(readState(`${home}/state.json`).bundles).toEqual({});
  });
});

describe('design stage', () => {
  it.each([
    [[], 'opus'],
    [['design-sonnet'], 'sonnet'],
    [['implementation-opus'], 'opus'],
  ])('designs with the model of labels %j: %s', async (set, model) => {
    labels = set;
    const models: string[] = [];
    await runStage(fakeCtx((run) => { models.push(run.model); writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'No.\n'); }), 7);
    expect(models).toEqual([model]);
  });

  it('passes the design effort to the agent', async () => {
    const efforts: Array<string | undefined> = [];
    await runStage(fakeCtx((run) => { efforts.push(run.effort); writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'No.\n'); }), 7);
    expect(efforts).toEqual(['medium']);
  });

  it('comments, labels, closes and moves to Done on won\'t do', async () => {
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'Against the design.\n')), 7);
    expect(calls).toContain('comment 7 Against the design.');
    expect(calls).toContain('addLabel 7 wont-do');
    expect(calls).toContain('close 7 not planned');
    expect(calls).toContain('move 7 Done');
    expect(calls).not.toContain('push w1 factory/issue-7');
  });

  it('asks the author, moves back to Triage and pushes nothing on questions', async () => {
    const ctx = fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/questions.md`, 'Which horn?\n\n  How loud?\n'));
    await runStage(ctx, 7);
    const post = calls.find((call) => call.startsWith('comment 7 ## Questions from the factory')) ?? '';
    expect(post).toContain('@anna');
    expect(post).toContain('1. Which horn?\n2. How loud?');
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.at(-1)).toBe('move 7 Triage');
    expect(calls.filter((call) => call.startsWith('push'))).toEqual([]);
  });

  it('notifies the committee once about design questions, with the issue link and reply place', async () => {
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/questions.md`, 'Which horn?')), 7);
    const messages = calls.filter((call) => call.startsWith('message'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Design needs answers on #7');
    expect(messages[0]).toContain('https://github.com/o/r/issues/7');
    expect(messages[0]).toContain('Replies in this chat do not reach the stage.');
    expect(messages[0]).not.toContain('Which horn?');
  });

  it('adds no duplicate notice when a retry asks while the earlier set is open', async () => {
    earlier = ['## Questions from the factory\n\n1. Old?\n\n<!-- roam-factory -->'];
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/questions.md`, 'Which horn?')), 7);
    expect(calls).toContain('addLabel 7 needs-info');
    expect(calls.filter((call) => call.startsWith('message'))).toEqual([]);
  });

  it('checks questions before wont-do and the plan', async () => {
    const ctx = fakeCtx((run) => {
      writeFileSync(`${run.clone}/${run.dir}/.factory/questions.md`, 'Which horn?');
      writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'No.');
    });
    await runStage(ctx, 7);
    expect(calls).not.toContain('close 7 not planned');
    expect(calls.at(-1)).toBe('move 7 Triage');
  });

  it('throws on an empty questions file', async () => {
    await expect(runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/questions.md`, '\n')), 7)).rejects.toThrow('empty questions.md');
  });

  it('pushes and moves to Implementation on a plan', async () => {
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    });
    await runStage(ctx, 7);
    expect(calls).toContain('push w1 factory/issue-7');
    expect(calls.at(-1)).toBe('move 7 Implementation');
  });

  it('drops a patch queued before the card came to Design, so Implementation runs the new plan', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), patching: { 7: 'abc1234', 8: 'def5678' } });
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    });
    await runStage(ctx, 7);
    expect(readState(`${home}/state.json`).patching).toEqual({ 8: 'def5678' });
  });

  it('writes the issue input as untrusted text', async () => {
    let seen = '';
    await runStage(fakeCtx((run) => {
      seen = run.prompt;
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    }), 7);
    expect(seen).toContain('.factory-tasks/issue-7.md');
    expect(seen).toContain('factory/issue-7');
  });

  it('throws when the plan is empty', async () => {
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, '# Task\n\n## Plan\n\n## Verify\n');
    });
    await expect(runStage(ctx, 7)).rejects.toThrow('Plan');
  });

  it('throws the committee text', async () => {
    const ctx = fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/needs-committee.md`, 'Bump the save?'));
    await expect(runStage(ctx, 7)).rejects.toThrow('Bump the save?');
  });

  it('does not push when the diff bumps SAVE_MAJOR', async () => {
    diff = 'diff --git a/game/src/three/save-migrations.ts b/game/src/three/save-migrations.ts\n@@ -1 +1 @@\n-const SAVE_MAJOR = 1;\n+const SAVE_MAJOR = 2;\n';
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    });
    await expect(runStage(ctx, 7)).rejects.toThrow('SAVE_MAJOR');
    expect(calls.filter((call) => call.startsWith('push'))).toEqual([]);
    expect(calls.filter((call) => call.startsWith('move'))).toEqual([]);
  });

  it('plans a release task against the release branch, fetched first', async () => {
    labels = ['release-task'];
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    });
    await runStage(ctx, 7);
    expect(calls[0]).toBe('fetch ');
    expect(bases).toEqual(['prepare release/2026-09-29', 'diff release/2026-09-29']);
  });

  it('plans an ordinary card against dev', async () => {
    const ctx = fakeCtx((run) => {
      mkdirSync(`${run.clone}/${run.dir}/.factory-tasks`, { recursive: true });
      writeFileSync(`${run.clone}/${run.dir}/.factory-tasks/issue-7.md`, PLAN);
    });
    await runStage(ctx, 7);
    expect(bases).toEqual(['prepare dev', 'diff dev']);
  });

  it('closes a cleanup task on won\'t do, so the candidate is not held', async () => {
    labels = ['release-task', 'maintenance'];
    await runStage(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/wont-do.md`, 'Nothing worth doing.\n')), 7);
    expect(calls).toContain('close 7 not planned');
    expect(calls.at(-1)).toBe('move 7 Done');
  });
});
