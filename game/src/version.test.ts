import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAVE_FORMAT } from './three/save-migrations';
import { gameVersion } from './version';

const SHAPE = 'src/three/save-shape.json';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function newRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'roam-version-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  mkdirSync(join(dir, 'src/three'), { recursive: true });
  return dir;
}

function writeFormat(dir: string, format: string, raw = `{\n "format": "${format}",\n "shape": {}\n}\n`): void {
  writeFileSync(join(dir, SHAPE), raw);
}

function commit(dir: string, message: string): void {
  writeFileSync(join(dir, `note-${message}.txt`), message);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

function repoAt(format: string): string {
  const dir = newRepo();
  writeFormat(dir, format);
  commit(dir, 'format');
  return dir;
}

const head = (dir: string): string => git(dir, 'rev-parse', '--short', 'HEAD');

describe('gameVersion', () => {
  it('counts commits since the commit that brought in the format', () => {
    const dir = repoAt('2.2');
    expect(gameVersion(dir)).toBe(`2.2.0+${head(dir)}`);
    commit(dir, 'a');
    commit(dir, 'b');
    expect(gameVersion(dir)).toBe(`2.2.2+${head(dir)}`);
  });

  it('resets z when a commit raises the format', () => {
    const dir = repoAt('2.2');
    commit(dir, 'a');
    writeFormat(dir, '2.3');
    commit(dir, 'step');
    expect(gameVersion(dir)).toBe(`2.3.0+${head(dir)}`);
    commit(dir, 'b');
    expect(gameVersion(dir)).toBe(`2.3.1+${head(dir)}`);
  });

  it('ranks a merge above both parents', () => {
    const dir = repoAt('2.2');
    git(dir, 'checkout', '-q', '-b', 'side');
    commit(dir, 's1');
    commit(dir, 's2');
    const side = Number(gameVersion(dir).split('+')[0]!.split('.')[2]);
    git(dir, 'checkout', '-q', 'main');
    commit(dir, 'm1');
    const main = Number(gameVersion(dir).split('+')[0]!.split('.')[2]);
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge', 'side');
    const merged = Number(gameVersion(dir).split('+')[0]!.split('.')[2]);
    expect(merged).toBeGreaterThan(side);
    expect(merged).toBeGreaterThan(main);
  });

  it('finds a format that first appears in a merge', () => {
    const dir = repoAt('2.2');
    git(dir, 'checkout', '-q', '-b', 'side');
    writeFormat(dir, '2.3', '{\n "format": "2.3",\n "shape": {"side": 1}\n}\n');
    commit(dir, 'side step');
    git(dir, 'checkout', '-q', 'main');
    writeFormat(dir, '2.3', '{\n "format": "2.3",\n "shape": {"main": 1}\n}\n');
    commit(dir, 'main step');
    expect(() => git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'side')).toThrow();
    writeFormat(dir, '2.4', '{\n "format": "2.4",\n "shape": {"main": 1, "side": 1}\n}\n');
    commit(dir, 'merge');
    expect(gameVersion(dir)).toBe(`2.4.0+${head(dir)}`);
    commit(dir, 'a');
    expect(gameVersion(dir)).toBe(`2.4.1+${head(dir)}`);
  });

  it('keeps z when a commit rewrites the file with the same format', () => {
    const dir = repoAt('2.2');
    commit(dir, 'a');
    writeFileSync(join(dir, SHAPE), '{\n "format": "2.2",\n "shape": {"x": 1}\n}\n');
    commit(dir, 'same format');
    expect(gameVersion(dir)).toBe(`2.2.2+${head(dir)}`);
  });

  it('ignores uncommitted edits', () => {
    const dir = repoAt('2.2');
    commit(dir, 'a');
    writeFormat(dir, '2.3');
    expect(gameVersion(dir)).toBe(`2.2.1+${head(dir)}`);
  });

  it('throws on a shallow clone', () => {
    const dir = repoAt('2.2');
    commit(dir, 'a');
    const clone = mkdtempSync(join(tmpdir(), 'roam-version-clone-'));
    git(clone, 'clone', '-q', '--depth', '1', `file://${dir}`, 'c');
    expect(() => gameVersion(join(clone, 'c'))).toThrow(/shallow/);
  });

  it('throws when no commit brings in the format string', () => {
    const dir = newRepo();
    writeFormat(dir, '2.2', '{"format":"2.2"}');
    commit(dir, 'compact');
    expect(() => gameVersion(dir)).toThrow(/save:shape/);
  });

  it('matches the save format of the game', () => {
    expect(gameVersion(process.cwd())).toMatch(new RegExp(`^${SAVE_FORMAT.major}\\.${SAVE_FORMAT.minor}\\.\\d+\\+`));
  });
});
