import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runAgentCheck } from './agent-check';
import { checkClone } from './clone-checks';
import { buildCheckBundle } from './container';
import { pngBytes } from './photo-fixtures';

let home = '';
let out = '';

const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: home, encoding: 'utf8' }).trim();
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = resolve(mkdtempSync('tmp/agent-check-'));
  out = join(home, '.factory');
  mkdirSync(out);
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'first');
});

// Writes a full passing round at the current head: approval, screenshot, manifest and visual review.
function capture(): void {
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(out, 'approval.json'), JSON.stringify({ description: 'Adds oil', howToTry: 'Drive on' }));
  writeFileSync(join(out, 'screenshot.png'), pngBytes(0));
  writeFileSync(join(out, 'evidence.json'), JSON.stringify({ commit: head, features: [{ name: 'Oil', kind: 'item' }], images: [{ file: 'screenshot.png', description: 'Oil patch', covers: ['Oil'], sheet: false }] }));
  writeFileSync(join(out, 'visual-review.json'), JSON.stringify({
    commit: head, visual: true, repairs: 0,
    images: [{ file: 'screenshot.png', sha256: sha(join(out, 'screenshot.png')), observations: 'Oil lies behind the rear axle as a spill.', verdict: 'correct' }],
    decisions: [{ feature: 'Oil', verdict: 'correct', notes: 'It trails the truck as the issue asks.' }],
    mismatches: [],
  }));
}

const lines = (args: string[]): { code: number; text: string } => {
  const printed: string[] = [];
  const code = runAgentCheck(args, home, (line) => printed.push(line));
  return { code, text: printed.join('\n') };
};

describe('runAgentCheck', () => {
  it('exits zero and names the checks it cannot run when the evidence is whole', () => {
    capture();
    const { code, text } = lines(['test']);
    expect(code).toBe(0);
    expect(text).toContain('Not checked here');
    expect(text).toContain('the fresh-clone tests');
  });

  it('prints the stale evidence message after a commit that follows the capture', () => {
    capture();
    git('commit', '-q', '--allow-empty', '-m', 'later');
    const { code, text } = lines(['test']);
    expect(code).toBe(1);
    expect(text).toMatch(/Failed: \.factory\/evidence\.json is from commit [0-9a-f]{40}, the final branch is at [0-9a-f]{40}/);
    expect(text).toContain('Failed: .factory/visual-review.json is from commit');
  });

  it('lists every failure in one run', () => {
    const { code, text } = lines(['test']);
    expect(code).toBe(1);
    expect(text).toContain('Failed: The testing stage wrote no .factory/approval.json');
    expect(text).toContain('2 checks failed');
  });

  it('reports a missing screenshot and a missing visual review', () => {
    capture();
    rmSync(join(out, 'screenshot.png'));
    expect(lines(['test']).text).toContain('Failed: The testing stage wrote no .factory/screenshot.png');
    capture();
    rmSync(join(out, 'visual-review.json'));
    expect(lines(['test']).text).toContain('Failed: The testing stage wrote no .factory/visual-review.json');
  });

  it('checks only the approval for a waived round and skips the review for a patch', () => {
    capture();
    git('commit', '-q', '--allow-empty', '-m', 'later');
    expect(lines(['waived']).code).toBe(0);
    expect(lines(['patch']).text).toContain('evidence.json is from commit');
    expect(lines(['patch']).text).not.toContain('visual-review.json');
  });

  it('refuses a missing or unknown round', () => {
    expect(lines([]).code).toBe(2);
    expect(lines(['full']).code).toBe(2);
    expect(lines(['test', 'patch']).code).toBe(2);
  });

  it('notes a valid send-back as no failure', () => {
    capture();
    const path = join(out, 'visual-review.json');
    const review = JSON.parse(readFileSync(path, 'utf8'));
    review.decisions[0].verdict = 'wrong';
    review.mismatches = [{ description: 'The oil is a perfect circle', scope: 'rebuild' }];
    writeFileSync(path, JSON.stringify(review));
    const report = checkClone(home, git('rev-parse', 'HEAD'), 'test');
    expect(report.failures).toEqual([]);
    expect(report.notes.join(' ')).toContain('sends the card back to implementation');
  });
});

describe('the bundled command', () => {
  it('runs under plain node with the same messages as the factory code', async () => {
    capture();
    git('commit', '-q', '--allow-empty', '-m', 'later');
    const dir = await buildCheckBundle(join(home, 'factory-home'));
    const result = spawnSync('node', [join(dir, 'check.mjs'), 'test'], { cwd: home, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Failed: .factory/evidence.json is from commit');
    expect(result.stdout).toBe(`${lines(['test']).text}\n`);
  });
});
