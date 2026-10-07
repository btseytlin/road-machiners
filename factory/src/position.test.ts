import { describe, expect, it } from 'vitest';
import { EMPTY_STATE } from './state';
import { CARD_JOBS, cardDrift, cardPosition, releaseDrift, runningJobs } from './position';
import type { Card, Column, FactoryState, Job, JobStage } from './types';

const card = (column: Column, issue = 157, labels: string[] = []): Card => ({ itemId: 'i', issue, column, labels });
const withState = (patch: Record<string, unknown>): FactoryState => ({ ...EMPTY_STATE, ...patch }) as FactoryState;
const job = (stage: JobStage, issue: number | null): Job => ({ id: 'j', stage, issue, pid: 1, startedAt: '2026-01-01T00:00:00Z', log: 'l' });
const postState = (phase: string) => withState({ testPhase: { 157: phase } });

describe('cardPosition', () => {
  it('maps each column and sub-position', () => {
    expect(cardPosition(card('Triage'), EMPTY_STATE)).toBe('triage');
    expect(cardPosition(card('Design'), EMPTY_STATE)).toBe('design');
    expect(cardPosition(card('Implementation'), EMPTY_STATE)).toBe('implement');
    expect(cardPosition(card('Implementation'), withState({ patching: { 157: 'abc' } }))).toBe('patch');
    expect(cardPosition(card('Testing'), EMPTY_STATE)).toBe('verify');
    expect(cardPosition(card('Testing'), postState('fix'))).toBe('fix');
    expect(cardPosition(card('Testing'), postState('checks'))).toBe('checks');
    expect(cardPosition(card('Testing'), postState('checks-after-fix'))).toBe('checks');
    expect(cardPosition(card('Testing'), postState('post'))).toBe('post');
    expect(cardPosition(card('Approval'), EMPTY_STATE)).toBe('approval');
    expect(cardPosition(card('Done'), EMPTY_STATE)).toBe('done');
  });
});

describe('cardDrift', () => {
  it('prints nothing for a clean card', () => {
    expect(cardDrift(card('Testing'), postState('checks'))).toEqual([]);
    expect(cardDrift(card('Approval'), withState({ approvalPosts: { 9: 157 } }))).toEqual([]);
    expect(cardDrift(card('Approval'), withState({ pendingApprovals: { 157: 'bob' } }))).toEqual([]);
    expect(cardDrift(card('Design'), withState({ jobs: [job('design', 157)] }))).toEqual([]);
    expect(cardDrift(card('Testing'), postState('post'))).toEqual([]);
  });
  it('flags testPhase outside Testing', () => {
    expect(cardDrift(card('Design'), postState('checks'))).toEqual(['#157 testPhase checks but column Design']);
  });
  it('flags patching outside Implementation', () => {
    expect(cardDrift(card('Testing'), withState({ patching: { 157: 'abc' } }))).toEqual(['#157 patching set but column Testing']);
  });
  it('flags an approval post outside Approval', () => {
    expect(cardDrift(card('Design'), withState({ approvalPosts: { 9: 157 } }))).toEqual(['#157 open approval post 9 but column Design']);
  });
  it('flags a queued approval outside Approval', () => {
    expect(cardDrift(card('Testing'), withState({ pendingApprovals: { 157: 'bob' } }))).toEqual(['#157 queued approval but column Testing']);
  });
  it('flags an Approval card with no open post that is not approved', () => {
    expect(cardDrift(card('Approval'), EMPTY_STATE)).toEqual(['#157 column Approval but no open post and no approval']);
  });
  it('flags a running job of another stage', () => {
    expect(cardDrift(card('Design'), withState({ jobs: [job('implement', 157)] }))).toEqual(['#157 running implement job but position design runs design']);
    expect(cardDrift(card('Done'), withState({ jobs: [job('checks', 157)] }))).toEqual(['#157 running checks job but position done runs nothing']);
  });
  it('lets post and fix run their mapped stages', () => {
    expect(cardDrift(card('Testing'), withState({ testPhase: { 157: 'post' }, jobs: [job('checks', 157)] }))).toEqual([]);
    expect(cardDrift(card('Testing'), withState({ testPhase: { 157: 'fix' }, jobs: [job('verify', 157)] }))).toEqual([]);
    expect(cardDrift(card('Approval'), withState({ approvalPosts: { 9: 157 }, jobs: [job('approve', 157)] }))).toEqual([]);
  });
  it('ignores jobs of other issues and release jobs', () => {
    expect(cardDrift(card('Design'), withState({ jobs: [job('implement', 158), job('candidate', 157)] }))).toEqual([]);
  });
});

describe('release tracking card', () => {
  it('reports no drift while it waits in Approval with its post in release.postId', () => {
    const release = { issue: 300, branch: 'release/x', day: '2026-01-01', postId: 5, removed: [] };
    expect(cardDrift(card('Approval', 300, ['release']), withState({ release }))).toEqual([]);
  });
});

describe('runningJobs', () => {
  it('lists the jobs of one card and ignores other issues', () => {
    const state = withState({ jobs: [job('design', 157), job('checks', 158), job('candidate', 157)] });
    expect(runningJobs(card('Design'), state).map((row) => row.stage)).toEqual(['design', 'candidate']);
    expect(runningJobs(card('Design', 159), state)).toEqual([]);
  });
});

describe('CARD_JOBS', () => {
  it('lists the jobs that belong to a card position', () => {
    expect(CARD_JOBS).toEqual(['triage', 'design', 'implement', 'adhoc', 'patch', 'verify', 'checks']);
  });
});

describe('releaseDrift', () => {
  const release = { issue: 300, branch: 'release/x', day: '2026-01-01', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 1, passed: 'abc1234', blocked: null, notes: [] } };
  it('prints nothing with no release or a healthy one', () => {
    expect(releaseDrift(EMPTY_STATE, [])).toEqual([]);
    expect(releaseDrift(withState({ release }), [card('Approval', 300)])).toEqual([]);
    expect(releaseDrift(withState({ release: { ...release, postId: 5, candidateSha: 'abc1234' }, pendingShip: 'bob' }), [card('Approval', 300)])).toEqual([]);
  });
  it('flags a candidate post of a commit the playtest did not pass', () => {
    expect(releaseDrift(withState({ release: { ...release, postId: 5, candidateSha: 'def5678' } }), [card('Approval', 300)])).toEqual(['candidate post of def5678 that the playtest did not pass']);
  });
  it('flags a missing tracking card', () => {
    expect(releaseDrift(withState({ release }), [])).toEqual(['release tracking card #300 missing']);
  });
  it('flags a pending ship with no current candidate post', () => {
    expect(releaseDrift(withState({ release, pendingShip: 'bob' }), [card('Approval', 300)])).toEqual(['pending ship but no current candidate post']);
    expect(releaseDrift(withState({ pendingShip: 'bob' }), [])).toEqual(['pending ship but no current candidate post']);
  });
});
