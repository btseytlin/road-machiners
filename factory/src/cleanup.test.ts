import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sweepLogs, sweepWork } from './cleanup';
import { EMPTY_STATE } from './state';
import type { Card, FactoryState, Job } from './types';

const state = (over: Partial<FactoryState> = {}): FactoryState => ({ ...structuredClone(EMPTY_STATE), ...over });
const card = (issue: number, column: Card['column']): Card => ({ itemId: `i${issue}`, issue, column, labels: [] });
const running = (stage: Job['stage'], issue: number | null): Job => ({ id: `${stage}-${issue}`, stage, issue, pid: 1, startedAt: '', log: '' });

// A work root with each named clone, each holding a task file and installed packages.
function work(...names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'work-'));
  for (const name of names) {
    mkdirSync(join(root, name, 'game', '.factory-tasks'), { recursive: true });
    writeFileSync(join(root, name, 'game', '.factory-tasks', 'task.md'), 'plan');
    mkdirSync(join(root, name, 'node_modules'), { recursive: true });
    mkdirSync(join(root, name, 'game', 'node_modules'), { recursive: true });
  }
  return root;
}

const has = (root: string, path: string): boolean => existsSync(join(root, path));

describe('sweepWork', () => {
  it('keeps an open card clone with its task file and drops its packages', () => {
    const root = work('issue-3');
    const swept = sweepWork(root, state(), [card(3, 'Approval')]);
    expect(swept).toEqual({ removed: [], stripped: ['issue-3'], unknown: [] });
    expect([has(root, 'issue-3/game/.factory-tasks/task.md'), has(root, 'issue-3/node_modules'), has(root, 'issue-3/game/node_modules')]).toEqual([true, false, false]);
  });

  it('removes the clones of Done cards, issues off the board, merged changes and finished builds', () => {
    const root = work('issue-1', 'issue-2', 'adhoc-4', 'check-issue-3', 'change-1790000000000', 'incident-6', 'dev-build', 'release-main', 'release-candidate', 'waste');
    const swept = sweepWork(root, state(), [card(1, 'Done'), card(3, 'Testing'), card(4, 'Done')]);
    expect(swept.removed.sort()).toEqual(['adhoc-4', 'change-1790000000000', 'check-issue-3', 'dev-build', 'incident-6', 'issue-1', 'issue-2', 'release-candidate', 'release-main', 'waste']);
  });

  it('keeps every clone a running or interrupted job works in, packages included', () => {
    const root = work('issue-5', 'check-issue-5', 'issue-7', 'dev-build', 'release-candidate', 'waste');
    const swept = sweepWork(root, state({ jobs: [running('verify', 5), running('ship', 20), running('waste', null)], interrupted: [7] }), [card(5, 'Done'), card(7, 'Done')]);
    expect(swept).toEqual({ removed: ['dev-build'], stripped: [], unknown: [] });
    expect([has(root, 'issue-5/node_modules'), has(root, 'check-issue-5/node_modules'), has(root, 'issue-7/node_modules'), has(root, 'release-candidate/node_modules')]).toEqual([true, true, true, true]);
  });

  it('keeps queued changes and incidents and the candidate of an open release', () => {
    const root = work('change-12', 'incident-6', 'release-candidate');
    const release = { issue: 20, branch: 'release/2026-01-05', day: '2026-01-05', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } };
    const swept = sweepWork(root, state({ pendingChanges: [{ id: 12, text: 't', by: 'u' }], pendingIncidents: [6], release }), []);
    expect(swept.removed).toEqual([]);
    expect(swept.stripped.sort()).toEqual(['change-12', 'incident-6', 'release-candidate']);
  });

  it('keeps every issue clone when the board has no card at all', () => {
    const root = work('issue-1', 'adhoc-2');
    expect(sweepWork(root, state(), []).removed).toEqual([]);
  });

  it('leaves unknown folders, the merge worktree and files alone', () => {
    const root = work('scratch', 'land');
    writeFileSync(join(root, 'notes.txt'), 'x');
    const swept = sweepWork(root, state(), [card(1, 'Design')]);
    expect(swept).toEqual({ removed: [], stripped: [], unknown: ['scratch'] });
    expect([has(root, 'scratch/node_modules'), has(root, 'land/node_modules'), has(root, 'notes.txt')]).toEqual([true, true, true]);
  });

  it('does nothing without a work root', () => {
    expect(sweepWork(join(tmpdir(), 'no-such-work-root'), state(), [])).toEqual({ removed: [], stripped: [], unknown: [] });
  });
});

describe('sweepLogs', () => {
  const NOW = new Date('2026-01-30T00:00:00Z');

  function logs(...entries: [string, number][]): string {
    const root = mkdtempSync(join(tmpdir(), 'logs-'));
    for (const [name, daysOld] of entries) {
      writeFileSync(join(root, name), 'log');
      const at = new Date(NOW.getTime() - daysOld * 24 * 3_600_000);
      utimesSync(join(root, name), at, at);
    }
    return root;
  }

  it('removes job logs older than the limit and keeps the rest', () => {
    const root = logs(['design-1-old.log', 20], ['design-2-new.log', 2], ['tick.log', 30], ['update.log', 30]);
    expect(sweepLogs(root, state(), NOW, 14)).toEqual(['design-1-old.log']);
    expect(['design-2-new.log', 'tick.log', 'update.log'].map((name) => has(root, name))).toEqual([true, true, true]);
  });

  it('keeps an old log that a failure names', () => {
    const root = logs(['checks-5-old.log', 20]);
    const failures = [{ stage: 'checks' as const, issue: 5, error: 'e', log: join(root, 'checks-5-old.log'), at: '' }];
    expect(sweepLogs(root, state({ failures }), NOW, 14)).toEqual([]);
  });
});
