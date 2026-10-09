import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { must, realRun } from './exec';
import { backupRoot, repairClone, type RepairFs } from './repair-clone';
import { hostRepo } from './repo';
import { EMPTY_STATE, writeState } from './state';
import type { Ctx, FactoryConfig, FactoryState } from './types';

vi.setConfig({ testTimeout: 60_000 });

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
const ORDER = { issue: 5, by: 'hermes', reason: 'merge left the clone dirty', backupMerge: false };
const DEV_FILES = 1284;

async function setup() {
  mkdirSync('tmp', { recursive: true });
  const home = resolve(mkdtempSync(join('tmp', 'factory-repair-')));
  const origin = join(home, 'origin.git');
  const author = join(home, 'author');
  const cfg = { home, repo: 'o/r' } as FactoryConfig;
  const repo = hostRepo(realRun, cfg);
  const statePath = join(home, 'state.json');
  const ctx = { cfg, repo, statePath, run: realRun, now: () => new Date('2026-10-07T10:00:00Z'), log: () => undefined } as unknown as Ctx;
  const git = async (cwd: string, ...a: string[]) => must(await realRun('git', [...ID, ...a], { cwd }), `git ${a.join(' ')}`);
  mkdirSync(origin);
  await git(origin, 'init', '--bare', '-b', 'main');
  await git(home, 'clone', origin, author);
  writeFileSync(join(author, 'f.txt'), 'base\n');
  writeFileSync(join(author, '.gitignore'), 'node_modules/\n');
  await git(author, 'add', '.');
  await git(author, 'commit', '-m', 'base');
  await git(author, 'push', 'origin', 'HEAD:main', 'HEAD:dev', 'HEAD:factory/issue-5');
  await git(home, 'clone', origin, repo.path);
  await repo.fetch();
  const work = join(home, 'work', 'issue-5');
  await repo.prepareWorkClone('factory/issue-5', 'dev', work);
  writeState(statePath, structuredClone(EMPTY_STATE));
  writeFileSync(join(home, 'paused'), 'Paused with factory pause: repair\n');
  const push = async (branch: string, files: Record<string, string>) => {
    await git(author, 'fetch', 'origin');
    await git(author, 'checkout', '-q', '-B', branch, `origin/${branch}`);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(author, name), text);
    await git(author, 'add', '.');
    await git(author, 'commit', '-qm', `${branch} moves`);
    await git(author, 'push', '-q', 'origin', branch);
  };
  const hub = async (ref: string) => (await git(origin, 'rev-parse', ref)).trim();
  const setState = (change: Partial<FactoryState>) => writeState(statePath, { ...structuredClone(EMPTY_STATE), ...change });
  return { home, ctx, git, work, push, hub, setState };
}

function factoryFiles(work: string): void {
  mkdirSync(join(work, 'game', '.factory'), { recursive: true });
  writeFileSync(join(work, 'game', '.factory', 'approval.json'), '{"description":"d","howToTry":"h"}');
  mkdirSync(join(work, 'game', '.factory-tasks'), { recursive: true });
  writeFileSync(join(work, 'game', '.factory-tasks', 'issue-5.md'), '# plan\n');
  mkdirSync(join(work, '.factory-media'), { recursive: true });
  writeFileSync(join(work, '.factory-media', 'ref.png'), 'png');
  mkdirSync(join(work, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(work, 'node_modules', 'pkg', 'index.js'), '');
}

function onlyBackup(home: string): string {
  const dirs = readdirSync(backupRoot(home));
  expect(dirs).toHaveLength(1);
  return join(backupRoot(home), dirs[0]);
}

const manifest = (backup: string) => JSON.parse(readFileSync(join(backup, 'repair.json'), 'utf8'));
const backups = (home: string) => (existsSync(backupRoot(home)) ? readdirSync(backupRoot(home)) : []);

describe('repairClone', () => {
  it(`backs up ${DEV_FILES} staged and unstaged changes of an aborted dev merge and checks out the branch fresh`, async () => {
    const { home, ctx, git, work, push, hub } = await setup();
    await push('dev', Object.fromEntries(Array.from({ length: DEV_FILES }, (_, i) => [`d${i}.txt`, `${i}\n`])));
    await ctx.repo.fetch();
    factoryFiles(work);
    await git(work, 'fetch', '-q', 'origin');
    await git(work, 'merge', '--no-commit', '--no-ff', 'origin/dev');
    for (const mark of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE']) renameSync(join(work, '.git', mark), join(work, `${mark}.gone`));
    writeFileSync(join(work, 'f.txt'), 'unstaged edit\n');
    const oldHead = (await git(work, 'rev-parse', 'HEAD')).trim();

    const out = await repairClone(ctx, ORDER);

    const backup = onlyBackup(home);
    const saved = join(backup, 'clone');
    expect(readFileSync(join(saved, 'd1283.txt'), 'utf8')).toBe('1283\n');
    expect(readFileSync(join(saved, 'f.txt'), 'utf8')).toBe('unstaged edit\n');
    expect(existsSync(join(saved, 'node_modules', 'pkg', 'index.js'))).toBe(true);
    expect((await git(saved, 'diff', '--cached', '--name-only')).split('\n').filter(Boolean)).toHaveLength(DEV_FILES);
    expect(readFileSync(join(backup, 'status.txt'), 'utf8').split('\n').filter((line) => line.startsWith('A '))).toHaveLength(DEV_FILES);
    expect(manifest(backup)).toMatchObject({ issue: 5, by: 'hermes', reason: ORDER.reason, head: oldHead, branch: 'factory/issue-5', outcome: 'repaired', open: [], conflicts: [] });
    expect(await git(work, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect((await git(work, 'rev-parse', 'HEAD')).trim()).toBe(await hub('factory/issue-5'));
    expect(existsSync(join(work, 'd0.txt'))).toBe(false);
    expect(existsSync(join(work, 'node_modules'))).toBe(false);
    expect(out.join('\n')).toContain('factory retry 5');
  });

  it('keeps the factory folders, from any agent folder, in the new clone', async () => {
    const { ctx, work } = await setup();
    factoryFiles(work);
    await repairClone(ctx, ORDER);
    expect(readFileSync(join(work, 'game', '.factory', 'approval.json'), 'utf8')).toContain('howToTry');
    expect(readFileSync(join(work, 'game', '.factory-tasks', 'issue-5.md'), 'utf8')).toBe('# plan\n');
    expect(readFileSync(join(work, '.factory-media', 'ref.png'), 'utf8')).toBe('png');
  });

  it('refuses an open merge with conflicts, and backs it up as it is with --backup-merge', async () => {
    const { home, ctx, git, work, push } = await setup();
    await push('dev', { 'f.txt': 'dev\n' });
    writeFileSync(join(work, 'f.txt'), 'issue\n');
    await git(work, 'commit', '-qam', 'issue work');
    await ctx.repo.fetch();
    await git(work, 'fetch', '-q', 'origin');
    expect((await realRun('git', [...ID, 'merge', 'origin/dev'], { cwd: work })).code).not.toBe(0);

    await expect(repairClone(ctx, ORDER)).rejects.toThrow(/open MERGE_HEAD and 1 conflicted files.*--backup-merge/);
    expect(existsSync(join(work, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(backups(home)).toEqual([]);

    await repairClone(ctx, { ...ORDER, backupMerge: true });
    const backup = onlyBackup(home);
    expect(existsSync(join(backup, 'clone', '.git', 'MERGE_HEAD'))).toBe(true);
    expect(manifest(backup)).toMatchObject({ open: ['MERGE_HEAD'], conflicts: ['f.txt'], outcome: 'repaired' });
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('base\n');
  });

  it('keeps commits that never reached GitHub in the backup and names them', async () => {
    const { home, ctx, git, work, hub } = await setup();
    writeFileSync(join(work, 'f.txt'), 'unpushed\n');
    await git(work, 'commit', '-qam', 'unpushed work');
    const local = (await git(work, 'rev-parse', 'HEAD')).trim();
    const out = await repairClone(ctx, ORDER);
    const backup = onlyBackup(home);
    expect(manifest(backup).unpushed).toEqual([local]);
    expect((await git(join(backup, 'clone'), 'rev-parse', 'HEAD')).trim()).toBe(local);
    expect(out.join('\n')).toContain('1 commits on no GitHub branch');
    expect((await git(work, 'rev-parse', 'HEAD')).trim()).toBe(await hub('factory/issue-5'));
  });

  it('checks out the branch head and dev as GitHub has them now, not as the host clone last saw them', async () => {
    const { ctx, git, work, push, hub } = await setup();
    await push('dev', { 'g.txt': 'new dev\n' });
    await push('factory/issue-5', { 'f.txt': 'pushed by a member\n' });
    await repairClone(ctx, ORDER);
    expect((await git(work, 'rev-parse', 'HEAD')).trim()).toBe(await hub('factory/issue-5'));
    expect((await git(work, 'rev-parse', 'origin/dev')).trim()).toBe(await hub('dev'));
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('pushed by a member\n');
  });

  it('refuses a card whose branch is not on GitHub and leaves its clone', async () => {
    const { home, ctx, git, work } = await setup();
    await git(join(home, 'origin.git'), 'branch', '-D', 'factory/issue-5');
    writeFileSync(join(work, 'f.txt'), 'dirty\n');
    await expect(repairClone(ctx, ORDER)).rejects.toThrow(/unchanged.*factory\/issue-5 is not in the host clone/);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('dirty\n');
    expect(backups(home)).toEqual([]);
  });

  it.each([
    ['no pause', (env: Env) => env.unpause(), 'needs a paused factory'],
    ['a job of the card', (env: Env) => env.setState({ jobs: [job(5)] }), 'A verify job of #5 is running'],
    ['a job of another card', (env: Env) => env.setState({ jobs: [job(9)] }), '1 jobs are running'],
    ['an interrupted job of the card', (env: Env) => env.setState({ interrupted: [5] }), 'continues in this clone'],
  ])('refuses with %s and changes nothing', async (_name, arrange, error) => {
    const env = await setup();
    writeFileSync(join(env.work, 'f.txt'), 'dirty\n');
    arrange({ ...env, unpause: () => renameSync(join(env.home, 'paused'), join(env.home, 'was-paused')) });
    await expect(repairClone(env.ctx, ORDER)).rejects.toThrow(error);
    expect(readFileSync(join(env.work, 'f.txt'), 'utf8')).toBe('dirty\n');
    expect(backups(env.home)).toEqual([]);
  });

  it('refuses a card with no clone', async () => {
    const { ctx, home } = await setup();
    await expect(repairClone(ctx, { ...ORDER, issue: 6 })).rejects.toThrow('nothing to repair');
    expect(backups(home)).toEqual([]);
  });

  it('leaves the clone in place when the move into the backup fails', async () => {
    const { home, ctx, work } = await setup();
    writeFileSync(join(work, 'f.txt'), 'dirty\n');
    const fs: RepairFs = { move: () => { throw new Error('disk gone'); }, copy: () => undefined };
    await expect(repairClone(ctx, ORDER, fs)).rejects.toThrow(/stays where it was: disk gone/);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('dirty\n');
    expect(manifest(onlyBackup(home))).toMatchObject({ outcome: 'failed', error: 'disk gone' });
  });

  it('keeps the whole backup and frees the clone path when the copy fails, so the printed restore works', async () => {
    const { home, ctx, git, work } = await setup();
    factoryFiles(work);
    writeFileSync(join(work, 'f.txt'), 'dirty\n');
    const fs: RepairFs = { move: renameSync, copy: () => { throw new Error('copy broke'); } };
    const failure = await repairClone(ctx, ORDER, fs).catch((error: Error) => error);
    const backup = onlyBackup(home);
    expect(String(failure)).toContain('copy broke');
    expect(String(failure)).toContain(`mv ${join(backup, 'clone')} ${work}`);
    expect(existsSync(work)).toBe(false);
    expect(existsSync(join(backup, 'failed-fresh', '.git'))).toBe(true);
    expect(manifest(backup)).toMatchObject({ outcome: 'failed', error: 'copy broke' });
    renameSync(join(backup, 'clone'), work);
    expect(readFileSync(join(work, 'f.txt'), 'utf8')).toBe('dirty\n');
    expect(readFileSync(join(work, 'game', '.factory-tasks', 'issue-5.md'), 'utf8')).toBe('# plan\n');
    expect(await git(work, 'status', '--porcelain')).toContain('f.txt');
  });

  it('gives each repair of the same card its own backup', async () => {
    const { home, ctx } = await setup();
    await repairClone(ctx, ORDER);
    await repairClone(ctx, ORDER);
    expect(backups(home).sort()).toEqual(['issue-5-2026-10-07T10-00-00-000Z', 'issue-5-2026-10-07T10-00-00-000Z-1']);
  });
});

type Env = Awaited<ReturnType<typeof setup>> & { unpause: () => void };

const job = (issue: number) => ({ id: `j${issue}`, stage: 'verify', issue, pid: 1, startedAt: '2026-10-07T09:00:00Z', log: 'l' }) as FactoryState['jobs'][number];

