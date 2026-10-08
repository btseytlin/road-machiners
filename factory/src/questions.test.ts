import { describe, expect, it } from 'vitest';
import { askedAt, isAnswered, operationsQuestions } from './questions';
import { FACTORY_MARK, QUESTIONS_HEADING } from './types';

const T0 = '2026-10-01T00:00:00Z';
const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n@anna\n\n1. What?\n\n${FACTORY_MARK}`, createdAt: T0 };
const marked = { login: 'bot', body: `Triage passed.\n\n${FACTORY_MARK}`, createdAt: T0 };

describe('isAnswered', () => {
  it('is false when nothing follows the questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'first', createdAt: T0 }, asked])).toBe(false);
  });

  it('is true when the author replies', () => {
    expect(isAnswered([asked, { login: 'anna', body: 'Like this', createdAt: T0 }])).toBe(true);
  });

  it('is true when anyone replies', () => {
    expect(isAnswered([asked, { login: 'stranger', body: 'I think so', createdAt: T0 }])).toBe(true);
  });

  it('ignores factory comments after the questions', () => {
    expect(isAnswered([asked, marked])).toBe(false);
  });

  it('ignores replies before the last questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'old', createdAt: T0 }, asked, marked, asked])).toBe(false);
    expect(isAnswered([asked, { login: 'anna', body: 'old', createdAt: T0 }, asked])).toBe(false);
  });

  it('is false when the factory never asked', () => {
    expect(isAnswered([{ login: 'anna', body: 'hello', createdAt: T0 }, marked])).toBe(false);
  });

  it('does not take a member quoting the heading for the factory', () => {
    expect(isAnswered([{ login: 'anna', body: QUESTIONS_HEADING, createdAt: T0 }])).toBe(false);
  });
});

describe('askedAt', () => {
  it('gives the time of the last questions', () => {
    const later = { ...asked, createdAt: '2026-10-02T00:00:00Z' };
    expect(askedAt([asked, { login: 'anna', body: 'old', createdAt: T0 }, later])).toBe('2026-10-02T00:00:00Z');
  });

  it('is null when the factory never asked', () => {
    expect(askedAt([{ login: 'anna', body: QUESTIONS_HEADING, createdAt: T0 }])).toBeNull();
  });
});

describe('operationsQuestions', () => {
  it.each([
    'Should the factory update the stale work clone and branch to dev so it can see the prerequisites #242 and #243?',
    'Can you rebase factory/issue-253 onto origin/dev first?',
    'Should I cherry-pick the fix from the release branch?',
    'Is it fine to wait until #242 is merged before this starts?',
    'Does this depend on #243 landing first?',
    'The test suite fails on main, should I skip it?',
    'Should I merge this into the dev branch or open a pull request?',
    'npm run typecheck fails in the work clone, what should I do?',
    'Should the checkout use `main`?',
  ])('flags a factory operations question: %s', (question) => {
    expect(operationsQuestions([question])).toEqual([question]);
  });

  it.each([
    'Should the horn sound when the truck brakes, or only when the player presses H?',
    'Should the side road merge into the main road?',
    'Should building a garage cost scrap or fuel?',
    'Can the player test drive a truck before buying it?',
    'Which branch of the dialogue should the trader open with?',
    'Should the map look like the one in #242?',
    'How many shells should the MG hold?',
    'Should the parts shop sell a clone of the player truck?',
  ])('passes a product question: %s', (question) => {
    expect(operationsQuestions([question])).toEqual([]);
  });

  it('returns only the operations questions of a mixed set', () => {
    expect(operationsQuestions(['How loud is the horn?', 'Should I rebase first?'])).toEqual(['Should I rebase first?']);
  });
});
