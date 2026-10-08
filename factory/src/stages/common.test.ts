import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentRun, Ctx } from '../types';
import { markResumed } from '../sessions';
import { EMPTY_STATE, writeState } from '../state';
import { solidPng } from '../media-fixtures';
import { factoryPaths } from '../diff-guard';
import { RESUME_NOTE, agentHome, baseBranchFor, baseBranchOf, fillPrompt, modelFor, prepareOutputs, runAgent } from './common';

function agentCtx(labels: string[], body = '', comments: { login: string; body: string }[] = [], fetchFn?: typeof fetch): { ctx: Ctx; runs: AgentRun[]; logs: string[] } {
  const runs: AgentRun[] = [];
  const logs: string[] = [];
  const ctx = {
    cfg: { home: 'tmp/factory-common-test', designModel: 'opus-id', buildModel: 'sonnet-id' },
    github: { issue: async () => ({ labels, body }), comments: async () => comments },
    fetch: fetchFn,
    run: async () => ({ code: 0, stdout: 'tok\n', stderr: '' }),
    container: { agent: async (run: AgentRun) => { runs.push(run); } },
    log: (_stage: string, _issue: number | null, msg: string) => { logs.push(msg); },
  } as unknown as Ctx;
  return { ctx, runs, logs };
}

describe('runAgent network', () => {
  it('uses the restricted network without the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug']);
    await runAgent(ctx, 7, 'design', 'design', 'p');
    expect(runs[0].openNetwork).toBe(false);
    expect(logs).toEqual(['agent model opus-id', 'agent runs on the restricted network']);
  });

  it('uses the open network with the open-network label', async () => {
    const { ctx, runs, logs } = agentCtx(['bug', 'open-network']);
    await runAgent(ctx, 7, 'design', 'design', 'p');
    expect(runs[0].openNetwork).toBe(true);
    expect(logs[1]).toContain('open network');
  });
});

describe('runAgent sessions', () => {
  const HOME = 'tmp/factory-common-test';
  // The tick marks the sessions of a job whose process died.
  const markedCtx = (issues: number[]) => {
    for (const issue of issues) markResumed(HOME, issue, 'verify');
    return agentCtx(['bug']);
  };
  beforeEach(() => { rmSync(`${HOME}/sessions`, { recursive: true, force: true }); });
  // What Claude Code writes in the container once the run starts.
  const saved = (run: AgentRun) => {
    if (!run.session) throw new Error('the run had no session');
    mkdirSync(`${run.session.dir}/-work-game`, { recursive: true });
    writeFileSync(`${run.session.dir}/-work-game/${run.session.id}.jsonl`, '{}\n');
  };

  it('starts a fresh session with the full prompt when the issue has no mark', async () => {
    const { ctx, runs, logs } = markedCtx([]);
    await runAgent(ctx, 7, 'implement', 'implement', 'p');
    expect(runs[0].prompt).toMatch(/^p\n\n/);
    expect(runs[0].session).toMatchObject({ dir: `${HOME}/sessions/issue-7`, resume: false });
    expect(logs.some((line) => line.includes('resuming'))).toBe(false);
  });

  it('resumes the stored session of the round with the resume note alone, and logs it', async () => {
    const { ctx, runs, logs } = markedCtx([]);
    await runAgent(ctx, 7, 'implement', 'implement', 'p');
    saved(runs[0]);
    const marked = markedCtx([7]);
    await runAgent(marked.ctx, 7, 'implement', 'implement', 'p');
    expect(marked.runs[0].prompt).toBe(RESUME_NOTE);
    expect(marked.runs[0].session).toEqual({ dir: `${HOME}/sessions/issue-7`, id: runs[0].session?.id, resume: true });
    expect(marked.logs).toContain(`resuming round implement, session ${runs[0].session?.id}`);
    expect(logs).toHaveLength(2);
  });

  it('gives a round with no stored session the full prompt, so a later round of a resumed job starts fresh', async () => {
    const first = markedCtx([]);
    await runAgent(first.ctx, 7, 'verify', 'test', 'p');
    saved(first.runs[0]);
    const marked = markedCtx([7]);
    await runAgent(marked.ctx, 7, 'verify', 'test', 'p');
    await runAgent(marked.ctx, 7, 'verify', 'test-fix', 'fix');
    expect(marked.runs.map((run) => [run.session?.resume, run.prompt === RESUME_NOTE])).toEqual([[true, true], [false, false]]);
    expect(marked.runs[1].prompt).toMatch(/^fix\n\n/);
  });

  it('starts a fresh round with the full prompt and its skill when the round asks for it, even in a resumed job', async () => {
    const first = markedCtx([]);
    await runAgent(first.ctx, 7, 'verify', 'review', 'review it', { skill: '/code-review' });
    saved(first.runs[0]);
    const marked = markedCtx([7]);
    await runAgent(marked.ctx, 7, 'verify', 'review', 'review it', { skill: '/code-review', fresh: true });
    expect(marked.runs[0].session?.resume).toBe(false);
    expect(marked.runs[0].session?.id).not.toBe(first.runs[0].session?.id);
    expect(marked.runs[0].skill).toBe('/code-review');
    expect(marked.runs[0].prompt).toMatch(/^review it\n\n/);
  });

  it('never resumes the session of an unmarked issue', async () => {
    const first = markedCtx([]);
    await runAgent(first.ctx, 8, 'design', 'design', 'p');
    saved(first.runs[0]);
    const other = markedCtx([7]);
    await runAgent(other.ctx, 8, 'design', 'design', 'p');
    expect(other.runs[0].session?.resume).toBe(false);
  });
});

describe('prepareOutputs', () => {
  const HOME = 'tmp/factory-common-outputs';
  const outputs = (interrupted: number[]) => {
    rmSync(`${HOME}/sessions`, { recursive: true, force: true });
    for (const issue of interrupted) markResumed(HOME, issue, 'design');
    return { cfg: { home: HOME } } as Ctx;
  };
  beforeEach(() => {
    rmSync(HOME, { recursive: true, force: true });
    mkdirSync(`${HOME}/.factory`, { recursive: true });
    writeFileSync(`${HOME}/.factory/old.md`, 'x');
  });

  it('resets the outputs of an unmarked issue', () => {
    prepareOutputs(outputs([]), 7, HOME);
    expect(existsSync(`${HOME}/.factory/old.md`)).toBe(false);
    expect(existsSync(`${HOME}/.factory`)).toBe(true);
  });

  it('keeps the outputs of a marked issue', () => {
    prepareOutputs(outputs([7]), 7, HOME);
    expect(existsSync(`${HOME}/.factory/old.md`)).toBe(true);
  });

  it('makes the outputs folder when none exists', () => {
    rmSync(`${HOME}/.factory`, { recursive: true });
    prepareOutputs(outputs([7]), 7, HOME);
    expect(existsSync(`${HOME}/.factory`)).toBe(true);
  });
});

describe('model routing', () => {
  const cfg = { designModel: 'opus-id', buildModel: 'sonnet-id' };
  const stages = ['triage', 'design', 'implement', 'verify'] as const;
  const pick = (labels: string[]) => stages.map((stage) => modelFor(cfg, stage, labels));

  it('keeps the baseline with no label: triage Sonnet, design Opus, implementation and verify Sonnet', () => {
    expect(pick([])).toEqual(['sonnet-id', 'opus-id', 'sonnet-id', 'sonnet-id']);
  });

  it('design-sonnet forces Sonnet for design only', () => {
    expect(pick(['design-sonnet'])).toEqual(['sonnet-id', 'sonnet-id', 'sonnet-id', 'sonnet-id']);
  });

  it('implementation-opus changes implementation only, leaving verification on Sonnet', () => {
    expect(pick(['implementation-opus'])).toEqual(['sonnet-id', 'opus-id', 'opus-id', 'sonnet-id']);
  });

  it('both labels apply independently', () => {
    expect(pick(['design-sonnet', 'implementation-opus'])).toEqual(['sonnet-id', 'sonnet-id', 'opus-id', 'sonnet-id']);
  });

  it('runAgent reads the labels at each run, so a manual change counts on the next one', async () => {
    const labels: string[] = ['implementation-opus'];
    const { ctx, runs } = agentCtx(labels);
    await runAgent(ctx, 7, 'implement', 'implement', 'p');
    labels.length = 0;
    await runAgent(ctx, 7, 'implement', 'implement', 'p');
    expect(runs.map((run) => run.model)).toEqual(['opus-id', 'sonnet-id']);
  });
});

const ASSET = 'https://github.com/user-attachments/assets/24c78bbf-b445-42bb-a191-2eba2e36379e';
const hosted = (status: number): typeof fetch => (async (input: URL | string) => (String(input) === ASSET
  ? new Response(null, { status: 302, headers: { location: 'https://github-production-user-asset-6210df.s3.amazonaws.com/1/2' } })
  : new Response(status === 200 ? new Uint8Array(solidPng(2, 2, [1, 2, 3])) : null, { status }))) as typeof fetch;

describe('runAgent reference images', () => {
  beforeEach(() => { rmSync('tmp/factory-common-test/media', { recursive: true, force: true }); });

  it('puts the absolute image paths and the media folder in the prompt of every stage', async () => {
    for (const stage of ['triage', 'design', 'implement', 'verify'] as const) {
      const { ctx, runs } = agentCtx([], `look ${ASSET}`, [], hosted(200));
      await runAgent(ctx, 7, stage, stage, 'the prompt');
      expect(runs[0].prompt).toMatch(/^the prompt\n\n.*\/work\/\.factory-media\/ref-[0-9a-f]{12}\.png \(png, 2x2,/s);
      expect(runs[0].mediaDir).toBe('tmp/factory-common-test/media/issue-7');
    }
  });

  it('takes images from feedback comments too', async () => {
    const { ctx, runs } = agentCtx([], 'no image here', [{ login: 'ann', body: `## Committee feedback\n![](${ASSET})` }], hosted(200));
    await runAgent(ctx, 7, 'design', 'design', 'p');
    expect(runs[0].prompt).toContain('from the comment by ann');
  });

  it('fetches an image that failed once more and runs the agent on the text with the image NOT AVAILABLE when it stays gone', async () => {
    for (const stage of ['design', 'verify'] as const) {
      let requests = 0;
      const counted = ((input: URL | string) => { requests += 1; return hosted(403)(input); }) as typeof fetch;
      const { ctx, runs } = agentCtx([], ASSET, [], counted);
      await runAgent(ctx, 7, stage, stage, 'p');
      expect(requests, stage).toBe(4);
      expect(runs[0].prompt, stage).toContain(`1. NOT AVAILABLE, ${ASSET} (issue body): `);
    }
  });

  it('runs the agent with the image when the second fetch works', async () => {
    let first = true;
    const flaky = ((input: URL | string) => { const status = first && String(input) !== ASSET ? 403 : 200; if (String(input) !== ASSET) first = false; return hosted(status)(input); }) as typeof fetch;
    const { ctx, runs } = agentCtx([], ASSET, [], flaky);
    await runAgent(ctx, 7, 'design', 'design', 'p');
    expect(runs[0].prompt).not.toContain('NOT AVAILABLE, ');
    expect(runs[0].prompt).toContain('/work/.factory-media/');
  });

  it('adds the committee images of earlier routes after the issue images', async () => {
    mkdirSync('tmp/factory-common-test/media/issue-7/committee', { recursive: true });
    writeFileSync('tmp/factory-common-test/media/issue-7/committee/abc.png', solidPng(1, 1, [0, 0, 0]));
    writeFileSync('tmp/factory-common-test/media/issue-7/committee.json', JSON.stringify([{ url: 'telegram:post-55-5-1.png', source: 'committee reply in Telegram by ann', status: 'ok', file: 'committee/abc.png', type: 'png', width: 1, height: 1, bytes: 9, sha256: 'f'.repeat(64) }]));
    const { ctx, runs } = agentCtx([], `look ${ASSET}`, [], hosted(200));
    await runAgent(ctx, 7, 'design', 'design', 'p');
    expect(runs[0].prompt).toContain(`2. /work/.factory-media/committee/abc.png (png, 1x1, 9 bytes, sha256 ${'f'.repeat(64)}, from the committee reply in Telegram by ann)`);
  });
});

describe('stage prompts for reference images', () => {
  const vars = { issue: '7', taskFile: 'f', branch: 'b', task: 'Play it.', playtest: 'npm run playtest' };

  it('tell every stage to read the images and what a missing one means', () => {
    for (const name of ['triage', 'design', 'implement', 'test']) {
      const text = fillPrompt(name, vars);
      expect(text, name).toContain('Reference images from the issue are listed at the end of this prompt');
    }
    for (const name of ['triage', 'design', 'implement', 'test']) expect(fillPrompt(name, vars), name).toContain('NOT AVAILABLE');
  });

  it('scope the Blender skill and keep silhouette overlap a diagnostic', () => {
    for (const name of ['design', 'implement']) {
      const text = fillPrompt(name, vars);
      expect(text).toContain('blender-image-to-3d');
      expect(text).toContain('Do not run all ten phases');
      expect(text).toContain('Never make it a pass or fail gate for a perspective concept');
    }
  });

  it('make testing own every fix, with a new plan as its only way back', () => {
    const text = fillPrompt('test', vars);
    expect(text).toContain('Fix every problem you find yourself, in this session');
    expect(text).toContain('a look that does not match the issue');
    expect(text).toContain('`.factory/needs-redesign.md`');
    expect(text).toContain('the failure comes back to you in this conversation');
    expect(text).toContain('Never describe an image you did not get.');
    expect(text).not.toContain('visual-review.json');
  });

  it('make implementation capture and read real screenshots of any visible change, with or without a reference image', () => {
    const text = fillPrompt('implement', vars);
    expect(text).toContain('Visual self-review');
    expect(text).toContain('with or without a reference image');
    expect(text).toContain('Capture real in-game screenshots');
    expect(text).toContain('Read every screenshot with the Read tool');
    // The agent works in game/, so the path is relative to it.
    expect(text).toContain('`docs/DESIGN.md`');
    expect(text).toContain('placeholder shapes');
    expect(text).toContain('behind it');
    expect(text).toContain('successive simulation points');
    expect(text).toContain('Do not commit them');
    expect(text).toContain('Never use a drawn or invented render');
    expect(text).toContain('needs no screenshots');
    expect(text).toContain('## Visual review findings');
    // The reference-image rules stay.
    expect(text).toContain('Read every available image with the Read tool before you build.');
    expect(text).toContain('When the task file asks for a visual acceptance check');
  });

  it('tell design how to read visual review findings', () => {
    expect(fillPrompt('design', vars)).toContain('## Visual review findings');
  });
});

describe('fillPrompt', () => {
  it('fills every variable', () => {
    const text = fillPrompt('design', { issue: '7', taskFile: 'docs/tasks/issue-7.md', branch: 'factory/issue-7' });
    expect(text).toContain('docs/tasks/issue-7.md');
    expect(text).not.toContain('{{');
  });

  it('throws on an unfilled variable', () => {
    expect(() => fillPrompt('design', { issue: '7' })).toThrow('unfilled {{');
  });
});

describe('factoryPaths', () => {
  it('finds agent messages and task files in a diff', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/.factory-tasks/issue-8.md b/.factory-tasks/issue-8.md\n+y\ndiff --git a/.factory/approval.json b/.factory/approval.json\n';
    expect(factoryPaths(diff)).toEqual(['.factory-tasks/issue-8.md', '.factory/approval.json']);
  });
});

describe('factoryPaths for reference images', () => {
  it('refuses the media folder, so downloaded issue images never reach the game repo', () => {
    expect(factoryPaths('diff --git a/game/.factory-media/ref-a.png b/game/.factory-media/ref-a.png\n')).toEqual(['game/.factory-media/ref-a.png']);
  });
});

describe('factoryPaths at any depth', () => {
  it('finds agent folders under game/ and factory/', () => {
    const diff = 'diff --git a/game/.factory/a.json b/game/.factory/a.json\n+x\ndiff --git a/factory/.factory-tasks/issue-1.md b/factory/.factory-tasks/issue-1.md\n+y\ndiff --git a/game/src/.factoryish/a.ts b/game/src/.factoryish/a.ts\n+z\n';
    expect(factoryPaths(diff)).toEqual(['game/.factory/a.json', 'factory/.factory-tasks/issue-1.md']);
  });

  it('refuses .github only at the root', () => {
    expect(factoryPaths('diff --git a/game/.github/x b/game/.github/x\n')).toEqual([]);
  });
});

describe('agentHome', () => {
  it('joins the clone and the agent folder', () => {
    expect(agentHome('/w/c', 'game')).toBe('/w/c/game');
  });
});

describe('factoryPaths and workflows', () => {
  it('refuses GitHub workflow files', () => {
    expect(factoryPaths('diff --git a/.github/workflows/x.yml b/.github/workflows/x.yml\n+on: push\n')).toEqual(['.github/workflows/x.yml']);
  });
});

describe('base branch', () => {
  const statePath = 'tmp/factory-common-test/state.json';
  const withRelease = () => {
    mkdirSync('tmp/factory-common-test', { recursive: true });
    writeState(statePath, { ...structuredClone(EMPTY_STATE), release: { issue: 20, branch: 'release/2026-09-29', day: '2026-09-29', postId: null, removed: [], tasks: [], candidateSha: null, playtest: { seed: 1, runs: 0, passed: null, blocked: null, notes: [] } } });
  };
  const ctxWith = (labels: string[]) => ({ statePath, github: { issue: async () => ({ labels }) } }) as unknown as Ctx;

  it('is dev for an ordinary card, whatever the state holds', async () => {
    withRelease();
    expect(baseBranchFor(ctxWith([]), ['bug'])).toBe('dev');
    expect(await baseBranchOf(ctxWith(['feature-request']), 7)).toBe('dev');
  });

  it('is the release branch for a release task', async () => {
    withRelease();
    expect(baseBranchFor(ctxWith([]), ['release-task', 'maintenance'])).toBe('release/2026-09-29');
    expect(await baseBranchOf(ctxWith(['release-task']), 7)).toBe('release/2026-09-29');
  });

  it('is main for a hotfix, also with no release open', async () => {
    expect(baseBranchFor(ctxWith([]), ['bug', 'hotfix'])).toBe('main');
    expect(await baseBranchOf(ctxWith(['hotfix', 'release-task']), 7)).toBe('main');
  });

  it('throws for a release task when no release is open', async () => {
    mkdirSync('tmp/factory-common-test', { recursive: true });
    writeState(statePath, structuredClone(EMPTY_STATE));
    expect(() => baseBranchFor(ctxWith([]), ['release-task'])).toThrow('needs an open release');
    await expect(baseBranchOf(ctxWith(['release-task']), 7)).rejects.toThrow('needs an open release');
  });
});
