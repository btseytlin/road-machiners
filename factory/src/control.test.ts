import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cardDrift } from './position';
import { replyMediaDir } from './reply-media';
import { workDir } from './stages/common';
import { readLedger } from './ledger';
import { EMPTY_STATE, readState, writeState } from './state';
import { TASK_FILE, type Card, type Column, type Ctx, type FactoryConfig, type FactoryState, type Job, type ReleaseState } from './types';

const killed: string[] = [];
vi.mock('./jobs', () => ({ killJob: async (_run: unknown, pid: number, id: string) => { killed.push(`${pid} ${id}`); } }));
const { applyControl, isGated, parseControl, resolveActor, writeControl } = await import('./control');
type Command = Parameters<typeof applyControl>[1];

const ROOT = resolve('tmp/factory-control-test');
const statePath = join(ROOT, 'state.json');
const NOW = new Date('2026-09-29T10:00:00Z');
const RELEASE: ReleaseState = { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [] };
const JOB: Job = { id: 'verify-4-x', stage: 'verify', issue: 4, pid: 77, startedAt: '2026-09-29T09:00:00Z', log: 'l' };

let calls: string[] = [];
let cards: Card[] = [];
let branches: string[] = [];
let moveFails = false;
let editFails = false;

const card = (issue: number, column: Column, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column, labels });

function fakeCtx(): Ctx {
  const cfg = { home: ROOT, committeeBootstrapTelegram: '11', committeeBootstrapGithub: 'boss', committeeChat: '-5', tokenPrices: {} } as FactoryConfig;
  return {
    cfg, statePath, now: () => NOW, log: () => undefined, run: async () => ({ code: 0, stdout: '', stderr: '' }),
    github: {
      cards: async () => cards,
      comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      move: async (n: number, column: string) => {
        if (moveFails) throw new Error('board down');
        calls.push(`move ${n} ${column}`);
      },
      pullRequestFor: async () => null,
      close: async (n: number, reason: string) => { calls.push(`close ${n} ${reason}`); },
      addLabel: async (n: number, label: string) => { calls.push(`addLabel ${n} ${label}`); },
      removeLabel: async (n: number, label: string) => { calls.push(`removeLabel ${n} ${label}`); },
      mergePullRequest: async (branch: string) => { calls.push(`mergePullRequest ${branch}`); },
    },
    telegram: {
      editCaption: async (_chat: string, id: number, caption: string) => {
        if (editFails) throw new Error('telegram down');
        calls.push(`editCaption ${id} ${caption}`);
      },
      editText: async (_chat: string, id: number, text: string) => {
        if (editFails) throw new Error('telegram down');
        calls.push(`editText ${id} ${text}`);
      },
    },
    repo: {
      fetch: async () => { calls.push('fetch'); },
      headHash: async (branch: string) => {
        if (!branches.includes(branch)) throw new Error(`unknown revision ${branch}`);
        return 'abc1234';
      },
    },
  } as unknown as Ctx;
}

const seed = (patch: Partial<FactoryState>): void => writeState(statePath, { ...structuredClone(EMPTY_STATE), ...patch });
const command = (body: object): Command => ({ by: 'Ann', reason: 'the gate failed on load', ...body }) as Command;
const ctrlLines = () => readLedger(ROOT, new Date(0)).filter((line) => line.kind === 'control');

// A card stuck in Testing with every store holding something of it.
function busyCard(): void {
  cards = [card(4, 'Testing', ['factory-stuck', 'needs-info', 'hotfix'])];
  seed({
    jobs: [JOB, { ...JOB, id: 'verify-5-x', issue: 5, pid: 78 }],
    testPhase: { 4: 'fix', 5: 'fix' }, patching: { 4: 'abc' }, interrupted: [4, 5],
    pendingApprovals: { 4: 'Bob', 5: 'Bob' }, approvedResolving: { 4: 'Bob' },
    approvalPosts: { 42: 4, 43: 5 }, postCaptions: { 42: 'Post four', 43: 'Post five' },
    unroutedReplies: { 9: { issue: 4, postId: 42, text: 't', at: 'a' }, 10: { issue: 5, postId: 43, text: 't', at: 'a' } },
    failures: [{ stage: 'checks', issue: 4, error: 'e', log: null, at: 'a' }, { stage: 'checks', issue: 5, error: 'e', log: null, at: 'a' }],
  });
}

// The work clone of an issue holds the task file and the approval the stages write.
function stageArtifacts(issue: number, names: { task: boolean; approval: boolean }): void {
  const game = join(workDir(fakeCtx(), issue), 'game');
  if (names.task) {
    mkdirSync(dirname(join(game, TASK_FILE(issue))), { recursive: true });
    writeFileSync(join(game, TASK_FILE(issue)), 'task');
  }
  if (names.approval) {
    mkdirSync(join(game, '.factory'), { recursive: true });
    writeFileSync(join(game, '.factory', 'approval.json'), '{}');
  }
}

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  branches = ['factory/issue-4', 'factory/issue-6'];
  moveFails = false;
  editFails = false;
  for (const issue of [4, 6]) stageArtifacts(issue, { task: true, approval: true });
  mkdirSync(join(ROOT, 'inbox'), { recursive: true });
  calls = [];
  killed.length = 0;
  cards = [];
  seed({});
  mkdirSync(join(ROOT, 'committee'), { recursive: true });
  writeFileSync(join(ROOT, 'committee', 'committee.json'), JSON.stringify({ members: [{ telegram: '11', github: 'boss', name: 'Ann' }] }));
});

describe('writeControl and parseControl', () => {
  it('writes inbox/<ms>-control.json with kind control and leaves no temp file', () => {
    const path = writeControl(ROOT, command({ action: 'move', issue: 4, to: 'design' }), NOW);
    expect(path).toBe(join(ROOT, 'inbox', `${NOW.getTime()}-control.json`));
    const data = JSON.parse(readFileSync(path, 'utf8'));
    expect(data).toEqual({ kind: 'control', action: 'move', issue: 4, to: 'design', by: 'Ann', reason: 'the gate failed on load' });
    expect(readdirSync(join(ROOT, 'inbox'))).toEqual([`${NOW.getTime()}-control.json`]);
    expect(parseControl(data)).toEqual(command({ action: 'move', issue: 4, to: 'design' }));
  });

  it('parses every action', () => {
    for (const body of [{ action: 'merge', issue: 4 }, { action: 'ship' }, { action: 'cut' }, { action: 'remove', issue: 4 }, { action: 'drop', queue: 'ship', id: null }, { action: 'drop', queue: 'approval', id: 4 }, { action: 'merge-change', id: 12 }]) {
      expect(parseControl({ kind: 'control', by: 'Ann', reason: 'r', ...body })).toEqual({ by: 'Ann', reason: 'r', ...body });
    }
  });

  it('throws on a bad shape', () => {
    const ok = { by: 'Ann', reason: 'r' };
    expect(() => parseControl(null)).toThrow('control');
    expect(() => parseControl({ ...ok, action: 'explode' })).toThrow('Unknown control action');
    expect(() => parseControl({ ...ok, action: 'move', issue: 4, to: 'nowhere' })).toThrow('to');
    expect(() => parseControl({ ...ok, action: 'move', to: 'design' })).toThrow('issue');
    expect(() => parseControl({ ...ok, action: 'drop', queue: 'mail', id: 1 })).toThrow('queue');
    expect(() => parseControl({ ...ok, action: 'drop', queue: 'ship' })).toThrow('id');
    expect(() => parseControl({ by: 'Ann', action: 'cut' })).toThrow('reason');
    expect(() => parseControl({ reason: 'r', action: 'cut' })).toThrow('by');
    expect(() => parseControl({ ...ok, reason: ' ', action: 'cut' })).toThrow('reason');
  });
});

describe('resolveActor', () => {
  it('acts as Hermes for an ungated action and refuses it for a gated one', () => {
    expect(resolveActor(fakeCtx(), 'hermes', false)).toBe('Hermes');
    expect(() => resolveActor(fakeCtx(), 'hermes', true)).toThrow('--by <member>');
  });

  it('matches a member by telegram id, github login or name', () => {
    mkdirSync(join(ROOT, 'committee'), { recursive: true });
    writeFileSync(join(ROOT, 'committee', 'committee.json'), JSON.stringify({ members: [{ telegram: '11', github: 'boss', name: 'Ann' }, { telegram: '12', github: 'bob-gh', name: null }, { telegram: '13', github: null, name: null }] }));
    expect(resolveActor(fakeCtx(), '11', true)).toBe('Ann');
    expect(resolveActor(fakeCtx(), 'boss', true)).toBe('Ann');
    expect(resolveActor(fakeCtx(), 'Ann', true)).toBe('Ann');
    expect(resolveActor(fakeCtx(), '12', false)).toBe('bob-gh');
    expect(resolveActor(fakeCtx(), '13', false)).toBe('13');
  });

  it('uses the bootstrap member when no committee file exists', () => {
    rmSync(join(ROOT, 'committee'), { recursive: true });
    expect(resolveActor(fakeCtx(), 'boss', true)).toBe('boss');
  });

  it('throws for an unknown actor', () => {
    expect(() => resolveActor(fakeCtx(), 'mallory', false)).toThrow('mallory');
  });
});

describe('isGated', () => {
  it('gates ship, merge-change and the merge of an unapproved card', () => {
    const ctx = fakeCtx();
    expect(isGated(ctx, command({ action: 'ship' }))).toBe(true);
    expect(isGated(ctx, command({ action: 'merge-change', id: 1 }))).toBe(true);
    expect(isGated(ctx, command({ action: 'merge', issue: 4 }))).toBe(true);
    expect(isGated(ctx, command({ action: 'move', issue: 4, to: 'done' }))).toBe(false);
    expect(isGated(ctx, command({ action: 'cut' }))).toBe(false);
  });

  it('does not gate the merge of a card the committee approved', () => {
    seed({ approvedResolving: { 4: 'Bob' } });
    expect(isGated(fakeCtx(), command({ action: 'merge', issue: 4 }))).toBe(false);
    seed({ pendingApprovals: { 5: 'Bob' } });
    expect(isGated(fakeCtx(), command({ action: 'merge', issue: 5 }))).toBe(false);
  });
});

describe('move', () => {
  it('to design stops the job and clears every store of the old position (IV1)', async () => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }));
    const state = readState(statePath);
    expect(killed).toEqual(['77 verify-4-x']);
    expect(state.jobs.map((job) => job.id)).toEqual(['verify-5-x']);
    expect(state.testPhase).toEqual({ 5: 'fix' });
    expect(state.patching).toEqual({});
    expect(state.interrupted).toEqual([5]);
    expect(state.pendingApprovals).toEqual({ 5: 'Bob' });
    expect(state.approvedResolving).toEqual({});
    expect(state.approvalPosts).toEqual({ 43: 5 });
    expect(Object.keys(state.unroutedReplies)).toEqual(['10']);
    expect(state.failures.map((failure) => failure.issue)).toEqual([5]);
    expect(calls).toContain('move 4 Design');
    expect(calls).toContain('removeLabel 4 factory-stuck');
    expect(calls).toContain('removeLabel 4 needs-info');
    expect(calls.filter((call) => call.startsWith('removeLabel'))).toHaveLength(2);
    expect(cardDrift(card(4, 'Design'), state)).toEqual([]);
    const jobLine = readLedger(ROOT, new Date(0)).find((line) => line.kind === 'job');
    expect(jobLine).toMatchObject({ kind: 'job', id: 'verify-4-x', outcome: 'stopped' });
  });

  it('closes each open post with the moved status, through the post kind of the caption', async () => {
    busyCard();
    seed({ ...readState(statePath), approvalPosts: { 42: 4, 44: 4, 43: 5 }, postCaptions: { 42: 'Post four', 43: 'Post five', 44: 'Text four' }, textPosts: ['44'] });
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }));
    expect(calls).toContain('editCaption 42 Post four\n\n↪️ Moved to design by Ann: the gate failed on load');
    expect(calls).toContain('editText 44 Text four\n\n↪️ Moved to design by Ann: the gate failed on load');
    expect(calls.some((call) => call.includes(' 43 '))).toBe(false);
    expect(readState(statePath).postCaptions[42]).toBe('Post four\n\n↪️ Moved to design by Ann: the gate failed on load');
  });

  it('deletes the reply images of each post it closes, and keeps those of other cards', async () => {
    busyCard();
    for (const post of [42, 43]) mkdirSync(replyMediaDir(ROOT, post), { recursive: true });
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }));
    expect(existsSync(replyMediaDir(ROOT, 42))).toBe(false);
    expect(existsSync(replyMediaDir(ROOT, 43))).toBe(true);
  });

  it.each([
    ['triage', 'Triage', {}, false],
    ['implement', 'Implementation', {}, false],
    ['verify', 'Testing', {}, true],
    ['checks', 'Testing', { 4: 'checks' }, true],
    ['approval', 'Testing', { 4: 'post' }, true],
    ['done', 'Done', {}, false],
  ] as const)('to %s sets column %s and phase %j, and keeps approval only for later positions (%s)', async (to, column, phase, keepsApproval) => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to }));
    const state = readState(statePath);
    expect(calls).toContain(`move 4 ${column}`);
    expect(Object.fromEntries(Object.entries(state.testPhase).filter(([key]) => key === '4'))).toEqual(phase);
    expect(String(4) in state.approvedResolving).toBe(keepsApproval);
    expect(state.patching).toEqual({});
    expect(state.pendingApprovals).toEqual({ 5: 'Bob' });
    expect(cardDrift(card(4, column as Column), state)).toEqual([]);
  });

  it('comments on the issue with the actor and the reason, and writes a ledger line (IV3)', async () => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }));
    const comment = calls.find((call) => call.startsWith('comment 4')) ?? '';
    expect(comment).toContain('Ann');
    expect(comment).toContain('the gate failed on load');
    expect(ctrlLines()).toEqual([{ kind: 'control', action: 'move', issue: 4, by: 'Ann', reason: 'the gate failed on load', at: NOW.toISOString() }]);
  });

  it('changes nothing for a card that is not on the board (IV4)', async () => {
    busyCard();
    cards = [];
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('#4');
    expect(readState(statePath)).toEqual(before);
    expect(killed).toEqual([]);
    expect(calls).toEqual([]);
    expect(ctrlLines()).toEqual([]);
  });

  it('changes nothing for an unknown actor (IV4)', async () => {
    busyCard();
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design', by: 'mallory' }))).rejects.toThrow('mallory');
    expect(readState(statePath)).toEqual(before);
    expect(calls).toEqual([]);
  });

  it('changes nothing while the card merges, and kills no merge (IV4)', async () => {
    busyCard();
    const state = readState(statePath);
    writeState(statePath, { ...state, jobs: [{ ...JOB, id: 'approve-4-x', stage: 'approve' }] });
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('merging now');
    expect(readState(statePath)).toEqual(before);
    expect(killed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('changes nothing when a post of the card has no caption (IV4)', async () => {
    busyCard();
    const state = readState(statePath);
    writeState(statePath, { ...state, postCaptions: {} });
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('No caption');
    expect(readState(statePath)).toEqual(before);
    expect(killed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('acts as Hermes when by is hermes', async () => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design', by: 'hermes' }));
    expect(calls.find((call) => call.startsWith('editCaption 42'))).toContain('by Hermes:');
    expect(ctrlLines()[0]).toMatchObject({ by: 'Hermes' });
  });
});

describe('merge', () => {
  it('moves an approved card to Approval with its merge queued under the actor', async () => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'merge', issue: 4 }));
    const state = readState(statePath);
    expect(killed).toEqual(['77 verify-4-x']);
    expect(state.approvedResolving).toEqual({ 4: 'Ann' });
    expect(state.pendingApprovals).toEqual({ 4: 'Ann', 5: 'Bob' });
    expect(state.testPhase).toEqual({ 5: 'fix' });
    expect(state.approvalPosts).toEqual({ 43: 5 });
    expect(calls).toContain('move 4 Approval');
    expect(calls).toContain('removeLabel 4 factory-stuck');
    expect(ctrlLines()).toHaveLength(1);
  });

  it('refuses an unapproved card for Hermes and changes nothing (IV5)', async () => {
    cards = [card(6, 'Approval')];
    seed({ approvalPosts: { 50: 6 }, postCaptions: { 50: 'P' } });
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'merge', issue: 6, by: 'hermes' }))).rejects.toThrow('--by <member>');
    expect(readState(statePath)).toEqual(before);
    expect(calls).toEqual([]);
  });

  it('lets a member merge an unapproved card', async () => {
    cards = [card(6, 'Approval')];
    seed({ approvalPosts: { 50: 6 }, postCaptions: { 50: 'P' } });
    await applyControl(fakeCtx(), command({ action: 'merge', issue: 6, by: '11' }));
    expect(readState(statePath).pendingApprovals).toEqual({ 6: 'Ann' });
    expect(readState(statePath).approvalPosts).toEqual({});
  });

  it('lets Hermes merge a card the committee approved', async () => {
    cards = [card(6, 'Approval')];
    seed({ pendingApprovals: { 6: 'Bob' } });
    await applyControl(fakeCtx(), command({ action: 'merge', issue: 6, by: 'hermes' }));
    expect(readState(statePath).pendingApprovals).toEqual({ 6: 'Hermes' });
  });
});

describe('move and merge preconditions and write order', () => {
  const expectUntouched = (before: FactoryState): void => {
    expect(readState(statePath)).toEqual(before);
    expect(killed).toEqual([]);
    expect(calls.filter((call) => call !== 'fetch')).toEqual([]);
    expect(ctrlLines()).toEqual([]);
  };

  it('refuses move and merge for the release tracking card', async () => {
    cards = [card(4, 'Testing', ['release'])];
    seed({ jobs: [JOB] });
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('release');
    await expect(applyControl(fakeCtx(), command({ action: 'merge', issue: 4, by: '11' }))).rejects.toThrow('release');
    expectUntouched(before);
  });

  it.each(['approval', 'checks'] as const)('move to %s needs the approval file, and names the position that writes it', async (to) => {
    busyCard();
    rmSync(join(workDir(fakeCtx(), 4), 'game', '.factory', 'approval.json'));
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to }))).rejects.toThrow(/approval\.json.*move it to verify/);
    expectUntouched(before);
  });

  it.each(['approval', 'checks', 'verify'] as const)('move to %s needs the branch, and names design', async (to) => {
    busyCard();
    branches = [];
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to }))).rejects.toThrow(/factory\/issue-4.*move it to design/);
    expectUntouched(before);
  });

  it('move to implement needs the task file, and names design', async () => {
    busyCard();
    rmSync(join(workDir(fakeCtx(), 4), 'game', TASK_FILE(4)));
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'implement' }))).rejects.toThrow(/issue-4\.md.*move it to design/);
    expectUntouched(before);
  });

  it('merge needs the branch', async () => {
    busyCard();
    branches = [];
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'merge', issue: 4, by: '11' }))).rejects.toThrow(/factory\/issue-4.*move it to design/);
    expectUntouched(before);
  });

  it('a board failure leaves the state as it was, except the killed job', async () => {
    busyCard();
    moveFails = true;
    const before = readState(statePath);
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('board down');
    expect(readState(statePath)).toEqual({ ...before, jobs: before.jobs.filter((job) => job.issue !== 4) });
    expect(killed).toEqual(['77 verify-4-x']);
    expect(calls).toEqual([]);
    expect(ctrlLines()).toEqual([]);
  });

  it('a post edit failure leaves the board and state on the new position, and a repeat finishes', async () => {
    busyCard();
    editFails = true;
    await expect(applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }))).rejects.toThrow('telegram down');
    const half = readState(statePath);
    expect(calls).toContain('move 4 Design');
    expect(half.approvalPosts).toEqual({ 42: 4, 43: 5 });
    expect(half.testPhase).toEqual({ 5: 'fix' });
    expect(half.pendingApprovals).toEqual({ 5: 'Bob' });
    expect(calls.some((call) => call.startsWith('removeLabel'))).toBe(false);
    expect(ctrlLines()).toEqual([]);
    editFails = false;
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'design' }));
    const state = readState(statePath);
    expect(state.approvalPosts).toEqual({ 43: 5 });
    expect(calls.filter((call) => call.startsWith('editCaption'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('removeLabel'))).toHaveLength(2);
    expect(ctrlLines()).toHaveLength(1);
  });

  it('move to done closes the card the way a denial does', async () => {
    busyCard();
    await applyControl(fakeCtx(), command({ action: 'move', issue: 4, to: 'done' }));
    expect(calls).toContain('comment 4 Dropped by Ann: the gate failed on load');
    expect(calls).toContain('addLabel 4 wont-do');
    expect(calls).toContain('close 4 not planned');
    expect(calls).toContain('move 4 Done');
    expect(readState(statePath).approvalPosts).toEqual({ 43: 5 });
  });
});

describe('ship, cut and remove', () => {
  it('ships the open release for a member and refuses Hermes (IV5)', async () => {
    seed({ release: RELEASE });
    await expect(applyControl(fakeCtx(), command({ action: 'ship', by: 'hermes' }))).rejects.toThrow('--by <member>');
    expect(readState(statePath).pendingShip).toBeNull();
    await applyControl(fakeCtx(), command({ action: 'ship', by: '11' }));
    expect(readState(statePath).pendingShip).toBe('Ann');
    expect(calls.find((call) => call.startsWith('comment 20'))).toContain('the gate failed on load');
    expect(ctrlLines()[0]).toMatchObject({ action: 'ship', issue: 20 });
  });

  it('refuses a ship with no open release or no candidate post', async () => {
    await expect(applyControl(fakeCtx(), command({ action: 'ship', by: '11' }))).rejects.toThrow('No release is open');
    seed({ release: { ...RELEASE, postId: null } });
    await expect(applyControl(fakeCtx(), command({ action: 'ship', by: '11' }))).rejects.toThrow('no current candidate post');
  });

  it('cuts by clearing lastRelease, and refuses an open release', async () => {
    seed({ lastRelease: '2026-09-28T00:00:00Z' });
    await applyControl(fakeCtx(), command({ action: 'cut' }));
    expect(readState(statePath).lastRelease).toBeNull();
    expect(ctrlLines()[0]).toMatchObject({ action: 'cut', issue: null });
    seed({ release: RELEASE, lastRelease: 'x' });
    await expect(applyControl(fakeCtx(), command({ action: 'cut' }))).rejects.toThrow('2026-09-29');
    expect(readState(statePath).lastRelease).toBe('x');
  });

  it('queues a removal with the reason as its text', async () => {
    seed({ release: RELEASE });
    await applyControl(fakeCtx(), command({ action: 'remove', issue: 5 }));
    expect(readState(statePath).pendingRemovals).toEqual([{ issue: 5, by: 'Ann', text: 'the gate failed on load' }]);
    expect(calls.find((call) => call.startsWith('comment 5'))).toContain('Ann');
    await expect(applyControl(fakeCtx(), command({ action: 'remove', issue: 5, by: 'hermes' }))).resolves.toContain('#5');
  });

  it('refuses a removal with no open release', async () => {
    await expect(applyControl(fakeCtx(), command({ action: 'remove', issue: 5 }))).rejects.toThrow('No release is open');
  });
});

describe('drop', () => {
  const full = (): void => seed({
    pendingApprovals: { 4: 'Bob', 5: 'Bob' }, pendingRemovals: [{ issue: 7, by: 'b', text: 't' }, { issue: 8, by: 'b', text: 't' }],
    pendingShip: 'Bob', pendingChanges: [{ id: 100, text: 'x', by: 'b' }, { id: 101, text: 'y', by: 'b' }], pendingIncidents: [30, 31],
  });

  it('removes one entry of each queue', async () => {
    full();
    await applyControl(fakeCtx(), command({ action: 'drop', queue: 'approval', id: 4 }));
    await applyControl(fakeCtx(), command({ action: 'drop', queue: 'removal', id: 7 }));
    await applyControl(fakeCtx(), command({ action: 'drop', queue: 'ship', id: null }));
    await applyControl(fakeCtx(), command({ action: 'drop', queue: 'change', id: 100 }));
    await applyControl(fakeCtx(), command({ action: 'drop', queue: 'incident', id: 30 }));
    const state = readState(statePath);
    expect(state.pendingApprovals).toEqual({ 5: 'Bob' });
    expect(state.pendingRemovals.map((item) => item.issue)).toEqual([8]);
    expect(state.pendingShip).toBeNull();
    expect(state.pendingChanges.map((item) => item.id)).toEqual([101]);
    expect(state.pendingIncidents).toEqual([31]);
    expect(ctrlLines()).toHaveLength(5);
    expect(calls.find((call) => call.startsWith('comment 4'))).toContain('Ann');
  });

  it('throws on a miss and changes nothing (IV4)', async () => {
    full();
    const before = readState(statePath);
    for (const [queue, id] of [['approval', 99], ['removal', 99], ['change', 99], ['incident', 99]] as const) {
      await expect(applyControl(fakeCtx(), command({ action: 'drop', queue, id }))).rejects.toThrow(String(id));
    }
    seed({ ...before, pendingShip: null });
    await expect(applyControl(fakeCtx(), command({ action: 'drop', queue: 'ship', id: null }))).rejects.toThrow('ship');
    await expect(applyControl(fakeCtx(), command({ action: 'drop', queue: 'approval', id: null }))).rejects.toThrow('id');
    expect(readState(statePath)).toEqual({ ...before, pendingShip: null });
    expect(ctrlLines()).toEqual([]);
  });
});

describe('merge-change', () => {
  it('merges the factory change pull request for a member only (IV5)', async () => {
    await expect(applyControl(fakeCtx(), command({ action: 'merge-change', id: 12, by: 'hermes' }))).rejects.toThrow('--by <member>');
    expect(calls).toEqual([]);
    await applyControl(fakeCtx(), command({ action: 'merge-change', id: 12, by: '11' }));
    expect(calls).toContain('mergePullRequest factory-change/12');
    expect(ctrlLines()[0]).toMatchObject({ action: 'merge-change', issue: null, by: 'Ann' });
  });
});
