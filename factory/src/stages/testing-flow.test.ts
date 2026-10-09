import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pngBytes } from '../photo-fixtures';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';
import { BudgetError } from './checkpoint';

vi.mock('../deploy', () => ({ checkScope: () => undefined, publishBuild: (_ctx: unknown, _clone: string, scope: string) => `https://play.test/${scope}/`, recordBuild: () => undefined }));
const { runStage: runPost, approvalCaption, timeoutOnly } = await import('./checks');
const { runStage: runVerify, taskText } = await import('./verify');
const { runStage: runHarden } = await import('./harden');

let home = '';
let calls: string[] = [];
let commentBodies: string[] = [];
let priorComments: { login: string; body: string; createdAt: string }[] = [];
let shellScripts: string[] = [];
let photoButtons: unknown;
let albums: { path: string; caption: string }[][] = [];
let albumFails = false;
let openPr: string | null = null;
let labels: string[] = [];
let bases: string[] = [];
let conflicts: string[] = [];
let merged = true;
let kept: string | null = null;
let changed: string[] = [];
let runs: AgentRun[] = [];

beforeEach(() => {
  albums = [];
  albumFails = false;
  conflicts = [];
  merged = true;
  kept = null;
  changed = ['game/src/sim/far.ts'];
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-testing-');
  calls = [];
  commentBodies = [];
  priorComments = [];
  shellScripts = [];
  openPr = null;
  labels = [];
  bases = [];
  runs = [];
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const TIMEOUT_FAILURE = ' FAIL  src/phys/drive.test.ts > climbs a hill\nError: Test timed out in 30000ms.\nIf this is a long-running test, pass a timeout value.\nError: [vitest-worker]: Timeout calling "onTaskUpdate"';
const result = (cost: number) => `${JSON.stringify({ type: 'result', total_cost_usd: cost, duration_ms: 1000 })}\n`;
const out = (run: AgentRun) => `${run.clone}/${run.dir}/.factory`;
const APPROVAL = JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' });

function fakeCtx(agent: (run: AgentRun, index: number) => void, shellFailures: string[] = [], budget = 10): Ctx {
  const failures = [...shellFailures];
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r', committeeChat: 'chat', gpu: false, testingBudgetUsd: budget },
    log: () => undefined,
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels, createdAt: '', state: 'OPEN', thumbsUp: [] }),
      move: async (issue: number, column: string) => { calls.push(`move ${issue} ${column}`); },
      comment: async (issue: number, body: string) => { calls.push(`comment ${issue}`); commentBodies.push(body); },
      comments: async () => priorComments,
      pullRequestFor: async () => openPr,
      openPullRequest: async (branch: string, base: string, title: string, body: string) => { calls.push(`openPullRequest ${branch} ${base} ${title} | ${body}`); return 'https://github.com/o/r/pull/50'; },
    },
    telegram: {
      sendPhoto: async (chat: string, path: string, caption: string, buttons?: unknown) => { calls.push(`photo ${chat} ${path} ${caption}`); photoButtons = buttons; return 100; },
      sendMessage: async (chat: string, text: string, replyTo?: number) => { calls.push(`message ${replyTo} ${text}`); return 101; },
      sendPhotos: async (_chat: string, photos: { path: string; caption: string }[], replyTo?: number) => {
        calls.push(`album ${photos.length} ${replyTo}`);
        albums.push(photos);
        if (albumFails) throw new Error('Telegram sendMediaGroup failed: boom');
        return photos.map((_, i) => 110 + i);
      },
      editCaption: async (_chat: string, id: number, caption: string) => { calls.push(`editCaption ${id} ${caption}`); },
      sendButtons: async (chat: string, text: string, buttons: unknown) => { calls.push(`buttons ${chat} ${text}`); photoButtons = buttons; return 120; },
    },
    container: {
      agent: async (run: AgentRun): Promise<string> => {
        calls.push('agent');
        runs.push(run);
        if (run.session) {
          mkdirSync(join(run.session.dir, 'project'), { recursive: true });
          writeFileSync(join(run.session.dir, 'project', `${run.session.id}.jsonl`), '');
        }
        agent(run, runs.length - 1);
        return result(1);
      },
      shell: async (_dir: string, script: string) => {
        shellScripts.push(script);
        calls.push('checks');
        const failure = failures.shift();
        if (failure !== undefined) throw new Error(failure);
      },
    },
    repo: {
      prepareWorkClone: async (_b: string, base: string, dir: string) => { bases.push(`prepare ${base}`); mkdirSync(dir, { recursive: true }); },
      readFile: async (branch: string, path: string) => {
        if (branch !== 'dev') throw new Error(`readFile from ${branch}`);
        if (path === 'docs/incident-log.md') return 'ID: R3\nwhat: propsNear scans every prop.\n';
        if (path === 'game/docs/architecture/principles.md') return '## 3. Hot code uses an index\n';
        throw new Error(`no file ${path}`);
      },
      fetchFromWork: async () => 'w1',
      untrackFactoryFiles: async () => [],
      push: async (commit: string, branch: string) => { calls.push(`push ${commit} ${branch}`); },
      diff: async () => '',
      headHash: async () => 'abc123',
      fetch: async () => undefined,
      catchUpBase: async (_dir: string, base: string) => { bases.push(`merge ${base}`); return kept === null ? { commit: 'base0001', conflicts, kept } : { commit: null, conflicts: [], kept }; },
      mergeBranchIntoWork: async () => ({ commit: null, conflicts: [] }),
      isMerged: async () => merged,
      changedFiles: async () => changed,
    },
  };
  return fake as unknown as Ctx;
}

function posts(run: AgentRun): void {
  writeFileSync(`${out(run)}/approval.json`, APPROVAL);
  writeFileSync(`${out(run)}/screenshot.png`, pngBytes(0));
}

describe('testing in one job', () => {
  it('plays, runs the preview checkpoint with no suite, opens the pull request, posts and moves to Approval', async () => {
    await runVerify(fakeCtx(posts), 7);
    expect(calls.filter((call) => call === 'agent')).toHaveLength(1);
    expect(shellScripts).toHaveLength(1);
    expect(shellScripts[0]).toContain('npm run typecheck');
    expect(shellScripts[0]).toContain('npm run playtest -- --cpu');
    expect(shellScripts[0]).not.toContain('test:cached');
    expect(calls.find((call) => call.startsWith('openPullRequest'))).toContain('openPullRequest factory/issue-7 dev #7 Big horn | Closes #7.');
    const photo = calls.find((call) => call.startsWith('photo')) ?? '';
    expect(photo).toContain('#7 Big horn\n\nPlay: https://play.test/abc123/');
    expect(photo).toContain('How to try: Press H.');
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('runs the testing agent on the build model', async () => {
    labels = ['implementation-opus'];
    await runVerify(fakeCtx(posts), 7);
    expect(runs[0]!.model).toBe('sonnet');
  });

  it('hands a failed checkpoint back to the same session, then posts', async () => {
    await runVerify(fakeCtx(posts, ['npm run typecheck failed: TS2304']), 7);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.session).toEqual({ ...runs[0]!.session, resume: true });
    expect(runs[1]!.prompt).toContain("The factory's checks of your pushed branch failed");
    expect(runs[1]!.prompt).toContain('TS2304');
    expect(shellScripts).toHaveLength(2);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('keeps fixing past any round count while the budget lasts', async () => {
    const failures = ['typecheck failed', 'playtest failed', 'build failed', 'typecheck failed'];
    await runVerify(fakeCtx(posts, failures), 7);
    expect(runs).toHaveLength(5);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('stops for Hermes with a BudgetError once the session spent the budget, and posts nothing', async () => {
    await expect(runVerify(fakeCtx(posts, Array(9).fill('typecheck failed'), 3), 7)).rejects.toThrow(BudgetError);
    expect(runs).toHaveLength(3);
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('buttons'))).toBe(false);
  });

  it('treats a missing approval as a checkpoint failure the session fixes', async () => {
    await runVerify(fakeCtx((run, index) => { if (index > 0) posts(run); }), 7);
    expect(runs[1]!.prompt).toContain('wrote no .factory/approval.json');
    expect(shellScripts).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('reruns checks that only timed out with no agent round, and fails for the load after three', async () => {
    await runVerify(fakeCtx(posts, [TIMEOUT_FAILURE]), 7);
    expect(runs).toHaveLength(1);
    expect(shellScripts).toHaveLength(2);
    await expect(runVerify(fakeCtx(posts, [TIMEOUT_FAILURE, TIMEOUT_FAILURE, TIMEOUT_FAILURE]), 8)).rejects.toThrow('timed out 3 times');
  });

  it('sends the card to Design with the reason when the plan is wrong, and runs no checks', async () => {
    await runVerify(fakeCtx((run) => writeFileSync(`${out(run)}/needs-redesign.md`, 'The issue wants a ramp, the plan builds stairs.')), 7);
    expect(commentBodies.at(-1)).toContain('The issue wants a ramp');
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(shellScripts).toEqual([]);
  });

  it('fails the stage when the agent asks the committee', async () => {
    await expect(runVerify(fakeCtx((run) => writeFileSync(`${out(run)}/needs-committee.md`, 'A major save bump.')), 7)).rejects.toThrow('committee decision');
  });

  it('hands an unfinished base merge back to the same session, then posts', async () => {
    merged = false;
    await runVerify(fakeCtx((run, index) => { posts(run); if (index > 0) merged = true; }), 7);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.session).toEqual({ ...runs[0]!.session, resume: true });
    expect(runs[1]!.prompt).toContain('merge of dev at base000 into factory/issue-7 is unfinished');
    expect(runs[1]!.prompt).toContain('git commit --no-edit');
    expect(shellScripts).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('stops with a BudgetError when the merge stays unfinished past the budget', async () => {
    merged = false;
    await expect(runVerify(fakeCtx(posts, [], 3), 7)).rejects.toThrow(BudgetError);
  });

  it('merges dev first and lists conflicts for the agent', async () => {
    conflicts = ['game/src/a.ts'];
    await runVerify(fakeCtx(posts), 7);
    expect(bases).toContain('merge dev');
  });

  it('writes the conflicts of a base merge it resumed for the agent', async () => {
    conflicts = ['game/src/a.ts'];
    await runVerify(fakeCtx((run) => { expect(readFileSync(`${out(run)}/merge-conflicts.md`, 'utf8')).toBe('- game/src/a.ts\n'); posts(run); }), 7);
  });

  it('tells the agent when the clone kept an old base and does not check for a base merge', async () => {
    kept = 'uncommitted changes in f.txt';
    merged = false;
    await runVerify(fakeCtx(posts), 7);
    expect(runs[0]!.prompt).toContain('uncommitted changes in f.txt');
  });

  it('works on the release branch for a release task', async () => {
    labels = ['release-task'];
    await runVerify(fakeCtx(posts), 7);
    expect(bases).toContain('merge release/2026-09-29');
    expect(calls.find((call) => call.startsWith('openPullRequest'))).toContain('release/2026-09-29');
  });

  it('hardens a hotfix and then tests it in one session, with the full suite and the ship button', async () => {
    labels = ['hotfix', 'bug'];
    await runVerify(fakeCtx((run, index) => { if (index === 1) posts(run); }), 7);
    expect(runs[0]!.prompt).toContain('This is the hardening stage');
    expect(runs[0]!.prompt).toContain('ID: R3');
    expect(runs[1]!.prompt).toContain('This is the testing stage');
    expect(runs[1]!.session).toEqual({ ...runs[0]!.session, resume: true });
    expect(shellScripts[0]).toContain('test:cached');
    expect(photoButtons).toEqual([[{ text: 'Approve and ship to players', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
  });

  it('posts a docs change with no agent and only a build', async () => {
    changed = ['docs/guide.md'];
    await runVerify(fakeCtx(posts), 7);
    expect(runs).toEqual([]);
    expect(shellScripts[0]).not.toContain('playtest');
    expect(calls.find((call) => call.startsWith('buttons'))).toContain('Docs only, the game does not change: docs/guide.md');
  });

  it('counts a wiki page as code', async () => {
    changed = ['game/docs/wiki/items.md'];
    await runVerify(fakeCtx(posts), 7);
    expect(runs).toHaveLength(1);
  });

  it('posts a text approval with a warning when there is no screenshot', async () => {
    await runVerify(fakeCtx((run) => writeFileSync(`${out(run)}/approval.json`, APPROVAL)), 7);
    const text = calls.find((call) => call.startsWith('buttons')) ?? '';
    expect(text).toContain('No screenshot. Judge it by playing.');
    expect(commentBodies.find((body) => body.startsWith('Ready for approval'))).toContain('wrote no .factory/screenshot.png');
    expect(readState(`${home}/state.json`).textPosts).toEqual(['120']);
  });

  it('sends the other images as one reply album in manifest order', async () => {
    await runVerify(fakeCtx((run) => {
      posts(run);
      for (const i of [1, 2]) writeFileSync(`${out(run)}/view${i}.png`, pngBytes(i));
      writeFileSync(`${out(run)}/evidence.json`, JSON.stringify({ images: [{ file: 'view2.png', description: 'Two' }, { file: 'view1.png', description: 'One' }] }));
    }), 7);
    expect(albums[0]!.map((photo) => photo.caption)).toEqual(['2/3 Two', '3/3 One']);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
  });

  it('keeps the primary post when the album fails', async () => {
    albumFails = true;
    const ctx = fakeCtx((run) => {
      posts(run);
      writeFileSync(`${out(run)}/view1.png`, pngBytes(1));
      writeFileSync(`${out(run)}/evidence.json`, JSON.stringify({ images: [{ file: 'view1.png', description: 'One' }] }));
    });
    await runVerify(ctx, 7);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
    expect(calls.at(-1)).toBe('move 7 Approval');
  });
});

describe('a patch reply', () => {
  const feedback = { login: 'factory', body: '## Committee feedback\n\nFrom Ann, routed as patch:\n\nMake the horn quieter.', createdAt: '' };
  const post = { login: 'factory', body: 'Ready for approval: https://play.test/a/', createdAt: '' };

  it('is the whole task of the round when it came after the last post', async () => {
    priorComments = [post, feedback];
    await runVerify(fakeCtx(posts), 7);
    expect(runs[0]!.prompt).toContain('Make the horn quieter.');
    expect(runs[0]!.prompt).toContain('It is the whole task of this round');
  });

  it('is not a task once a later post answered it', () => {
    expect(taskText([feedback, post])).toContain('This round gets the change ready');
    expect(taskText([])).toContain('This round gets the change ready');
  });
});

describe('hardening in one session', () => {
  beforeEach(() => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } }));

  it('merges dev, runs one agent with the incident log and the principles, and moves the card to Merging with no checks', async () => {
    await runHarden(fakeCtx(() => undefined), 7);
    expect(bases).toContain('merge dev');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.prompt).toContain('/code-review');
    expect(runs[0]!.prompt).toContain('ID: R3');
    expect(runs[0]!.prompt).toContain('Hot code uses an index');
    expect(shellScripts).toEqual([]);
    expect(calls).toContain('push w1 factory/issue-7');
    expect(calls.at(-1)).toBe('move 7 Merging');
  });

  it('resumes an open base merge and gives its conflicts to the agent', async () => {
    conflicts = ['game/src/a.ts'];
    await runHarden(fakeCtx((run) => { expect(readFileSync(`${out(run)}/merge-conflicts.md`, 'utf8')).toBe('- game/src/a.ts\n'); }), 7);
    expect(runs).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Merging');
  });

  it('tells the agent when the clone kept an old base and does not check for a base merge', async () => {
    kept = 'uncommitted changes in f.txt';
    merged = false;
    await runHarden(fakeCtx(() => undefined), 7);
    expect(runs[0]!.prompt).toContain('uncommitted changes in f.txt');
    expect(calls.at(-1)).toBe('move 7 Merging');
  });

  it('runs no agent for a docs change', async () => {
    changed = ['docs/guide.md'];
    await runHarden(fakeCtx(() => undefined), 7);
    expect(runs).toEqual([]);
    expect(calls.at(-1)).toBe('move 7 Merging');
  });

  it('sends an unfinished base merge back to the same session once', async () => {
    merged = false;
    await runHarden(fakeCtx((_run, index) => { if (index > 0) merged = true; }), 7);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.session).toEqual({ ...runs[0]!.session, resume: true });
    expect(runs[1]!.prompt).toContain('git commit --no-edit');
    expect(calls.at(-1)).toBe('move 7 Merging');
  });

  it('fails when the merge stays unfinished after the second round', async () => {
    merged = false;
    await expect(runHarden(fakeCtx(() => undefined), 7)).rejects.toThrow('is unfinished');
    expect(runs).toHaveLength(2);
  });
});

describe('a post with no checks', () => {
  it('builds once, posts with the no-checks notice and default text, and clears the mark', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), postOnly: [7] });
    await runPost(fakeCtx(() => undefined), 7);
    expect(runs).toEqual([]);
    expect(shellScripts[0]).not.toContain('playtest');
    const text = calls.find((call) => call.startsWith('buttons')) ?? '';
    expect(text).toContain('No factory checks ran on this build.');
    expect(text).toContain('The pull request shows what changed.');
    expect(readState(`${home}/state.json`).postOnly).toEqual([]);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('refuses a card that waits for no post', async () => {
    await expect(runPost(fakeCtx(() => undefined), 7)).rejects.toThrow('not waiting for a post');
  });

  it('throws on a failed build and keeps the mark', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), postOnly: [7] });
    await expect(runPost(fakeCtx(() => undefined, ['build failed']), 7)).rejects.toThrow('The build failed');
    expect(readState(`${home}/state.json`).postOnly).toEqual([7]);
  });
});

describe('captions', () => {
  it('fits long notes into the caption limit', () => {
    const caption = approvalCaption('#7 Big horn', 'https://play.test/x/', 'https://github.com/o/r/issues/7', 'https://github.com/o/r/pull/50', { description: 'd'.repeat(900), howToTry: 'h'.repeat(900) }, 'dev');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('How to try: h');
  });

  it('says a hotfix approval ships to main and itch.io', () => {
    expect(approvalCaption('#7 Fix', 'u', 'l', 'p', { description: 'd', howToTry: 'h' }, 'main')).toContain('HOTFIX');
  });

  it('tells a timeout-only failure from a real one', () => {
    expect(timeoutOnly(TIMEOUT_FAILURE)).toBe(true);
    expect(timeoutOnly(`${TIMEOUT_FAILURE}\nError: expected 1 to be 2`)).toBe(false);
    expect(timeoutOnly('typecheck failed')).toBe(false);
    const hung = '[checks] 10:00:00 tests and typecheck\n\nCheckTimeoutError: the checks ran past their 45 minute limit, and the factory removed their container.';
    expect(timeoutOnly(hung)).toBe(true);
    expect(timeoutOnly(hung.replace('45', '37.5'))).toBe(true);
    expect(timeoutOnly(` FAIL  src/a.test.ts > adds\nAssertionError: expected 1 to be 2\n${hung}`)).toBe(false);
  });
});
