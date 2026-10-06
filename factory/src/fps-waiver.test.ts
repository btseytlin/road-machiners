import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dropWaiver, fpsOnly, grantFpsWaiver, matchingWaiver } from './fps-waiver';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryState } from './types';

// The tail of a checks log whose playtest failed, with the game's own output lines.
const playtestFailure = (...problems: string[]): string => [
  '[checks] 10:00:00 tests done',
  '[checks] 10:00:30 dev server',
  '[checks] 10:00:31 playtest',
  '> roam@0.1.0 playtest',
  '> node scripts/playtest.mjs',
  '',
  'turns 12, fps 43',
  'FAIL',
  ...problems,
  'npm error Lifecycle script `playtest` failed with error:',
  'npm error code 1',
].join('\n');

describe('fpsOnly', () => {
  it('reads the frame rate of a playtest that failed on it alone', () => {
    expect(fpsOnly(playtestFailure('fps 43 under 50'))).toEqual({ fps: 43, min: 50 });
    expect(fpsOnly(playtestFailure('fps 44.5 under 50').replace('fps 43', 'fps 44.5'))).toEqual({ fps: 44.5, min: 50 });
  });

  it('ignores the notice of the stopped dev server', () => {
    expect(fpsOnly(`${playtestFailure('fps 43 under 50')}\nbash: line 42:   311 Terminated              npm run dev -- --port 5173`)).toEqual({ fps: 43, min: 50 });
  });

  it('refuses a playtest with any other problem beside the frame rate', () => {
    expect(fpsOnly(playtestFailure('TypeError: x is undefined', 'fps 43 under 50'))).toBeNull();
    expect(fpsOnly(playtestFailure('crash screen shown', 'fps 43 under 50'))).toBeNull();
    expect(fpsOnly(playtestFailure('expected turn 13, got 9', 'fps 43 under 50'))).toBeNull();
    expect(fpsOnly(playtestFailure('no WebGL canvas', 'fps 43 under 50'))).toBeNull();
    expect(fpsOnly(playtestFailure('crash screen shown'))).toBeNull();
  });

  it('refuses a turn that never finished, which fails with no FAIL block', () => {
    expect(fpsOnly('[checks] 10:00:31 playtest\nError: Turn 3 did not finish playing within 10000 ms\nnpm error code 1')).toBeNull();
  });

  it('refuses a failure before the playtest, like the tests or the typecheck', () => {
    expect(fpsOnly('[checks] 10:00:00 tests and typecheck\n FAIL  src/a.test.ts > b\nturns 12, fps 43\nFAIL\nfps 43 under 50')).toBeNull();
  });

  it('refuses a failure after the playtest, like the build', () => {
    expect(fpsOnly(`${playtestFailure('fps 43 under 50')}\n[checks] 10:01:00 build\nerror TS2304`)).toBeNull();
  });

  it('refuses a report that disagrees with the problem, or a frame rate at the minimum', () => {
    expect(fpsOnly(playtestFailure('fps 40 under 50'))).toBeNull();
    expect(fpsOnly(playtestFailure('fps 50 under 50').replace('fps 43', 'fps 50'))).toBeNull();
  });
});

describe('grantFpsWaiver', () => {
  let home = '';
  let comments: string[] = [];
  let head = 'abc123';
  const ctx = (gpu = true): Ctx => ({
    cfg: { home, gpu, committeeBootstrapTelegram: '1', committeeBootstrapGithub: 'boot' },
    statePath: `${home}/state.json`,
    now: () => new Date('2026-10-06T12:00:00Z'),
    log: () => undefined,
    github: { comment: async (_issue: number, body: string) => { comments.push(body); } },
    repo: { headHash: async () => head },
  }) as unknown as Ctx;
  const seed = (state: Partial<FactoryState>): void => writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), ...state });

  beforeEach(() => {
    mkdirSync('tmp', { recursive: true });
    home = mkdtempSync('tmp/factory-waiver-');
    mkdirSync(`${home}/committee`);
    writeFileSync(`${home}/committee/committee.json`, JSON.stringify({ members: [{ telegram: '42', github: 'btseytlin', name: 'Dr. Boris' }] }));
    comments = [];
    head = 'abc123';
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('records the waiver for the branch head and sends the stuck card straight to the checks', async () => {
    seed({ approvedResolving: { 168: 'Dr. Boris' } });
    await grantFpsWaiver(ctx(), 168, 'btseytlin', 'GPU contended on the host');
    const state = readState(`${home}/state.json`);
    expect(state.fpsWaivers).toEqual({ 168: { by: 'Dr. Boris', reason: 'GPU contended on the host', build: 'abc123', at: '2026-10-06T12:00:00.000Z' } });
    expect(state.testPhase).toEqual({ 168: 'checks-after-fix' });
    expect(comments[0]).toContain('authorized by Dr. Boris');
    const ledger = readFileSync(`${home}/ledger.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(ledger).toEqual([{ kind: 'waiver', event: 'granted', check: 'fps', issue: 168, by: 'Dr. Boris', reason: 'GPU contended on the host', build: 'abc123', at: '2026-10-06T12:00:00.000Z' }]);
  });

  it('keeps a phase that already runs the checks', async () => {
    seed({ approvedResolving: { 168: 'Dr. Boris' }, testPhase: { 168: 'checks' } });
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    expect(readState(`${home}/state.json`).testPhase).toEqual({ 168: 'checks' });
  });

  it('refuses a card the committee has not approved, a stranger, an empty reason, a running job and the CPU playtest', async () => {
    seed({});
    await expect(grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended')).rejects.toThrow('no approved card');
    seed({ approvedResolving: { 168: 'Dr. Boris' } });
    await expect(grantFpsWaiver(ctx(), 168, 'mallory', 'contended')).rejects.toThrow('no committee member');
    await expect(grantFpsWaiver(ctx(), 168, 'Dr. Boris', '  ')).rejects.toThrow('needs a reason');
    await expect(grantFpsWaiver(ctx(false), 168, 'Dr. Boris', 'contended')).rejects.toThrow('CPU playtest');
    seed({ approvedResolving: { 168: 'Dr. Boris' }, jobs: [{ id: 'j', stage: 'verify', issue: 168, pid: 1, startedAt: '', log: '' } as FactoryState['jobs'][number]] });
    await expect(grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended')).rejects.toThrow('A job runs');
    expect(readState(`${home}/state.json`).fpsWaivers).toEqual({});
  });

  it('matches only the build it names, and goes once dropped', async () => {
    seed({ approvedResolving: { 168: 'Dr. Boris' } });
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    expect(matchingWaiver(ctx(), 168, 'abc123')?.by).toBe('Dr. Boris');
    expect(matchingWaiver(ctx(), 168, 'def456')).toBeNull();
    expect(matchingWaiver(ctx(), 169, 'abc123')).toBeNull();
    dropWaiver(ctx(), 168);
    expect(matchingWaiver(ctx(), 168, 'abc123')).toBeNull();
  });
});
