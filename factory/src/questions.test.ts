import { describe, expect, it } from 'vitest';
import { askedAt, isAnswered } from './questions';
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
