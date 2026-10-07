import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { drainInbox, parseCommand } from './inbox';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Card, Ctx, FactoryConfig, FactoryState, ReleaseState } from './types';

const ROOT = resolve('tmp/factory-inbox-test');
const statePath = join(ROOT, 'state.json');
// The post every test command acts on. Its caption is in the state, so the status edit works.
const POST = 42;
const withPost = (state: FactoryState): FactoryState => ({ ...state, postCaptions: { [POST]: 'Post' } });

function fakeCtx(cards: Card[], sent: string[], calls: string[]): Ctx {
  const cfg = { home: ROOT, committeeBootstrapTelegram: '11', committeeBootstrapGithub: 'boss', committeeChat: '-5' } as FactoryConfig;
  return {
    cfg, statePath, now: () => new Date(5000), log: () => undefined,
    github: {
      cards: async () => cards,
      createIssue: async (title: string, body: string, labels: string[]) => { calls.push(`create ${title}|${body}|${labels}`); return 9; },
      addCard: async (n: number, column: string) => { calls.push(`addCard ${n} ${column}`); },
      comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      move: async (n: number, column: string) => { calls.push(`move ${n} ${column}`); },
      pullRequestFor: async () => null,
      addLabel: async (n: number, label: string) => { calls.push(`addLabel ${n} ${label}`); },
      close: async (n: number, reason: string) => { calls.push(`close ${n} ${reason}`); },
    },
    telegram: {
      sendMessage: async (_chat: string, text: string) => { sent.push(text); return 1; },
      editCaption: async (chat: string, id: number, caption: string) => { calls.push(`edit ${chat} ${id} ${caption}`); },
      editText: async (chat: string, id: number, text: string) => { calls.push(`editText ${chat} ${id} ${text}`); },
    },
  } as unknown as Ctx;
}

function put(name: string, command: object): void {
  writeFileSync(join(ROOT, 'inbox', name), JSON.stringify({ issue: null, text: null, byName: 'Ann', chat: '-5', messageId: 3, postId: POST, by: '11', ...command }));
}

describe('drainInbox', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'inbox'), { recursive: true });
    writeState(statePath, withPost(structuredClone(EMPTY_STATE)));
  });

  it('queues an approval for a card in Approval and empties the inbox', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'approve', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, []));
    expect(readState(statePath).pendingApprovals).toEqual({ '4': 'Ann' });
    expect(readdirSync(join(ROOT, 'inbox'))).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('queues an ad hoc task as an issue, a card and a reply entry', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'adhoc', text: `${'x'.repeat(100)}\nmore` });
    await drainInbox(fakeCtx([], sent, calls));
    expect(calls[0]).toBe(`create ${'x'.repeat(80)}|${'x'.repeat(100)}\nmore\n\nRequested by Ann in the committee chat.|adhoc`);
    expect(calls[1]).toBe('addCard 9 Implementation');
    expect(readState(statePath).adhocReplies).toEqual({ '9': { chat: '-5', messageId: 3 } });
    // Hermes answers the member itself.
    expect(sent).toEqual([]);
  });

  it('queues an ad hoc task of Hermes with no message to answer', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'adhoc', text: 'check the disk', by: 'hermes', byName: null, messageId: null });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).adhocReplies).toEqual({ '9': { chat: '-5', messageId: null } });
    expect(sent).toEqual([]);
  });

  it('accepts a route of Hermes, as Hermes', async () => {
    const calls: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), builds: { 4: 'abc1234' } }));
    put('1.json', { kind: 'route', route: 'patch', issue: 4, text: 'make the horn louder', by: 'hermes', byName: null, messageId: null });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    expect(readState(statePath).patching).toEqual({ 4: 'abc1234' });
    expect(calls).toContain('edit -5 42 Post\n\n🔧 Patch from Hermes. Sonnet fixes the build, then the checks run again.');
  });

  it('refuses an approve, a deny, a ship and a remove from Hermes', async () => {
    const sent: string[] = [];
    for (const kind of ['approve', 'deny', 'ship', 'remove']) put(`${kind}.json`, { kind, issue: 4, text: 'x', by: 'hermes', byName: null, messageId: null });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, []));
    expect(sent).toHaveLength(4);
    for (const text of sent) expect(text).toContain('Only committee members can do that');
    expect(readState(statePath).pendingApprovals).toEqual({});
  });

  it('refuses an ad hoc task without text', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'adhoc' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).adhocReplies).toEqual({});
    expect(sent[0]).toContain('needs text');
  });

  it('refuses a user outside the committee and queues nothing', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'change', text: 'faster ticks', by: '99' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).pendingChanges).toEqual([]);
    expect(sent[0]).toContain('Only committee members');
  });

  it('reads the committee file, so a member added later is accepted', async () => {
    mkdirSync(join(ROOT, 'committee'), { recursive: true });
    writeFileSync(join(ROOT, 'committee', 'committee.json'), '{"members":[{"telegram":"99","github":null,"name":null}]}');
    put('1.json', { kind: 'change', text: 'x', by: '99' });
    put('2.json', { kind: 'change', text: 'y', by: '11' });
    await drainInbox(fakeCtx([], [], []));
    expect(readState(statePath).pendingChanges.map((item) => item.text)).toEqual(['x']);
  });

  it('shows the status of a button press on a text post by editing its text', async () => {
    const calls: string[] = [];
    writeState(statePath, { ...structuredClone(EMPTY_STATE), postCaptions: { [POST]: 'Post' }, textPosts: [String(POST)] });
    put('1.json', { kind: 'redesign', issue: 4, text: 'too loud' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    expect(calls.at(-1)).toBe('editText -5 42 Post\n\n💬 Feedback from Ann. Back to design.');
    expect(calls.some((call) => call.startsWith('edit -5'))).toBe(false);
  });

  it('sends a redesign back to design at once', async () => {
    const calls: string[] = [];
    put('1.json', { kind: 'redesign', issue: 4, text: 'too loud' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    expect(calls).toEqual([expect.stringContaining('routed as redesign:\n\ntoo loud'), 'move 4 Design', 'edit -5 42 Post\n\n💬 Feedback from Ann. Back to design.']);
  });

  it('drops an approval queued before a redesign, with the status line as the only answer', async () => {
    const sent: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), pendingApprovals: { 4: 'Ann' } }));
    put('1.json', { kind: 'redesign', issue: 4, text: 'too loud' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, []));
    expect(readState(statePath).pendingApprovals).toEqual({});
    expect(sent).toEqual([]);
  });

  it('holds a plain reply for Hermes to route, with no answer and no status line', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'reply', issue: 4, text: 'show the atlas', messageId: 3 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, calls));
    expect(readState(statePath).unroutedReplies).toEqual({ 3: { issue: 4, postId: POST, text: 'show the atlas', at: new Date(5000).toISOString() } });
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('turns a Hermes route into a patch, settles the waiting replies of that post and marks the post', async () => {
    const calls: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), builds: { 4: 'abc1234' }, unroutedReplies: { 3: { issue: 4, postId: POST, text: 'x', at: 'a' }, 8: { issue: 5, postId: 77, text: 'y', at: 'a' } } }));
    put('1.json', { kind: 'route', route: 'patch', issue: 4, text: 'Use top-down icons in the grid.', messageId: 6 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    const state = readState(statePath);
    expect(state.unroutedReplies).toEqual({ 8: { issue: 5, postId: 77, text: 'y', at: 'a' } });
    expect(state.patching).toEqual({ 4: 'abc1234' });
    expect(calls).toEqual([expect.stringContaining('routed as patch:\n\nUse top-down icons in the grid.'), 'move 4 Implementation', 'edit -5 42 Post\n\n🔧 Patch from Ann. Sonnet fixes the build, then the checks run again.']);
  });

  it('records an answer on the issue and leaves the post open and silent', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), unroutedReplies: { 3: { issue: 4, postId: POST, text: 'x', at: 'a' } } }));
    put('1.json', { kind: 'route', route: 'answer', issue: 4, text: 'Is there a top-down atlas?' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, calls));
    expect(calls).toEqual([expect.stringContaining('routed as answer')]);
    expect(sent).toEqual([]);
    expect(readState(statePath).unroutedReplies).toEqual({});
  });

  it('refuses a route it does not know', () => {
    expect(() => parseCommand(JSON.stringify({ kind: 'route', route: 'ship', by: '1', chat: 'c', messageId: 1, postId: 2 }))).toThrow('Unknown route ship');
  });

  it('answers a /change with one reply, since it acts on no post', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'change', text: 'faster ticks', postId: null });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent).toEqual([expect.stringContaining('is queued. The factory answers with a pull request.')]);
  });

  it('denies a card in Approval: closes, labels, moves to Done and clears state', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), approvalPosts: { 100: 4, 200: 5 }, pendingApprovals: { 4: 'Ann' } }));
    put('1.json', { kind: 'deny', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, calls));
    expect(calls).toEqual(['comment 4 Denied by Ann in the committee chat.', 'addLabel 4 wont-do', 'close 4 not planned', 'move 4 Done', 'edit -5 42 Post\n\n❌ Denied by Ann']);
    expect(readState(statePath).approvalPosts).toEqual({ 200: 5 });
    expect(readState(statePath).pendingApprovals).toEqual({});
    expect(sent).toEqual([]);
  });

  it('adds the approver under the post caption and remembers the new caption', async () => {
    const calls: string[] = [];
    put('1.json', { kind: 'approve', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], [], calls));
    expect(calls).toEqual(['edit -5 42 Post\n\n✅ Approved by Ann']);
    expect(readState(statePath).postCaptions).toEqual({ [POST]: 'Post\n\n✅ Approved by Ann' });
  });

  it('replies with the answer only when the post cannot show its status', async () => {
    const sent: string[] = [];
    writeState(statePath, structuredClone(EMPTY_STATE));
    put('1.json', { kind: 'approve', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Approval', labels: [] }], sent, []));
    expect(readState(statePath).pendingApprovals).toEqual({ '4': 'Ann' });
    expect(sent).toEqual([expect.stringMatching(/^Approval of #4 is queued.*\nThe post could not show its status: No caption is recorded for post 42$/)]);
  });

  it('answers with an error when a denied card is not in Approval', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'deny', issue: 4 });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Testing', labels: [] }], sent, calls));
    expect(calls).toEqual([]);
    expect(sent[0]).toContain('not in Approval');
  });

  it('queues change requests in order', async () => {
    put('1.json', { kind: 'change', text: 'a' });
    put('2.json', { kind: 'change', text: 'b' });
    await drainInbox(fakeCtx([], [], []));
    expect(readState(statePath).pendingChanges.map((item) => item.text)).toEqual(['a', 'b']);
  });
});

const RELEASE: ReleaseState = { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };
const openRelease = (over: Partial<ReleaseState> = {}) => writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), release: { ...RELEASE, ...over } }));

describe('release commands', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'inbox'), { recursive: true });
    writeState(statePath, withPost(structuredClone(EMPTY_STATE)));
  });

  it('queues a ship for the current candidate post', async () => {
    const sent: string[] = [];
    openRelease();
    put('1.json', { kind: 'ship', issue: 20 });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).pendingShip).toBe('Ann');
    expect(sent).toEqual([]);
  });

  it('refuses a ship without an open release, without a post, or for another issue', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'ship', issue: 20 });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent[0]).toContain('No release is open');
    openRelease({ postId: null });
    put('2.json', { kind: 'ship', issue: 20 });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent[1]).toContain('no current candidate post');
    openRelease();
    put('3.json', { kind: 'ship', issue: 21 });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent[2]).toContain('not the open release');
    expect(readState(statePath).pendingShip).toBeNull();
  });

  it('refuses a ship from outside the committee', async () => {
    const sent: string[] = [];
    openRelease();
    put('1.json', { kind: 'ship', issue: 20, by: '99' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).pendingShip).toBeNull();
    expect(sent[0]).toContain('Only committee members');
  });

  it('queues a removal with the whole reply', async () => {
    const sent: string[] = [];
    openRelease();
    put('1.json', { kind: 'remove', issue: 5, text: 'remove #5 too loud' });
    await drainInbox(fakeCtx([], sent, []));
    expect(readState(statePath).pendingRemovals).toEqual([{ issue: 5, by: 'Ann', text: 'remove #5 too loud' }]);
    expect(sent).toEqual([]);
  });

  it('refuses a removal without an open release or of a feature already removed', async () => {
    const sent: string[] = [];
    put('1.json', { kind: 'remove', issue: 5, text: 'remove 5' });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent[0]).toContain('No release is open');
    openRelease({ removed: [5] });
    put('2.json', { kind: 'remove', issue: 5, text: 'remove 5' });
    await drainInbox(fakeCtx([], sent, []));
    expect(sent[1]).toContain('already removed');
    expect(readState(statePath).pendingRemovals).toEqual([]);
  });

  it('opens a release task as an issue and a Design card, and drops the current post', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    writeState(statePath, withPost({ ...structuredClone(EMPTY_STATE), release: RELEASE, pendingShip: 'Bob' }));
    put('1.json', { kind: 'release-task', text: 'The horn is too quiet\nMake it louder' });
    await drainInbox(fakeCtx([], sent, calls));
    expect(calls[0]).toBe('create The horn is too quiet|The horn is too quiet\nMake it louder\n\nRequested by Ann in the committee chat as a task of release 2026-09-29.|release-task');
    expect(calls[1]).toBe('addCard 9 Design');
    expect(readState(statePath).release?.postId).toBeNull();
    expect(readState(statePath).pendingShip).toBeNull();
    expect(sent).toEqual([]);
  });

  it('refuses a release task without an open release or without text', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    put('1.json', { kind: 'release-task', text: 'x' });
    await drainInbox(fakeCtx([], sent, calls));
    expect(sent[0]).toContain('No release is open');
    openRelease();
    put('2.json', { kind: 'release-task' });
    await drainInbox(fakeCtx([], sent, calls));
    expect(sent[1]).toContain('needs text');
    expect(calls).toEqual([]);
    expect(readState(statePath).release?.postId).toBe(42);
  });
});

describe('parseCommand', () => {
  it('accepts the release kinds', () => {
    for (const kind of ['ship', 'remove', 'release-task']) expect(parseCommand(`{"kind":"${kind}","by":"1","chat":"c","messageId":1,"postId":2}`).kind).toBe(kind);
  });
  it('rejects a command without postId', () => {
    expect(() => parseCommand('{"kind":"approve","by":"1","chat":"c","messageId":1}')).toThrow('lacks postId');
  });
  it('rejects an unknown kind', () => {
    expect(() => parseCommand('{"kind":"merge","by":"1","chat":"c","messageId":1}')).toThrow('Unknown inbox command kind');
  });
});

describe('control files', () => {
  const putControl = (name: string, body: object): void => writeFileSync(join(ROOT, 'inbox', name), JSON.stringify({ kind: 'control', by: 'boss', reason: 'the gate failed on load', ...body }));

  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(join(ROOT, 'inbox'), { recursive: true });
    writeState(statePath, withPost(structuredClone(EMPTY_STATE)));
  });

  it('applies a control order, empties the inbox and sends no chat message', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    putControl('1-control.json', { action: 'move', issue: 4, to: 'design' });
    await drainInbox(fakeCtx([{ itemId: 'i', issue: 4, column: 'Testing', labels: [] }], sent, calls));
    expect(calls).toContain('move 4 Design');
    expect(calls.find((call) => call.startsWith('comment 4'))).toContain('Reason: the gate failed on load');
    expect(readdirSync(join(ROOT, 'inbox'))).toEqual([]);
    expect(sent).toEqual([]);
    expect(readState(statePath).failures).toEqual([]);
  });

  it('turns an order that cannot apply into a failure that names the reason, with no chat message and no change (IV4)', async () => {
    const sent: string[] = [];
    const calls: string[] = [];
    putControl('1-control.json', { action: 'move', issue: 4, to: 'design' });
    await drainInbox(fakeCtx([], sent, calls));
    const failure = readState(statePath).failures[0];
    expect(failure).toMatchObject({ stage: 'control', issue: null, log: null });
    expect(failure.error).toContain('#4: Issue #4 is not on the board');
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('fails a bad shape and an unknown actor as control failures', async () => {
    const sent: string[] = [];
    putControl('1-control.json', { action: 'explode' });
    putControl('2-control.json', { action: 'cut', by: 'mallory' });
    await drainInbox(fakeCtx([], sent, []));
    const errors = readState(statePath).failures.map((failure) => failure.error);
    expect(errors[0]).toContain('Unknown control action explode');
    expect(errors[1]).toContain('mallory');
    expect(sent).toEqual([]);
  });

  it('refuses Hermes on a gated order', async () => {
    openRelease();
    putControl('1-control.json', { action: 'ship', by: 'hermes' });
    await drainInbox(fakeCtx([], [], []));
    expect(readState(statePath).pendingShip).toBeNull();
    expect(readState(statePath).failures[0].error).toContain('--by <member>');
  });
});
