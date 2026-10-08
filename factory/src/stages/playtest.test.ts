import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, newPlaytest, readState, writeState } from '../state';
import type { AgentRun, ReleaseState } from '../types';
import { auditDir, playtest } from './playtest';
import { logText } from './playtest-fixtures';
import type { Review } from './playtest-review';
import { ROOT, fake, reset, type Fake } from './test-fakes';

const DAY = '2026-10-07';
const SEED = 20261007;
const RELEASE: ReleaseState = { issue: 11, branch: `release/${DAY}`, day: DAY, postId: null, candidateSha: null, removed: [], playtest: newPlaytest(DAY) };
const CLONE_LOG = join(ROOT, 'work', 'release-playtest', 'game', '.factory', 'playtest', 'log.jsonl');

const finding = { id: 'F1', severity: 'important' as const, title: 'Raiders chase forever', evidence: 'turns 300 to 900, v12' };
const PLAN = [
  { priority: 2, finding: 'F2', change: 'second step', tests: 'b.test.ts' },
  { priority: 1, finding: 'F1', change: 'end the raid goal after a lost target', tests: 'npc-decisions.test.ts' },
];
const review = (over: Partial<Review> = {}): string => JSON.stringify({
  verdict: 'clean', summary: 'A full run.', drama: 'A raid at turn 300.', observations: ['trade at turn 20'], suspected: [], limitations: ['far mode'],
  findings: [], plan: [], explanations: { death: null, quiet: null }, blocker: null, ...over,
});

type Run = { f: Fake; shells: string[]; prompts: string[]; models: string[] };

// The fake harness writes the log the command asks for, with the seed, turns and commit it was given.
function setup(heads: string[] = ['abc1234'], state: Partial<ReleaseState> = {}): Run {
  const f = fake();
  f.ctx.cfg = { ...f.ctx.cfg, designModel: 'opus', playtestTurns: 100, playtestRuns: 3 };
  writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, ...state, playtest: { ...RELEASE.playtest, ...state.playtest } } });
  const run: Run = { f, shells: [], prompts: [], models: [] };
  const left = [...heads];
  // The clone takes the head the factory read first, as a full hash.
  f.ctx.run = async () => ({ code: 0, stdout: `${heads[0]}0123456789abcdef\n`, stderr: '' });
  f.ctx.repo.headHash = async () => (left.length > 1 ? left.shift() : left[0]) ?? 'abc1234';
  f.ctx.container.shell = async (_clone: string, script: string) => {
    run.shells.push(script);
    const arg = (name: string) => new RegExp(`--${name} (\\S+)`).exec(script)?.[1] ?? '';
    mkdirSync(join(CLONE_LOG, '..'), { recursive: true });
    writeFileSync(CLONE_LOG, logText({}, { seed: Number(arg('seed')), turns: Number(arg('turns')), sha: arg('sha') }));
  };
  const agent = f.ctx.container.agent;
  f.ctx.container.agent = async (agentRun: AgentRun) => {
    run.prompts.push(agentRun.prompt);
    run.models.push(agentRun.model);
    return agent(agentRun);
  };
  return run;
}

const release = (f: Fake): ReleaseState => {
  const open = readState(f.ctx.statePath).release;
  if (!open) throw new Error('no release');
  return open;
};
const comments = (f: Fake): string[] => f.calls.filter((call) => call.startsWith('comment'));

beforeEach(reset);

describe('playtest', () => {
  it('plays the release seed on the release head, has Opus review the log and passes that commit', async () => {
    const { f, shells, prompts, models } = setup();
    f.agentWrites = { 'playtest.json': review(), 'playtest.md': '## Run\nAll good.' };
    await playtest(f.ctx, 11);
    expect(shells).toEqual([`npm ci && npm test && npm run progression:playthrough -- --seed ${SEED} --turns 100 --sha abc1234 --out .factory/playtest/log.jsonl`]);
    expect(models).toEqual(['opus']);
    expect(prompts[0]).toContain(`seed ${SEED}, 100 turns`);
    expect(prompts[0]).toContain('commit abc1234');
    expect(release(f).playtest).toMatchObject({ runs: 1, passed: 'abc1234', blocked: null });
    expect(comments(f)).toEqual([expect.stringContaining(`Release playtest run 1: clean. Seed ${SEED}, 100 turns, commit abc1234, run ended by complete.`)]);
    expect(comments(f)[0]).toContain('All good.');
  });

  it('keeps an audit record of each run: log, facts, review, report and outcome', async () => {
    const { f } = setup();
    f.agentWrites = { 'playtest.json': review(), 'playtest.md': 'report' };
    await playtest(f.ctx, 11);
    const dir = auditDir(f.ctx, RELEASE, 1);
    for (const name of ['log.jsonl', 'playtest-facts.json', 'playtest.json', 'playtest.md', 'meta.json']) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).toMatchObject({ day: DAY, run: 1, seed: SEED, turns: 100, sha: 'abc1234', outcome: 'clean', verdict: 'clean', task: null, ending: 'complete' });
    expect(readFileSync(join(dir, 'log.jsonl'), 'utf8')).toContain('"sha":"abc1234"');
  });

  it('opens one release task with the findings and the plan, most important first, and passes nothing', async () => {
    const { f } = setup();
    f.agentWrites = { 'playtest.json': review({ verdict: 'fix', findings: [finding], plan: PLAN }) };
    await playtest(f.ctx, 11);
    expect(f.created).toHaveLength(1);
    const task = f.created[0];
    expect(task.title).toBe(`Fix release playtest findings (release ${DAY}, run 1)`);
    expect(task.labels).toEqual(['release-task', 'maintenance']);
    expect(task.body).toContain('F1 (important): Raiders chase forever. Evidence: turns 300 to 900, v12');
    expect(task.body.indexOf('1. F1')).toBeLessThan(task.body.indexOf('2. F2'));
    expect(task.body).toContain('Never remove or disable a feature');
    expect(task.body).toContain('replays the same seed');
    expect(f.calls).toContain('addCard Design');
    expect(release(f).playtest).toMatchObject({ runs: 1, streak: 1, passed: null, blocked: null });
    expect(comments(f)[0]).toContain('The fixes go to release task #11.');
  });

  it('replays the same seed on the new head after the fix merged, with the earlier run in its history', async () => {
    const first = setup(['abc1234']);
    first.f.agentWrites = { 'playtest.json': review({ verdict: 'fix', findings: [finding], plan: PLAN }) };
    await playtest(first.f.ctx, 11);
    const second = setup(['def5678'], { playtest: release(first.f).playtest });
    second.f.agentWrites = { 'playtest.json': review() };
    await playtest(second.f.ctx, 11);
    expect(second.shells[0]).toContain(`--seed ${SEED} --turns 100 --sha def5678`);
    const history = readFileSync(join(ROOT, 'work', 'release-playtest', 'game', '.factory', 'playtest-history.md'), 'utf8');
    expect(history).toContain('- run 1 at abc1234: fix, 2 planned fixes, fix task #11');
    expect(release(second.f).playtest).toMatchObject({ runs: 2, streak: 0, passed: 'def5678' });
  });

  it('passes nothing when the release moved during the run, so the tick plays the new head', async () => {
    const { f } = setup(['abc1234', 'def5678']);
    f.agentWrites = { 'playtest.json': review() };
    await playtest(f.ctx, 11);
    expect(release(f).playtest).toMatchObject({ runs: 1, passed: null, blocked: null });
  });

  it('blocks the release and fails on a blocked verdict, with the report on the tracking issue', async () => {
    const { f } = setup();
    f.agentWrites = { 'playtest.json': review({ verdict: 'blocked', blocker: 'Should raiders give up at night? A design call.' }) };
    await expect(playtest(f.ctx, 11)).rejects.toThrow('Release playtest blocked: Should raiders give up at night?');
    expect(release(f).playtest.blocked).toEqual({ sha: 'abc1234', reason: 'Should raiders give up at night? A design call.' });
    expect(f.created).toEqual([]);
    expect(comments(f)[0]).toContain('The release is blocked');
  });

  it('blocks instead of opening a fix task on the last run, so it never loops past the limit', async () => {
    const { f } = setup(['abc1234'], { playtest: { ...RELEASE.playtest, runs: 5, streak: 2 } });
    f.agentWrites = { 'playtest.json': review({ verdict: 'fix', findings: [finding], plan: PLAN }) };
    await expect(playtest(f.ctx, 11)).rejects.toThrow('The run 3 of 3 since the last pass still has findings to fix');
    expect(f.created).toEqual([]);
    expect(release(f).playtest).toMatchObject({ runs: 6, streak: 3, passed: null, blocked: { sha: 'abc1234' } });
    expect(existsSync(join(auditDir(f.ctx, RELEASE, 6), 'meta.json'))).toBe(true);
  });

  it('gives a fresh budget after a clean pass, so a committee change later is not short of runs', async () => {
    const { f } = setup(['abc1234'], { playtest: { ...RELEASE.playtest, runs: 2, streak: 2 } });
    f.agentWrites = { 'playtest.json': review() };
    await playtest(f.ctx, 11);
    expect(release(f).playtest).toMatchObject({ runs: 3, streak: 0, passed: 'abc1234' });
  });

  it('blocks a clean verdict of a run that ended in an error', async () => {
    const { f } = setup();
    f.ctx.container.shell = async (_clone: string, script: string) => {
      const sha = /--sha (\S+)/.exec(script)?.[1];
      mkdirSync(join(CLONE_LOG, '..'), { recursive: true });
      writeFileSync(CLONE_LOG, logText({ end: { reason: 'error', message: 'the player truck stalled' } }, { seed: SEED, turns: 100, sha: sha ?? '' }));
    };
    f.agentWrites = { 'playtest.json': review() };
    await expect(playtest(f.ctx, 11)).rejects.toThrow('ended in an error at turn 101');
    expect(release(f).playtest.passed).toBeNull();
  });

  it('refuses to start past the run limit and blocks without playing', async () => {
    const { f, shells } = setup(['abc1234'], { playtest: { ...RELEASE.playtest, runs: 3, streak: 3 } });
    await expect(playtest(f.ctx, 11)).rejects.toThrow('spent all 3 playtest runs');
    expect(shells).toEqual([]);
    expect(release(f).playtest.blocked).toEqual({ sha: 'abc1234', reason: 'The release spent all 3 playtest runs since its last pass.' });
  });

  it('refuses while a release task is open or the playtest is blocked, and plays nothing', async () => {
    const open = setup();
    open.f.cards = [{ itemId: 'i', issue: 30, column: 'Testing', labels: ['release-task'] }];
    await expect(playtest(open.f.ctx, 11)).rejects.toThrow('Release tasks are still open: #30');
    const blocked = setup(['abc1234'], { playtest: { ...RELEASE.playtest, blocked: { sha: 'abc1234', reason: 'r' } } });
    await expect(playtest(blocked.f.ctx, 11)).rejects.toThrow('blocked at abc1234');
    expect([...open.shells, ...blocked.shells]).toEqual([]);
  });

  it('spends the run and fails when the harness or the agent wrote nothing', async () => {
    const harness = setup();
    harness.f.ctx.container.shell = async () => undefined;
    await expect(playtest(harness.f.ctx, 11)).rejects.toThrow('wrote no playtest log');
    expect(release(harness.f).playtest.runs).toBe(1);
    const agent = setup();
    await expect(playtest(agent.f.ctx, 11)).rejects.toThrow('wrote no .factory/playtest.json');
    expect(release(agent.f).playtest).toMatchObject({ runs: 1, passed: null });
  });

  it('plays nothing and spends no run when the clone is not at the release head it read, so the audit never names the wrong commit', async () => {
    const { f, shells } = setup();
    f.ctx.run = async () => ({ code: 0, stdout: 'def5678aaaa\n', stderr: '' });
    await playtest(f.ctx, 11);
    expect(shells).toEqual([]);
    expect(release(f).playtest).toMatchObject({ runs: 0, streak: 0, passed: null, blocked: null });
  });

  it('refuses an issue that is not the tracking issue', async () => {
    const { f } = setup();
    await expect(playtest(f.ctx, 12)).rejects.toThrow('not the tracking issue');
  });
});
