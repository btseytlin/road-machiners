import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from '../state';
import { ROOT, fake, reset, type Fake } from './test-fakes';
import { change, diffPaths } from './change';

beforeEach(reset);

function pending(f: Fake): void {
  writeState(f.ctx.statePath, { ...EMPTY_STATE, pendingChanges: [{ id: 4, text: 'post daily', by: 'ann' }] });
}

describe('change', () => {
  it('rejects a diff outside factory/', async () => {
    const f = fake();
    pending(f);
    f.diff = 'diff --git a/factory/src/a.ts b/factory/src/a.ts\n+x\ndiff --git a/src/sim/world.ts b/src/sim/world.ts\n+y\n';
    await expect(change(f.ctx, 4)).rejects.toThrow('src/sim/world.ts');
    expect(f.calls.some((call) => call.startsWith('push'))).toBe(false);
    expect(readState(f.ctx.statePath).pendingChanges).toHaveLength(1);
  });

  it('opens a pull request for a factory-only diff and clears the request', async () => {
    const f = fake();
    pending(f);
    f.diff = 'diff --git a/factory/src/a.ts b/factory/src/a.ts\n+x\n';
    f.agentWrites = { 'pr-title.txt': 'Post daily\n' };
    f.ctx.cfg = { ...f.ctx.cfg, designModel: 'opus' };
    const dirs: string[] = [];
    const runs: { model: string; prompt: string }[] = [];
    const agent = f.ctx.container.agent;
    f.ctx.container.agent = async (run) => { dirs.push(run.dir); runs.push(run); await agent(run); };
    const bases: string[] = [];
    const prepare = f.ctx.repo.prepareWorkClone;
    f.ctx.repo.prepareWorkClone = async (branch, base, dir) => { bases.push(base); await prepare(branch, base, dir); };
    await change(f.ctx, 4);
    expect(dirs).toEqual(['factory']);
    expect(runs[0].model).toBe('opus');
    expect(runs[0].prompt).toContain('up:make in hands-off mode on the task file .factory-tasks/change-4.md');
    expect(bases).toEqual(['main']);
    expect(f.calls).toContain('push work-head factory-change/4');
    expect(f.calls).toContain('pr factory-change/4 main Post daily');
    expect(readState(f.ctx.statePath).pendingChanges).toEqual([]);
    expect(f.prBodies.at(-1)).toContain('## Requested by');
    expect(readFileSync(join(ROOT, 'work/change-4/factory/.factory/request.md'), 'utf8')).toContain('ann');
  });

  it('throws for an unknown id', async () => {
    const f = fake();
    await expect(change(f.ctx, 9)).rejects.toThrow('no pending');
  });
});

describe('diffPaths', () => {
  it('lists both sides of a rename', () => {
    expect(diffPaths('diff --git a/factory/a b/docs/b\n')).toEqual(['factory/a', 'docs/b']);
  });
});
