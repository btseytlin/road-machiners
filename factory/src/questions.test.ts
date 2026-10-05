import { describe, expect, it } from 'vitest';
import { freshQuestions, isAnswered } from './questions';
import { FACTORY_MARK, QUESTIONS_HEADING } from './types';

const asked = { login: 'bot', body: `${QUESTIONS_HEADING}\n\n@anna\n\n1. What?\n\n${FACTORY_MARK}` };
const marked = { login: 'bot', body: `Triage passed.\n\n${FACTORY_MARK}` };

describe('isAnswered', () => {
  it('is false when nothing follows the questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'first' }, asked])).toBe(false);
  });

  it('is true when the author replies', () => {
    expect(isAnswered([asked, { login: 'anna', body: 'Like this' }])).toBe(true);
  });

  it('is true when anyone replies', () => {
    expect(isAnswered([asked, { login: 'stranger', body: 'I think so' }])).toBe(true);
  });

  it('ignores factory comments after the questions', () => {
    expect(isAnswered([asked, marked])).toBe(false);
  });

  it('ignores replies before the last questions', () => {
    expect(isAnswered([{ login: 'anna', body: 'old' }, asked, marked, asked])).toBe(false);
    expect(isAnswered([asked, { login: 'anna', body: 'old' }, asked])).toBe(false);
  });

  it('is false when the factory never asked', () => {
    expect(isAnswered([{ login: 'anna', body: 'hello' }, marked])).toBe(false);
  });

  it('does not take a member quoting the heading for the factory', () => {
    expect(isAnswered([{ login: 'anna', body: QUESTIONS_HEADING }])).toBe(false);
  });
});

describe('freshQuestions', () => {
  const answered = [{ login: 'bot', body: `${QUESTIONS_HEADING}\n\n@anna\n\n1. Should this wait for #242?\n2. Which horn?\n\n${FACTORY_MARK}` }, { login: 'anna', body: 'Yes, wait. The big one.' }];

  it('drops a repeated question the author answered, however it is cased or numbered', () => {
    expect(freshQuestions(answered, ['should this wait for #242', '1) WHICH HORN?', 'How loud?'], [])).toEqual(['How loud?']);
  });

  it('asks a question again when nobody answered it', () => {
    expect(freshQuestions([answered[0]], ['Which horn?'], [])).toEqual(['Which horn?']);
  });

  it('drops a question about waiting for a prerequisite the hold covers, and keeps other questions about it', () => {
    const questions = ['Do you want this to wait until #243 merges?', 'How should the radio from #243 sound?', 'Wait for #99?'];
    expect(freshQuestions([], questions, [242, 243])).toEqual(['How should the radio from #243 sound?', 'Wait for #99?']);
  });

  it('keeps genuine questions when no hold covers anything', () => {
    expect(freshQuestions([], ['Which horn?', 'Should it wait for #5?'], [])).toEqual(['Which horn?', 'Should it wait for #5?']);
  });
});
