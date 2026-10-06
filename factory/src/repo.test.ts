import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { must, realRun } from './exec';
import { hostRepo } from './repo';
import { MergeConflictError, type FactoryConfig, type Run } from './types';

// Each test runs dozens of real git commands against a local stand-in for GitHub.
vi.setConfig({ testTimeout: 30_000 });

const cfg = (home: string): FactoryConfig => ({ home, repo: 'o/r' }) as FactoryConfig;

function tmpHome(): string {
  mkdirSync('tmp', { recursive: true });
  return resolve(mkdtempSync(join('tmp', 'factory-repo-')));
}

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];

// A bare repo stands in for GitHub. Main holds two files and dev starts from it. `author` is a second clone, like a person on GitHub.
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
  // Pushes a commit to `branch` on GitHub, cut from `from` when the branch is new.
  const commit = async (branch: string, file: string, text: string, from = 'dev') => {
    await by('fetch', '--prune', 'origin');
    const exists = (await realRun('git', ['rev-parse', '--verify', '--quiet', `origin/${branch}`], { cwd: author })).code === 0;
    await by('checkout', '-B', branch, exists ? `origin/${branch}` : `origin/${from}`);
    writeFileSync(join(author, file), text);
    await by('commit', '-am', `${branch} changes ${file}`);
    await by('push', 'origin', branch);
  };
  // An issue branch on GitHub, merged into `into` the way approval merges it.
  const feature = async (issue: number, file: string, text: string, into = 'dev') => {
    await commit(`factory/issue-${issue}`, file, text, into);
    await repo.fetch();
    await repo.merge([{ branch: `factory/issue-${issue}`, into, message: `Merge issue #${issue}: title ${issue}` }]);
  };
  const show = async (branch: string, file: string) => hub('show', `${branch}:${file}`);
  const head = async (branch: string) => (await hub('rev-parse', branch)).trim();
  return { home, origin, repo, hub, host, commit, feature, show, head };
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

  it('fails when GitHub moved since the fetch, keeps nothing of the try, and a retry after a fetch merges', async () => {
    const { repo, host, commit, show } = await setup();
    await commit('factory/issue-5', 'f.txt', 'five\n');
    await repo.fetch();
    await commit('dev', 'g.txt', 'moved on GitHub\n');
    const step = { branch: 'factory/issue-5', into: 'dev', message: 'Merge issue #5: t' };
    await expect(repo.merge([step])).rejects.toThrow('git push');
    expect((await host('for-each-ref', 'refs/heads')).trim()).toBe('');
    await repo.fetch();
    await repo.merge([step]);
    expect(await show('dev', 'f.txt')).toBe('five\n');
    expect(await show('dev', 'g.txt')).toBe('moved on GitHub\n');
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
    ])).rejects.toThrow('git push');
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
    await git(work, 'commit', '-m', 'work on 10 with the task file');
    expect(await repo.untrackFactoryFiles(work)).toEqual(['game/.factory-tasks/issue-10.md']);
    expect(await repo.untrackFactoryFiles(work)).toEqual([]);
    const head = await repo.fetchFromWork(work, 'factory/issue-10');
    const diff = await repo.diff('dev', head);
    expect(diff).toContain('+ten');
    expect(diff).not.toContain('.factory-tasks');
    expect(readFileSync(join(work, 'game', '.factory-tasks', 'issue-10.md'), 'utf8')).toBe('# plan\n');
  });

  it('continues a branch that exists on GitHub', async () => {
    const { home, repo, commit } = await setup();
    await commit('factory/issue-9', 'f.txt', 'nine\n');
    await repo.fetch();
    const work = join(home, 'work', 'issue-9');
    await repo.prepareWorkClone('factory/issue-9', 'dev', work);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('nine\n');
  });

  // An issue branch cut from dev, then a dev commit to `file` that the branch lacks. The work clone holds the branch.
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
    expect(await repo.mergeBaseIntoWork(work, 'dev')).toEqual({ commit: await head('dev'), conflicts: [] });
    expect(readFileSync(join(work, 'g.txt'), 'utf8')).toBe('dev moved\n');
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('five\n');
    await repo.push(await repo.fetchFromWork(work, 'factory/issue-5'), 'factory/issue-5');
    expect(await repo.isMerged('dev', 'factory/issue-5')).toBe(true);
  });

  it('still sees the merged commit inside the branch after dev moves on', async () => {
    const { repo, work, commit } = await behindDev('g.txt');
    const merged = (await repo.mergeBaseIntoWork(work, 'dev')).commit;
    await repo.push(await repo.fetchFromWork(work, 'factory/issue-5'), 'factory/issue-5');
    await commit('dev', 'g.txt', 'another approval\n');
    await repo.fetch();
    expect(await repo.isMerged('dev', 'factory/issue-5')).toBe(false);
    expect(await repo.isMerged(merged, 'factory/issue-5')).toBe(true);
  });

  it('names the conflicted files and leaves the merge open for the agent', async () => {
    const { repo, work } = await behindDev('f.txt');
    expect((await repo.mergeBaseIntoWork(work, 'dev')).conflicts).toEqual(['f.txt']);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toContain('<<<<<<<');
  });
});
