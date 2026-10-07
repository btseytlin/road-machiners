import { describe, expect, it } from 'vitest';
import { isForeignError, type ErrorFacts } from './crash';

const PAGE = 'https://roam-game.online';
const muted: ErrorFacts = { error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0 };

describe('isForeignError', () => {
  it('treats the browser\'s muted error event as foreign', () => {
    expect(isForeignError(muted, PAGE)).toBe(true);
  });

  it('accepts the muted message without its period and in any case', () => {
    expect(isForeignError({ ...muted, message: 'Script error' }, PAGE)).toBe(true);
    expect(isForeignError({ ...muted, message: 'script error.' }, PAGE)).toBe(true);
  });

  it('treats a muted error from another origin as foreign', () => {
    expect(isForeignError({ ...muted, filename: 'https://cdn.example.com/inject.js' }, PAGE)).toBe(true);
  });

  it('keeps a muted message from a page file as the game\'s own', () => {
    expect(isForeignError({ ...muted, filename: `${PAGE}/assets/index.js` }, PAGE)).toBe(false);
  });

  it('keeps an event that carries an error object as the game\'s own', () => {
    expect(isForeignError({ ...muted, error: new Error('Script error.') }, PAGE)).toBe(false);
  });

  it('never guesses from any other message text', () => {
    expect(isForeignError({ ...muted, message: 'Uncaught TypeError: x' }, PAGE)).toBe(false);
  });
});
