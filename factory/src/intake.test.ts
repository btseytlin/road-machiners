import { describe, expect, it } from 'vitest';
import { intake, isMarked } from './intake';
import type { Ctx, Issue } from './types';

const NOW = new Date('2026-01-10T12:00:00Z');
const RULES = { minVotes: 3, minAgeHours: 24, committee: ['boss'] };

function issue(over: Partial<Issue>): Issue {
  return { number: 1, title: 't', body: '', labels: [], createdAt: '2026-01-01T00:00:00Z', state: 'OPEN', author: 'anna', thumbsUp: [], ...over };
}

describe('isMarked', () => {
  it('rejects an issue younger than the minimum age', () => {
    expect(isMarked(issue({ createdAt: '2026-01-10T00:00:00Z', thumbsUp: ['a', 'b', 'c', 'boss'] }), NOW, RULES)).toBe(false);
  });

  it('accepts enough votes', () => {
    expect(isMarked(issue({ thumbsUp: ['a', 'b', 'c'] }), NOW, RULES)).toBe(true);
  });

  it('accepts one committee vote', () => {
    expect(isMarked(issue({ thumbsUp: ['boss'] }), NOW, RULES)).toBe(true);
  });

  it('rejects too few votes and no committee vote', () => {
    expect(isMarked(issue({ thumbsUp: ['a', 'b'] }), NOW, RULES)).toBe(false);
  });
});

describe('intake', () => {
  it('puts a marked issue in Triage and says so', async () => {
    const calls: string[] = [];
    const ctx = {
      cfg: { home: 'tmp/factory-intake-none', minVotes: 3, minAgeHours: 24, committeeBootstrapTelegram: '1', committeeBootstrapGithub: 'boss' },
      now: () => NOW,
      log: () => undefined,
      github: {
        cards: async () => [],
        candidates: async () => [issue({ number: 4, thumbsUp: ['boss'] }), issue({ number: 5 })],
        addCard: async (n: number, column: string) => { calls.push(`addCard ${n} ${column}`); },
        comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      },
    } as unknown as Ctx;
    expect(await intake(ctx)).toEqual([4]);
    expect(calls).toEqual(['addCard 4 Triage', 'comment 4 The factory picked this up for triage.']);
  });

  it('puts a fresh error report with no votes into Triage, not Design', async () => {
    const calls: string[] = [];
    const ctx = {
      cfg: { home: 'tmp/factory-intake-none', minVotes: 3, minAgeHours: 24, committeeBootstrapTelegram: '1', committeeBootstrapGithub: 'boss' },
      now: () => NOW,
      log: () => undefined,
      github: {
        cards: async () => [],
        candidates: async () => [issue({ number: 8, labels: ['bug', 'error-report'], createdAt: NOW.toISOString() }), issue({ number: 9, labels: ['bug'], createdAt: NOW.toISOString() })],
        addCard: async (n: number, column: string) => { calls.push(`addCard ${n} ${column}`); },
        comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      },
    } as unknown as Ctx;
    expect(await intake(ctx)).toEqual([8]);
    expect(calls).toEqual(['addCard 8 Triage', 'comment 8 The factory picked this up for triage.']);
  });

  it('puts a fresh hotfix with no votes straight into Design', async () => {
    const calls: string[] = [];
    let asked: string[] = [];
    const ctx = {
      cfg: { home: 'tmp/factory-intake-none', minVotes: 3, minAgeHours: 24, committeeBootstrapTelegram: '1', committeeBootstrapGithub: 'boss' },
      now: () => NOW,
      log: () => undefined,
      github: {
        cards: async () => [],
        candidates: async (labels: string[]) => { asked = labels; return [issue({ number: 6, labels: ['bug', 'hotfix'], createdAt: NOW.toISOString() })]; },
        addCard: async (n: number, column: string) => { calls.push(`addCard ${n} ${column}`); },
        comment: async (n: number, body: string) => { calls.push(`comment ${n} ${body}`); },
      },
    } as unknown as Ctx;
    expect(await intake(ctx)).toEqual([6]);
    expect(asked).toContain('hotfix');
    expect(calls).toEqual(['addCard 6 Design', 'comment 6 The factory picked this up as a hotfix. It goes to design now.']);
  });
});
