import { describe, expect, it } from 'vitest';
import { resolve } from '../text/resolve';
import type { Msg } from '../text/msg';
import { BOOT_STEPS, BOOT_TEXT, BootProgress, type BootStep } from './boot-progress';

const en = (msg: Msg | null): string => (msg ? resolve(msg, 'en') : '');
const ru = (msg: Msg | null): string => (msg ? resolve(msg, 'ru') : '');

describe('BootProgress', () => {
  it('starts with the code step running and the rest waiting', () => {
    const p = new BootProgress();
    expect(p.state('code')).toBe('running');
    expect(BOOT_STEPS.slice(1).every((s) => p.state(s) === 'waiting')).toBe(true);
    expect(en(p.stageLine)).toBe(en(BOOT_TEXT.code));
    expect(p.finished).toBe(0);
    expect(p.total).toBe(9);
  });

  it('raises finished by one per finished step', () => {
    const p = new BootProgress();
    p.finish('code');
    p.start('map');
    expect(p.finished).toBe(1);
    p.finish('map');
    expect(p.finished).toBe(2);
  });

  it('shows counts in the stage line but not the live line', () => {
    const p = new BootProgress();
    p.finish('code');
    p.start('sounds');
    p.count('sounds', 31, 76);
    expect(en(p.stageLine)).toBe('Loading sounds 31 of 76');
    expect(en(p.liveLine)).toBe('Loading sounds');
    expect(ru(p.stageLine)).toBe('Загружаем звуки (31 из 76)');
  });

  it('joins running steps with a comma', () => {
    const p = new BootProgress();
    p.finish('code');
    p.start('map');
    p.start('physics');
    expect(en(p.stageLine)).toBe('Reading the map, Starting physics');
  });

  it('labels the world step on start', () => {
    const p = new BootProgress();
    p.finish('code');
    p.start('world', BOOT_TEXT.newGame);
    expect(en(p.stageLine)).toBe(en(BOOT_TEXT.newGame));
  });

  it('throws on misuse', () => {
    const p = new BootProgress();
    expect(() => p.start('nope' as BootStep)).toThrow('Unknown');
    expect(() => p.start('code')).toThrow('not waiting');
    expect(() => p.finish('map')).toThrow('not running');
    p.start('map');
    p.count('map', 2, 3);
    expect(() => p.count('map', 4, 3)).toThrow('counted 4 of 3');
    expect(() => p.count('map', 1, 3)).toThrow('fell');
    p.finish('map');
    expect(() => p.finish('map')).toThrow('not running');
  });

  it('freezes after a failure', () => {
    const p = new BootProgress();
    p.fail('code');
    expect(p.state('code')).toBe('failed');
    expect(p.failed).toBe(true);
    expect(() => p.start('map')).toThrow('failed');
    expect(() => p.finish('code')).toThrow('failed');
    expect(() => p.fail('code')).toThrow('failed');
  });
});
