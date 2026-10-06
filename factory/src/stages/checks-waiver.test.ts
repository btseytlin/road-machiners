import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFpsWaiver } from '../fps-waiver';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { Ctx, FactoryState } from '../types';

vi.mock('../deploy', () => ({ checkScope: () => undefined, publishBuild: (_ctx: unknown, _clone: string, scope: string) => `https://play.test/${scope}/`, recordBuild: () => undefined }));
const { runStage: runChecks } = await import('./checks');

// The checks log of a run that reached the playtest, as the check script and the game's playtest print it.
const playtest = (...problems: string[]): string => [
  '[checks] 10:00:00 npm ci', '[checks] 10:00:10 tests and typecheck', ' Test Files  412 passed (412)', '      Tests  3869 passed (3869)',
  '[checks] 10:05:00 tests done', '[checks] 10:05:01 dev server', '[checks] 10:05:03 playtest', 'turns 12, fps 43', 'FAIL', ...problems,
  'npm error Lifecycle script `playtest` failed with error:', 'npm error code 1', '',
].join('\n');
const FPS_ONLY = playtest('fps 43 under 50');

let home = '';
let comments: string[] = [];
let moves: string[] = [];
let scripts: string[] = [];
let head = 'abc123';
// What each container shell writes to the log, and whether it fails, in order. Shells past the list pass.
let shells: { log: string; fails: boolean }[] = [];

function ctx(gpu = true): Ctx {
  return {
    cfg: { home, gpu, repo: 'o/r', committeeChat: 'chat', committeeBootstrapTelegram: '1', committeeBootstrapGithub: 'boot' },
    statePath: `${home}/state.json`,
    now: () => new Date('2026-10-06T12:00:00Z'),
    log: () => undefined,
    github: {
      issue: async () => ({ number: 168, title: 'Hardened', body: '', labels: [], createdAt: '', state: 'OPEN', thumbsUp: [] }),
      comment: async (_issue: number, body: string) => { comments.push(body); },
      move: async (issue: number, column: string) => { moves.push(`${issue} ${column}`); },
    },
    container: {
      shell: async (_dir: string, script: string, log: string) => {
        scripts.push(script);
        const next = shells.shift() ?? { log: '[checks] 10:06:00 done\n', fails: false };
        appendFileSync(log, next.log);
        if (next.fails) throw new Error('shell failed');
      },
    },
    repo: { prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); }, headHash: async () => head },
  } as unknown as Ctx;
}

const state = (): FactoryState => readState(`${home}/state.json`);
const ledger = (): { event: string; fps?: number }[] => existsSync(`${home}/ledger.jsonl`) ? readFileSync(`${home}/ledger.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
const builds = (): number => scripts.filter((script) => script.includes('npm run build')).length;

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-checks-waiver-');
  mkdirSync(`${home}/committee`);
  writeFileSync(`${home}/committee/committee.json`, JSON.stringify({ members: [{ telegram: '42', github: 'btseytlin', name: 'Dr. Boris' }] }));
  // Issue #168 after its second failed checks: approved, its phase cleared, its card stuck in Testing.
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), approvedResolving: { 168: 'Dr. Boris' } });
  comments = [];
  moves = [];
  scripts = [];
  shells = [];
  head = 'abc123';
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the FPS waiver in the checks', () => {
  it('keeps the strict gate with no waiver: an FPS-only failure after the fix stops the card', async () => {
    writeState(`${home}/state.json`, { ...state(), testPhase: { 168: 'checks-after-fix' } });
    shells = [{ log: FPS_ONLY, fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('The factory checks failed twice');
    expect(state().pendingApprovals).toEqual({});
    expect(moves).toEqual([]);
    expect(builds()).toBe(1);
  });

  it('passes an authorized FPS-only failure, flags it and queues the approved merge with no agent', async () => {
    await grantFpsWaiver(ctx(), 168, 'btseytlin', 'GPU contended on the host');
    shells = [{ log: FPS_ONLY, fails: true }];
    await runChecks(ctx(), 168);
    // The same full checks ran first, then the build alone.
    expect(scripts[0]).toContain('npm test');
    expect(scripts[0]).toContain('\nnpm run playtest\n');
    expect(scripts[1]).toContain('FPS minimum waived');
    expect(scripts[1]).not.toContain('playtest\n');
    expect(comments.at(-1)).toContain('⚠️ FPS gate waived');
    expect(comments.at(-1)).toContain('43 FPS, under the minimum of 50');
    expect(comments.at(-1)).toContain('Authorized by Dr. Boris');
    expect(comments.at(-1)).toContain('GPU contended on the host');
    expect(ledger().map((line) => [line.event, line.fps])).toEqual([['granted', undefined], ['used', 43]]);
    expect(moves).toEqual(['168 Approval']);
    expect(state().pendingApprovals).toEqual({ 168: 'Dr. Boris' });
    expect(state().testPhase).toEqual({});
    expect(state().fpsWaivers).toEqual({});
  });

  it('does not waive any other failure, and spends the waiver on it', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    shells = [{ log: playtest('crash screen shown', 'fps 43 under 50'), fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('The factory checks failed twice');
    expect(builds()).toBe(1);
    expect(state().fpsWaivers).toEqual({});
    expect(state().pendingApprovals).toEqual({});
    expect(comments.some((body) => body.includes('FPS gate waived'))).toBe(false);
  });

  it('does not waive a failing test before the playtest', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    shells = [{ log: '[checks] 10:00:10 tests and typecheck\n FAIL  src/a.test.ts > b\nAssertionError: expected 1 to be 2\n', fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('failed twice');
    expect(state().pendingApprovals).toEqual({});
  });

  it('fails the card when the build after a waived playtest fails', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    shells = [{ log: FPS_ONLY, fails: true }, { log: '[checks] 10:06:00 build, FPS minimum waived\nerror during build\n', fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('error during build');
    expect(state().pendingApprovals).toEqual({});
    expect(ledger().map((line) => line.event)).toEqual(['granted']);
  });

  it('does not waive a new branch head, or another issue', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    head = 'def456';
    shells = [{ log: FPS_ONLY, fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('failed twice');
    writeState(`${home}/state.json`, { ...state(), approvedResolving: { 168: 'Dr. Boris', 169: 'Dr. Boris' }, testPhase: { 169: 'checks-after-fix' } });
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    shells = [{ log: FPS_ONLY, fails: true }];
    await expect(runChecks(ctx(), 169)).rejects.toThrow('failed twice');
    expect(state().fpsWaivers[168]).toBeDefined();
  });

  it('is one shot: a passing run spends it, so a later FPS failure stops the card again', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    await runChecks(ctx(), 168);
    expect(state().fpsWaivers).toEqual({});
    expect(comments.some((body) => body.includes('FPS gate waived'))).toBe(false);
    writeState(`${home}/state.json`, { ...state(), testPhase: { 168: 'checks-after-fix' } });
    shells = [{ log: FPS_ONLY, fails: true }];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('failed twice');
  });

  it('keeps the waiver when the checks only timed out, since they reached no verdict', async () => {
    await grantFpsWaiver(ctx(), 168, 'Dr. Boris', 'contended');
    const timeout = { log: '[checks] 10:00:10 tests and typecheck\nError: Test timed out in 30000ms.\n', fails: true };
    shells = [timeout, timeout, timeout];
    await expect(runChecks(ctx(), 168)).rejects.toThrow('timed out 3 times');
    expect(state().fpsWaivers[168]?.build).toBe('abc123');
    expect(state().testPhase).toEqual({ 168: 'checks-after-fix' });
  });

  it('never waives on the CPU playtest, which checks no frame rate', async () => {
    writeState(`${home}/state.json`, { ...state(), testPhase: { 168: 'checks-after-fix' }, fpsWaivers: { 168: { by: 'Dr. Boris', reason: 'r', build: 'abc123', at: '' } } });
    shells = [{ log: FPS_ONLY, fails: true }];
    await expect(runChecks(ctx(false), 168)).rejects.toThrow('failed twice');
    expect(state().fpsWaivers).toEqual({});
  });
});
