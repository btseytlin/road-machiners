import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { pngBytes } from '../photo-fixtures';
import { EMPTY_STATE, readState, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';

vi.mock('../deploy', () => ({ checkScope: () => undefined, publishBuild: (_ctx: unknown, _clone: string, scope: string) => `https://play.test/${scope}/`, recordBuild: () => undefined }));
const { runStage: runChecks, approvalCaption, approvalButtons, timeoutOnly } = await import('./checks');
const { runStage: runVerify } = await import('./verify');
const { runStage: runPatch } = await import('./patch');

// Runs the Testing column the way the tick does: verify or checks by the card's phase, until the card leaves Testing.
// Verify, checks, the fix round and the second checks make four jobs at most.
async function runStage(ctx: Ctx, issue: number): Promise<void> {
  for (let job = 0; job < 4; job += 1) {
    const phase = readState(ctx.statePath).testPhase[String(issue)];
    await (phase === 'checks' || phase === 'checks-after-fix' ? runChecks(ctx, issue) : runVerify(ctx, issue));
    if (!(String(issue) in readState(ctx.statePath).testPhase)) return;
  }
  throw new Error(`Testing of #${issue} did not leave the column in four jobs`);
}

let home = '';
let calls: string[] = [];
let commentBodies: string[] = [];
// Comments already on the issue before the stage runs.
let priorComments: { login: string; body: string }[] = [];
let shellScript = '';
let shellEnv: Record<string, string> | undefined;
let photoButtons: unknown;
let albums: { path: string; caption: string }[][] = [];
let albumFails = false;
let openPr: string | null = null;
let labels: string[] = [];
let bases: string[] = [];
// The merges testing queued for the approve job.
const queued = (): Record<string, string> => readState(`${home}/state.json`).pendingApprovals;
let conflicts: string[] = [];
let merged = true;
// The review agent's outputs in order. A null means it wrote no file. Rounds past the list get a clean review.
let reviews: (string | null)[] = [];
const PASSED = 'No blocking issue.\n\nREVIEW_VERDICT: PASS\n';
const failed = (finding: string): string => `${finding}\n\nREVIEW_VERDICT: FAIL\n`;
// How-to sentences the posts no longer carry. The buttons and the docs explain them.
const BOILERPLATE = ['Approve runs the review', 'Deny closes the issue', 'Reply to this post'];
// The prompt of every review round, in order.
let reviewPrompts: string[] = [];

beforeEach(() => {
  albums = [];
  albumFails = false;
  reviews = [];
  reviewPrompts = [];
  conflicts = [];
  merged = true;
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-testing-');
  calls = [];
  commentBodies = [];
  priorComments = [];
  openPr = null;
  labels = [];
  bases = [];
  writeState(`${home}/state.json`, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [], candidateSha: null, playtest: { seed: 1, runs: 0, streak: 0, passed: null, blocked: null, notes: [] } } });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const TIMEOUT_FAILURE = ' FAIL  src/phys/drive.test.ts > climbs a hill\nError: Test timed out in 30000ms.\nIf this is a long-running test, pass a timeout value.\nError: [vitest-worker]: Timeout calling "onTaskUpdate"';

function fakeCtx(agent: (run: AgentRun) => void, shellFailures = 0, failureText = 'npm test failed: 1 failed'): Ctx {
  let failuresLeft = shellFailures;
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet', repo: 'o/r', committeeChat: 'chat', gpu: false },
    log: () => undefined,
    statePath: `${home}/state.json`,
    now: () => new Date('2026-09-30T10:00:00Z'),
    github: {
      issue: async () => ({ number: 7, title: 'Big horn', body: '', labels, createdAt: '', state: 'OPEN', thumbsUp: [] }),
      move: async (issue: number, column: string) => { calls.push(`move ${issue} ${column}`); },
      comment: async (issue: number, body: string) => { calls.push(`comment ${issue}`); commentBodies.push(body); },
      comments: async () => priorComments,
      pullRequestFor: async (branch: string) => { calls.push(`pullRequestFor ${branch}`); return openPr; },
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
      agent: async (run: AgentRun) => {
        if (!run.prompt.includes('review round')) return agent(run);
        calls.push(`review ${run.model} ${run.skill}`);
        reviewPrompts.push(run.prompt);
        const output = reviews.length > 0 ? reviews.shift() : PASSED;
        if (typeof output === 'string') writeFileSync(`${run.clone}/${run.dir}/.factory/review.md`, output);
      },
      shell: async (_dir: string, script: string, _log: string, env?: Record<string, string>) => {
        shellScript = script;
        shellEnv = env;
        calls.push('checks');
        if (failuresLeft-- > 0) throw new Error(failureText);
      },
    },
    repo: {
      prepareWorkClone: async (_b: string, base: string, dir: string) => { bases.push(`prepare ${base}`); mkdirSync(dir, { recursive: true }); },
      // The review reads the incident log and the principles from dev, whatever the card's base.
      readFile: async (branch: string, path: string) => {
        if (branch !== 'dev') throw new Error(`readFile from ${branch}`);
        if (path === 'docs/incident-log.md') return 'ID: R3\nwhat: propsNear scans every prop.\n';
        if (path === 'game/docs/architecture/principles.md') return '## 3. Hot code uses an index\n';
        throw new Error(`no file ${path}`);
      },
      fetchFromWork: async () => 'w1',
      untrackFactoryFiles: async () => [],
      push: async (commit: string, branch: string) => { calls.push(`push ${commit} ${branch}`); },
      diff: async (base: string) => { bases.push(`diff ${base}`); return ''; },
      headHash: async () => 'abc123',
      fetch: async () => { bases.push('fetch'); },
      mergeBaseIntoWork: async (_dir: string, base: string) => { bases.push(`merge ${base}`); return { commit: 'base0001', conflicts }; },
      mergeBranchIntoWork: async () => ({ commit: null, conflicts: [] }),
      isMerged: async (base: string) => { bases.push(`isMerged ${base}`); return merged; },
    },
  };
  return fake as unknown as Ctx;
}

// The agent's honest reading of images it opened: every image and feature judged, unless the test overrides a field.
function visualReview(out: string, features: { name: string }[], files: string[], overrides: Partial<Record<string, unknown>> = {}): object {
  const read = (file: string) => ({ file, sha256: createHash('sha256').update(readFileSync(`${out}/${file}`)).digest('hex'), observations: `The ${file} view shows the change as the issue describes.`, verdict: 'correct' });
  return {
    commit: 'abc1234', visual: true, repairs: 0, images: files.map(read),
    decisions: features.map((feature) => ({ feature: feature.name, verdict: 'correct', notes: `${feature.name} fits the issue and DESIGN.md.` })),
    mismatches: [], ...overrides,
  };
}

const NONVISUAL = { commit: 'abc1234', visual: false, reason: 'A rule changed and nothing on screen moved.' };

// By default the agent reports a change nobody can see, so the tests of the other rules need no images.
function writeOutputs(run: AgentRun, approval: string | null, review: object = NONVISUAL): void {
  if (approval !== null) writeFileSync(`${run.clone}/${run.dir}/.factory/approval.json`, approval);
  writeFileSync(`${run.clone}/${run.dir}/.factory/screenshot.png`, 'png');
  writeFileSync(`${run.clone}/${run.dir}/.factory/visual-review.json`, JSON.stringify(review));
}

describe('testing stage', () => {
  it('opens a pull request against dev when none is open', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    const opened = calls.find((call) => call.startsWith('openPullRequest')) ?? '';
    expect(opened).toContain('openPullRequest factory/issue-7 dev #7 Big horn | Closes #7.');
    expect(opened).toContain('A loud horn.');
    expect(opened).toContain('How to try: Press H.');
    expect(opened).toContain('The factory merges it when the committee approves.');
  });

  it('closes every bundled issue from the pull request too', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), bundles: { '7': [9, 12] } });
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    expect(calls.find((call) => call.startsWith('openPullRequest'))).toContain('| Closes #7, #9, #12.');
  });

  it('reuses the open pull request of the branch', async () => {
    openPr = 'https://github.com/o/r/pull/12';
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('openPullRequest'))).toBe(false);
    expect(calls.find((call) => call.startsWith('photo'))).toContain('PR: https://github.com/o/r/pull/12');
  });

  it('plays every turn with the frame rate check when the host has a GPU', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    ctx.cfg.gpu = true;
    await runStage(ctx, 7);
    expect(shellScript).toContain('\nnpm run playtest\n');
    expect(shellScript).not.toContain('--cpu');
  });

  it('posts one photo with everything in the caption, records it and moves to Approval', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' })));
    await runStage(ctx, 7);
    expect(shellScript).toContain('npm run playtest -- --cpu');
    expect(shellScript).toContain('seq 1 60');
    expect(shellScript).toContain('SAVE_SCOPE="$BUILD_SCOPE" npm run build');
    expect(shellEnv).toEqual({ BUILD_SCOPE: 'abc123' });
    const photo = calls.find((call) => call.startsWith('photo')) ?? '';
    expect(photo).toContain('#7 Big horn\n\nPlay: https://play.test/abc123/');
    expect(photo).toContain('How to try: Press H.');
    expect(photo).toContain('Issue: https://github.com/o/r/issues/7\nPR: https://github.com/o/r/pull/50');
    expect(photo.trimEnd().endsWith('How to try: Press H.')).toBe(true);
    for (const tail of BOILERPLATE) expect(photo).not.toContain(tail);
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(calls.some((call) => call.startsWith('message'))).toBe(false);
    expect(calls).toContain('comment 7');
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('fits long notes into the caption limit', () => {
    const caption = approvalCaption('#7 Big horn', 'https://play.test/x/', 'https://github.com/o/r/issues/7', 'https://github.com/o/r/pull/50', { description: 'd'.repeat(900), howToTry: 'h'.repeat(900) }, 'dev');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toContain('…');
    expect(caption).toContain('How to try: h');
    expect(caption).not.toContain('Deny closes the issue');
  });

  it('uses the room of the dropped tail for the notes', () => {
    const description = 'd'.repeat(800);
    const caption = approvalCaption('#7 Big horn', 'https://play.test/x/', 'https://github.com/o/r/issues/7', 'https://github.com/o/r/pull/50', { description, howToTry: 'Press H.' }, 'dev');
    expect(caption).toContain(description);
    expect(caption.endsWith('How to try: Press H.')).toBe(true);
  });

  it('says a hotfix approval ships to main and itch.io', () => {
    const caption = approvalCaption('#7 Big horn', 'u', 'l', 'p', { description: 'd', howToTry: 'h' }, 'main');
    expect(caption.startsWith('⚠️ HOTFIX. Approve merges into main and ships to players at once.')).toBe(true);
    for (const tail of BOILERPLATE) expect(caption).not.toContain(tail);
    expect(caption).not.toContain('Approve ships this hotfix');
    expect(approvalCaption('#7 Big horn', 'u', 'l', 'p', { description: 'd', howToTry: 'h' }, 'dev')).not.toContain('HOTFIX');
    expect(approvalButtons(7, 'main')[0][0]).toEqual({ text: 'Approve and ship to players', data: 'factory:approve:7' });
  });

  it('throws when approval.json lacks howToTry', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'x' })));
    await expect(runStage(ctx, 7)).rejects.toThrow('howToTry');
    expect(calls).toEqual([]);
  });

  it('throws when approval.json is missing', async () => {
    await expect(runStage(fakeCtx((run) => writeOutputs(run, null)), 7)).rejects.toThrow('approval.json');
  });

  it('gives the agent one fix round when the checks fail, then posts', async () => {
    const prompts: string[] = [];
    const ctx = fakeCtx((run) => { prompts.push(run.prompt); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('second round');
    expect(readFileSync(`${home}/work/issue-7/game/.factory/check-failure.md`, 'utf8')).toContain('npm test failed');
    expect(calls.filter((call) => call === 'checks')).toHaveLength(2);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('runs every testing round on the build model by default', async () => {
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['sonnet', 'sonnet']);
  });

  it('runs the test round and the check-fix retry on Sonnet even with implementation-opus', async () => {
    labels = ['implementation-opus'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['sonnet', 'sonnet']);
  });

  it('keeps verify on Sonnet when an implementation label changes between rounds', async () => {
    labels = ['implementation-opus'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); labels = []; writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runStage(ctx, 7);
    expect(models).toEqual(['sonnet', 'sonnet']);
  });

  it('keeps verify on Sonnet when a conflict sends the card back to testing', async () => {
    labels = ['implementation-opus'];
    conflicts = ['game/src/a.ts'];
    const models: string[] = [];
    const ctx = fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); });
    await runStage(ctx, 7);
    await runStage(fakeCtx((run) => { models.push(run.model); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }), 7);
    expect(models).toEqual(['sonnet', 'sonnet']);
  });

  it('reruns checks that only timed out, with no agent round, then posts', async () => {
    const prompts: string[] = [];
    const ctx = fakeCtx((run) => { prompts.push(run.prompt); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 2, TIMEOUT_FAILURE);
    await runStage(ctx, 7);
    expect(prompts).toHaveLength(1);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(3);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('fails with the load reason after three timed-out runs, with no agent round', async () => {
    const prompts: string[] = [];
    const ctx = fakeCtx((run) => { prompts.push(run.prompt); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 3, TIMEOUT_FAILURE);
    await expect(runStage(ctx, 7)).rejects.toThrow('The factory checks timed out 3 times, under load');
    expect(prompts).toHaveLength(1);
    expect(calls).not.toContain('move 7 Approval');
  });

  it('tells a timeout-only failure from a real one', () => {
    expect(timeoutOnly(TIMEOUT_FAILURE)).toBe(true);
    expect(timeoutOnly(`${TIMEOUT_FAILURE}\nAssertionError: expected 3 to be 4`)).toBe(false);
    expect(timeoutOnly('playtest: the truck never moved')).toBe(false);
  });

  it('stops after the checks fail twice, and clears the phase so a retry starts from verify', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })), 2);
    await expect(runStage(ctx, 7)).rejects.toThrow('The factory checks failed twice');
    expect(calls).not.toContain('move 7 Approval');
    expect(readState(ctx.statePath).testPhase).toEqual({});
  });

  it('runs no agent in a checks job, and hands a first failure to verify without throwing', async () => {
    const agents: string[] = [];
    const ctx = fakeCtx((run) => { agents.push(run.prompt); writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })); }, 1);
    await runVerify(ctx, 7);
    expect(readState(ctx.statePath).testPhase).toEqual({ 7: 'checks' });
    const before = agents.length;
    await runChecks(ctx, 7);
    expect(agents).toHaveLength(before);
    expect(readState(ctx.statePath).testPhase).toEqual({ 7: 'fix' });
    expect(calls).not.toContain('move 7 Approval');
    await runVerify(ctx, 7);
    expect(agents.at(-1)).toContain('second round');
    expect(readState(ctx.statePath).testPhase).toEqual({ 7: 'checks-after-fix' });
    await runChecks(ctx, 7);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(readState(ctx.statePath).testPhase).toEqual({});
  });

  it('refuses checks for a card verify has not finished', async () => {
    await expect(runChecks(fakeCtx(() => undefined), 7)).rejects.toThrow('not ready for checks, its test phase is none');
  });

  describe('post phase', () => {
    const outDir = (): string => `${home}/work/issue-7/game/.factory`;
    const leaveOutputs = (approval: string | null): void => {
      mkdirSync(outDir(), { recursive: true });
      if (approval !== null) writeFileSync(`${outDir()}/approval.json`, approval);
      writeFileSync(`${outDir()}/screenshot.png`, 'png');
    };
    const setPost = (): void => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), testPhase: { 7: 'post' } });

    it('builds once with no test, no playtest and no agent, posts, and moves to Approval', async () => {
      leaveOutputs(JSON.stringify({ description: 'A loud horn.', howToTry: 'Press H.' }));
      setPost();
      const agents: string[] = [];
      const ctx = fakeCtx((run) => agents.push(run.prompt));
      await runChecks(ctx, 7);
      expect(agents).toEqual([]);
      expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
      expect(shellScript).toContain('npm ci');
      expect(shellScript).toContain('SAVE_SCOPE="$BUILD_SCOPE" npm run build');
      expect(shellScript).not.toContain('npm test');
      expect(shellScript).not.toContain('playtest');
      expect(shellEnv).toEqual({ BUILD_SCOPE: 'abc123' });
      expect(calls.find((call) => call.startsWith('photo'))).toContain('No factory checks ran on this build.');
      expect(commentBodies[0]).toContain('No factory checks ran on this build.');
      expect(readState(ctx.statePath).approvalPosts).toEqual({ 100: 7 });
      expect(readState(ctx.statePath).testPhase).toEqual({});
      expect(calls.at(-1)).toBe('move 7 Approval');
    });

    it('throws on a failed build, runs it once and keeps the phase', async () => {
      leaveOutputs(JSON.stringify({ description: 'd', howToTry: 'h' }));
      setPost();
      await expect(runChecks(fakeCtx(() => undefined, 1, 'vite build failed'), 7)).rejects.toThrow('The build failed, no factory checks ran');
      expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
      expect(calls).not.toContain('move 7 Approval');
      expect(readState(`${home}/state.json`).testPhase).toEqual({ 7: 'post' });
    });

    it('fails naming approval.json when the card has none', async () => {
      leaveOutputs(null);
      setPost();
      await expect(runChecks(fakeCtx(() => undefined), 7)).rejects.toThrow('approval.json');
      expect(calls).toEqual([]);
    });

    it('queues the merge of an already approved card and posts nothing', async () => {
      leaveOutputs(null);
      setPost();
      writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
      await runChecks(fakeCtx(() => undefined), 7);
      expect(calls.some((call) => call.startsWith('photo') || call.startsWith('buttons'))).toBe(false);
      expect(queued()).toEqual({ 7: 'Ann' });
      expect(calls.at(-1)).toBe('move 7 Approval');
    });
  });

  describe('test modes', () => {
    // The first line of each agent prompt names its round.
    let rounds: string[] = [];
    const agent = (run: AgentRun): void => {
      rounds.push(run.prompt.split('\n')[0]);
      if (!run.prompt.startsWith('This is the hardening round')) writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' }));
    };
    beforeEach(() => { rounds = []; });

    it('previews a new card with the test round only, no review, then posts it', async () => {
      await runStage(fakeCtx(agent), 7);
      expect(rounds).toEqual(['This is the testing stage of the ROAM factory.']);
      expect(calls.some((call) => call.startsWith('review'))).toBe(false);
      expect(calls.some((call) => call.startsWith('photo'))).toBe(true);
      expect(queued()).toEqual({});
    });

    it('hardens an approved card with the review and no evidence, then queues its merge with no post', async () => {
      writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
      await runStage(fakeCtx(agent), 7);
      expect(rounds).toEqual(['This is the hardening round of the testing stage of the ROAM factory.']);
      expect(calls.filter((call) => call.startsWith('review'))).toHaveLength(1);
      expect(existsSync(`${home}/work/issue-7/game/.factory/approval.json`)).toBe(false);
      expect(calls.some((call) => call.startsWith('photo'))).toBe(false);
      expect(queued()).toEqual({ 7: 'Ann' });
    });

    it('hardens a hotfix and reviews it before the test round that shows it, then posts it', async () => {
      labels = ['hotfix'];
      await runStage(fakeCtx(agent), 7);
      expect(rounds).toEqual(['This is the hardening round of the testing stage of the ROAM factory.', 'This is the testing stage of the ROAM factory.']);
      expect(calls.findIndex((call) => call.startsWith('review'))).toBeLessThan(calls.indexOf('checks'));
      expect(calls.some((call) => call.startsWith('photo'))).toBe(true);
    });

    it('asks a hardening fix round for no evidence', async () => {
      writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
      const prompts: string[] = [];
      await runStage(fakeCtx((run) => { prompts.push(run.prompt); agent(run); }, 1), 7);
      expect(prompts[1]).toContain('second round');
      expect(prompts[1]).toContain('No post follows this round');
      expect(prompts[1]).not.toContain('evidence.json');
      expect(queued()).toEqual({ 7: 'Ann' });
    });
  });

  describe('review round', () => {
    const outputs = (run: AgentRun): void => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' }));
    // The review runs in the hardening round, after the committee approved the preview.
    beforeEach(() => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } }));

    it('runs /code-review once on Sonnet after the hardening round and before the checks', async () => {
      await runStage(fakeCtx(outputs), 7);
      expect(calls.filter((call) => call.startsWith('review'))).toEqual(['review sonnet /code-review']);
      expect(calls.indexOf('review sonnet /code-review')).toBeLessThan(calls.indexOf('checks'));
      expect(calls.at(-1)).toBe('move 7 Approval');
    });

    it('keeps review on Sonnet for an implementation-opus issue', async () => {
      labels = ['implementation-opus'];
      await runStage(fakeCtx(outputs), 7);
      expect(calls.filter((call) => call.startsWith('review'))).toEqual(['review sonnet /code-review']);
    });

    it('pastes the incident log and the principles of the clone into the review prompt', async () => {
      await runStage(fakeCtx(outputs), 7);
      expect(reviewPrompts[0]).toContain('ID: R3\nwhat: propsNear scans every prop.');
      expect(reviewPrompts[0]).toContain('## 3. Hot code uses an index');
      expect(reviewPrompts[0]).toContain('git diff origin/dev...HEAD');
    });

    it('fails on a FAIL verdict, runs one fix round with the review, then passes a second review', async () => {
      reviews = [failed('propsNear scans every prop per check. R3.')];
      const prompts: string[] = [];
      let seen = '';
      const ctx = fakeCtx((run) => {
        prompts.push(run.prompt);
        if (run.prompt.includes('second round')) seen = readFileSync(`${run.clone}/${run.dir}/.factory/review-findings.md`, 'utf8');
        outputs(run);
      });
      await runStage(ctx, 7);
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toContain('second round');
      expect(seen).toBe('propsNear scans every prop per check. R3.\n\nREVIEW_VERDICT: FAIL\n');
      expect(calls.filter((call) => call.startsWith('review'))).toHaveLength(2);
      expect(existsSync(`${home}/work/issue-7/game/.factory/review-findings.md`)).toBe(false);
      expect(calls.at(-1)).toBe('move 7 Approval');
    });

    it('sends the card back to Design with the review when the second review fails again', async () => {
      reviews = [failed('First review.'), failed('Hot scan in far.ts. Principle 3.')];
      await runStage(fakeCtx(outputs), 7);
      expect(commentBodies).toHaveLength(1);
      expect(commentBodies[0]).toContain('## Review findings');
      expect(commentBodies[0]).toContain('Hot scan in far.ts. Principle 3.');
      expect(calls.at(-1)).toBe('move 7 Design');
      expect(calls).not.toContain('checks');
      expect(calls).not.toContain('move 7 Approval');
      expect(existsSync(`${home}/work/issue-7/game/.factory/review-findings.md`)).toBe(false);
      expect(readState(`${home}/state.json`).approvedResolving).toEqual({});
    });

    it('throws instead of a second redesign when the card already came back from the review once', async () => {
      priorComments = [{ login: 'factory', body: '## Review findings\n\nThe review failed this change twice.' }];
      reviews = [failed('First review.'), failed('Still scans every prop.')];
      await expect(runStage(fakeCtx(outputs), 7)).rejects.toThrow('The review failed the change twice again after a redesign.\nStill scans every prop.');
      expect(commentBodies).toHaveLength(0);
      expect(calls).not.toContain('move 7 Design');
      expect(calls).not.toContain('checks');
    });

    it('throws when review.md is missing', async () => {
      reviews = [null];
      await expect(runStage(fakeCtx(outputs), 7)).rejects.toThrow('wrote no .factory/review.md');
      expect(calls).not.toContain('checks');
    });

    it.each([
      ['Looks fine.\n', 'must end with REVIEW_VERDICT: PASS or REVIEW_VERDICT: FAIL'],
      ['REVIEW_VERDICT: PASS\nMore text after the verdict.\n', 'must end with'],
      ['REVIEW_VERDICT: FAIL\nOn second thought.\nREVIEW_VERDICT: PASS\n', 'names both verdicts'],
    ])('throws on a review with no clear verdict: %s', async (output, message) => {
      reviews = [output];
      await expect(runStage(fakeCtx(outputs), 7)).rejects.toThrow(message);
      expect(calls).not.toContain('checks');
    });

    it('does not reuse the first review file for the second review', async () => {
      reviews = [failed('First review.'), null];
      await expect(runStage(fakeCtx(outputs), 7)).rejects.toThrow('wrote no .factory/review.md');
    });
  });

  it('works on the release branch for a release task and merges there', async () => {
    labels = ['release-task'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(new Set(bases)).toEqual(new Set(['prepare release/2026-09-29', 'fetch','merge release/2026-09-29', 'isMerged base0001', 'diff release/2026-09-29']));
    expect(calls.find((call) => call.startsWith('openPullRequest'))).toContain('openPullRequest factory/issue-7 release/2026-09-29 #7 Big horn');
    expect(calls.find((call) => call.startsWith('photo'))).not.toContain('Approve runs the review');
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(queued()).toEqual({});
  });

  it('works on dev for an ordinary card even while a release is open', async () => {
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(new Set(bases)).toEqual(new Set(['prepare dev', 'fetch','merge dev', 'isMerged base0001', 'diff dev']));
  });

  it('merges dev into the branch before the agent runs, and lists conflicts for it', async () => {
    conflicts = ['game/src/a.ts', 'game/src/b.ts'];
    let seen = '';
    const ctx = fakeCtx((run) => {
      seen = readFileSync(`${run.clone}/${run.dir}/.factory/merge-conflicts.md`, 'utf8');
      writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' }));
    });
    await runStage(ctx, 7);
    expect(bases.indexOf('merge dev')).toBeLessThan(bases.indexOf('diff dev'));
    expect(seen).toBe('- game/src/a.ts\n- game/src/b.ts\n');
  });

  it('fails the stage when the agent leaves the merge of dev unfinished', async () => {
    merged = false;
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await expect(runStage(ctx, 7)).rejects.toThrow('left the merge of dev at base000 into factory/issue-7 unfinished');
    expect(calls).not.toContain('checks');
  });

  it('resolves a conflict that stopped approve with a merge agent alone, then checks and queues the merge', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' }, testPhase: { 7: 'resolve' } });
    conflicts = ['game/src/a.ts'];
    const prompts: string[] = [];
    await runStage(fakeCtx((run) => { prompts.push(run.prompt); }), 7);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('This is a merge round of the ROAM factory.');
    expect(prompts[0]).toContain('merged the current dev into your branch');
    expect(prompts[0]).toContain('- game/src/a.ts');
    expect(calls.some((call) => call.startsWith('review'))).toBe(false);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(calls.some((call) => call.startsWith('photo'))).toBe(false);
    expect(queued()).toEqual({ 7: 'Ann' });
  });

  it('runs no agent when the base merges cleanly after a conflict at approve', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' }, testPhase: { 7: 'resolve' } });
    const prompts: string[] = [];
    await runStage(fakeCtx((run) => { prompts.push(run.prompt); }), 7);
    expect(prompts).toEqual([]);
    expect(calls).toContain('push w1 factory/issue-7');
    expect(queued()).toEqual({ 7: 'Ann' });
  });

  it('fails the stage when the merge agent leaves the merge of the base unfinished', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' }, testPhase: { 7: 'resolve' } });
    conflicts = ['game/src/a.ts'];
    merged = false;
    await expect(runStage(fakeCtx(() => undefined), 7)).rejects.toThrow('left the merge of dev at base000 into factory/issue-7 unfinished');
    expect(calls).not.toContain('checks');
  });

  it('merges a cleanup task into the release itself, with no committee post', async () => {
    labels = ['release-task', 'maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('openPullRequest') || call === 'comment 7')).toBe(false);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(queued()).toEqual({ 7: 'the factory' });
  });

  it('queues the merge of a card approved before a conflict sent it back, with no new post', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo'))).toBe(false);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(queued()).toEqual({ 7: 'Ann' });
  });

  it('posts a maintenance task on dev for approval as usual', async () => {
    labels = ['maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })));
    await runStage(ctx, 7);
    expect(calls.some((call) => call.startsWith('photo'))).toBe(true);
    expect(queued()).toEqual({});
  });

  it('does not merge a cleanup task when the checks fail twice', async () => {
    labels = ['release-task', 'maintenance'];
    const ctx = fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' })), 2);
    await expect(runStage(ctx, 7)).rejects.toThrow('checks failed twice');
    expect(queued()).toEqual({});
  });
});

describe('testing stage evidence', () => {
  type Feature = { name: string; kind: string };
  const horn: Feature = { name: 'Horn', kind: 'other' };
  const yard: Feature = { name: 'Yard', kind: 'location' };
  // Writes real images view0..N-1 (view0 is screenshot.png) and a manifest. `covers[i]` names what image i shows.
  function writeEvidence(run: AgentRun, features: Feature[], covers: string[][], commit = 'abc1234', review: Partial<Record<string, unknown>> = {}): void {
    const out = `${run.clone}/${run.dir}/.factory`;
    writeFileSync(`${out}/approval.json`, JSON.stringify({ description: 'd', howToTry: 'h' }));
    const images = covers.map((names, i) => {
      const file = i === 0 ? 'screenshot.png' : `view${i}.png`;
      writeFileSync(`${out}/${file}`, pngBytes(i));
      return { file, description: `View ${i}`, covers: names };
    });
    writeFileSync(`${out}/evidence.json`, JSON.stringify({ commit, features, images }));
    writeFileSync(`${out}/visual-review.json`, JSON.stringify(visualReview(out, features, images.map((image) => image.file), review)));
  }
  const items = (count: number): Feature[] => Array.from({ length: count }, (_, i) => ({ name: `Item ${i}`, kind: 'item' }));
  const each = (count: number): string[][] => Array.from({ length: count }, (_, i) => [`Item ${i}`]);

  it('keeps one actionable primary post and sends no album for one image', async () => {
    await runStage(fakeCtx((run) => writeEvidence(run, [horn], [['Horn']])), 7);
    expect(calls.filter((call) => call.startsWith('photo'))).toHaveLength(1);
    expect(albums).toEqual([]);
  });

  it('sends one reply photo to the primary for two images, and registers only the primary', async () => {
    await runStage(fakeCtx((run) => writeEvidence(run, items(2), each(2))), 7);
    expect(calls.filter((call) => call.startsWith('photo'))).toHaveLength(1);
    expect(calls).toContain('album 1 100');
    expect(albums[0]!.map((photo) => photo.caption)).toEqual(['2/2 View 1']);
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
    expect(Object.keys(readState(`${home}/state.json`).postCaptions)).toEqual(['100']);
    expect(calls.indexOf('album 1 100')).toBeLessThan(calls.indexOf('move 7 Approval'));
  });

  it('sends nine supplements as one album in manifest order for ten images', async () => {
    await runStage(fakeCtx((run) => writeEvidence(run, items(10), each(10))), 7);
    expect(calls).toContain('album 9 100');
    expect(albums[0]!.map((photo) => photo.caption)).toEqual(Array.from({ length: 9 }, (_, i) => `${i + 2}/10 View ${i + 1}`));
    expect(albums[0]![0]!.path.endsWith('view1.png')).toBe(true);
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({ 100: 7 });
  });

  it.each<[string, (run: AgentRun) => void, string]>([
    ['more than ten images', (run) => writeEvidence(run, items(11), each(11)), 'limit is 10'],
    ['a location no image covers', (run) => writeEvidence(run, [yard, horn], [['Horn']]), 'No evidence image covers "Yard"'],
    ['coverage of a feature the manifest does not list', (run) => writeEvidence(run, [yard], [['Salvage yard']]), 'by exact name'],
    ['a duplicate image', (run) => { writeEvidence(run, [yard], [['Yard'], ['Yard']]); writeFileSync(`${run.clone}/${run.dir}/.factory/view1.png`, pngBytes(0)); }, 'duplicates'],
    ['a missing image file', (run) => { writeEvidence(run, items(2), each(2)); rmSync(`${run.clone}/${run.dir}/.factory/view1.png`); }, 'does not exist'],
    ['a manifest from an older commit', (run) => writeEvidence(run, [horn], [['Horn']], 'deadbee'), 'Capture the views again'],
  ])('drops a manifest with %s, posts the one screenshot and says why on the issue', async (_name, write, reason) => {
    await runStage(fakeCtx(write), 7);
    expect(calls.filter((call) => call.startsWith('photo'))).toHaveLength(1);
    expect(albums).toEqual([]);
    expect(commentBodies[0]).toContain('The evidence manifest was dropped');
    expect(commentBodies[0]).toContain(reason);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it.each([1, 2])('posts a location shown by %i genuine image(s), with no minimum count', async (count) => {
    await runStage(fakeCtx((run) => writeEvidence(run, [yard], Array.from({ length: count }, () => ['Yard']))), 7);
    expect(calls.filter((call) => call.startsWith('photo'))).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('runs the fresh-clone checks before it posts a one-image location', async () => {
    await runStage(fakeCtx((run) => writeEvidence(run, [yard], [['Yard']])), 7);
    expect(calls.indexOf('checks')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('checks')).toBeLessThan(calls.findIndex((call) => call.startsWith('photo')));
  });

  it('posts nothing when the fresh-clone checks fail twice, whatever the evidence', async () => {
    await expect(runStage(fakeCtx((run) => writeEvidence(run, [yard], [['Yard']]), 2), 7)).rejects.toThrow('checks failed twice');
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('album'))).toBe(false);
    expect(calls).not.toContain('move 7 Approval');
  });

  it('retracts the primary and registers nothing when the album fails, so a retry posts once', async () => {
    albumFails = true;
    await expect(runStage(fakeCtx((run) => writeEvidence(run, items(3), each(3))), 7)).rejects.toThrow('boom');
    expect(calls.find((call) => call.startsWith('editCaption 100'))).toContain('Superseded');
    expect(calls).not.toContain('move 7 Approval');
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({});
    expect(readState(`${home}/state.json`).postCaptions).toEqual({});
    albumFails = false;
    calls = [];
    await runStage(fakeCtx((run) => writeEvidence(run, items(3), each(3))), 7);
    expect(calls.filter((call) => call.startsWith('photo'))).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith('album'))).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('sends no images for a queued merge of an approved card', async () => {
    writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), approvedResolving: { 7: 'Ann' } });
    await runStage(fakeCtx((run) => writeEvidence(run, items(3), each(3))), 7);
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('album'))).toBe(false);
  });
});

describe('patch stage', () => {
  const approval = JSON.stringify({ description: 'Grid icons now top-down', howToTry: 'Press I' });
  const patching = (): void => writeState(`${home}/state.json`, { ...readState(`${home}/state.json`), patching: { 7: 'aaa1111' } });

  it('runs one agent on the build model with the played commit, then hands the card to checks in Testing', async () => {
    labels = ['implementation-opus'];
    patching();
    const runs: AgentRun[] = [];
    await runPatch(fakeCtx((run) => { runs.push(run); writeOutputs(run, approval); }), 7);
    expect(runs.map((run) => run.model)).toEqual(['sonnet']);
    expect(runs[0].prompt).toContain('played the build of commit aaa1111');
    expect(runs[0].prompt).toContain('git diff aaa1111..HEAD');
    expect(calls).not.toContain('checks');
    expect(calls.filter((call) => call.startsWith('review'))).toEqual([]);
    expect(calls.at(-1)).toBe('move 7 Testing');
    const state = readState(`${home}/state.json`);
    expect(state.patching).toEqual({});
    expect(state.testPhase).toEqual({ 7: 'checks' });
    expect(bases).toContain('merge dev');
  });

  it('is followed by the factory checks and a new post, like any Testing card', async () => {
    patching();
    await runPatch(fakeCtx((run) => writeOutputs(run, approval)), 7);
    await runStage(fakeCtx(() => { throw new Error('checks run no agent'); }), 7);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(calls.at(-1)).toBe('move 7 Approval');
    expect(calls.some((call) => call.startsWith('photo') && call.includes('Grid icons now top-down'))).toBe(true);
  });

  it('sends the card to Design with the reason when the agent finds the plan must change', async () => {
    patching();
    await runPatch(fakeCtx((run) => writeFileSync(`${run.clone}/${run.dir}/.factory/needs-redesign.md`, 'It needs a second sprite sheet.\n')), 7);
    expect(commentBodies.at(-1)).toBe('## Committee feedback\n\nThe patch found that this reply needs a new plan:\n\nIt needs a second sprite sheet.');
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(calls).not.toContain('push w1 factory/issue-7');
    expect(readState(`${home}/state.json`).patching).toEqual({});
    expect(readState(`${home}/state.json`).testPhase).toEqual({});
  });

  it('refuses a card with no queued patch', async () => {
    await expect(runPatch(fakeCtx(() => undefined), 7)).rejects.toThrow('no patch queued');
  });
});

describe('visual review of the candidate', () => {
  const oil = [{ name: 'Oil patch', kind: 'other' }];
  const state = () => readState(`${home}/state.json`);
  // The agent captures the oil patch from the final head and reads it. `review` overrides what it decided.
  function capture(run: AgentRun, review: Partial<Record<string, unknown>> = {}, seed = 0): void {
    const out = `${run.clone}/${run.dir}/.factory`;
    writeFileSync(`${out}/approval.json`, JSON.stringify({ description: 'd', howToTry: 'h' }));
    writeFileSync(`${out}/screenshot.png`, pngBytes(seed));
    writeFileSync(`${out}/view1.png`, pngBytes(seed + 1));
    const images = [{ file: 'screenshot.png', description: 'Oil behind the truck', covers: ['Oil patch'] }, { file: 'view1.png', description: 'Oil from the side', covers: ['Oil patch'] }];
    writeFileSync(`${out}/evidence.json`, JSON.stringify({ commit: 'abc1234', features: oil, images }));
    writeFileSync(`${out}/visual-review.json`, JSON.stringify(visualReview(out, oil, images.map((image) => image.file), review)));
  }
  const wrongOil = (scope: string, repairs = 0): Partial<Record<string, unknown>> => ({
    repairs,
    decisions: [{ feature: 'Oil patch', verdict: 'wrong', notes: 'The oil is a perfect circle ahead of the truck.' }],
    mismatches: [{ description: 'The oil is a perfect circle and lies ahead of the truck, the issue says behind it.', scope }],
  });
  const posted = (): boolean => calls.some((call) => call.startsWith('photo'));

  it('posts a candidate whose images the agent read and found right', async () => {
    await runStage(fakeCtx((run) => capture(run)), 7);
    expect(posted()).toBe(true);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('gives the agent the issue text and the visual review rules in the test round', async () => {
    let prompt = '';
    await runStage(fakeCtx((run) => { prompt = run.prompt; capture(run); }), 7);
    expect(prompt).toContain('Visual review of the final build');
    expect(readFileSync(`${home}/work/issue-7/game/.factory/issue.md`, 'utf8')).toContain('UNTRUSTED USER TEXT');
  });

  it.each([
    ['rebuild', 'Implementation'],
    ['plan', 'Design'],
  ])('a visibly wrong %s mismatch makes no post and sends the card to %s with the mismatch report', async (scope, column) => {
    await runStage(fakeCtx((run) => capture(run, wrongOil(scope))), 7);
    expect(posted()).toBe(false);
    expect(calls.some((call) => call.startsWith('openPullRequest'))).toBe(false);
    expect(calls).not.toContain('checks');
    expect(calls.at(-1)).toBe(`move 7 ${column}`);
    expect(commentBodies[0]).toContain('## Visual review findings');
    expect(commentBodies[0]).toContain(`(${scope}) The oil is a perfect circle and lies ahead of the truck`);
    expect(state().testPhase).toEqual({});
    expect(state().visualSendBacks).toEqual({ 7: 1 });
    expect(state().approvalPosts).toEqual({});
  });

  it('sends a plan mismatch to Design even when a rebuild one is listed with it', async () => {
    const mismatches = [{ description: 'The shape is a placeholder disc.', scope: 'rebuild' }, { description: 'The plan puts the drop ahead of the truck.', scope: 'plan' }];
    await runStage(fakeCtx((run) => capture(run, { ...wrongOil('rebuild'), mismatches })), 7);
    expect(calls.at(-1)).toBe('move 7 Design');
  });

  it('sends a tune mismatch that two repair rounds did not fix to Implementation', async () => {
    await runStage(fakeCtx((run) => capture(run, wrongOil('tune', 2))), 7);
    expect(calls.at(-1)).toBe('move 7 Implementation');
  });

  it('caps the send-backs of a card, then fails with the report and no move', async () => {
    writeState(`${home}/state.json`, { ...state(), visualSendBacks: { 7: 2 } });
    await expect(runStage(fakeCtx((run) => capture(run, wrongOil('rebuild'))), 7)).rejects.toThrow('after 2 send-backs already');
    expect(calls.some((call) => call.startsWith('move'))).toBe(false);
    expect(commentBodies).toEqual([]);
    expect(posted()).toBe(false);
  });

  it('clears the send-back count once a corrected candidate passes', async () => {
    await runStage(fakeCtx((run) => capture(run, wrongOil('rebuild'))), 7);
    expect(state().visualSendBacks).toEqual({ 7: 1 });
    calls = [];
    await runStage(fakeCtx((run) => capture(run, {}, 10)), 7);
    expect(state().visualSendBacks).toEqual({});
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('inspects again after a check-fix round and sends a now-wrong candidate back, with no post', async () => {
    let round = 0;
    await runStage(fakeCtx((run) => capture(run, round++ === 0 ? {} : wrongOil('rebuild')), 1), 7);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(posted()).toBe(false);
    expect(calls.at(-1)).toBe('move 7 Implementation');
    expect(state().testPhase).toEqual({});
  });

  it.each<[string, (run: AgentRun) => void]>([
    ['only tune-sized mismatches and repair rounds left', (run) => capture(run, wrongOil('tune'))],
    ['more repair rounds than the limit', (run) => capture(run, { repairs: 3 })],
    ['a reading of an older image', (run) => { capture(run); writeFileSync(`${run.clone}/${run.dir}/.factory/screenshot.png`, pngBytes(99)); }],
    ['a reading from an older commit', (run) => capture(run, { commit: 'deadbee' })],
    ['no reading at all', (run) => { capture(run); rmSync(`${run.clone}/${run.dir}/.factory/visual-review.json`); }],
    ['a missing image reading', (run) => capture(run, { images: [] })],
    ['a missing feature decision', (run) => capture(run, { decisions: [] })],
    ['a thin note', (run) => capture(run, { decisions: [{ feature: 'Oil patch', verdict: 'correct', notes: 'ok' }] })],
    ['a wrong verdict with no mismatch', (run) => capture(run, { decisions: [{ feature: 'Oil patch', verdict: 'wrong', notes: 'The oil is a perfect circle.' }] })],
    ['a made-up verdict', (run) => capture(run, { decisions: [{ feature: 'Oil patch', verdict: 'fine', notes: 'The oil looks fine to me.' }] })],
    ['the nonvisual exemption while the manifest lists visible features', (run) => capture(run, { visual: false, reason: 'Nothing changed on screen at all.' })],
  ])('ignores a visual review with %s, and the card goes on to its post', async (_name, write) => {
    await runStage(fakeCtx(write), 7);
    expect(posted()).toBe(true);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('keeps a nonvisual task viable on its stated reason, with no images read', async () => {
    await runStage(fakeCtx((run) => writeOutputs(run, JSON.stringify({ description: 'd', howToTry: 'h' }))), 7);
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('applies to the test round of a hotfix after its hardening round, and a wrong look makes no post', async () => {
    labels = ['hotfix'];
    const rounds: string[] = [];
    await runStage(fakeCtx((run) => { rounds.push(run.prompt.split('\n')[0]); if (!run.prompt.startsWith('This is the hardening round')) capture(run, wrongOil('plan')); }), 7);
    expect(rounds).toHaveLength(2);
    expect(calls.at(-1)).toBe('move 7 Design');
    expect(posted()).toBe(false);
    expect(calls).not.toContain('checks');
  });

  it('does not ask a hardening round for a reading, so an approved card still queues its merge', async () => {
    writeState(`${home}/state.json`, { ...state(), approvedResolving: { 7: 'Ann' } });
    await runStage(fakeCtx(() => undefined), 7);
    expect(readState(`${home}/state.json`).pendingApprovals).toEqual({ 7: 'Ann' });
  });
});

describe('a round with no screenshot', () => {
  const APPROVAL = JSON.stringify({ description: 'Salvage yard fights.', howToTry: 'Drive to the yard.' });
  // The agent leaves an approval and no image at all.
  const approvalOnly = (run: AgentRun): void => writeFileSync(`${run.clone}/${run.dir}/.factory/approval.json`, APPROVAL);

  it('lets verify accept an approval with no screenshot, evidence or visual review and moves on to the checks', async () => {
    await runVerify(fakeCtx(approvalOnly), 7);
    expect(readState(`${home}/state.json`).testPhase).toEqual({ 7: 'checks' });
    expect(calls).not.toContain('checks');
  });

  it('runs the same checks, then posts a text approval with buttons, a warning and normal routing', async () => {
    await runStage(fakeCtx(approvalOnly), 7);
    expect(calls.filter((call) => call === 'checks')).toHaveLength(1);
    expect(shellScript).toContain('npm run playtest -- --cpu');
    expect(shellScript).toContain('SAVE_SCOPE="$BUILD_SCOPE" npm run build');
    expect(calls.some((call) => call.startsWith('photo') || call.startsWith('album'))).toBe(false);
    const text = calls.find((call) => call.startsWith('buttons')) ?? '';
    expect(text).toContain('No screenshot. Judge it by playing.');
    expect(text).toContain('Play: https://play.test/abc123/');
    expect(text).toContain('How to try: Drive to the yard.');
    for (const tail of BOILERPLATE) expect(text).not.toContain(tail);
    expect(photoButtons).toEqual([[{ text: 'Approve', data: 'factory:approve:7' }, { text: 'Deny', data: 'factory:deny:7' }]]);
    expect(commentBodies[0]).toContain('The testing agent wrote no .factory/screenshot.png.');
    const state = readState(`${home}/state.json`);
    expect(state.approvalPosts).toEqual({ 120: 7 });
    expect(state.textPosts).toEqual(['120']);
    expect(state.postCaptions['120']).toBe(text.replace('buttons chat ', ''));
    expect(calls.at(-1)).toBe('move 7 Approval');
  });

  it('posts nothing when the checks fail', async () => {
    await expect(runStage(fakeCtx(approvalOnly, 2), 7)).rejects.toThrow('The factory checks failed twice');
    expect(calls.some((call) => call.startsWith('buttons') || call.startsWith('photo'))).toBe(false);
    expect(calls).not.toContain('move 7 Approval');
    expect(readState(`${home}/state.json`).approvalPosts).toEqual({});
  });
});
