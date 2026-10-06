import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { must } from './exec';
import { withLock } from './lock';
import { createLockWaitReporter } from './observability';
import { MEDIA_DIR, MergeConflictError, OUT_DIR, TASK_DIR, type FactoryConfig, type HostRepo, type MergeStep, type Run } from './types';

// Hooks are switched off on every call, so no git command here runs code from a repository.
// The identity names the factory on its merge commits, the same one the agent image uses.
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=ROAM Factory', '-c', 'user.email=factory@roam.invalid'];

// The log runs newest first, so the first entry that names the issue decides.
// A revert means the branch is clean already, and a merge that came back after a removal reverts its latest merge.
function mergeToRevert(log: string, issue: number): string | null {
  const merge = `Merge issue #${issue}:`;
  const reverted = `Revert "Merge issue #${issue}:`;
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, ...words] = line.split(' ');
    const subject = words.join(' ');
    if (subject.startsWith(reverted)) return null;
    if (subject.startsWith(merge)) return hash;
  }
  return null;
}

const lines = (text: string): string[] => text.split('\n').filter(Boolean);

// GitHub holds every branch. The host clone is a cache of it: it keeps GitHub's branches as origin/* refs and no local branch.
// A write merges in a throwaway worktree and pushes the result. A failed merge or push leaves nothing behind, so a retry starts from GitHub.
export function hostRepo(run: Run, cfg: FactoryConfig, jobId: string | null = null): HostRepo {
  const path = `${cfg.home}/repo`;
  const landDir = join(cfg.home, 'work', 'land');
  const gitIn = async (cwd: string, args: string[]): Promise<string> => must(await run('git', [...NO_HOOKS, ...args], { cwd }), `git ${args.join(' ')}`);
  const git = (args: string[]): Promise<string> => gitIn(path, args);
  const hasRef = async (cwd: string, ref: string): Promise<boolean> => (await run('git', [...NO_HOOKS, 'rev-parse', '--verify', '--quiet', ref], { cwd })).code === 0;

  // A branch name reads GitHub's copy. Anything else, like a commit hash, passes as it is.
  async function ref(name: string): Promise<string> {
    return (await hasRef(path, `refs/remotes/origin/${name}`)) ? `origin/${name}` : name;
  }

  async function commitOf(name: string): Promise<string> {
    return (await git(['rev-parse', `${await ref(name)}^{commit}`])).trim();
  }

  // Runs `work` in a fresh worktree detached at `commit`, and removes it afterwards, also after a failure or a crash before.
  async function inWorktree<T>(commit: string, work: (dir: string) => Promise<T>): Promise<T> {
    rmSync(landDir, { recursive: true, force: true });
    await git(['worktree', 'prune']);
    await git(['worktree', 'add', '--detach', landDir, commit]);
    try {
      return await work(landDir);
    } finally {
      rmSync(landDir, { recursive: true, force: true });
      await git(['worktree', 'prune']);
    }
  }

  async function conflictedFiles(dir: string): Promise<string[]> {
    return lines(await gitIn(dir, ['diff', '--name-only', '--diff-filter=U']));
  }

  // Merges `source` into `base` and returns the merge commit, which no ref names yet.
  function mergeCommit(source: string, base: string, step: MergeStep): Promise<string> {
    return inWorktree(base, async (dir) => {
      const result = await run('git', [...NO_HOOKS, 'merge', '--no-ff', '-m', step.message, source], { cwd: dir });
      if (result.code !== 0) {
        const files = await conflictedFiles(dir);
        const reason = (result.stderr || result.stdout).trim();
        if (files.length === 0) throw new Error(`merge of ${step.branch} into ${step.into} failed without a conflict: ${reason}`);
        throw new MergeConflictError(step.branch, step.into, files, reason);
      }
      return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
    });
  }

  // One push moves every branch or none. A branch that moved on GitHub meanwhile makes it fail, since the push never forces.
  async function pushAll(heads: Map<string, string>): Promise<void> {
    await git(['push', '--atomic', 'origin', ...[...heads].map(([branch, commit]) => `${commit}:refs/heads/${branch}`)]);
  }

  // The work clone sees the host's origin/* refs as its own origin/*.
  async function checkoutBranch(dir: string, branch: string, base: string): Promise<void> {
    const start = (await hasRef(dir, `refs/remotes/origin/${branch}`)) ? branch : base;
    await gitIn(dir, ['checkout', '-B', branch, `origin/${start}`]);
  }

  return lockEach(cfg, jobId, {
    path,
    async fetch() {
      if (!existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true });
        await gitIn(dirname(path), ['clone', `https://github.com/${cfg.repo}.git`, path]);
      }
      await git(['fetch', '--prune', 'origin']);
      // A local branch could only be a stale copy of GitHub, like a merge whose push failed, so none is kept.
      const local = lines(await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']));
      if (local.length === 0) return;
      await git(['checkout', '--detach']);
      await git(['branch', '-D', ...local]);
    },
    async createBranch(name, from) {
      if (await hasRef(path, `refs/remotes/origin/${name}`)) throw new Error(`branch ${name} exists on GitHub already`);
      await pushAll(new Map([[name, await commitOf(from)]]));
    },
    async revertIssueMerge(issue, branch) {
      const log = await git(['log', '--first-parent', '--format=%H %s', `${await ref('main')}..${await ref(branch)}`]);
      const hash = mergeToRevert(log, issue);
      if (hash === null) return false;
      const head = await inWorktree(await commitOf(branch), async (dir) => {
        const result = await run('git', [...NO_HOOKS, 'revert', '--no-edit', '-m', '1', hash], { cwd: dir });
        if (result.code === 0) return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
        const files = await conflictedFiles(dir);
        const reason = (result.stderr || result.stdout).trim();
        if (files.length === 0) throw new Error(`revert of issue #${issue} on ${branch} failed without a conflict: ${reason}`);
        throw new Error(`revert of issue #${issue} on ${branch} failed. Conflicting files: ${files.join(', ')}. ${reason}`);
      });
      await pushAll(new Map([[branch, head]]));
      return true;
    },
    async deleteBranch(branch) {
      if (lines(await git(['ls-remote', '--heads', 'origin', branch])).length > 0) await git(['push', 'origin', '--delete', branch]);
    },
    async prepareWorkClone(branch, base, dir) {
      if (existsSync(dir)) return;
      mkdirSync(dir, { recursive: true });
      await gitIn(dir, ['init', '--quiet']);
      await gitIn(dir, ['remote', 'add', 'origin', path]);
      await gitIn(dir, ['config', 'remote.origin.fetch', '+refs/remotes/origin/*:refs/remotes/origin/*']);
      await gitIn(dir, ['fetch', '--quiet', 'origin']);
      // The clone ignores the factory's own files, whatever the branch's .gitignore says.
      appendFileSync(join(dir, '.git', 'info', 'exclude'), `\n${OUT_DIR}/\n${TASK_DIR}/\n${MEDIA_DIR}/\n`);
      await checkoutBranch(dir, branch, base);
    },
    async untrackFactoryFiles(dir) {
      const tracked = lines(await gitIn(dir, ['ls-files', '--', `:(glob)**/${TASK_DIR}/**`, `:(glob)**/${OUT_DIR}/**`, `:(glob)**/${MEDIA_DIR}/**`]));
      if (tracked.length === 0) return [];
      await gitIn(dir, ['rm', '-r', '-q', '--cached', '--', ...tracked]);
      // A path list would commit the file from disk again, so the commit takes the index.
      await gitIn(dir, ['commit', '-q', '-m', 'Keep factory task files out of the branch']);
      return tracked;
    },
    async fetchFromWork(dir, branch) {
      const head = (await gitIn(dir, ['rev-parse', `refs/heads/${branch}`])).trim();
      await git(['fetch', dir, `refs/heads/${branch}`]);
      return head;
    },
    async push(commit, branch) {
      await pushAll(new Map([[branch, commit]]));
    },
    async mergeBaseIntoWork(dir, base) {
      await gitIn(dir, ['fetch', 'origin']);
      const commit = (await gitIn(dir, ['rev-parse', `origin/${base}`])).trim();
      const result = await run('git', [...NO_HOOKS, 'merge', '--no-edit', commit], { cwd: dir });
      if (result.code === 0) return { commit, conflicts: [] };
      const conflicts = await conflictedFiles(dir);
      if (conflicts.length === 0) throw new Error(`merge of ${base} into ${dir} failed without a conflict: ${(result.stderr || result.stdout).trim()}`);
      return { commit, conflicts };
    },
    async isMerged(base, branch) {
      const result = await run('git', [...NO_HOOKS, 'merge-base', '--is-ancestor', await ref(base), await ref(branch)], { cwd: path });
      if (result.code === 0 || result.code === 1) return result.code === 0;
      throw new Error(`git merge-base --is-ancestor ${base} ${branch} failed: ${result.stderr.trim()}`);
    },
    async headHash(branch) {
      return (await git(['rev-parse', '--short', await ref(branch)])).trim();
    },
    diff: async (base, branch) => git(['diff', `${await ref(base)}...${await ref(branch)}`]),
    async readFile(branch, path) {
      return git(['show', `${await ref(branch)}:${path}`]);
    },
    async changedFiles(base, branch) {
      return lines(await git(['diff', '--name-only', `${await ref(base)}...${await ref(branch)}`]));
    },
    async hasNewCommits(base, branch) {
      return Number((await git(['rev-list', '--count', `${await ref(base)}..${await ref(branch)}`])).trim()) > 0;
    },
    // Each step merges into the result of the steps before it, so "main into dev" after "issue into main" takes the new main.
    async merge(steps) {
      const heads = new Map<string, string>();
      const tip = async (name: string): Promise<string> => heads.get(name) ?? commitOf(name);
      for (const step of steps) heads.set(step.into, await mergeCommit(await tip(step.branch), await tip(step.into), step));
      await pushAll(heads);
    },
    async mergeLog(from, to) {
      return lines(await git(['log', '--first-parent', '--merges', '--format=%s', `${await ref(to)}..${await ref(from)}`]));
    },
  });
}

// The longest single step is a clone of the repo. A job that waits this long found a stuck lock.
const REPO_LOCK_MS = 15 * 60_000;

// Parallel jobs share the host clone and its one merge worktree, so each method runs whole under one lock.
// A job's steps may interleave with another job's, which is safe: no method leaves state behind except GitHub's refs.
function lockEach(cfg: FactoryConfig, jobId: string | null, repo: HostRepo): HostRepo {
  const dir = join(cfg.home, 'locks', 'repo');
  const entries = Object.entries(repo).map(([key, value]) => {
    if (typeof value !== 'function') return [key, value];
    const method = value as (...args: unknown[]) => Promise<unknown>;
    return [key, (...args: unknown[]) => withLock(dir, REPO_LOCK_MS, () => method(...args), createLockWaitReporter(cfg.home, jobId, cfg.observationHeartbeatMs))];
  });
  return Object.fromEntries(entries) as HostRepo;
}
