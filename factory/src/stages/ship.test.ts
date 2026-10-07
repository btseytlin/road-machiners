import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { Card, ReleaseState } from '../types';
import { ROOT, fake, reset, type Fake } from './test-fakes';

vi.mock('../deploy', () => ({ deployDev: async () => 'https://play.test/dev/' }));
const { ship } = await import('./ship');

const RELEASE: ReleaseState = { issue: 11, branch: 'release/2026-09-29', day: '2026-09-29', postId: 42, removed: [6], candidateSha: 'abc1234', playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } };
const done = (issue: number, labels: string[] = []): Card => ({ itemId: `i${issue}`, issue, column: 'Done', labels });

beforeEach(() => {
  reset();
  writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), release: RELEASE, pendingShip: 'Ann', builds: { '11': 'rc', '3': 'aaa1111' } });
  const out = join(ROOT, 'work', 'release-candidate', 'game', '.factory');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'screenshot.png'), 'png');
  writeFileSync(join(out, 'release.md'), '- [#3] Trucks are faster.\n');
});

function shippable(): Fake {
  const f = fake();
  Object.assign(f.ctx.cfg, { itchTarget: 'u/g', butlerKey: 'secret' });
  f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #6: gone'];
  f.cards = [{ itemId: 'i11', issue: 11, column: 'Approval', labels: ['release'] }, done(12, ['release-task', 'maintenance'])];
  return f;
}

describe('ship', () => {
  it('merges, builds main in a fresh clone, pushes with butler alone, and posts publicly only afterwards', async () => {
    const f = shippable();
    const runs: { cmd: string; args: string[]; env?: Record<string, string> }[] = [];
    f.ctx.run = async (cmd, args, opts) => { runs.push({ cmd, args, env: opts?.env }); f.calls.push(`run ${cmd}`); return { code: 0, stdout: '', stderr: '' }; };
    const shells: { script: string; env?: Record<string, string> }[] = [];
    f.ctx.container.shell = async (clone, script, _log, env) => { shells.push({ script, env }); f.calls.push(`shell ${clone}`); };
    await ship(f.ctx, 11, 'Ann');
    const at = (name: string) => f.calls.findIndex((call) => call.startsWith(name));
    expect(f.calls.slice(at('fetch'), at('fetch') + 4)).toEqual(['fetch', 'merge release/2026-09-29 main', 'merge main dev', 'push main dev']);
    expect(at('push main dev')).toBeLessThan(at('prepare main'));
    expect(at('prepare main')).toBeLessThan(at('run butler'));
    expect(at('run butler')).toBeLessThan(at('photo public'));
    expect(at('photo public')).toBeLessThan(at('message public'));
    expect(shells).toEqual([{ script: 'npm ci && npm run build', env: { SAVE_SCOPE: '' } }]);
    expect(runs).toEqual([{ cmd: 'butler', args: ['push', join(ROOT, 'work', 'release-main', 'game', 'dist'), 'u/g:html5', '--userversion', 'abc1234'], env: { BUTLER_API_KEY: 'secret' } }]);
    const publicNote = f.calls.find((call) => call.startsWith('message public')) ?? '';
    expect(publicNote).toContain('- [#3] Trucks are faster.');
    expect(publicNote).not.toContain('#6');
  });

  it('fails on a dev merge conflict before the build, the butler push and any public post', async () => {
    const f = shippable();
    const merge = f.ctx.repo.merge;
    f.ctx.repo.merge = async (steps) => { if (steps.some((step) => step.into === 'dev')) throw new Error('merge conflict in dev'); return merge(steps); };
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('merge conflict in dev');
    expect(f.calls.some((call) => call.startsWith('prepare') || call.startsWith('run butler') || call.includes('public'))).toBe(false);
    expect(readState(f.ctx.statePath).release).not.toBeNull();
  });

  it('closes the tracking issue, clears the release and the rc build, and tells the committee', async () => {
    const f = shippable();
    await ship(f.ctx, 11, 'Ann');
    expect(f.calls).toContain('close completed');
    expect(f.calls).toContain('move Done');
    expect(f.calls.at(-1)).toBe('message committee - Release 2026-09-29 shipped with 1 changes.');
    const state = readState(f.ctx.statePath);
    expect(state.release).toBeNull();
    expect(state.lastRelease).toBe('2026-09-29T10:00:00.000Z');
    expect(state.builds).toEqual({ '3': 'aaa1111' });
  });

  it('closes each shipped issue and drops its release-candidate label, after the itch push, but not a removed one', async () => {
    const f = shippable();
    await ship(f.ctx, 11, 'Ann');
    const at = (name: string) => f.calls.findIndex((call) => call.startsWith(name));
    expect(at('run butler')).toBeLessThan(at('comment Shipped in release 2026-09-29'));
    expect(f.calls).toContain('removeLabel 3 release-candidate');
    expect(f.calls.some((call) => call.startsWith('removeLabel 6'))).toBe(false);
    expect(f.calls.filter((call) => call === 'close completed')).toHaveLength(2);
  });

  it('queues an incident job for each shipped issue labeled bug, and for no other', async () => {
    const f = shippable();
    f.changelog = ['Merge issue #3: faster trucks', 'Merge issue #4: new horn'];
    writeFileSync(join(ROOT, 'work', 'release-candidate', 'game', '.factory', 'release.md'), '- [#3] Trucks are faster.\n- [#4] A horn.\n');
    f.ctx.github.issue = async (n: number) => ({ number: n, title: 'T', body: '', labels: n === 3 ? ['bug'] : ['feature-request'], createdAt: '', state: 'OPEN', author: 'a', thumbsUp: [] });
    await ship(f.ctx, 11, 'Ann');
    expect(readState(f.ctx.statePath).pendingIncidents).toEqual([3]);
  });

  it('closes the issues bundled into a shipped lead and queues the lead for an incident when a bundled one is a bug', async () => {
    const f = shippable();
    writeState(f.ctx.statePath, { ...readState(f.ctx.statePath), bundles: { '3': [8, 9], '5': [10] } });
    f.ctx.github.issue = async (n: number) => ({ number: n, title: 'T', body: '', labels: n === 9 ? ['bug'] : ['feature-request'], createdAt: '', state: 'OPEN', author: 'a', thumbsUp: [] });
    await ship(f.ctx, 11, 'Ann');
    expect(f.calls.filter((call) => call === 'comment Shipped in release 2026-09-29. It is on main and itch.io. It shipped as part of #3.')).toHaveLength(2);
    expect(f.calls.filter((call) => call === 'close completed')).toHaveLength(4);
    const state = readState(f.ctx.statePath);
    expect(state.pendingIncidents).toEqual([3]);
    expect(state.bundles).toEqual({ '5': [10] });
  });

  it('publishes a GitHub release of main with the changelog, after the itch push', async () => {
    const f = shippable();
    await ship(f.ctx, 11, 'Ann');
    const at = (name: string) => f.calls.findIndex((call) => call.startsWith(name));
    expect(at('run butler')).toBeLessThan(at('release release-2026-09-29'));
    expect(f.calls).toContain('release release-2026-09-29 main ROAM release 2026-09-29\n- [#3] Trucks are faster.');
  });

  it('stops before it merges anything when main has game changes the release lacks', async () => {
    const f = shippable();
    f.ctx.repo.isMerged = async () => false;
    f.ctx.repo.changedFiles = async () => ['factory/src/tick.ts', 'game/src/sim/sun.ts'];
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('main changed 1 game files that release/2026-09-29 lacks, like game/src/sim/sun.ts');
    expect(f.calls.some((call) => call.startsWith('merge') || call.startsWith('push'))).toBe(false);
  });

  it('merges main into the release first when main has only other changes', async () => {
    const f = shippable();
    f.ctx.repo.isMerged = async () => false;
    f.ctx.repo.changedFiles = async () => ['factory/src/tick.ts'];
    await ship(f.ctx, 11, 'Ann');
    const merges = f.calls.filter((call) => call.startsWith('merge') || call.startsWith('push'));
    expect(merges).toEqual(['merge main release/2026-09-29', 'merge release/2026-09-29 main', 'merge main dev', 'push release/2026-09-29 main dev']);
  });

  it('stops before it merges anything when the changelog does not match the release', async () => {
    const f = shippable();
    writeFileSync(join(ROOT, 'work', 'release-candidate', 'game', '.factory', 'release.md'), 'Trucks are faster.\n');
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('not "- [#N] what changed"');
    expect(f.calls.some((call) => call.startsWith('merge') || call.startsWith('push'))).toBe(false);
  });

  it('stops before it merges anything when the itch keys are missing', async () => {
    const f = shippable();
    Object.assign(f.ctx.cfg, { itchTarget: null, butlerKey: null });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('ITCH_TARGET in factory/settings.env and BUTLER_API_KEY');
    expect(f.calls).toEqual([]);
  });

  it('refuses without a Ship from a member (IV1)', async () => {
    const f = shippable();
    await expect(ship(f.ctx, 11, null)).rejects.toThrow('needs a Ship');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses while the release has no current post (IV3)', async () => {
    const f = shippable();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, postId: null } });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('no current candidate post');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses when the release moved after the candidate was posted, before it merges anything', async () => {
    const f = shippable();
    f.ctx.repo.headHash = async () => 'def5678';
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('moved to def5678 after the candidate of abc1234');
    expect(f.calls.some((call) => call.startsWith('merge') || call.startsWith('run butler'))).toBe(false);
  });

  it('refuses while a release task is outside Done (IV3)', async () => {
    const f = shippable();
    f.cards.push({ itemId: 'i13', issue: 13, column: 'Testing', labels: ['release-task'] });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('still open: #13');
    expect(f.calls.some((call) => call.startsWith('merge'))).toBe(false);
  });

  it('refuses when no release is open or another issue is named', async () => {
    const f = shippable();
    await expect(ship(f.ctx, 99, 'Ann')).rejects.toThrow('not the tracking issue');
    writeState(f.ctx.statePath, structuredClone(EMPTY_STATE));
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('No release is open');
  });

  it('posts nothing publicly when butler fails', async () => {
    const f = shippable();
    f.ctx.run = async () => ({ code: 1, stdout: '', stderr: 'bad key' });
    await expect(ship(f.ctx, 11, 'Ann')).rejects.toThrow('butler push failed');
    expect(f.calls.some((call) => call.startsWith('photo') || call.startsWith('message'))).toBe(false);
    expect(readState(f.ctx.statePath).release).not.toBeNull();
  });
});
