import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAgentCheck } from './agent-check';
import { checkClone } from './clone-checks';
import { buildCheckBundle } from './container';
import { pngBytes } from './photo-fixtures';

let home = '';
let out = '';

const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: home, encoding: 'utf8' }).trim();

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = resolve(mkdtempSync('tmp/agent-check-'));
  out = join(home, '.factory');
  mkdirSync(out);
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'first');
});

// Writes a full passing round: approval, screenshot and manifest.
function capture(): void {
  writeFileSync(join(out, 'approval.json'), JSON.stringify({ description: 'Adds oil', howToTry: 'Drive on' }));
  writeFileSync(join(out, 'screenshot.png'), pngBytes(0));
  writeFileSync(join(out, 'evidence.json'), JSON.stringify({ images: [{ file: 'screenshot.png', description: 'Oil patch' }] }));
}

const lines = (args: string[]): { code: number; text: string } => {
  const printed: string[] = [];
  const code = runAgentCheck(args, home, (line) => printed.push(line));
  return { code, text: printed.join('\n') };
};

describe('runAgentCheck', () => {
  it('exits zero and names the checks it cannot run when the round is whole', () => {
    capture();
    const { code, text } = lines(['test']);
    expect(code).toBe(0);
    expect(text).toContain('Not checked here');
    expect(text).toContain('the typecheck, playtest and build');
  });

  it('passes after a later commit, since evidence is not tied to a commit', () => {
    capture();
    git('commit', '-q', '--allow-empty', '-m', 'later');
    expect(lines(['test']).code).toBe(0);
  });

  it('lists every failure in one run', () => {
    writeFileSync(join(out, 'evidence.json'), '{');
    const { code, text } = lines(['test']);
    expect(code).toBe(1);
    expect(text).toContain('Failed: The testing stage wrote no .factory/approval.json');
    expect(text).toContain('Failed: The testing agent wrote no .factory/screenshot.png. The post leaves out what it cannot show.');
    expect(text).toContain('2 checks failed');
  });

  it('reports an image the post would leave out', () => {
    capture();
    writeFileSync(join(out, 'evidence.json'), JSON.stringify({ images: [{ file: 'gone.png', description: 'x' }] }));
    expect(checkClone(home).failures.join(' ')).toContain('gone.png is left out');
  });

  it('guards the staged change: a protected path or a SAVE_MAJOR bump refuses the commit, other work passes', () => {
    writeFileSync(join(home, 'a.ts'), 'export const a = 1;\n');
    git('add', 'a.ts');
    expect(lines(['guard'])).toEqual({ code: 0, text: '' });
    mkdirSync(join(home, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(home, '.github', 'workflows', 'x.yml'), 'on: push\n');
    git('add', '.github');
    expect(lines(['guard'])).toEqual({ code: 1, text: expect.stringContaining('The factory refuses this commit: The branch touches paths an agent may not push: .github/workflows/x.yml') });
    git('rm', '-r', '-q', '--cached', '.github');
    mkdirSync(join(home, 'game', 'src', 'three'), { recursive: true });
    writeFileSync(join(home, 'game', 'src', 'three', 'save-migrations.ts'), 'export const SAVE_MAJOR = 9;\n');
    git('add', 'game');
    expect(lines(['guard']).text).toContain('bumps SAVE_MAJOR');
  });

  it('refuses a missing or unknown round', () => {
    expect(lines([]).code).toBe(2);
    expect(lines(['full']).code).toBe(2);
    expect(lines(['patch']).code).toBe(2);
    expect(lines(['test', 'test']).code).toBe(2);
  });
});

describe('the bundled command', () => {
  it('runs under plain node with the same messages as the factory code', async () => {
    const dir = await buildCheckBundle(join(home, 'factory-home'));
    const result = spawnSync('node', [join(dir, 'check.mjs'), 'test'], { cwd: home, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Failed: The testing stage wrote no .factory/approval.json');
    expect(result.stdout).toBe(`${lines(['test']).text}\n`);
  });
});
