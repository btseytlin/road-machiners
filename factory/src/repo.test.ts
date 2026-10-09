import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { must, realRun } from './exec';
import { hostRepo } from './repo';
import { MergeConflictError, RevertConflictError, type FactoryConfig, type Run } from './types';

vi.setConfig({ testTimeout: 30_000 });

const cfg = (home: string): FactoryConfig => ({ home, repo: 'o/r' }) as FactoryConfig;

function tmpHome(): string {
  mkdirSync('tmp', { recursive: true });
  return resolve(mkdtempSync(join('tmp', 'factory-repo-')));
}

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

async function setup() {
  const home = tmpHome();
  const origin = join(home, 'origin.git');
  const author = join(home, 'author');
  const repo = hostRepo(realRun, cfg(home));
  const gitAt = async (cwd: string, ...a: string[]) => must(await realRun('git', [...ID, ...a], { cwd }), `git ${a.join(' ')}`);
  const hub = (...a: string[]) => gitAt(origin, ...a);
  const host = (...a: string[]) => gitAt(repo.path, ...a);
  const by = (...a: string[]) => gitAt(author, ...a);
  mkdirSync(origin);
  await hub('init', '--bare', '-b', 'main');
  await gitAt(home, 'clone', origin, author);
  writeFileSync(join(author, 'f.txt'), 'base\n');
  writeFileSync(join(author, 'g.txt'), 'g\n');
  await by('add', '.');
  await by('commit', '-m', 'base');
  await by('push', 'origin', 'HEAD:main', 'HEAD:dev');
  await gitAt(home, 'clone', origin, repo.path);
  await repo.fetch();
  const commit = async (branch: string, file: string, text: string, from = 'dev') => {
    await by('fetch', '--prune', 'origin');
    const exists = (await realRun('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd: author })).code === 0;
    await by('checkout', '-B', branch, exists ? `origin/${branch}` : `origin/${from}`);
    writeFileSync(join(author, file), text);
    await by('commit', '-am', `${branch} changes ${file}`);
    await by('push', 'origin', branch);
  };
  const feature = async (issue: number, file: string, text: string, into = 'dev') => {
    await commit(`factory/issue-${issue}`, file, text, into);
    await repo.fetch();
    await repo.merge([{ branch: `factory/issue-${issue}`, into, message: `Merge issue #${issue}: title ${issue}` }]);
  };
  const show = async (branch: string, file: string) => hub('show', `${branch}:${file}`);
  const head = async (branch: string) => (await hub('rev-parse', branch)).trim();
  return { home, origin, repo, hub, host, by, commit, feature, show, head };
}

describe('hostRepo', () => {
  it('turns hooks off on every git call', async () => {
    const calls: string[][] = [];
    const run: Run = async (_cmd, args) => { calls.push(args); return { code: args.includes('--verify') ? 1 : 0, stdout: 'a.ts\n', stderr: '' }; };
    const repo = hostRepo(run, cfg(tmpHome()));
    await repo.fetch();
    await repo.push('c', 'b');
    await repo.headHash('b');
    await repo.diff('dev', 'b');
    await repo.hasNewCommits('dev', 'b');
    await repo.fetchFromWork('/w', 'b');
    await repo.mergeLog('dev', 'main');
    await repo.merge([{ branch: 'b', into: 'dev', message: 'msg' }]);
    await repo.createBranch('r', 'dev');
    await repo.revertIssueMerge(3, 'r');
    await repo.deleteBranch('b');
    expect(calls.length).toBeGreaterThan(15);
    for (const args of calls) expect(args.slice(0, 2)).toEqual(['-c', 'core.hooksPath=/dev/null']);
  });
});

describe('merging on GitHub', () => {
  it('merges into GitHub, and the host keeps no branch and no worktree', async () => {
    const { home, host, feature, show } = await setup();
    await feature(3, 'f.txt', 'three\n');
    expect(await show('dev', 'f.txt')).toBe('three\n');
    expect(await show('main', 'f.txt')).toBe('base\n');
    expect((await host('for-each-ref', 'refs/heads')).trim()).toBe('');
    expect(existsSync(join(home, 'work', 'land'))).toBe(false);
    expect((await host('worktree', 'list')).trim().split('\n')).toHaveLength(1);
  });

  it('throws a conflict with its files and leaves GitHub as it was', async () => {
    const { repo, commit, head } = await setup();
    await commit('factory/issue-4', 'f.txt', 'four\n');
    await commit('dev', 'f.txt', 'dev moved\n');
    await repo.fetch();
    const before = await head('dev');
    const error = await repo.merge([{ branch: 'factory/issue-4', into: 'dev', message: 'Merge issue #4: t' }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MergeConflictError);
    expect((error as MergeConflictError).files).toEqual(['f.txt']);
    expect(await head('dev')).toBe(before);
  });

  it('merges again on the new tip when GitHub moved since the fetch, and keeps nothing of the first try', async () => {
    const { repo, host, commit, show } = await setup();
    await commit('factory/issue-5', 'f.txt', 'five\n');
    await repo.fetch();
    await commit('dev', 'g.txt', 'moved on GitHub\n');
    await repo.merge([{ branch: 'factory/issue-5', into: 'dev', message: 'Merge issue #5: t' }]);
    expect(await show('dev', 'f.txt')).toBe('five\n');
    expect(await show('dev', 'g.txt')).toBe('moved on GitHub\n');
    expect((await host('for-each-ref', 'refs/heads')).trim()).toBe('');
  });

  it('throws a conflict with the new tip when GitHub moved into one', async () => {
    const { repo, commit, show } = await setup();
    await commit('factory/issue-5', 'f.txt', 'five\n');
    await repo.fetch();
    await commit('dev', 'f.txt', 'dev moved\n');
    await expect(repo.merge([{ branch: 'factory/issue-5', into: 'dev', message: 'Merge issue #5: t' }])).rejects.toBeInstanceOf(MergeConflictError);
    expect(await show('dev', 'f.txt')).toBe('dev moved\n');
  });

  it('merges each step into the result of the steps before, in one push', async () => {
    const { repo, commit, show } = await setup();
    await commit('factory/issue-6', 'f.txt', 'fix\n', 'main');
    await repo.fetch();
    await repo.merge([
      { branch: 'factory/issue-6', into: 'main', message: 'Hotfix #6: t' },
      { branch: 'main', into: 'dev', message: 'Merge main into dev after hotfix #6' },
    ]);
    expect(await show('main', 'f.txt')).toBe('fix\n');
    expect(await show('dev', 'f.txt')).toBe('fix\n');
  });

  it('moves no branch when GitHub rejects one of them', async () => {
    const { origin, repo, commit, head } = await setup();
    await commit('factory/issue-6', 'f.txt', 'fix\n', 'main');
    await repo.fetch();
    const hook = join(origin, 'hooks', 'update');
    writeFileSync(hook, '#!/bin/sh\n[ "$1" != refs/heads/dev ]\n', { mode: 0o755 });
    const [main, dev] = [await head('main'), await head('dev')];
    await expect(repo.merge([
      { branch: 'factory/issue-6', into: 'main', message: 'Hotfix #6: t' },
      { branch: 'main', into: 'dev', message: 'Merge main into dev after hotfix #6' },
    ])).rejects.toThrow('push of main, dev failed');
    expect([await head('main'), await head('dev')]).toEqual([main, dev]);
  });

  it('drops a stale local branch on fetch, so an unpushed merge never reaches a later job', async () => {
    const { repo, host, head } = await setup();
    await host('checkout', '-b', 'main', 'origin/main');
    writeFileSync(join(repo.path, 'f.txt'), 'never pushed\n');
    await host('commit', '-am', 'local only');
    await repo.fetch();
    expect((await host('for-each-ref', 'refs/heads')).trim()).toBe('');
    expect(await repo.headHash('main')).toBe((await head('main')).slice(0, 7));
  });

  it('creates a branch on GitHub and refuses one that exists', async () => {
    const { repo, head } = await setup();
    await repo.createBranch('release/x', 'dev');
    expect(await head('release/x')).toBe(await head('dev'));
    await expect(repo.createBranch('release/x', 'dev')).rejects.toThrow('exists on GitHub');
  });

  it('deletes a branch on GitHub and does nothing when it is gone', async () => {
    const { repo, commit, hub } = await setup();
    await commit('factory/issue-7', 'f.txt', 'seven\n');
    await repo.deleteBranch('factory/issue-7');
    expect((await hub('branch', '--list', 'factory/issue-7')).trim()).toBe('');
    await expect(repo.deleteBranch('factory/issue-7')).resolves.toBeUndefined();
  });

  it('reads the merge log and changed files from GitHub', async () => {
    const { repo, feature } = await setup();
    await feature(3, 'f.txt', 'three\n');
    expect(await repo.mergeLog('dev', 'main')).toEqual(['Merge issue #3: title 3']);
    expect(await repo.changedFiles('main', 'dev')).toEqual(['f.txt']);
    expect(await repo.isMerged('main', 'dev')).toBe(true);
    expect(await repo.hasNewCommits('main', 'dev')).toBe(true);
  });

  it('lists both paths of a moved file', async () => {
    const { repo, by } = await setup();
    await by('checkout', '-B', 'dev', 'origin/dev');
    await by('mv', 'g.txt', 'moved.txt');
    await by('commit', '-m', 'move g');
    await by('push', 'origin', 'dev');
    await repo.fetch();
    expect((await repo.changedFiles('main', 'dev')).sort()).toEqual(['g.txt', 'moved.txt']);
  });
});

describe('reverting an issue merge', () => {
  it('reverts the merge on the branch that has it, pushes it, and leaves the other branch alone', async () => {
    const { repo, feature, show } = await setup();
    await feature(3, 'f.txt', 'three\n');
    await feature(4, 'g.txt', 'four\n');
    await repo.createBranch('release/x', 'dev');
    expect(await repo.revertIssueMerge(3, 'release/x')).toBe(true);
    expect(await show('release/x', 'f.txt')).toBe('base\n');
    expect(await show('release/x', 'g.txt')).toBe('four\n');
    expect(await show('dev', 'f.txt')).toBe('three\n');
  });

  it('matches the issue number exactly and answers false for a merge the branch lacks', async () => {
    const { repo, feature, show } = await setup();
    await feature(12, 'f.txt', 'twelve\n');
    expect(await repo.revertIssueMerge(1, 'dev')).toBe(false);
    expect(await repo.revertIssueMerge(99, 'dev')).toBe(false);
    expect(await show('dev', 'f.txt')).toBe('twelve\n');
  });

  it('throws on a conflicting revert and leaves GitHub as it was', async () => {
    const { repo, feature, head } = await setup();
    await feature(3, 'f.txt', 'three\n');
    await feature(4, 'f.txt', 'four\n');
    const before = await head('dev');
    await expect(repo.revertIssueMerge(3, 'dev')).rejects.toThrow('Conflicting files: f.txt');
    expect(await head('dev')).toBe(before);
  });

  it('skips a merge that the branch already reverted, so a retried removal finishes the other branch', async () => {
    const { repo, feature, show, head } = await setup();
    await feature(3, 'f.txt', 'three\n');
    await repo.createBranch('release/x', 'dev');
    expect(await repo.revertIssueMerge(3, 'release/x')).toBe(true);
    const reverted = await head('release/x');
    expect(await repo.revertIssueMerge(3, 'release/x')).toBe(false);
    expect(await head('release/x')).toBe(reverted);
    expect(await repo.revertIssueMerge(3, 'dev')).toBe(true);
    expect(await show('dev', 'f.txt')).toBe('base\n');
  });

  it('reverts a merge that came back after an earlier revert', async () => {
    const { repo, feature, show } = await setup();
    await feature(3, 'f.txt', 'three\n');
    expect(await repo.revertIssueMerge(3, 'dev')).toBe(true);
    await repo.deleteBranch('factory/issue-3');
    await feature(3, 'f.txt', 'three again\n');
    expect(await repo.revertIssueMerge(3, 'dev')).toBe(true);
    expect(await show('dev', 'f.txt')).toBe('base\n');
  });
});

describe('work clones', () => {
  const git = async (cwd: string, ...a: string[]) => must(await realRun('git', [...ID, ...a], { cwd }), `git ${a.join(' ')}`);

  it('waits for the clone lock of an issue clone before it prepares the clone', async () => {
    const { home, repo } = await setup();
    const work = join(home, 'work', 'issue-8');
    const lock = join(home, 'locks', 'issue-8');
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, 'owner'), String(process.pid));
    const done = repo.prepareWorkClone('factory/issue-8', 'dev', work).then(() => 'done');
    expect(await Promise.race([done, new Promise((resolve) => setTimeout(() => resolve('waiting'), 400))])).toBe('waiting');
    expect(existsSync(work)).toBe(false);
    rmSync(lock, { recursive: true });
    await done;
    expect(existsSync(join(work, '.git'))).toBe(true);
  });

  it('starts a new branch from the base, and fetches work without pushing it until asked', async () => {
    const { home, repo, show, head } = await setup();
    const work = join(home, 'work', 'issue-8');
    await repo.prepareWorkClone('factory/issue-8', 'dev', work);
    expect((await git(work, 'rev-parse', 'HEAD')).trim()).toBe(await head('dev'));
    writeFileSync(join(work, 'f.txt'), 'eight\n');
    await git(work, 'commit', '-am', 'work on 8');
    const commit = await repo.fetchFromWork(work, 'factory/issue-8');
    expect(commit).toBe((await git(work, 'rev-parse', 'HEAD')).trim());
    expect(await repo.diff('dev', commit)).toContain('+eight');
    expect(await repo.isMerged(commit, 'dev')).toBe(false);
    await expect(show('factory/issue-8', 'f.txt')).rejects.toThrow();
    await repo.push(commit, 'factory/issue-8');
    expect(await show('factory/issue-8', 'f.txt')).toBe('eight\n');
    expect(await repo.isMerged(commit, 'factory/issue-8')).toBe(true);
  });

  it('merges an issue branch into a work clone with its feature message and never fast-forwards', async () => {
    const { home, repo, commit } = await setup();
    await commit('factory/issue-12', 'f.txt', 'twelve\n');
    await repo.fetch();
    const work = join(home, 'work', 'merge-queue');
    await repo.prepareWorkClone('dev', 'dev', work);
    expect(await repo.mergeBranchIntoWork(work, 'factory/issue-12', 'Merge issue #12: Horn')).toMatchObject({ conflicts: [] });
    expect((await git(work, 'log', '-1', '--format=%P')).trim().split(' ')).toHaveLength(2);
    expect((await git(work, 'log', '-1', '--format=%s')).trim()).toBe('Merge issue #12: Horn');
  });

  describe('catching a work clone up to its base', () => {
    const tip = async (dir: string) => (await git(dir, 'rev-parse', 'HEAD')).trim();
    const staleClone = async (issue: number) => {
      const env = await setup();
      const work = join(env.home, 'work', `issue-${issue}`);
      await env.repo.prepareWorkClone(`factory/issue-${issue}`, 'dev', work);
      mkdirSync(join(work, 'game', '.factory-tasks'), { recursive: true });
      writeFileSync(join(work, 'game', '.factory-tasks', `issue-${issue}.md`), '# plan\n');
      await env.feature(242, 'g.txt', 'prerequisite\n');
      await env.repo.fetch();
      return { ...env, work };
    };

    it('fast-forwards a stale clean clone onto the base with no issue branch on GitHub, and keeps the task file', async () => {
      const { repo, work, head } = await staleClone(253);
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: [], kept: null });
      expect(await tip(work)).toBe(await head('dev'));
      expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe('prerequisite\n');
      expect(readFileSync(join(work, 'game', '.factory-tasks', 'issue-253.md'), 'utf8')).toBe('# plan\n');
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: null, conflicts: [], kept: null });
    });

    it('keeps unpushed commits under a merge of the base', async () => {
      const { repo, work } = await staleClone(254);
      writeFileSync(join(work, 'f.txt'), 'unpushed\n');
      await git(work, 'commit', '-am', 'unpushed work');
      const own = await tip(work);
      expect(await repo.catchUpBase(work, 'dev')).toMatchObject({ conflicts: [], kept: null });
      expect((await realRun('git', ['merge-base', '--is-ancestor', own, 'HEAD'], { cwd: work })).code).toBe(0);
      expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('unpushed\n');
      expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe('prerequisite\n');
    });

    it('keeps a clone with uncommitted changes exactly as it is', async () => {
      const { repo, work } = await staleClone(255);
      writeFileSync(join(work, 'f.txt'), 'dirty\n');
      const before = await tip(work);
      expect((await repo.catchUpBase(work, 'dev')).kept).toContain('f.txt');
      expect(await tip(work)).toBe(before);
      expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('dirty\n');
      expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe('g\n');
    });

    it('keeps the clone when an untracked file blocks the merge', async () => {
      const { repo, work, home, by } = await staleClone(256);
      await by('fetch', '--prune', 'origin');
      await by('checkout', '-B', 'dev', 'origin/dev');
      writeFileSync(join(home, 'author', 'new.txt'), 'from dev\n');
      await by('add', 'new.txt');
      await by('commit', '-m', 'dev adds new.txt');
      await by('push', 'origin', 'dev');
      await repo.fetch();
      writeFileSync(join(work, 'new.txt'), 'local scratch\n');
      const before = await tip(work);
      expect((await repo.catchUpBase(work, 'dev')).kept).toContain('new.txt');
      expect(await tip(work)).toBe(before);
      expect(readFileSync(join(work, 'new.txt'), 'utf8')).toBe('local scratch\n');
    });

    it('refuses a clone with an open conflicted merge of other work and touches nothing', async () => {
      const { repo, work, commit } = await staleClone(257);
      await commit('factory/issue-999', 'g.txt', 'other\n');
      await repo.fetch();
      writeFileSync(join(work, 'g.txt'), 'mine\n');
      await git(work, 'commit', '-am', 'mine');
      await git(work, 'fetch', '--quiet', 'origin');
      expect((await realRun('git', [...ID, 'merge', 'origin/factory/issue-999'], { cwd: work })).code).not.toBe(0);
      const before = readFileSync(join(work, 'g.txt'), 'utf8');
      await expect(repo.catchUpBase(work, 'dev')).rejects.toThrow(/unfinished merge or conflicts \(MERGE_HEAD, g\.txt\)/);
      expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe(before);
    });

    it('leaves a real conflict with the base open for the agent and names its files', async () => {
      const { repo, work, head } = await staleClone(258);
      writeFileSync(join(work, 'g.txt'), 'mine\n');
      await git(work, 'commit', '-am', 'mine');
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: ['g.txt'], kept: null });
      expect((await realRun('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: work })).code).toBe(0);
    });

    it('hands its own unfinished base merge back for another round instead of refusing it', async () => {
      const { repo, work, head } = await staleClone(259);
      writeFileSync(join(work, 'g.txt'), 'mine\n');
      await git(work, 'commit', '-am', 'mine');
      await repo.catchUpBase(work, 'dev');
      const before = readFileSync(join(work, 'g.txt'), 'utf8');
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: ['g.txt'], kept: null });
      expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe(before);
      writeFileSync(join(work, 'g.txt'), 'both\n');
      await git(work, 'add', 'g.txt');
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: ['g.txt'], kept: null });
    });

    it('lets the issue branch catch-up pass an open base merge when the branch did not move, so the stage reaches it', async () => {
      const { repo, work, head } = await staleClone(260);
      writeFileSync(join(work, 'g.txt'), 'mine\n');
      await git(work, 'commit', '-am', 'mine');
      await git(work, 'push', '--quiet', 'origin', 'HEAD:factory/issue-260');
      await repo.catchUpBase(work, 'dev');
      expect(await repo.mergeBranchIntoWork(work, 'factory/issue-260')).toEqual({ commit: null, conflicts: [] });
      expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: ['g.txt'], kept: null });
    });
  });

  it('gives a new and an existing work clone the guard as an executable pre-commit hook that passes on the host', async () => {
    const { home, repo } = await setup();
    const work = join(home, 'work', 'issue-9');
    await repo.prepareWorkClone('factory/issue-9', 'dev', work);
    const hook = join(work, '.git', 'hooks', 'pre-commit');
    expect(readFileSync(hook, 'utf8')).toContain('check.mjs guard');
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    rmSync(hook);
    await repo.prepareWorkClone('factory/issue-9', 'dev', work);
    expect(existsSync(hook)).toBe(true);
    writeFileSync(join(work, 'f.txt'), 'nine\n');
    await git(work, 'commit', '-am', 'work on 9');
  });

  it('keeps the mounted reference image folder out of every commit', async () => {
    const { home, repo } = await setup();
    const work = join(home, 'work', 'issue-11');
    await repo.prepareWorkClone('factory/issue-11', 'dev', work);
    mkdirSync(join(work, '.factory-media'), { recursive: true });
    writeFileSync(join(work, '.factory-media', 'ref-a.png'), 'png');
    await git(work, 'add', '-A');
    expect(await git(work, 'status', '--short')).toBe('');
  });

  it('takes a force-committed task file out of the branch and keeps it on disk', async () => {
    const { home, repo } = await setup();
    const work = join(home, 'work', 'issue-10');
    await repo.prepareWorkClone('factory/issue-10', 'dev', work);
    mkdirSync(join(work, 'game', '.factory-tasks'), { recursive: true });
    writeFileSync(join(work, 'game', '.factory-tasks', 'issue-10.md'), '# plan\n');
    writeFileSync(join(work, 'f.txt'), 'ten\n');
    await git(work, 'add', '-f', 'f.txt', 'game/.factory-tasks/issue-10.md');
    await git(work, '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'work on 10 with the task file');
    expect(await repo.untrackFactoryFiles(work)).toEqual(['game/.factory-tasks/issue-10.md']);
    expect(await repo.untrackFactoryFiles(work)).toEqual([]);
    const head = await repo.fetchFromWork(work, 'factory/issue-10');
    const diff = await repo.diff('dev', head);
    expect(diff).toContain('+ten');
    expect(diff).not.toContain('.factory-tasks');
    expect(readFileSync(join(work, 'game', '.factory-tasks', 'issue-10.md'), 'utf8')).toBe('# plan\n');
  });

  it('clones again over a clone cut short with no commit checked out, and keeps a working clone as it is', async () => {
    const { home, repo, commit } = await setup();
    await commit('factory/issue-12', 'f.txt', 'twelve\n');
    await repo.fetch();
    const broken = join(home, 'work', 'issue-12');
    const bare = join(home, 'work', 'issue-13');
    for (const dir of [broken, bare]) {
      mkdirSync(join(dir, 'game', '.factory'), { recursive: true });
      writeFileSync(join(dir, 'game', '.factory', 'issue.md'), 'left over\n');
    }
    await git(broken, 'init', '--quiet');
    await repo.prepareWorkClone('factory/issue-12', 'dev', broken);
    await repo.prepareWorkClone('factory/issue-13', 'dev', bare);
    expect(readFileSync(join(broken, 'f.txt'), 'utf8')).toBe('twelve\n');
    expect(readFileSync(join(bare, 'f.txt'), 'utf8')).toBe('base\n');
    writeFileSync(join(broken, 'f.txt'), 'local work\n');
    await repo.prepareWorkClone('factory/issue-12', 'dev', broken);
    expect(readFileSync(join(broken, 'f.txt'), 'utf8')).toBe('local work\n');
  });

  it('clones the exact issue branch into a new folder, and refuses a missing branch or a used folder', async () => {
    const { home, repo, commit, head } = await setup();
    await commit('factory/issue-14', 'f.txt', 'fourteen\n');
    await repo.fetch();
    const work = join(home, 'fresh-14');
    expect(await repo.cloneBranch('factory/issue-14', work)).toBe(await head('factory/issue-14'));
    expect((await git(work, 'symbolic-ref', '--short', 'HEAD')).trim()).toBe('factory/issue-14');
    expect(await git(work, 'check-ignore', '.factory-tasks/x.md')).toContain('.factory-tasks');
    await expect(repo.cloneBranch('factory/issue-14', work)).rejects.toThrow('exists already');
    await expect(repo.cloneBranch('factory/issue-15', join(home, 'fresh-15'))).rejects.toThrow('not in the host clone');
    expect(existsSync(join(home, 'fresh-15'))).toBe(false);
  });

  it('continues a branch that exists on GitHub', async () => {
    const { home, repo, commit } = await setup();
    await commit('factory/issue-9', 'f.txt', 'nine\n');
    await repo.fetch();
    const work = join(home, 'work', 'issue-9');
    await repo.prepareWorkClone('factory/issue-9', 'dev', work);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('nine\n');
  });

  async function behindDev(file: string) {
    const env = await setup();
    await env.commit('factory/issue-5', 'f.txt', 'five\n');
    await env.commit('dev', file, 'dev moved\n');
    await env.repo.fetch();
    const work = join(env.home, 'work', 'issue-5');
    await env.repo.prepareWorkClone('factory/issue-5', 'dev', work);
    return { ...env, work };
  }

  it('merges a moved dev into the branch, and GitHub sees it as merged after the push', async () => {
    const { repo, work, head } = await behindDev('g.txt');
    expect(await repo.isMerged('dev', 'factory/issue-5')).toBe(false);
    expect(await repo.catchUpBase(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: [], kept: null });
    expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe('dev moved\n');
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('five\n');
    await repo.push(await repo.fetchFromWork(work, 'factory/issue-5'), 'factory/issue-5');
    expect(await repo.isMerged('dev', 'factory/issue-5')).toBe(true);
  });

  it('still sees the merged commit inside the branch after dev moves on', async () => {
    const { repo, work, commit } = await behindDev('g.txt');
    const merged = (await repo.catchUpBase(work, 'dev')).commit as string;
    await repo.push(await repo.fetchFromWork(work, 'factory/issue-5'), 'factory/issue-5');
    await commit('dev', 'g.txt', 'another approval\n');
    await repo.fetch();
    expect(await repo.isMerged('dev', 'factory/issue-5')).toBe(false);
    expect(await repo.isMerged(merged, 'factory/issue-5')).toBe(true);
  });

  it('names the conflicted files and leaves the merge open for the agent', async () => {
    const { repo, work } = await behindDev('f.txt');
    expect((await repo.catchUpBase(work, 'dev')).conflicts).toEqual(['f.txt']);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toContain('<<<<<<<');
  });

  async function branchMoved(file: string, pushed: string) {
    const env = await setup();
    await env.commit('factory/issue-12', 'f.txt', 'twelve\n');
    await env.repo.fetch();
    const work = join(env.home, 'work', 'issue-12');
    await env.repo.prepareWorkClone('factory/issue-12', 'dev', work);
    writeFileSync(join(work, file), 'agent\n');
    await git(work, 'commit', '-am', 'agent work');
    await env.commit('factory/issue-12', pushed, 'member\n');
    await env.repo.fetch();
    return { ...env, work };
  }

  it('finds nothing to merge on a new branch or a branch the clone already holds', async () => {
    const { home, repo } = await setup();
    const work = join(home, 'work', 'issue-13');
    await repo.prepareWorkClone('factory/issue-13', 'dev', work);
    expect(await repo.mergeBranchIntoWork(work, 'factory/issue-13')).toEqual({ commit: null, conflicts: [] });
    await repo.push(await repo.fetchFromWork(work, 'factory/issue-13'), 'factory/issue-13');
    expect(await repo.mergeBranchIntoWork(work, 'factory/issue-13')).toEqual({ commit: null, conflicts: [] });
  });

  it('merges a member push on the branch into the work, so the next push holds both', async () => {
    const { repo, work, head, show } = await branchMoved('g.txt', 'f.txt');
    const branch = 'factory/issue-12';
    await expect(repo.push(await repo.fetchFromWork(work, branch), branch)).rejects.toThrow();
    expect(await repo.mergeBranchIntoWork(work, branch)).toEqual({ commit: await head(branch), conflicts: [] });
    await repo.push(await repo.fetchFromWork(work, branch), branch);
    expect(await show(branch, 'g.txt')).toBe('agent\n');
    expect(await show(branch, 'f.txt')).toBe('member\n');
  });

  it('leaves a conflict with a member push open for the agent', async () => {
    const { repo, work } = await branchMoved('g.txt', 'g.txt');
    expect((await repo.mergeBranchIntoWork(work, 'factory/issue-12')).conflicts).toEqual(['g.txt']);
    expect(readFileSync(join(work, 'g.txt'), 'utf8')).toContain('<<<<<<<');
  });

  it('hands its own unfinished merge of the branch back for another round instead of failing', async () => {
    const { repo, work, head } = await branchMoved('g.txt', 'g.txt');
    const branch = 'factory/issue-12';
    await repo.mergeBranchIntoWork(work, branch);
    const before = readFileSync(join(work, 'g.txt'), 'utf8');
    expect(await repo.mergeBranchIntoWork(work, branch)).toEqual({ commit: await head(branch), conflicts: ['g.txt'] });
    expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe(before);
  });

  it('still fails on an unfinished merge of other work', async () => {
    const { repo, work, commit } = await branchMoved('g.txt', 'f.txt');
    await commit('factory/issue-999', 'g.txt', 'other\n');
    await repo.fetch();
    await git(work, 'fetch', '--quiet', 'origin');
    expect((await realRun('git', [...ID, 'merge', 'origin/factory/issue-999'], { cwd: work })).code).not.toBe(0);
    await expect(repo.mergeBranchIntoWork(work, 'factory/issue-12')).rejects.toThrow(/unfinished merge or conflicts/);
  });
});

describe('resolving a conflict', () => {
  const agent = async (dir: string, file: string, text: string) => {
    writeFileSync(join(dir, file), text);
    await must(await realRun('git', [...ID, 'add', file], { cwd: dir }), 'git add');
    await must(await realRun('git', [...ID, 'commit', '--no-edit'], { cwd: dir }), 'git commit');
  };
  const mainIntoDev = { branch: 'main', into: 'dev', message: 'Merge main into dev' };

  it('pushes a merge that an agent finished, and keeps both sides', async () => {
    const { home, repo, commit, show, hub } = await setup();
    await commit('main', 'f.txt', 'main\n', 'main');
    await commit('main', 'g.txt', 'main g\n', 'main');
    await commit('dev', 'f.txt', 'dev\n');
    await repo.fetch();
    const error = await repo.merge([mainIntoDev]).catch((e: unknown) => e) as MergeConflictError;
    expect(error).toBeInstanceOf(MergeConflictError);
    const dir = join(home, 'work', 'merge-dev');
    await repo.openConflict(dir, error);
    await agent(dir, 'f.txt', 'both\n');
    const { resolution, diff } = await repo.closeConflict(dir, error);
    expect(diff).toContain('+both');
    expect(diff).not.toContain('main g');
    await repo.merge([mainIntoDev], [resolution]);
    expect(await show('dev', 'f.txt')).toBe('both\n');
    expect(await show('dev', 'g.txt')).toBe('main g\n');
    expect((await hub('log', '-1', '--format=%s', 'dev')).trim()).toBe('Merge main into dev');
  });

  it('merges again when the target moved on GitHub after the agent began, and asks again only for a new conflict', async () => {
    const { home, repo, commit, show } = await setup();
    await commit('main', 'f.txt', 'main\n', 'main');
    await commit('dev', 'f.txt', 'dev\n');
    await repo.fetch();
    const error = await repo.merge([mainIntoDev]).catch((e: unknown) => e) as MergeConflictError;
    const dir = join(home, 'work', 'merge-dev');
    await repo.openConflict(dir, error);
    await agent(dir, 'f.txt', 'both\n');
    const { resolution } = await repo.closeConflict(dir, error);
    await commit('dev', 'g.txt', 'moved\n');
    await repo.fetch();
    const again = await repo.merge([mainIntoDev], [resolution]).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(MergeConflictError);
    expect(await show('dev', 'g.txt')).toBe('moved\n');
    expect(await show('dev', 'f.txt')).toBe('dev\n');
  });

  it('catches a waiting issue branch up to dev with a resolved conflict, leaves dev alone, and its later merge into dev is clean', async () => {
    const { home, repo, commit, feature, show, head } = await setup();
    await commit('factory/issue-8', 'f.txt', 'card 8\n');
    await feature(7, 'f.txt', 'card 7\n');
    await commit('dev', 'g.txt', 'dev moved\n');
    await repo.fetch();
    const devBefore = await head('dev');
    const catchUp = { branch: 'dev', into: 'factory/issue-8', message: 'Merge dev into factory/issue-8 while it waits in Merging' };
    const error = await repo.merge([catchUp]).catch((e: unknown) => e) as MergeConflictError;
    expect(error).toBeInstanceOf(MergeConflictError);
    const dir = join(home, 'work', 'merge-factory-issue-8');
    await repo.openConflict(dir, error);
    await agent(dir, 'f.txt', 'card 7 and 8\n');
    const { resolution } = await repo.closeConflict(dir, error);
    await repo.merge([catchUp], [resolution]);
    expect(await head('dev')).toBe(devBefore);
    expect(await show('dev', 'f.txt')).toBe('card 7\n');
    expect(await show('factory/issue-8', 'f.txt')).toBe('card 7 and 8\n');
    expect(await show('factory/issue-8', 'g.txt')).toBe('dev moved\n');
    expect(await repo.isMerged('dev', 'factory/issue-8')).toBe(true);
    await repo.merge([{ branch: 'factory/issue-8', into: 'dev', message: 'Merge issue #8: title 8' }]);
    expect(await show('dev', 'f.txt')).toBe('card 7 and 8\n');
  });

  it('rejects a merge the agent left open, and a commit that drops a side', async () => {
    const { home, repo, commit, host } = await setup();
    await commit('main', 'f.txt', 'main\n', 'main');
    await commit('dev', 'f.txt', 'dev\n');
    await repo.fetch();
    const error = await repo.merge([mainIntoDev]).catch((e: unknown) => e) as MergeConflictError;
    const dir = join(home, 'work', 'merge-dev');
    await repo.openConflict(dir, error);
    await expect(repo.closeConflict(dir, error)).rejects.toThrow('unfinished');
    await must(await realRun('git', [...ID, 'merge', '--abort'], { cwd: dir }), 'git merge --abort');
    writeFileSync(join(dir, 'f.txt'), 'plain\n');
    await must(await realRun('git', [...ID, 'commit', '-am', 'plain'], { cwd: dir }), 'git commit');
    await expect(repo.closeConflict(dir, error)).rejects.toThrow('does not hold');
    expect((await host('worktree', 'list')).trim().split('\n')).toHaveLength(1);
  });

  it('resolves a step that merges a commit no branch names yet, in one push with the steps before', async () => {
    const { home, repo, commit, show, head } = await setup();
    await commit('factory/issue-6', 'g.txt', 'fix\n', 'main');
    await commit('dev', 'g.txt', 'dev\n');
    await repo.fetch();
    const steps = [{ branch: 'factory/issue-6', into: 'main', message: 'Hotfix #6' }, mainIntoDev];
    const error = await repo.merge(steps).catch((e: unknown) => e) as MergeConflictError;
    expect(error.source).not.toBe(await head('main'));
    const dir = join(home, 'work', 'merge-dev');
    await repo.openConflict(dir, error);
    await agent(dir, 'g.txt', 'both\n');
    const { resolution } = await repo.closeConflict(dir, error);
    await repo.merge(steps, [...error.done, resolution]);
    expect(await show('main', 'g.txt')).toBe('fix\n');
    expect(await show('dev', 'g.txt')).toBe('both\n');
  });

  it('pushes a revert that an agent finished', async () => {
    const { home, repo, feature, show } = await setup();
    await feature(3, 'f.txt', 'three\n');
    await feature(4, 'f.txt', 'four\n');
    const error = await repo.revertIssueMerge(3, 'dev').catch((e: unknown) => e) as RevertConflictError;
    expect(error).toBeInstanceOf(RevertConflictError);
    const dir = join(home, 'work', 'merge-dev');
    await repo.openConflict(dir, error);
    await agent(dir, 'f.txt', 'resolved\n');
    const { resolution } = await repo.closeConflict(dir, error);
    expect(await repo.revertIssueMerge(3, 'dev', [resolution])).toBe(true);
    expect(await show('dev', 'f.txt')).toBe('resolved\n');
    expect(await repo.revertIssueMerge(3, 'dev')).toBe(false);
  });
});
