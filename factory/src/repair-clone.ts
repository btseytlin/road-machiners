import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { withLock } from './lock';
import { readState, updateState } from './state';
import { clearStuck } from './stuck';
import { BRANCH, CLONE_LOCK_MS, MEDIA_DIR, OPEN_MARKS, OUT_DIR, TASK_DIR, WORK_DIR, WORK_LOCK, type Ctx, type FactoryState, type Hold } from './types';

export type RepairOrder = { issue: number; by: string; reason: string; backupMerge: boolean; refuseUnpushed: boolean };
export type RepairFs = { move: (from: string, to: string) => void; copy: (from: string, to: string) => void };
const REAL_FS: RepairFs = { move: renameSync, copy: (from, to) => cpSync(from, to, { recursive: true }) };

const FACTORY_DIRS = new Set([OUT_DIR, TASK_DIR, MEDIA_DIR]);
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];

export const backupRoot = (home: string): string => join(home, 'clone-backups');

type OldClone = { head: string; branch: string | null; status: string; open: string[]; conflicts: string[]; unpushed: string[] };
type Manifest = OldClone & { issue: number; by: string; reason: string; at: string; remoteBranch: string; remoteHead: string; outcome: 'moving' | 'repaired' | 'failed'; error: string | null; copied: string[] };

const lines = (text: string): string[] => text.split('\n').filter(Boolean);

export async function repairClone(ctx: Ctx, order: RepairOrder, fs: RepairFs = REAL_FS): Promise<string[]> {
  return withLock(WORK_LOCK(ctx.cfg.home, `issue-${order.issue}`), CLONE_LOCK_MS, () => repairHeld(ctx, order, fs));
}

async function repairHeld(ctx: Ctx, order: RepairOrder, fs: RepairFs): Promise<string[]> {
  const placed = placeHold(ctx, order);
  try {
    const done = await repairOnce(ctx, order, fs);
    await clearStuck(ctx, order.issue);
    return done;
  } finally {
    if (placed !== null) liftHold(ctx, order.issue, placed);
  }
}

function placeHold(ctx: Ctx, order: RepairOrder): Hold | null {
  const { issue } = order;
  let placed: Hold | null = null;
  updateState(ctx.statePath, (state) => {
    requireNoJob(state, issue);
    if (String(issue) in state.held) return state;
    placed = { by: order.by, reason: `repair-clone: ${order.reason}`, at: ctx.now().toISOString(), stage: null };
    return { ...state, held: { ...state.held, [issue]: placed } };
  });
  return placed;
}

function liftHold(ctx: Ctx, issue: number, placed: Hold): void {
  updateState(ctx.statePath, (state) => {
    const hold = state.held[String(issue)];
    if (hold === undefined || hold.at !== placed.at || hold.by !== placed.by || hold.reason !== placed.reason) return state;
    return { ...state, held: Object.fromEntries(Object.entries(state.held).filter(([key]) => key !== String(issue))) };
  });
}

async function repairOnce(ctx: Ctx, order: RepairOrder, fs: RepairFs): Promise<string[]> {
  const dir = WORK_DIR(ctx.cfg.home, order.issue);
  const git = gitIn(ctx);
  const old = await inspect(git, dir, order.issue);
  requireRepairable(dir, old, order);
  await ctx.repo.fetch();
  const backup = newBackupDir(ctx.cfg.home, order.issue, ctx.now());
  const fresh = join(backup, 'fresh');
  const remoteBranch = BRANCH(order.issue);
  let remoteHead: string;
  try {
    remoteHead = await ctx.repo.cloneBranch(remoteBranch, fresh);
    requireNoJob(readState(ctx.statePath), order.issue);
  } catch (error) {
    rmSync(backup, { recursive: true, force: true });
    throw new Error(`Refused, ${dir} is unchanged: ${message(error)}`);
  }
  const manifest: Manifest = { ...old, issue: order.issue, by: order.by, reason: order.reason, at: ctx.now().toISOString(), remoteBranch, remoteHead, outcome: 'moving', error: null, copied: [] };
  writeFileSync(join(backup, 'status.txt'), old.status);
  record(backup, manifest);
  return replace({ dir, backup, fresh, manifest }, git, fs);
}

type Steps = { dir: string; backup: string; fresh: string; manifest: Manifest };

async function replace(steps: Steps, git: Git, fs: RepairFs): Promise<string[]> {
  const { dir, backup, fresh, manifest } = steps;
  const saved = join(backup, 'clone');
  try {
    fs.move(dir, saved);
  } catch (error) {
    record(backup, { ...manifest, outcome: 'failed', error: message(error) });
    throw new Error(`Could not move ${dir} into the backup, so it stays where it was: ${message(error)}`);
  }
  let copied: string[];
  try {
    fs.move(fresh, dir);
    copied = copyFactoryDirs(saved, dir, fs);
    await verify(git, dir, manifest.remoteHead);
    record(backup, { ...manifest, outcome: 'repaired', copied });
  } catch (error) {
    const left = setAside(dir, join(backup, 'failed-fresh'), fs);
    record(backup, { ...manifest, outcome: 'failed', error: message(error) });
    throw new Error(`The repair failed: ${message(error)}. ${left} The old clone is whole in ${saved}. Restore it with: mv ${saved} ${dir}`);
  }
  return [
    `Moved the old clone to ${saved}, with its status and HEAD ${manifest.head.slice(0, 7)} in ${join(backup, 'repair.json')}.`,
    ...(manifest.unpushed.length === 0 ? [] : [`The old clone holds ${manifest.unpushed.length} commits on no GitHub branch it knew. They stay in the backup.`]),
    `${dir} is a fresh clone of ${manifest.remoteBranch} at ${manifest.remoteHead.slice(0, 7)}, clean.`,
    `Copied ${copied.length === 0 ? 'no factory folders' : copied.join(', ')} from the old clone.`,
    `The stuck label and the failures of #${manifest.issue} are cleared. The next tick continues the card.`,
  ];
}

function setAside(dir: string, to: string, fs: RepairFs): string {
  if (!existsSync(dir)) return `${dir} is empty.`;
  try {
    fs.move(dir, to);
    return `The half-made clone is in ${to}, and ${dir} is empty.`;
  } catch (error) {
    return `The half-made clone stays in ${dir}, since it could not move: ${message(error)}. Move it away before the restore.`;
  }
}

type Git = (dir: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

function gitIn(ctx: Ctx): Git {
  return (dir, args) => ctx.run('git', [...NO_HOOKS, ...args], { cwd: dir });
}

async function must(git: Git, dir: string, args: string[]): Promise<string> {
  const result = await git(dir, args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function requireNoJob(state: FactoryState, issue: number): void {
  const own = state.jobs.find((job) => job.issue === issue);
  if (own !== undefined) throw new Error(`A ${own.stage} job of #${issue} is running, pid ${own.pid}. Wait until it ends.`);
}

async function inspect(git: Git, dir: string, issue: number): Promise<OldClone> {
  const headOf = existsSync(join(dir, '.git')) ? await git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']) : null;
  if (headOf === null || headOf.code !== 0) throw new Error(`${dir} holds no clone with a commit, so there is nothing to repair. The next job of #${issue} clones it again.`);
  const branch = await git(dir, ['symbolic-ref', '--short', '--quiet', 'HEAD']);
  return {
    head: headOf.stdout.trim(),
    branch: branch.code === 0 ? branch.stdout.trim() : null,
    status: await must(git, dir, ['status', '--porcelain=v1', '--branch', '--untracked-files=all']),
    open: OPEN_MARKS.filter((name) => existsSync(join(dir, '.git', name))),
    conflicts: lines(await must(git, dir, ['diff', '--name-only', '--diff-filter=U'])),
    unpushed: lines(await must(git, dir, ['rev-list', 'HEAD', '--not', '--remotes=origin'])),
  };
}

function requireRepairable(dir: string, old: OldClone, order: RepairOrder): void {
  if ((old.open.length > 0 || old.conflicts.length > 0) && !order.backupMerge) throw new Error(`${dir} has ${describeOpen(old)}. Add --backup-merge to back it up as it is.`);
  if (order.refuseUnpushed && old.unpushed.length > 0) throw new Error(`${dir} holds ${old.unpushed.length} commits on no GitHub branch, so it stays as it is for a repair by hand.`);
}

function describeOpen(old: OldClone): string {
  const parts = [...old.open.map((mark) => `an open ${mark}`), ...(old.conflicts.length === 0 ? [] : [`${old.conflicts.length} conflicted files`])];
  return parts.join(' and ');
}

function newBackupDir(home: string, issue: number, now: Date): string {
  const root = backupRoot(home);
  mkdirSync(root, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  for (let n = 0; ; n++) {
    const dir = join(root, `issue-${issue}-${stamp}${n === 0 ? '' : `-${n}`}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

function record(backup: string, manifest: Manifest): void {
  writeFileSync(join(backup, 'repair.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function copyFactoryDirs(from: string, to: string, fs: RepairFs): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (FACTORY_DIRS.has(entry.name)) found.push(relative(from, path));
      else walk(path);
    }
  };
  walk(from);
  for (const path of found) fs.copy(join(from, path), join(to, path));
  return found;
}

async function verify(git: Git, dir: string, remoteHead: string): Promise<void> {
  const status = await must(git, dir, ['status', '--porcelain', '--untracked-files=all']);
  if (status.trim() !== '') throw new Error(`the new clone is not clean:\n${status}`);
  const head = (await must(git, dir, ['rev-parse', 'HEAD'])).trim();
  if (head !== remoteHead) throw new Error(`the new clone stands on ${head}, not the branch head ${remoteHead}`);
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
