import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GUARD_HOOK } from './container';
import { must } from './exec';
import { withLock } from './lock';
import { createLockWaitReporter } from './observability';
import { MEDIA_DIR, MergeConflictError, OUT_DIR, RevertConflictError, TASK_DIR, type FactoryConfig, type HostRepo, type MergeStep, type Resolution, type Run } from './types';

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
  // An agent's resolution of this very merge stands in for it.
  function mergeCommit(source: string, base: string, step: MergeStep, resolutions: Resolution[], done: Resolution[]): Promise<string> {
    const resolved = resolutions.find((item) => item.base === base && item.source === source);
    if (resolved) return Promise.resolve(resolved.head);
    return inWorktree(base, async (dir) => {
      const result = await run('git', [...NO_HOOKS, 'merge', '--no-ff', '-m', step.message, source], { cwd: dir });
      if (result.code !== 0) {
        const files = await conflictedFiles(dir);
        const reason = (result.stderr || result.stdout).trim();
        if (files.length === 0) throw new Error(`merge of ${step.branch} into ${step.into} failed without a conflict: ${reason}`);
        throw new MergeConflictError(step, files, reason, base, source, done);
      }
      return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
    });
  }

  // Reverts the merge `hash` on `tip` and returns the revert commit, which no ref names yet. An agent's resolution of this very revert stands in for it.
  async function revertCommit(issue: number, branch: string, at: { tip: string; hash: string }, resolutions: Resolution[]): Promise<string> {
    const resolved = resolutions.find((item) => item.base === at.tip && item.source === at.hash);
    if (resolved) return resolved.head;
    return inWorktree(at.tip, async (dir) => {
      const result = await run('git', [...NO_HOOKS, 'revert', '--no-edit', '-m', '1', at.hash], { cwd: dir });
      if (result.code === 0) return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
      const files = await conflictedFiles(dir);
      const reason = (result.stderr || result.stdout).trim();
      if (files.length === 0) throw new Error(`revert of issue #${issue} on ${branch} failed without a conflict: ${reason}`);
      throw new RevertConflictError(issue, branch, files, reason, at.tip, at.hash);
    });
  }

  // Pushes every head in one atomic push. False when GitHub rejected it because a target moved since `started`, which the caller redoes. Any other rejection throws.
  async function pushUnlessMoved(heads: Map<string, string>, started: Map<string, string>): Promise<boolean> {
    const pushed = await run('git', [...NO_HOOKS, 'push', '--atomic', 'origin', ...[...heads].map(([branch, commit]) => `${commit}:refs/heads/${branch}`)], { cwd: path });
    if (pushed.code === 0) return true;
    await git(['fetch', '--prune', 'origin']);
    const moved = await Promise.all([...started].map(async ([branch, commit]) => (await commitOf(branch)) !== commit));
    if (!moved.includes(true)) throw new Error(`push of ${[...heads.keys()].join(', ')} failed: ${(pushed.stderr || pushed.stdout).trim()}`);
    return false;
  }

  // Each step merges into the result of the steps before it. `heads` holds the new commit of each target and `started` its tip on GitHub before the first step.
  async function mergeSteps(steps: MergeStep[], resolutions: Resolution[]): Promise<{ heads: Map<string, string>; started: Map<string, string> }> {
    const heads = new Map<string, string>();
    const started = new Map<string, string>();
    const tip = async (name: string): Promise<string> => heads.get(name) ?? commitOf(name);
    const done: Resolution[] = [];
    for (const step of steps) {
      if (!started.has(step.into)) started.set(step.into, await commitOf(step.into));
      const [source, base] = [await tip(step.branch), await tip(step.into)];
      const head = await mergeCommit(source, base, step, resolutions, done);
      done.push({ base, source, head });
      heads.set(step.into, head);
    }
    return { heads, started };
  }

  // One push moves every branch or none. A branch that moved on GitHub meanwhile makes it fail, since the push never forces.
  async function pushAll(heads: Map<string, string>): Promise<void> {
    await git(['push', '--atomic', 'origin', ...[...heads].map(([branch, commit]) => `${commit}:refs/heads/${branch}`)]);
  }

  // Brings a work clone's branch head into the host clone, without pushing it, and returns its full hash.
  async function headFromWork(dir: string, branch: string): Promise<string> {
    const head = (await gitIn(dir, ['rev-parse', `refs/heads/${branch}`])).trim();
    await git(['fetch', dir, `refs/heads/${branch}`]);
    return head;
  }

  // Clones into `dir` unless a working clone is there.
  // A clone made before the guard hook existed gets it too.
  async function prepareClone(branch: string, base: string, dir: string): Promise<void> {
    // A clone cut short, like by a full disk, has no commit checked out. It holds no work, so it is cloned again.
    // The note goes to the job log, so the replacement is on record.
    if (existsSync(dir)) {
      if (existsSync(join(dir, '.git')) && (await hasRef(dir, 'HEAD'))) return installGuardHook(dir);
      console.error(`${dir} has no commit checked out, so it is cloned again`);
      rmSync(dir, { recursive: true, force: true });
    }
    await initClone(dir);
    await checkoutBranch(dir, branch, base);
    installGuardHook(dir);
  }

  function installGuardHook(dir: string): void {
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), GUARD_HOOK, { mode: 0o755 });
  }

  // A new clone in `dir` with the host clone's refs and no branch checked out yet.
  async function initClone(dir: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    await gitIn(dir, ['init', '--quiet']);
    await gitIn(dir, ['remote', 'add', 'origin', path]);
    await gitIn(dir, ['config', 'remote.origin.fetch', '+refs/remotes/origin/*:refs/remotes/origin/*']);
    await gitIn(dir, ['fetch', '--quiet', 'origin']);
    // The clone ignores the factory's own files, whatever the branch's .gitignore says.
    appendFileSync(join(dir, '.git', 'info', 'exclude'), `\n${OUT_DIR}/\n${TASK_DIR}/\n${MEDIA_DIR}/\n`);
  }

  // A conflict, a merge in progress or a revert in progress means the agent did not commit.
  async function requireFinished(dir: string, into: string, source: string): Promise<void> {
    const open = (await conflictedFiles(dir)).length > 0 || (await hasRef(dir, 'MERGE_HEAD')) || (await hasRef(dir, 'REVERT_HEAD'));
    if (open) throw new Error(`The agent left the conflict of ${source} on ${into} unfinished`);
  }

  // The agent's commit must hold `ancestor`, and must be a new commit, so a reset or an aborted merge fails here.
  async function requireDescends(head: string, ancestor: string, what: string): Promise<void> {
    const result = await run('git', [...NO_HOOKS, 'merge-base', '--is-ancestor', ancestor, head], { cwd: path });
    if (result.code !== 0 || head === ancestor) throw new Error(`The agent's commit ${head.slice(0, 7)} does not hold ${ancestor.slice(0, 7)}, ${what}`);
  }

  // A file that differs from both sides is the agent's own work. A file that equals one side came in with a clean merge.
  async function agentAdded(base: string, source: string, head: string): Promise<string> {
    const names = async (side: string): Promise<string[]> => (await git(['diff', '--name-only', '-z', side, head])).split('\0').filter(Boolean);
    const fromSource = new Set(await names(source));
    const added = (await names(base)).filter((file) => fromSource.has(file));
    return added.length === 0 ? '' : git(['diff', base, head, '--', ...added]);
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
    async revertIssueMerge(issue, branch, resolutions = []) {
      for (;;) {
        const tip = await commitOf(branch);
        const hash = mergeToRevert(await git(['log', '--first-parent', '--format=%H %s', `${await ref('main')}..${tip}`]), issue);
        if (hash === null) return false;
        const head = await revertCommit(issue, branch, { tip, hash }, resolutions);
        if (await pushUnlessMoved(new Map([[branch, head]]), new Map([[branch, tip]]))) return true;
      }
    },
    async openConflict(dir, conflict) {
      rmSync(dir, { recursive: true, force: true });
      await prepareClone(conflict.into, conflict.into, dir);
      const [source, command] = conflict instanceof MergeConflictError
        ? [conflict.source, ['merge', '--no-ff', '-m', conflict.step.message, conflict.source]]
        : [conflict.merge, ['revert', '--no-edit', '-m', '1', conflict.merge]];
      // A commit that an earlier step made has no ref, so the clone asks the host clone for it by hash.
      await gitIn(dir, ['fetch', '--quiet', 'origin', conflict.base, source]);
      await gitIn(dir, ['checkout', '-B', conflict.into, conflict.base]);
      const result = await run('git', [...NO_HOOKS, ...command], { cwd: dir });
      if (result.code === 0) throw new Error(`${command[0]} of ${source} on ${conflict.into} went through in the work clone though it conflicted`);
      if ((await conflictedFiles(dir)).length === 0) throw new Error(`${command[0]} of ${source} on ${conflict.into} failed in the work clone without a conflict: ${(result.stderr || result.stdout).trim()}`);
    },
    async closeConflict(dir, conflict) {
      const merging = conflict instanceof MergeConflictError;
      const source = merging ? conflict.source : conflict.merge;
      await requireFinished(dir, conflict.into, source);
      const head = await headFromWork(dir, conflict.into);
      await requireDescends(head, conflict.base, `the tip of ${conflict.into}`);
      if (merging) await requireDescends(head, source, `the commit to merge into ${conflict.into}`);
      const diff = merging ? await agentAdded(conflict.base, source, head) : await git(['diff', conflict.base, head]);
      return { resolution: { base: conflict.base, source, head }, diff };
    },
    async deleteBranch(branch) {
      if (lines(await git(['ls-remote', '--heads', 'origin', branch])).length > 0) await git(['push', 'origin', '--delete', branch]);
    },
    prepareWorkClone: prepareClone,
    async cloneBranch(branch, dir) {
      if (!(await hasRef(path, `refs/remotes/origin/${branch}`))) throw new Error(`branch ${branch} is not in the host clone, so GitHub has no such branch as of the last fetch`);
      if (existsSync(dir)) throw new Error(`${dir} exists already`);
      await initClone(dir);
      await gitIn(dir, ['checkout', '--quiet', '-B', branch, `origin/${branch}`]);
      return (await gitIn(dir, ['rev-parse', 'HEAD'])).trim();
    },
    async untrackFactoryFiles(dir) {
      const tracked = lines(await gitIn(dir, ['ls-files', '--', `:(glob)**/${TASK_DIR}/**`, `:(glob)**/${OUT_DIR}/**`, `:(glob)**/${MEDIA_DIR}/**`]));
      if (tracked.length === 0) return [];
      await gitIn(dir, ['rm', '-r', '-q', '--cached', '--', ...tracked]);
      // A path list would commit the file from disk again, so the commit takes the index.
      await gitIn(dir, ['commit', '-q', '-m', 'Keep factory task files out of the branch']);
      return tracked;
    },
    fetchFromWork: headFromWork,
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
    async mergeBranchIntoWork(dir, branch) {
      await gitIn(dir, ['fetch', 'origin']);
      if (!(await hasRef(dir, `refs/remotes/origin/${branch}`))) return { commit: null, conflicts: [] };
      const commit = (await gitIn(dir, ['rev-parse', `origin/${branch}`])).trim();
      if ((await run('git', [...NO_HOOKS, 'merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: dir })).code === 0) return { commit: null, conflicts: [] };
      const result = await run('git', [...NO_HOOKS, 'merge', '--no-edit', commit], { cwd: dir });
      if (result.code === 0) return { commit, conflicts: [] };
      const conflicts = await conflictedFiles(dir);
      if (conflicts.length === 0) throw new Error(`merge of ${branch} into ${dir} failed without a conflict: ${(result.stderr || result.stdout).trim()}`);
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
    // Other jobs and members push all the time. A push that GitHub rejects because a target moved merges again from the new tips.
    async merge(steps, resolutions = []) {
      for (;;) {
        const { heads, started } = await mergeSteps(steps, resolutions);
        if (await pushUnlessMoved(heads, started)) return;
      }
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
