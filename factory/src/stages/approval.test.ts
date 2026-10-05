import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState, readState, EMPTY_STATE } from '../state';
import { MergeConflictError, type Column, type Ctx, type MergeStep } from '../types';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { approve, deny, routeFeedback } = await import('./approval');
const { readLedger } = await import('../ledger');

let home = '';
let calls: string[] = [];
let column: Column = 'Approval';
let openPr: string | null = null;
let labels: string[] = [];

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-approval-');
  calls = [];
  column = 'Approval';
  openPr = null;
  labels = [];
  writeState(`${home}/state.json`, { ...EMPTY_STATE, approvalPosts: { 100: 7, 101: 7, 200: 8 }, pendingApprovals: { 7: 'bob' }, builds: { 7: 'aaa1111', 8: 'bbb2222' } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(): Ctx {
  const record = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.join(' ')}`); };
  const fake = {
    cfg: { home, committeeChat: 'chat', publicChannel: 'public', publicUrl: 'https://play.test', itchTarget: 'u/g', butlerKey: 'key' },
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    log: () => undefined,
    run: async (cmd: string, args: string[]) => { calls.push(`run ${cmd} ${args[0]}`); return { code: 0, stdout: '', stderr: '' }; },
    github: {
      cards: async () => [{ itemId: 'x', issue: 7, column, labels: [] }],
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels, createdAt: '', state: 'OPEN', thumbsUp: [] }),
      comment: record('comment'), addLabel: record('addLabel'), removeLabel: record('removeLabel'), pullRequestFor: async () => openPr, closePullRequest: record('closePullRequest'), close: record('close'), move: record('move'),
      createRelease: record('release'),
    },
    telegram: { sendMessage: record('message') },
    container: { shell: record('shell') },
    repo: {
      fetch: record('fetch'), prepareWorkClone: record('prepare'), headHash: async () => 'abc1234',
      merge: async (steps: MergeStep[]) => { for (const step of steps) calls.push(`merge ${step.branch} ${step.into} ${step.message}`); calls.push(`push ${steps.map((step) => step.into).join(' ')}`); },
    },
  };
  return fake as unknown as Ctx;
}

describe('approve', () => {
  // The queued merge of a hardened card. The committee approved its preview, and the hardening round and its checks passed.
  beforeEach(() => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'bob' } }));

  it('sends an approved preview back to Testing to harden, with no merge and no chat post', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: {} });
    await approve(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'comment 7 Approved by bob in the committee chat. The review, the fixes and the full testing run now. Then the factory merges it into dev by itself, with no new post.',
      'move 7 Testing',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvedResolving).toEqual({ 7: 'bob' });
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
  });

  it('merges, pushes, labels a release candidate without closing, moves to Done and clears state', async () => {
    await approve(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'fetch ',
      'merge factory/issue-7 dev Merge issue #7: Big horn',
      'push dev',
      'comment 7 Approved by bob in the committee chat and merged into dev. It closes when its release ships.',
      'addLabel 7 release-candidate',
      'move 7 Done',
      'message chat Issue #7 Big horn is merged into dev.\nPlay it: https://play.test/dev',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
    expect(state.builds).toEqual({ 8: 'bbb2222' });
  });

  it('merges a release task into the release branch, skips the dev deploy and keeps dev as it is', async () => {
    labels = ['release-task'];
    writeState(`${home}/state.json`, { ...EMPTY_STATE, release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 300, removed: [7, 9] }, pendingShip: 'ann', builds: { 7: 'aaa1111' }, approvedResolving: { 7: 'bob' } });
    await approve(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'fetch ',
      'merge factory/issue-7 release/2026-09-29 Merge issue #7: Big horn',
      'push release/2026-09-29',
      'comment 7 Approved by bob and merged into the release branch release/2026-09-29. It closes when the release ships.',
      'addLabel 7 release-candidate',
      'move 7 Done',
      'message chat Issue #7 Big horn is merged into the release release/2026-09-29.',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.release?.removed).toEqual([9]);
    // The played candidate lacks the task, so its post can no longer ship and a new candidate follows.
    expect(state.release?.postId).toBeNull();
    expect(state.pendingShip).toBeNull();
  });

  it('ships a hotfix from main to itch.io, brings main into dev and the open release, and closes the issue', async () => {
    labels = ['bug', 'hotfix'];
    writeState(`${home}/state.json`, { ...EMPTY_STATE, release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 300, removed: [] }, pendingShip: 'ann', pendingApprovals: { 7: 'bob' } });
    await approve(fakeCtx(), 7, 'bob');
    const changelog = 'ROAM hotfix 2026-09-30\n\nFixed: #7 Big horn';
    expect(calls.filter((call) => !call.startsWith('prepare') && !call.startsWith('shell'))).toEqual([
      'fetch ',
      'merge factory/issue-7 main Hotfix #7: Big horn',
      'merge main dev Merge main into dev after hotfix #7',
      'merge main release/2026-09-29 Merge main into release/2026-09-29 after hotfix #7',
      'push main dev release/2026-09-29',
      'run butler push',
      `message public ${changelog}`,
      `release hotfix-2026-09-30-issue-7 main ROAM hotfix 2026-09-30 ${changelog}`,
      'comment 7 Approved by bob in the committee chat and shipped as a hotfix. It is on main and itch.io.',
      'close 7 completed',
      'move 7 Done',
      'message chat Hotfix #7 Big horn is on main and itch.io.\nRelease 2026-09-29 took the fix, so its candidate is built again.',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.release?.postId).toBeNull();
    expect(state.pendingShip).toBeNull();
    expect(state.pendingApprovals).toEqual({});
    expect(state.pendingIncidents).toEqual([7]);
  });

  it('sends the card back to Testing on a conflict with dev, keeping the approver, with no chat post', async () => {
    const ctx = fakeCtx();
    ctx.repo.merge = async ([step]: MergeStep[]) => { throw new MergeConflictError(step.branch, step.into, ['game/src/a.ts'], 'boom'); };
    await approve(ctx, 7, 'bob');
    expect(calls).toEqual([
      'fetch ',
      'comment 7 dev moved on since testing, and the branch conflicts with it in game/src/a.ts. Testing merges dev again and resolves the conflict. Then the approval by bob merges it, with no new post.',
      'move 7 Testing',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvedResolving).toEqual({ 7: 'bob' });
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
  });

  it('fails loud on a conflict of main into dev after a hotfix, which the agent cannot resolve', async () => {
    labels = ['hotfix'];
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: {} });
    const ctx = fakeCtx();
    ctx.repo.merge = async (steps: MergeStep[]) => {
      const step = steps.find((item) => item.branch === 'main');
      if (step) throw new MergeConflictError(step.branch, step.into, ['x'], 'boom');
    };
    await expect(approve(ctx, 7, 'bob')).rejects.toThrow('merge of main into dev failed');
    expect(readState(`${home}/state.json`).approvedResolving).toEqual({});
  });

  it('clears a kept approver and a leftover test phase once the merge lands', async () => {
    writeState(`${home}/state.json`, { ...EMPTY_STATE, approvedResolving: { 7: 'bob', 8: 'ann' }, testPhase: { 7: 'checks', 8: 'fix' } });
    await approve(fakeCtx(), 7, 'bob');
    expect(readState(`${home}/state.json`).approvedResolving).toEqual({ 8: 'ann' });
    expect(readState(`${home}/state.json`).testPhase).toEqual({ 8: 'fix' });
  });

  it('refuses a hotfix without itch.io keys before any git call', async () => {
    labels = ['hotfix'];
    const ctx = fakeCtx();
    ctx.cfg.butlerKey = null;
    await expect(approve(ctx, 7, 'bob')).rejects.toThrow('BUTLER_API_KEY');
    expect(calls).toEqual([]);
  });

  it('throws for a release task when no release is open, before any git call', async () => {
    labels = ['release-task'];
    await expect(approve(fakeCtx(), 7, 'bob')).rejects.toThrow('needs an open release');
    expect(calls).toEqual([]);
  });

  it('throws when the card is not in Approval', async () => {
    column = 'Testing';
    await expect(approve(fakeCtx(), 7, 'bob')).rejects.toThrow('not in Approval');
    expect(calls).toEqual([]);
  });
});

describe('routeFeedback', () => {
  it('redesign comments with the route, moves to Design, drops the posts and the queued approval', async () => {
    expect(await routeFeedback(fakeCtx(), 7, 'bob', 'Make it louder', 'redesign')).toBe(true);
    expect(calls).toEqual(['comment 7 ## Committee feedback\n\nFrom bob, routed as redesign:\n\nMake it louder', 'move 7 Design']);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.builds).toEqual({ 8: 'bbb2222' });
    expect(state.pendingApprovals).toEqual({});
    expect(state.patching).toEqual({});
  });

  it('patch keeps the played build for the patch, moves to Implementation and drops the posts', async () => {
    await routeFeedback(fakeCtx(), 7, 'bob', 'Louder horn', 'patch');
    expect(calls).toEqual(['comment 7 ## Committee feedback\n\nFrom bob, routed as patch:\n\nLouder horn', 'move 7 Implementation']);
    const state = readState(`${home}/state.json`);
    expect(state.patching).toEqual({ 7: 'aaa1111' });
    expect(state.approvalPosts).toEqual({ 200: 8 });
  });

  it('answer only comments, and keeps the card, its posts and its queued approval', async () => {
    expect(await routeFeedback(fakeCtx(), 7, 'bob', 'Is there a top-down atlas?', 'answer')).toBe(false);
    expect(calls).toEqual(['comment 7 ## Committee question\n\nFrom bob, routed as answer:\n\nIs there a top-down atlas?']);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 100: 7, 101: 7, 200: 8 });
    expect(state.pendingApprovals).toEqual({ 7: 'bob' });
  });

  it('records every route in the ledger', async () => {
    await routeFeedback(fakeCtx(), 7, 'bob', 'q', 'answer');
    await routeFeedback(fakeCtx(), 7, 'bob', 'p', 'patch');
    expect(readLedger(home, new Date(0))).toEqual([
      { kind: 'route', issue: 7, route: 'answer', by: 'bob', at: '2026-09-30T10:00:00.000Z' },
      { kind: 'route', issue: 7, route: 'patch', by: 'bob', at: '2026-09-30T10:00:00.000Z' },
    ]);
  });

  it('refuses a patch for a card with no recorded build before it comments or records anything', async () => {
    writeState(`${home}/state.json`, { ...EMPTY_STATE, approvalPosts: { 100: 7 } });
    await expect(routeFeedback(fakeCtx(), 7, 'bob', 'p', 'patch')).rejects.toThrow('no recorded build');
    expect(calls).toEqual([]);
    expect(readLedger(home, new Date(0))).toEqual([]);
  });

  it('drops a reply still waiting for Hermes once the card leaves Approval', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), unroutedReplies: { 5: { issue: 7, postId: 100, text: 'x', at: 'a' }, 6: { issue: 8, postId: 200, text: 'y', at: 'a' } } });
    await approve(fakeCtx(), 7, 'bob');
    expect(readState(`${home}/state.json`).unroutedReplies).toEqual({ 6: { issue: 8, postId: 200, text: 'y', at: 'a' } });
  });

  it('throws when the card is not in Approval', async () => {
    column = 'Design';
    await expect(routeFeedback(fakeCtx(), 7, 'bob', 'p', 'patch')).rejects.toThrow('not in Approval');
    expect(calls).toEqual([]);
  });
});

describe('deny', () => {
  it('comments, labels wont-do, closes as not planned, moves to Done and clears state', async () => {
    await deny(fakeCtx(), 7, 'bob');
    expect(calls).toEqual([
      'comment 7 Denied by bob in the committee chat.',
      'addLabel 7 wont-do',
      'close 7 not planned',
      'move 7 Done',
    ]);
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 200: 8 });
    expect(state.pendingApprovals).toEqual({});
    expect(state.builds).toEqual({ 8: 'bbb2222' });
  });

  it('sends each bundled issue back to Triage on its own and forgets the bundle', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), bundles: { '7': [9], '8': [10] } });
    await deny(fakeCtx(), 7, 'bob');
    expect(calls.slice(-3)).toEqual(['comment 9 #7 was denied, so this issue goes back to triage on its own.', 'removeLabel 9 bundled', 'move 9 Triage']);
    expect(readState(`${home}/state.json`).bundles).toEqual({ '8': [10] });
  });

  it('closes the open pull request with the same comment', async () => {
    openPr = 'https://github.com/o/r/pull/3';
    await deny(fakeCtx(), 7, 'bob');
    expect(calls).toContain('closePullRequest factory/issue-7 Denied by bob in the committee chat.');
  });

  it('throws when the card is not in Approval', async () => {
    column = 'Testing';
    await expect(deny(fakeCtx(), 7, 'bob')).rejects.toThrow('not in Approval');
    expect(calls).toEqual([]);
  });
});
