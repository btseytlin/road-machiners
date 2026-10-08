import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE, readState, writeState } from './state';
import { ROOT, fake, reset, type Fake } from './stages/test-fakes';

// The control module has its own tests. These fakes write the inbox file like the real one and let only the name "ann" act.
vi.mock('./control', async (importOriginal) => ({
  DROP_QUEUES: (await importOriginal<{ DROP_QUEUES: readonly string[] }>()).DROP_QUEUES,
  resolveActor: (_ctx: unknown, by: string, gated: boolean) => {
    if (by === 'hermes' && gated) throw new Error('hermes cannot order this');
    if (by !== 'hermes' && by !== 'ann') throw new Error(`unknown actor ${by}`);
    return by;
  },
  isGated: (_ctx: unknown, command: { action: string }) => command.action === 'ship',
  writeControl: (home: string, command: unknown, now: Date) => {
    mkdirSync(join(home, 'inbox'), { recursive: true });
    const path = join(home, 'inbox', `${now.getTime()}-control.json`);
    writeFileSync(path, JSON.stringify({ kind: 'control', ...(command as object) }));
    return path;
  },
}));
// The repair has its own tests with real git. Here it records the order it got.
const repairs: unknown[] = [];
vi.mock('./repair-clone', () => ({ repairClone: async (_ctx: unknown, order: unknown) => { repairs.push(order); return ['repaired']; } }));
const { runCtl } = await import('./ctl');

let out: string[];
beforeEach(() => {
  reset();
  out = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
});
afterEach(() => vi.restoreAllMocks());

const run = (f: Fake, ...args: string[]) => runCtl(f.ctx, args);
const inbox = () => (existsSync(join(ROOT, 'inbox')) ? readdirSync(join(ROOT, 'inbox')) : []);
const stored = () => JSON.parse(readFileSync(join(ROOT, 'inbox', inbox()[0]), 'utf8'));

describe('argument errors', () => {
  it('rejects an unknown command and points to help', async () => {
    await expect(run(fake(), 'dance')).rejects.toThrow('factory help');
    await expect(runCtl(fake().ctx, [])).rejects.toThrow('factory help');
  });

  it('rejects a bad issue number and a bad position', async () => {
    await expect(run(fake(), 'move', 'x', 'design', '--by', 'ann', '--reason', 'r')).rejects.toThrow('not an issue number');
    await expect(run(fake(), 'move', '5', 'limbo', '--by', 'ann', '--reason', 'r')).rejects.toThrow('Unknown position');
    await expect(run(fake(), 'drop', 'bin', '5', '--by', 'ann', '--reason', 'r')).rejects.toThrow('Unknown queue');
    expect(inbox()).toEqual([]);
  });

  it('needs --by and --reason on every write command', async () => {
    await expect(run(fake(), 'move', '5', 'design', '--reason', 'r')).rejects.toThrow('Missing --by');
    await expect(run(fake(), 'move', '5', 'design', '--by', 'ann')).rejects.toThrow('Missing --reason');
    await expect(run(fake(), 'move', '5', 'design', '--by', 'ann', '--reason')).rejects.toThrow('Missing --reason');
    expect(inbox()).toEqual([]);
  });

  it('refuses an unknown actor and a gated order from hermes before writing', async () => {
    await expect(run(fake(), 'cut', '--by', 'bob', '--reason', 'r')).rejects.toThrow('unknown actor');
    await expect(run(fake(), 'ship', '--by', 'hermes', '--reason', 'r')).rejects.toThrow('cannot order');
    expect(inbox()).toEqual([]);
  });
});

describe('write commands', () => {
  it('leaves one inbox file and says it applies on the next tick', async () => {
    await run(fake(), 'move', '5', 'design', '--reason', 'gate failed on load', '--by', 'hermes');
    expect(stored()).toEqual({ kind: 'control', action: 'move', issue: 5, to: 'design', by: 'hermes', reason: 'gate failed on load' });
    expect(out[0]).toContain('next tick');
  });

  it.each([
    [['merge', '5'], { action: 'merge', issue: 5 }],
    [['ship'], { action: 'ship' }],
    [['cut'], { action: 'cut' }],
    [['remove', '5'], { action: 'remove', issue: 5 }],
    [['drop', 'approval', '5'], { action: 'drop', queue: 'approval', id: 5 }],
    [['drop', 'ship'], { action: 'drop', queue: 'ship', id: null }],
    [['merge-change', '9'], { action: 'merge-change', id: 9 }],
    [['pause-card', '5'], { action: 'hold', issue: 5 }],
    [['resume-card', '5'], { action: 'unhold', issue: 5 }],
  ])('%j writes %j', async (args, action) => {
    await run(fake(), ...args, '--by', 'ann', '--reason', 'because');
    expect(stored()).toEqual({ kind: 'control', ...action, by: 'ann', reason: 'because' });
  });
});

describe('write commands while paused', () => {
  it('still writes the order and says it waits for the pause to lift', async () => {
    const f = fake();
    writeFileSync(join(ROOT, 'paused'), 'Paused with factory pause: fixing state\n');
    await run(f, 'cut', '--by', 'ann', '--reason', 'r');
    expect(stored()).toMatchObject({ action: 'cut' });
    expect(out.join('\n')).toContain('The factory is paused: Paused with factory pause: fixing state.');
    expect(out.join('\n')).toContain('applies when the pause is lifted');
  });
});

describe('read commands', () => {
  function board(): Fake {
    const f = fake();
    f.cards = [
      { itemId: 'i5', issue: 5, column: 'Design', labels: ['hotfix'] },
      { itemId: 'i6', issue: 6, column: 'Approval', labels: [] },
    ];
    return f;
  }

  it('audit prints nothing on a clean factory', async () => {
    const f = board();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), approvalPosts: { '77': 6 } });
    await run(f, 'audit');
    expect(out).toEqual([]);
  });

  it('audit prints only the drift lines', async () => {
    writeState(fake().ctx.statePath, { ...structuredClone(EMPTY_STATE), testPhase: { '5': 'checks' } });
    await run(board(), 'audit');
    expect(out).toEqual(['#5 testPhase checks but column Design', '#6 column Approval but no open post and no approval']);
  });

  it('audit skips a card with a running job, and card still shows its drift and the job', async () => {
    const f = board();
    const running = { id: 'j', stage: 'checks' as const, issue: 5, pid: 1, startedAt: '2026-01-01T00:00:00Z', log: 'l' };
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), testPhase: { '5': 'checks' }, jobs: [running], approvalPosts: { '77': 6 } });
    await run(f, 'audit');
    expect(out).toEqual([]);
    await run(f, 'card', '5');
    expect(out).toContain('drift: #5 testPhase checks but column Design');
    expect(out).toContain('note: a checks job is running, so the drift above may pass in seconds');
  });

  it('audit and the other read commands change no store', async () => {
    const f = board();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), testPhase: { '5': 'checks' } });
    const before = readFileSync(f.ctx.statePath, 'utf8');
    for (const args of [['audit'], ['cards'], ['card', '5'], ['jobs'], ['queues'], ['release'], ['failures'], ['help']]) await run(f, ...args);
    expect(readFileSync(f.ctx.statePath, 'utf8')).toBe(before);
    expect(f.calls.filter((call) => /^(comment|move|removeLabel|editIssue)/.test(call))).toEqual([]);
    expect(inbox()).toEqual([]);
  });

  it('cards lists each card with its position', async () => {
    await run(board(), 'cards');
    expect(out).toEqual(['#5 design Design [hotfix]', '#6 approval Approval []']);
  });

  it('card prints one fact per line and its drift', async () => {
    const f = board();
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), testPhase: { '5': 'checks' }, builds: { '5': 'abc1234' } });
    await run(f, 'card', '5');
    expect(out).toContain('position: design');
    expect(out).toContain('labels: hotfix');
    expect(out).toContain('testPhase: checks');
    expect(out).toContain('build: abc1234');
    expect(out).toContain('drift: #5 testPhase checks but column Design');
    await expect(run(f, 'card', '99')).rejects.toThrow('No card');
  });

  it('shows a hold in cards, card, status and audit', async () => {
    const f = board();
    f.ctx.cfg.publicUrl = 'https://play.test';
    f.ctx.fetch = (async () => new Response('{"jobs":[]}')) as unknown as typeof fetch;
    const hold = { by: 'Ann', reason: 'release tasks first', at: '2026-01-01T00:00:00Z', stage: 'design' as const };
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), approvalPosts: { '77': 6 }, held: { '5': hold, '9': hold } });
    await run(f, 'cards');
    expect(out).toContain('#5 design Design [hotfix] held by Ann: release tasks first');
    out.length = 0;
    await run(f, 'card', '5');
    expect(out).toContain('held: by Ann since 2026-01-01T00:00:00Z, stopped design: release tasks first');
    out.length = 0;
    await run(f, 'status');
    expect(JSON.parse(out.join('\n')).held).toEqual([{ issue: 5, ...hold }, { issue: 9, ...hold }]);
    out.length = 0;
    await run(f, 'audit');
    expect(out).toEqual(['#9 held by Ann (release tasks first) but not on the board']);
  });

  it('audit flags a job that runs on a held card, though it skips the card drift of a card with a job', async () => {
    const f = board();
    const hold = { by: 'Ann', reason: 'r', at: 'a', stage: null };
    const job = { id: 'j', stage: 'design' as const, issue: 5, pid: 1, startedAt: 'a', log: 'l' };
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), approvalPosts: { '77': 6 }, held: { '5': hold }, jobs: [job] });
    await run(f, 'audit');
    expect(out).toEqual(['#5 held by Ann (r) but a design job is running']);
  });

  it('help lists every command', async () => {
    await run(fake(), 'help');
    for (const name of ['status', 'cards', 'card N', 'jobs', 'queues', 'release', 'failures', 'log N', 'audit', 'move N', 'merge N', 'ship', 'cut', 'remove N', 'drop', 'merge-change', 'pause-card N', 'resume-card N', 'retry N', 'pause', 'resume', 'repair-clone N']) {
      expect(out.some((line) => line.startsWith(name))).toBe(true);
    }
  });

  it('status asks the dashboard with the curl agent', async () => {
    const f = fake();
    f.ctx.cfg.publicUrl = 'https://play.test';
    const fetchMock = vi.fn(async () => new Response('{"jobs":[]}'));
    f.ctx.fetch = fetchMock as unknown as typeof fetch;
    await run(f, 'status');
    expect(fetchMock).toHaveBeenCalledWith('https://play.test/factory/api/snapshot', { headers: { Accept: 'application/json', 'User-Agent': 'curl/8.0' } });
    expect(out.join('\n')).toContain('"jobs"');
  });

  it('log prints the tail of the newest log of the issue', async () => {
    const f = fake();
    const logs = join(ROOT, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'design-5-1.log'), 'old\n');
    writeFileSync(join(logs, 'issue-5-adhoc.log'), `${Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n')}\n`);
    writeFileSync(join(logs, 'design-6-9.log'), 'other\n');
    utimesSync(join(logs, 'design-5-1.log'), new Date(1000), new Date(1000));
    await run(f, 'log', '5');
    expect(out[0]).toContain('issue-5-adhoc.log');
    expect(out[1]).toContain('line 79');
    expect(out[1]).not.toContain('line 0\n');
    await run(f, 'log', '5', 'design');
    expect(out[2]).toContain('design-5-1.log');
    await expect(run(f, 'log', '7')).rejects.toThrow('No log');
  });
});

const RELEASE = { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, candidateSha: null, removed: [], tasks: [] };

describe('immediate commands', () => {
  it('retry removes the stuck label and only that card failures', async () => {
    const f = fake();
    const failure = (issue: number) => ({ stage: 'checks' as const, issue, error: 'boom', log: null, at: '2026-09-29T09:00:00Z' });
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), failures: [failure(5), failure(6)] });
    await run(f, 'retry', '5');
    expect(f.calls).toContain('removeLabel 5 factory-stuck');
    expect(readState(f.ctx.statePath).failures.map((row) => row.issue)).toEqual([6]);
  });

  it('retry of the release tracking card lifts a playtest block, gives back the runs and keeps the decision and the run count', async () => {
    const f = fake();
    f.ctx.cfg = { ...f.ctx.cfg, playtestRuns: 4 };
    const playtest = { seed: 1, runs: 4, streak: 4, passed: null, blocked: { sha: 'abc1234', reason: 'taste' }, notes: [] };
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, playtest } });
    await run(f, 'retry', String(RELEASE.issue), 'Raiders', 'may', 'chase', 'at', 'night.');
    expect(f.calls).toContain(`removeLabel ${RELEASE.issue} factory-stuck`);
    expect(readState(f.ctx.statePath).release?.playtest).toEqual({ seed: 1, runs: 4, streak: 0, passed: null, blocked: null, notes: ['Raiders may chase at night.'] });
  });

  it('retry of another card leaves the playtest alone', async () => {
    const f = fake();
    const playtest = { seed: 1, runs: 4, streak: 0, passed: null, blocked: { sha: 'abc1234', reason: 'taste' }, notes: [] };
    writeState(f.ctx.statePath, { ...structuredClone(EMPTY_STATE), release: { ...RELEASE, playtest } });
    await run(f, 'retry', '5', 'note');
    expect(readState(f.ctx.statePath).release?.playtest).toEqual(playtest);
  });

  it('pause writes the pause file and resume removes it', async () => {
    const f = fake();
    await run(f, 'pause', 'fixing', 'state');
    expect(readFileSync(join(ROOT, 'paused'), 'utf8')).toBe('Paused with factory pause: fixing state\n');
    await expect(run(f, 'pause')).rejects.toThrow('needs a reason');
    await run(f, 'resume');
    expect(existsSync(join(ROOT, 'paused'))).toBe(false);
  });

  it('repair-clone passes the card, who, why and --backup-merge to the repair and prints its lines', async () => {
    repairs.length = 0;
    await run(fake(), 'repair-clone', '5', '--by', 'hermes', '--reason', 'merge left it dirty');
    await run(fake(), 'repair-clone', '6', '--backup-merge', '--reason', 'open merge', '--by', 'ann');
    expect(repairs).toEqual([
      { issue: 5, by: 'hermes', reason: 'merge left it dirty', backupMerge: false },
      { issue: 6, by: 'ann', reason: 'open merge', backupMerge: true },
    ]);
    expect(out).toContain('repaired');
    expect(inbox()).toEqual([]);
  });

  it('repair-clone refuses a missing --by or --reason, an unknown actor and stray arguments before it repairs', async () => {
    repairs.length = 0;
    await expect(run(fake(), 'repair-clone', '5', '--reason', 'r')).rejects.toThrow('Missing --by');
    await expect(run(fake(), 'repair-clone', '5', '--by', 'hermes')).rejects.toThrow('Missing --reason');
    await expect(run(fake(), 'repair-clone', '5', '--by', 'bob', '--reason', 'r')).rejects.toThrow('unknown actor');
    await expect(run(fake(), 'repair-clone', '5', '6', '--by', 'hermes', '--reason', 'r')).rejects.toThrow('Unexpected "6"');
    await expect(run(fake(), 'repair-clone', 'x', '--by', 'hermes', '--reason', 'r')).rejects.toThrow('not an issue number');
    expect(repairs).toEqual([]);
  });

  it('resume keeps a pause written by hand', async () => {
    writeFileSync(join(ROOT, 'paused'), 'Hermes fixing #5\npid: 12\n');
    await expect(run(fake(), 'resume')).rejects.toThrow('This pause was written by hand or by a member. Once its reason is gone, delete the pause file.');
    expect(existsSync(join(ROOT, 'paused'))).toBe(true);
  });
});
