import { describe, expect, it } from 'vitest';
import { changedAgainstAll } from './diff-guard';

const section = (file: string, line: string): string => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-old\n+${line}\n`;

describe('changedAgainstAll', () => {
  it('keeps a file that differs from every approved side and drops one that only a side brought', () => {
    const fromMain = section('.github/ci.yml', 'release side') + section('game/a.ts', 'fix');
    const fromRelease = section('game/a.ts', 'fix') + section('factory/x.ts', 'main side');
    expect(changedAgainstAll([fromMain, fromRelease])).toBe(section('game/a.ts', 'fix'));
  });

  it('keeps the whole diff when one side is approved', () => {
    const diff = section('.github/ci.yml', 'x') + section('game/a.ts', 'y');
    expect(changedAgainstAll([diff])).toBe(diff);
  });

  it('keeps nothing from an empty diff', () => {
    expect(changedAgainstAll(['', section('game/a.ts', 'y')])).toBe('');
  });
});
