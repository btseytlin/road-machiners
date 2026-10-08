import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, FactoryState } from './types';

// Each kind of work clone, and when an idle one still holds work. A folder whose name matches no kind is not the factory's, so it stays.
// `land` belongs to the repo's merge worktree, which cleans itself.
type Keep = (id: number, state: FactoryState, cards: Card[]) => boolean;

// With no card on the board at all, the board read is doubtful, so every issue clone stays.
const openCard: Keep = (id, _state, cards) => cards.length === 0 || cards.some((card) => card.issue === id && card.column !== 'Done');

const NUMBERED = /^(issue|check-issue|adhoc|change|incident)-(\d+)$/;
const KEEP_NUMBERED: Record<string, Keep> = {
  issue: openCard,
  adhoc: openCard,
  'check-issue': () => false,
  change: (id, state) => state.pendingChanges.some((change) => change.id === id),
  incident: (id, state) => state.pendingIncidents.includes(id),
};
// Named clones, the job stages that work in each, and when an idle one still holds work.
const NAMED: Record<string, { stages: string[]; keep: (state: FactoryState) => boolean }> = {
  'dev-build': { stages: ['dev'], keep: () => false },
  'release-main': { stages: ['ship'], keep: () => false },
  'release-candidate': { stages: ['candidate', 'ship'], keep: (state) => state.release !== null },
  'release-playtest': { stages: ['playtest'], keep: () => false },
  'release-baseline': { stages: ['playtest'], keep: () => false },
  waste: { stages: ['waste'], keep: () => false },
  'merge-queue': { stages: ['merge'], keep: () => false },
};
const OWN = new Set(['land']);
// Every stage that works in a clone installs these again, so an idle clone does not need them.
const PACKAGE_DIRS = ['node_modules', 'game/node_modules', 'factory/node_modules', 'quality/node_modules'];

export type Swept = { removed: string[]; stripped: string[]; unknown: string[] };

const isClone = (name: string): boolean => NUMBERED.test(name) || name in NAMED;

// A folder is busy while a job of its own runs or an interrupted job will resume in it.
// Numbers are shared by issues, change ids and incidents, so a running job on N keeps every clone named for N.
function busy(name: string, state: FactoryState): boolean {
  const numbered = NUMBERED.exec(name);
  if (!numbered) return state.jobs.some((job) => NAMED[name].stages.includes(job.stage));
  const id = Number(numbered[2]);
  return state.jobs.some((job) => job.issue === id) || state.interrupted.includes(id);
}

function needed(name: string, state: FactoryState, cards: Card[]): boolean {
  const numbered = NUMBERED.exec(name);
  return numbered ? KEEP_NUMBERED[numbered[1]](Number(numbered[2]), state, cards) : NAMED[name].keep(state);
}

// Returns whether the clone had packages to remove.
function stripPackages(dir: string): boolean {
  const packages = PACKAGE_DIRS.map((sub) => join(dir, sub)).filter((path) => existsSync(path));
  for (const path of packages) rmSync(path, { recursive: true, force: true });
  return packages.length > 0;
}

function sweepOne(workRoot: string, name: string, state: FactoryState, cards: Card[], swept: Swept): void {
  if (!isClone(name)) return void swept.unknown.push(name);
  if (busy(name, state)) return;
  const dir = join(workRoot, name);
  if (!needed(name, state, cards)) {
    rmSync(dir, { recursive: true, force: true });
    return void swept.removed.push(name);
  }
  if (stripPackages(dir)) swept.stripped.push(name);
}

// Deletes the clones of finished work, and the installed packages of the clones that stay idle. Returns what it did.
export function sweepWork(workRoot: string, state: FactoryState, cards: Card[]): Swept {
  const swept: Swept = { removed: [], stripped: [], unknown: [] };
  if (!existsSync(workRoot)) return swept;
  const folders = readdirSync(workRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !OWN.has(entry.name));
  for (const folder of folders) sweepOne(workRoot, folder.name, state, cards, swept);
  return swept;
}

// The tick and update logs are appended forever by design, and a log a failure names stays for Hermes.
const KEEP_LOGS = new Set(['tick.log', 'update.log']);

function oldFile(path: string, cutoff: number): boolean {
  const stat = statSync(path);
  return stat.isFile() && stat.mtimeMs < cutoff;
}

// Deletes job logs older than `days`. Returns the names it removed.
export function sweepLogs(logRoot: string, state: FactoryState, now: Date, days: number): string[] {
  if (!existsSync(logRoot)) return [];
  const cutoff = now.getTime() - days * 24 * 3_600_000;
  const named = new Set(state.failures.map((failure) => failure.log));
  const removed = readdirSync(logRoot).filter((name) => !KEEP_LOGS.has(name) && !named.has(join(logRoot, name)) && oldFile(join(logRoot, name), cutoff));
  for (const name of removed) rmSync(join(logRoot, name));
  return removed;
}

// Deletes files older than `days` under the test cache, then the folders they leave empty. The cache root stays.
// The tool owns the cache format and touches an entry on each hit, so an entry in use keeps a fresh mtime. Returns how many files it removed.
export function sweepTestCache(root: string, now: Date, days: number): number {
  if (!existsSync(root)) return 0;
  return sweepFolder(root, now.getTime() - days * 24 * 3_600_000, true);
}

function sweepFolder(dir: string, cutoff: number, isRoot: boolean): number {
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) removed += sweepFolder(path, cutoff, false);
    else if (oldFile(path, cutoff)) {
      rmSync(path);
      removed++;
    }
  }
  if (!isRoot && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
  return removed;
}
