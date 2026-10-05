import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liftEndedPause, pauseFile, pausedReason, pausePid, pidAlive } from './pause';

let home = '';
beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-pause-');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('pausedReason', () => {
  it('is null without the pause file', () => {
    expect(pausedReason(home)).toBeNull();
  });

  it('gives the text of the pause file, or a stand-in for an empty file', () => {
    writeFileSync(pauseFile(home), 'Hermes repairs #4\n');
    expect(pausedReason(home)).toBe('Hermes repairs #4');
    writeFileSync(pauseFile(home), '');
    expect(pausedReason(home)).toBe('no reason given');
  });
});

describe('pausePid', () => {
  it('reads the pid line, or null without one', () => {
    expect(pausePid('Hermes runs checks for #4\npid: 1234')).toBe(1234);
    expect(pausePid('Hermes repairs #4')).toBeNull();
  });

  it('fails loud on a pid line without a valid process id', () => {
    expect(() => pausePid('Hermes runs checks\npid: soon')).toThrow('no valid process');
  });
});

describe('pidAlive', () => {
  it('sees this process alive and a pid past the system limit as ended', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 1)).toBe(false);
  });
});

describe('liftEndedPause', () => {
  it('removes a pause whose process ended and gives its text', () => {
    writeFileSync(pauseFile(home), 'Hermes runs checks for #4\npid: 1234\n');
    expect(liftEndedPause(home, () => false)).toBe('Hermes runs checks for #4\npid: 1234');
    expect(existsSync(pauseFile(home))).toBe(false);
  });

  it('keeps a pause whose process still runs', () => {
    writeFileSync(pauseFile(home), 'Hermes runs checks for #4\npid: 1234\n');
    expect(liftEndedPause(home, () => true)).toBeNull();
    expect(existsSync(pauseFile(home))).toBe(true);
  });

  it('keeps a pause that names no process', () => {
    writeFileSync(pauseFile(home), 'Hermes repairs #4\n');
    expect(liftEndedPause(home, () => false)).toBeNull();
    expect(existsSync(pauseFile(home))).toBe(true);
  });
});
