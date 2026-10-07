import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failureIssue, pruneFailures, reportFailure, summarizeError } from './fail';
import { UsageLimitError } from './pause';
import { EMPTY_STATE, readState, writeState } from './state';
import type { Ctx, FactoryState } from './types';

describe('summarizeError', () => {
  it('keeps the failure lines of colored test output', () => {
    const output = 'shell failed with exit 1: \u001b[32m✓ a\u001b[39m\n ✓ b\n × local game save > records the saved shape\n FAIL src/three/save.test.ts\n Tests  1 failed | 2175 passed\n';
    expect(summarizeError(output)).toBe('shell failed with exit 1: ✓ a\n× local game save > records the saved shape\nFAIL src/three/save.test.ts\nTests  1 failed | 2175 passed');
  });

  it('falls back to the last lines when nothing looks like a failure', () => {
    expect(summarizeError('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });
});

describe('reportFailure', () => {
  const NOW = new Date('2026-09-30T12:00:00Z');
  const setup = (addLabel: () => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'factory-fail-'));
    const statePath = join(dir, 'state.json');
    writeState(statePath, structuredClone(EMPTY_STATE));
    const ctx = { cfg: { repo: 'o/r', committeeChat: 'c' }, statePath, now: () => NOW, log: () => undefined, github: { addLabel } } as unknown as Ctx;
    return { ctx, statePath };
  };

  it('records the failure for Hermes and labels the issue, with no chat post', async () => {
    const labels: string[] = [];
    const { ctx, statePath } = setup(async () => { labels.push('stuck'); });
    await reportFailure(ctx, 'implement', 4, new Error('agent failed'), 'l');
    expect(readState(statePath).failures).toEqual([{ stage: 'implement', issue: 4, error: 'agent failed', log: 'l', at: NOW.toISOString() }]);
    expect(labels).toEqual(['stuck']);
  });

  it('records a usage-limit failure but leaves the card unlabeled, so it runs again after the pause', async () => {
    const labels: string[] = [];
    const { ctx, statePath } = setup(async () => { labels.push('stuck'); });
    await reportFailure(ctx, 'implement', 4, new UsageLimitError('agent hit the usage limit'), 'l');
    expect(readState(statePath).failures).toHaveLength(1);
    expect(labels).toEqual([]);
  });

  it('records the failure before a label that fails, so Hermes still sees it', async () => {
    const { ctx, statePath } = setup(async () => { throw new Error('x509: certificate is not standards compliant'); });
    await expect(reportFailure(ctx, 'implement', 4, new Error('agent failed'), 'l')).rejects.toThrow('x509');
    expect(readState(statePath).failures).toHaveLength(1);
  });

  it('keeps failures for a day', () => {
    const state = { ...structuredClone(EMPTY_STATE), failures: [{ stage: 'design' as const, issue: 1, error: 'e', log: null, at: '2026-09-29T11:00:00Z' }, { stage: 'change' as const, issue: null, error: 'e', log: null, at: '2026-09-29T13:00:00Z' }] };
    expect(pruneFailures(NOW)(state).failures.map((failure) => failure.stage)).toEqual(['change']);
  });
});

describe('failureIssue', () => {
  const open: FactoryState = { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/x', day: 'd', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } };
  const none = structuredClone(EMPTY_STATE);

  it('names the issue of a card stage, approve, candidate, ship and remove', () => {
    for (const stage of ['design', 'approve', 'candidate', 'ship', 'remove'] as const) expect(failureIssue(stage, 9, open)).toBe(9);
  });

  it('names the tracking issue for a cut once one exists, and no issue before', () => {
    expect(failureIssue('release', null, open)).toBe(20);
    expect(failureIssue('release', null, none)).toBeNull();
  });

  it('names no issue for a change', () => {
    expect(failureIssue('change', 5, open)).toBeNull();
  });
});
