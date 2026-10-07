import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { drainInbox } from './inbox';
import { readLedger } from './ledger';
import { releasePostDir } from './release-post';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryConfig, InlineButton } from './types';

const ROOT = resolve('tmp/factory-release-post-test');
const statePath = join(ROOT, 'state.json');
const DAY = '2026-09-29';
const SCREENSHOT = join(releasePostDir(ROOT, DAY), 'screenshot.png');

type Sent = { calls: string[]; buttons: InlineButton[][][] };

function fakeCtx(sent: Sent): Ctx {
  const cfg = { home: ROOT, committeeBootstrapTelegram: '11', committeeBootstrapGithub: 'boss', committeeChat: 'committee', publicChannel: 'public' } as FactoryConfig;
  let next = 100;
  return {
    cfg, statePath, now: () => new Date(5000), log: () => undefined,
    telegram: {
      sendMessage: async (chat: string, text: string) => { sent.calls.push(`message ${chat} ${text}`); return next++; },
      sendPhoto: async (chat: string, path: string, caption: string) => { sent.calls.push(`photo ${chat} ${path} ${caption}`); return next++; },
      sendButtons: async (chat: string, text: string, buttons: InlineButton[][]) => { sent.calls.push(`buttons ${chat} ${text}`); sent.buttons.push(buttons); return next++; },
      editText: async (chat: string, id: number, text: string) => { sent.calls.push(`editText ${chat} ${id} ${text}`); },
    },
  } as unknown as Ctx;
}

function put(name: string, command: object): void {
  writeFileSync(join(ROOT, 'inbox', name), JSON.stringify({ issue: null, text: null, byName: 'Ann', chat: 'committee', messageId: 3, postId: null, by: '11', ...command }));
}

const draft = (text: string) => ({ kind: 'release-draft', text, by: 'hermes', byName: null, messageId: null });

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'inbox'), { recursive: true });
  mkdirSync(releasePostDir(ROOT, DAY), { recursive: true });
  writeFileSync(SCREENSHOT, 'png');
  writeState(statePath, { ...structuredClone(EMPTY_STATE), releasePost: { issue: 11, day: DAY, changelog: '- [#3] Trucks are faster.', screenshot: SCREENSHOT, postId: null, draft: null } });
});

describe('release post', () => {
  it('posts Hermes\'s first draft with the screenshot and a Publish button, and a second draft replaces it', async () => {
    const sent: Sent = { calls: [], buttons: [] };
    const ctx = fakeCtx(sent);
    put('1.json', draft('First draft'));
    await drainInbox(ctx);
    expect(sent.calls).toEqual([expect.stringMatching(/^photo committee .*screenshot\.png Draft of the public post of release 2026-09-29/), 'buttons committee First draft']);
    expect(sent.buttons).toEqual([[[{ text: 'Publish', data: 'factory:publish:11' }]]]);
    expect(readState(statePath).releasePost).toMatchObject({ postId: 101, draft: 'First draft' });

    sent.calls.length = 0;
    put('2.json', draft('Second draft'));
    await drainInbox(ctx);
    expect(sent.calls).toEqual(['buttons committee Second draft', 'editText committee 101 First draft\n\nReplaced by a newer draft.']);
    const state = readState(statePath);
    expect(state.releasePost).toMatchObject({ postId: 102, draft: 'Second draft' });
    expect(state.postCaptions).toEqual({ '102': 'Second draft' });
    expect(state.textPosts).toEqual(['102']);
  });

  it('publishes the current draft under the screenshot, records the post and marks the draft', async () => {
    const sent: Sent = { calls: [], buttons: [] };
    const ctx = fakeCtx(sent);
    put('1.json', draft('The road is longer now.'));
    await drainInbox(ctx);
    sent.calls.length = 0;
    put('2.json', { kind: 'publish', issue: 11, postId: 101 });
    await drainInbox(ctx);
    expect(sent.calls).toEqual([`photo public ${SCREENSHOT} The road is longer now.`, 'editText committee 101 The road is longer now.\n\n📣 Published to the channel by Ann']);
    expect(readState(statePath).releasePost).toBeNull();
    expect(readLedger(ROOT, new Date(0))).toContainEqual({ kind: 'post', id: 102, channel: 'public', text: 'The road is longer now.', at: new Date(5000).toISOString() });
    expect(existsSync(releasePostDir(ROOT, DAY))).toBe(false);
  });

  it('sends a draft longer than a caption as the screenshot and a text under it', async () => {
    const sent: Sent = { calls: [], buttons: [] };
    const ctx = fakeCtx(sent);
    const long = 'x'.repeat(1500);
    put('1.json', draft(long));
    await drainInbox(ctx);
    sent.calls.length = 0;
    put('2.json', { kind: 'publish', issue: 11, postId: 101 });
    await drainInbox(ctx);
    expect(sent.calls.slice(0, 2)).toEqual([`photo public ${SCREENSHOT} `, `message public ${long}`]);
  });

  it('publishes nothing from an old draft, and Hermes cannot publish', async () => {
    const sent: Sent = { calls: [], buttons: [] };
    const ctx = fakeCtx(sent);
    put('1.json', draft('First'));
    put('2.json', draft('Second'));
    await drainInbox(ctx);
    sent.calls.length = 0;
    put('3.json', { kind: 'publish', issue: 11, postId: 101 });
    put('4.json', { kind: 'publish', issue: 11, postId: 102, by: 'hermes', messageId: null });
    await drainInbox(ctx);
    expect(sent.calls.some((call) => call.includes('public'))).toBe(false);
    expect(sent.calls).toEqual(['message committee That did not work: This release post draft is out of date.', expect.stringMatching(/^message committee That did not work: Only committee members can do that/)]);
    expect(readState(statePath).releasePost).toMatchObject({ postId: 102 });
  });

  it('refuses a draft when no shipped release waits for its post', async () => {
    const sent: Sent = { calls: [], buttons: [] };
    writeState(statePath, structuredClone(EMPTY_STATE));
    put('1.json', draft('Draft'));
    await drainInbox(fakeCtx(sent));
    expect(sent.calls).toEqual(['message committee That did not work: No shipped release waits for its public post.']);
  });
});
