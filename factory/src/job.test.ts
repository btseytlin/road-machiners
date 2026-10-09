import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressNote, runJob } from './job';
import { appendUsage, readLedger } from './ledger';
import { markResumed, resumeError, resumedStage } from './sessions';
import { BudgetError } from './stages/checkpoint';
import { CommitteeDecisionError } from './diff-guard';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryConfig, JobStage } from './types';

const ROOT = resolve('tmp/factory-job-test');

describe('runJob', () => {
  it('clears the job and the queued change after a failure, and reports it once', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'design', issue: 4, pid: 1, startedAt: '', log: 'l' }, { id: 'b', stage: 'change', issue: 9, pid: 1, startedAt: '', log: 'l' }], pendingChanges: [{ id: 9, text: 't', by: 'b' }], interrupted: [9] });
    mkdirSync(join(ROOT, 'sessions', 'issue-9'), { recursive: true });
    const posts: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig,
      statePath,
      now: () => new Date(),
      log: () => undefined,
      repo: {
        fetch: async () => {
          throw new Error('offline');
        },
      },
      telegram: {
        sendMessage: async (_c: string, text: string) => {
          posts.push(text);
          return 1;
        },
      },
      github: {},
    } as unknown as Ctx;
    await runJob(ctx, 'change', 9);
    const state = readState(statePath);
    expect(state.jobs.map((job) => job.id)).toEqual(['a']);
    expect(state.pendingChanges).toEqual([]);
    expect(state.interrupted).toEqual([]);
    expect(existsSync(join(ROOT, 'sessions', 'issue-9'))).toBe(false);
    expect(posts).toEqual([]);
    expect(state.failures).toMatchObject([{ stage: 'change', issue: null, error: 'offline' }]);
    expect(readLedger(ROOT, new Date(0)).filter((line) => line.kind === 'job')).toMatchObject([{ kind: 'job', id: 'b', stage: 'change', issue: 9, outcome: 'failed', agents: [] }]);
  });

  it('records the batch a failed merge job wrote on its entry', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'm', stage: 'merge', issue: null, pid: 1, startedAt: '', log: 'l', batch: [6, 7] }] });
    const github = { cards: async () => { throw new Error('offline'); } };
    const ctx = { cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date(), log: () => undefined, github } as unknown as Ctx;
    await runJob(ctx, 'merge', null);
    expect(readState(statePath).failures).toMatchObject([{ stage: 'merge', issue: null, error: 'offline', batch: [6, 7] }]);
  });

  describe('a failed card stage', () => {
    const setup = (interrupted: number[]) => {
      rmSync(ROOT, { recursive: true, force: true });
      mkdirSync(join(ROOT, 'sessions', 'issue-4'), { recursive: true });
      const statePath = join(ROOT, 'state.json');
      writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'v', stage: 'verify', issue: 4, pid: 1, startedAt: '', log: 'l' }], interrupted });
      const comments: string[] = [];
      const labels: string[] = [];
      const ctx = {
        cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig, statePath, now: () => new Date(), log: () => undefined,
        github: {
          issue: async () => { throw new Error('GitHub is down'); },
          comment: async (_n: number, body: string) => { comments.push(body); },
          addLabel: async (_n: number, label: string) => { labels.push(label); },
        },
      } as unknown as Ctx;
      return { ctx, statePath, comments, labels };
    };

    it('resumes once in its sessions with the error, with no stuck label and no failure for Hermes', async () => {
      const { ctx, statePath, comments, labels } = setup([]);
      await runJob(ctx, 'verify', 4);
      const state = readState(statePath);
      expect(state.interrupted).toEqual([4]);
      expect(state.failures).toEqual([]);
      expect(labels).toEqual([]);
      expect(resumedStage(ROOT, 4)).toBe('verify');
      expect(resumeError(ROOT, 4)).toContain('GitHub is down');
      expect(comments).toEqual(['Testing stopped. It resumes in its own session on the next tick, with the error.']);
    });

    it('goes to Hermes when it fails again after its resume', async () => {
      const { ctx, statePath, labels } = setup([4]);
      markResumed(ROOT, 4, 'verify');
      await runJob(ctx, 'verify', 4);
      const state = readState(statePath);
      expect(state.interrupted).toEqual([]);
      expect(state.failures).toMatchObject([{ stage: 'verify', issue: 4 }]);
      expect(labels).toEqual(['factory-stuck']);
      expect(existsSync(join(ROOT, 'sessions', 'issue-4'))).toBe(false);
    });

    it('goes to Hermes at once on an empty budget or a question for the committee', async () => {
      for (const error of [new BudgetError('spent'), new CommitteeDecisionError('a save bump')]) {
        const { ctx, statePath, labels } = setup([]);
        ctx.github.issue = async () => { throw error; };
        await runJob(ctx, 'verify', 4);
        expect(readState(statePath).interrupted).toEqual([]);
        expect(labels).toEqual(['factory-stuck']);
      }
    });
  });

  it('writes one ledger line with the agent runs of a job that finished', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, {
      ...structuredClone(EMPTY_STATE),
      jobs: [
        {
          id: 'dev-1',
          stage: 'dev',
          issue: null,
          pid: 1,
          startedAt: '2026-01-10T11:00:00Z',
          log: join(ROOT, 'dev.log'),
        },
      ],
    });
    appendUsage(ROOT, 'dev-1', { model: 'sonnet', costUsd: 0.5, minutes: 4 });
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig,
      statePath,
      now: () => new Date('2026-01-10T12:00:00Z'),
      log: () => undefined,
      repo: { fetch: async () => undefined, headHash: async () => 'abc1234' },
      container: { shell: async () => undefined },
    } as unknown as Ctx;
    await runJob(ctx, 'dev', null).catch(() => undefined);
    expect(readLedger(ROOT, new Date(0)).filter((line) => line.kind === 'job')).toEqual([{ kind: 'job', retryOf: null, id: 'dev-1', stage: 'dev', issue: null, startedAt: '2026-01-10T11:00:00Z', endedAt: '2026-01-10T12:00:00.000Z', outcome: expect.any(String), agents: [{ model: 'sonnet', costUsd: 0.5, minutes: 4 }] }]);
  });

  it('clears the queued ship after a failed ship, and reports on the tracking issue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, { ...structuredClone(EMPTY_STATE), jobs: [{ id: 'a', stage: 'ship', issue: 20, pid: 1, startedAt: '', log: 'l' }], pendingShip: 'Ann', release: { issue: 20, branch: 'release/x', day: 'd', postId: 5, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } });
    const labels: string[] = [];
    const ctx = {
      cfg: {
        home: ROOT,
        repo: 'o/r',
        committeeChat: 'c',
        itchTarget: null,
        butlerKey: null,
      } as unknown as FactoryConfig,
      statePath,
      now: () => new Date(),
      log: () => undefined,
      telegram: { sendMessage: async () => 1 },
      github: {
        addLabel: async (n: number, label: string) => {
          labels.push(`${n}:${label}`);
        },
      },
    } as unknown as Ctx;
    await runJob(ctx, 'ship', 20);
    const state = readState(statePath);
    expect(state.pendingShip).toBeNull();
    expect(state.release).not.toBeNull();
    expect(labels).toEqual(['20:factory-stuck']);
  });

  it('comments on the issue when a card stage fails, after the report', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    writeState(statePath, {
      ...structuredClone(EMPTY_STATE),
      jobs: [
        {
          id: 'a',
          stage: 'design',
          issue: 7,
          pid: 1,
          startedAt: '2026-01-10T11:50:00Z',
          log: 'l',
        },
      ],
      interrupted: [3, 7],
    });
    const events: string[] = [];
    const fail = async () => {
      throw new Error('offline');
    };
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig,
      statePath,
      now: () => new Date('2026-01-10T12:00:00Z'),
      log: () => undefined,
      repo: { fetch: fail },
      telegram: {
        sendMessage: async () => {
          events.push('report');
          return 1;
        },
      },
      github: {
        issue: fail,
        cards: fail,
        addLabel: async () => {
          events.push('label');
        },
        comment: async (n: number, body: string) => {
          events.push(`comment ${n} ${body}`);
        },
      },
    } as unknown as Ctx;
    await runJob(ctx, 'design', 7);
    expect(events).toEqual(['label', 'comment 7 Design failed after 10 min. Hermes is looking into it.']);
    expect(readState(statePath).interrupted).toEqual([3]);
  });

  describe('sessions', () => {
    const sessions = (issue: number) => join(ROOT, 'sessions', `issue-${issue}`);

    async function run(stage: 'design' | 'approve', issue: number, interrupted: number[], died: JobStage | null = null): Promise<boolean[]> {
      rmSync(ROOT, { recursive: true, force: true });
      mkdirSync(sessions(issue), { recursive: true });
      mkdirSync(sessions(9), { recursive: true });
      if (died !== null) markResumed(ROOT, issue, died);
      const statePath = join(ROOT, 'state.json');
      writeState(statePath, {
        ...structuredClone(EMPTY_STATE),
        jobs: [{ id: 'a', stage, issue, pid: 1, startedAt: '', log: 'l' }],
        interrupted,
      });
      const seen: boolean[] = [];
      const look = async () => {
        seen.push(existsSync(sessions(issue)));
        throw new Error('offline');
      };
      const ctx = {
        cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig,
        statePath,
        now: () => new Date(),
        log: () => undefined,
        repo: { fetch: look },
        telegram: { sendMessage: async () => 1 },
        github: {
          issue: look,
          cards: look,
          addLabel: async () => undefined,
          comment: async () => undefined,
        },
      } as unknown as Ctx;
      await runJob(ctx, stage, issue);
      return seen;
    }

    it('clears the sessions of an issue that starts with no mark, before the stage and at the end', async () => {
      expect(await run('design', 7, [])).toEqual([false]);
      expect(existsSync(sessions(9))).toBe(true);
    });

    it('keeps the sessions of a marked issue for the stage that died, and clears them with the mark at the end', async () => {
      expect(await run('design', 7, [7], 'design')).toEqual([true]);
      expect(existsSync(sessions(7))).toBe(false);
      expect(readState(join(ROOT, 'state.json')).interrupted).toEqual([]);
    });

    it('starts new when the card moved on to another stage after the death', async () => {
      expect(await run('design', 7, [7], 'implement')).toEqual([false]);
    });

    it('never touches the sessions of an issue for a branch job', async () => {
      await run('approve', 7, []);
      expect(existsSync(sessions(7))).toBe(true);
    });
  });

  it('writes a finished note with the stage time', () => {
    const ctx = {
      now: () => new Date('2026-01-10T12:00:00Z'),
    } as unknown as Ctx;
    expect(progressNote(ctx, 'implement', '2026-01-10T11:15:00Z', 'finished')).toBe('Implementation finished after 45 min.');
    expect(progressNote(ctx, 'verify', null, 'finished')).toBe('Testing finished.');
    expect(progressNote(ctx, 'checks', null, 'failed')).toBe('Post failed. Hermes is looking into it.');
  });

  it('drops only the failed removal from the queue', async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    const statePath = join(ROOT, 'state.json');
    const removals = [
      { issue: 5, by: 'a', text: 't' },
      { issue: 6, by: 'b', text: 'u' },
    ];
    writeState(statePath, {
      ...structuredClone(EMPTY_STATE),
      jobs: [{ id: 'a', stage: 'remove', issue: 5, pid: 1, startedAt: '', log: 'l' }],
      pendingRemovals: removals,
    });
    const labels: string[] = [];
    const ctx = {
      cfg: { home: ROOT, repo: 'o/r', committeeChat: 'c' } as FactoryConfig,
      statePath,
      now: () => new Date(),
      log: () => undefined,
      telegram: { sendMessage: async () => 1 },
      github: {
        addLabel: async (n: number, label: string) => {
          labels.push(`${n}:${label}`);
        },
      },
    } as unknown as Ctx;
    await runJob(ctx, 'remove', 5);
    expect(readState(statePath).pendingRemovals).toEqual([removals[1]]);
    expect(labels).toEqual(['5:factory-stuck']);
  });
});
