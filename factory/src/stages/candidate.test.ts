import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pngBytes } from '../photo-fixtures';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { ReleaseState } from '../types';
import { changeLines } from './release-common';
import { ROOT, fake, reset } from './test-fakes';

const deployed: string[] = [];
vi.mock('../deploy', () => ({
  buildAndDeploy: async (_ctx: unknown, _clone: string, scope: string) => { deployed.push(scope); return `https://play.test/${scope}/`; },
  recordBuild: (_statePath: string, issue: number, name: string) => { deployed.push(`record ${issue} ${name}`); },
}));
const { candidate, candidateCaption } = await import('./candidate');

const RELEASE: ReleaseState = { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [] };
const CHANGES = '- [#3] Trucks are faster.\n- [#5] The horn is louder.\n';

beforeEach(() => {
  reset();
  deployed.length = 0;
  writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE });
});

describe('candidate', () => {
  it('runs the release candidate agent on Opus', async () => {
    const f = fake();
    f.ctx.cfg = { ...f.ctx.cfg, designModel: 'opus', buildModel: 'sonnet' };
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn'];
    f.agentWrites = { 'release.md': CHANGES, 'screenshot.png': 'png' };
    const original = f.ctx.container.agent;
    const models: string[] = [];
    f.ctx.container.agent = async (run) => { models.push(run.model); await original(run); };
    await candidate(f.ctx, 11);
    expect(models).toEqual(['opus']);
  });

  it('posts one photo with a Ship button, stores the post id and puts the whole changelog in a reply to it', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn', 'Merge issue #6: gone'];
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, removed: [6] } });
    f.agentWrites = { 'release.md': CHANGES, 'screenshot.png': 'png' };
    await candidate(f.ctx, 11);
    expect(f.calls.filter((call) => !call.startsWith('comment'))).toEqual(['fetch', 'prepare release/2026-09-29', 'shell', 'agent', 'pr release/2026-09-29 main Release 2026-09-29', 'photo committee', 'message committee 42 - [#3] Trucks are faster.\n- [#5] The horn is louder.']);
    expect(deployed).toEqual(['rc', 'record 11 rc']);
    expect(f.calls.find((call) => call.startsWith('comment'))).toContain('- [#5] The horn is louder.');
    const photo = f.photos[0];
    expect(photo.buttons).toEqual([[{ text: 'Ship', data: 'factory:ship:11' }]]);
    expect(photo.caption).toContain('Play: https://play.test/rc/');
    expect(photo.caption).toContain('2 changes, listed in the message under this post.');
    expect(readState(f.ctx.statePath).release?.postId).toBe(42);
  });

  it('lists the issues bundled into a change under it, so the changelog sums up the bundle in one line', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn'];
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE, bundles: { '3': [8, 9] } });
    f.agentWrites = { 'release.md': CHANGES, 'screenshot.png': 'png' };
    await candidate(f.ctx, 11);
    const input = readFileSync(join(ROOT, 'work', 'release-candidate', 'game', '.factory', 'changelog.md'), 'utf8');
    expect(input).toBe('#3 faster trucks\n  bundled: #8 T\n  bundled: #9 T\n#5 louder horn\n');
  });

  it('opens the pull request to main when none is open', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.agentWrites = { 'release.md': '- [#3] Trucks are faster.', 'screenshot.png': 'png' };
    await candidate(f.ctx, 11);
    expect(f.calls).toContain('pr release/2026-09-29 main Release 2026-09-29');
    expect(f.photos[0].caption).toContain('PR: http://pr');
  });

  it('refuses an issue that is not the tracking issue and posts nothing', async () => {
    const f = fake();
    await expect(candidate(f.ctx, 12)).rejects.toThrow('not the tracking issue');
    expect(f.photos).toEqual([]);
  });

  it('throws when no release is open', async () => {
    const f = fake();
    writeState(f.ctx.statePath, structuredClone(EMPTY_STATE));
    await expect(candidate(f.ctx, 11)).rejects.toThrow('No release is open');
  });

  it('throws when the agent wrote no notes, before it builds anything', async () => {
    const f = fake();
    f.agentWrites = { 'screenshot.png': 'png' };
    await expect(candidate(f.ctx, 11)).rejects.toThrow('no .factory/release.md');
    expect(deployed).toEqual([]);
  });

  it('does not post a build when a release task opened during it, so the old post stays dead', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks'];
    f.agentWrites = { 'release.md': '- [#3] Trucks are faster.', 'screenshot.png': 'png' };
    f.cards = [{ itemId: 'i74', issue: 74, column: 'Design', labels: ['release-task'] }];
    await candidate(f.ctx, 11);
    expect(f.photos).toEqual([]);
    expect(f.calls.some((call) => call.startsWith('comment') || call.startsWith('message'))).toBe(false);
    expect(readState(f.ctx.statePath).release?.postId).toBeNull();
  });

  it('throws when the changelog misses a change, before it builds or posts anything', async () => {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn'];
    f.agentWrites = { 'release.md': '- [#3] Trucks are faster.', 'screenshot.png': 'png' };
    await expect(candidate(f.ctx, 11)).rejects.toThrow('release.md names #3, but the release holds #3, #5');
    expect(deployed).toEqual([]);
    expect(f.photos).toEqual([]);
  });
});

describe('candidate evidence', () => {
  // The fake agent writes into the clone's .factory, and the fake shell leaves the screenshot there.
  function setup(commit = 'abc1234'): ReturnType<typeof fake> {
    const f = fake();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #5: louder horn'];
    f.agentWrites = { 'release.md': CHANGES, 'screenshot.png': pngBytes(0).toString('latin1'), 'view1.png': pngBytes(1).toString('latin1'), 'evidence.json': JSON.stringify({ commit, features: [{ name: '#3', kind: 'other' }, { name: '#5', kind: 'other' }], images: [{ file: 'screenshot.png', description: 'Faster trucks', covers: ['#3'] }, { file: 'view1.png', description: 'Louder horn', covers: ['#5'] }] }) };
    return f;
  }

  it('posts the Ship post alone, then the extra view as a reply to it, then the changelog', async () => {
    const f = setup();
    await candidate(f.ctx, 11);
    expect(f.photos).toHaveLength(1);
    expect(f.photos[0].buttons).toEqual([[{ text: 'Ship', data: 'factory:ship:11' }]]);
    expect(f.albums).toEqual([{ chat: 'committee', paths: [expect.stringContaining('view1.png')], captions: ['2/2 Louder horn'], replyTo: 42 }]);
    const posts = f.calls.filter((call) => /^(photo|album|message)/.test(call));
    expect(posts).toEqual(['photo committee', 'album committee 1 42', expect.stringContaining('message committee 42')]);
    expect(readState(f.ctx.statePath).release?.postId).toBe(42);
  });

  it('falls back to the one screenshot when the manifest is for another commit', async () => {
    const f = setup('ffffff0');
    await candidate(f.ctx, 11);
    expect(f.albums).toEqual([]);
    expect(f.photos).toHaveLength(1);
  });

  it('clears the post id and fails when the album fails, so no dead Ship post stays current', async () => {
    const f = setup();
    f.albumFails = true;
    await expect(candidate(f.ctx, 11)).rejects.toThrow('boom');
    expect(readState(f.ctx.statePath).release?.postId).toBeNull();
    expect(readState(f.ctx.statePath).postCaptions).toEqual({});
    expect(f.calls.some((call) => call.startsWith('editCaption 42 Superseded'))).toBe(true);
    expect(f.calls.some((call) => call.startsWith('message committee 42'))).toBe(false);
  });
});

describe('candidateCaption', () => {
  it('fits the Telegram caption limit and points to the changelog under the post', () => {
    const caption = candidateCaption('2026-09-29', 'https://p/rc/', 'https://i', 'https://pr', 33);
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('33 changes, listed in the message under this post.');
    expect(caption).toContain('Play: https://p/rc/\nPR: https://pr\nIssue: https://i');
    expect(caption.endsWith('33 changes, listed in the message under this post.')).toBe(true);
    for (const tail of ['Ship publishes it', 'remove #N', 'Reply to this post', 'holds the release']) expect(caption).not.toContain(tail);
  });

  it('says so when no change is left', () => {
    expect(candidateCaption('2026-09-29', 'u', 'i', 'p', 0)).toContain('No changes in this candidate.');
  });
});

describe('changeLines', () => {
  const features = [{ issue: 3, title: 'faster trucks' }, { issue: 5, title: 'louder horn' }];

  it('keeps one line per change in the order written, without blank lines', () => {
    expect(changeLines('\n- [#5] The horn is louder.\n\n- [#3] Trucks are faster.\n', features)).toEqual(['- [#5] The horn is louder.', '- [#3] Trucks are faster.']);
  });

  it('refuses prose, a missing change and an extra one', () => {
    expect(() => changeLines('Trucks are faster.', features)).toThrow('not "- [#N] what changed"');
    expect(() => changeLines('- [#3] Trucks are faster.\n- [#5] Louder.\n- [#9] Extra.', features)).toThrow('names #3, #5, #9');
  });
});
