import { describe, expect, it } from 'vitest';
import { crashText, isForeignError, type CrashContext, type ErrorFacts } from './crash';

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

const context: CrashContext = { version: '0.12.3-abc1234', step: 'loading the map', userAgent: 'Mozilla/5.0 (iPhone) Brave', page: 'https://roam-game.online/dev/?seed=4#x' };

describe('crashText', () => {
  it('lists the message, then the stack, then the details', () => {
    const err = new Error('map fetch failed');
    err.stack = 'Error: map fetch failed\n    at fetchMap (index.js:1:2)';
    const text = crashText(err, null, context);
    expect(text.indexOf('map fetch failed')).toBe(0);
    expect(text.indexOf('at fetchMap')).toBeGreaterThan(0);
    expect(text.indexOf('Version: 0.12.3-abc1234')).toBeGreaterThan(text.indexOf('at fetchMap'));
  });

  it('names the source file, line and column when the event has them', () => {
    const facts: ErrorFacts = { error: null, message: 'boom', filename: 'https://roam-game.online/assets/index.js', lineno: 12, colno: 34 };
    expect(crashText('boom', facts, context)).toContain('Source: https://roam-game.online/assets/index.js:12:34');
  });

  it('gives the version, boot step, browser and page without its query or hash', () => {
    const text = crashText('boom', null, context);
    expect(text).toContain('Version: 0.12.3-abc1234');
    expect(text).toContain('Boot step: loading the map');
    expect(text).toContain('Browser: Mozilla/5.0 (iPhone) Brave');
    expect(text).toContain('Page: https://roam-game.online/dev/');
    expect(text).not.toContain('seed=4');
    expect(text).not.toContain('#x');
  });

  it('prints a reason that is not an Error as text', () => {
    expect(crashText('Script error.', null, context).startsWith('Script error.')).toBe(true);
    expect(crashText(undefined, null, context).startsWith('undefined')).toBe(true);
  });

  it('leaves out the source line when the event names no file', () => {
    expect(crashText('boom', { error: null, message: 'boom', filename: '', lineno: 0, colno: 0 }, context)).not.toContain('Source:');
  });
});
