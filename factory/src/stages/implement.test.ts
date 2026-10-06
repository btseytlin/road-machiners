import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, writeState } from '../state';
import type { AgentRun, Ctx } from '../types';
import { runStage } from './implement';

let home = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/factory-implement-');
  writeState(`${home}/state.json`, structuredClone(EMPTY_STATE));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeCtx(labels: string[], models: string[], prompts: string[] = []): Ctx {
  const fake = {
    cfg: { home, designModel: 'opus', buildModel: 'sonnet' },
    log: () => undefined,
    statePath: `${home}/state.json`,
    github: { issue: async () => ({ labels, title: 'Oil spiller', body: 'Drop oil behind the truck.' }), comments: async () => [], move: async () => undefined },
    container: { agent: async (run: AgentRun) => { models.push(run.model); prompts.push(run.prompt); mkdirSync(`${run.clone}/${run.dir}/.factory`, { recursive: true }); } },
    repo: {
      prepareWorkClone: async (_b: string, _base: string, dir: string) => { mkdirSync(dir, { recursive: true }); },
      fetchFromWork: async () => 'w1', isMerged: async () => false, untrackFactoryFiles: async () => [], diff: async () => '', push: async () => undefined,
    },
  };
  return fake as unknown as Ctx;
}

describe('implement stage model', () => {
  it.each([
    [[], 'sonnet'],
    [['design-sonnet'], 'sonnet'],
    [['implementation-opus'], 'opus'],
  ])('uses the model of labels %j: %s', async (labels, model) => {
    const models: string[] = [];
    await runStage(fakeCtx(labels, models), 7);
    expect(models).toEqual([model]);
  });
});

describe('implement stage visual self-review', () => {
  it('asks for real screenshots read with the Read tool for any visible change, and gives the agent the issue text', async () => {
    const prompts: string[] = [];
    await runStage(fakeCtx([], [], prompts), 7);
    expect(prompts[0]).toContain('Visual self-review');
    expect(prompts[0]).toContain('Read every screenshot with the Read tool');
    expect(prompts[0]).toContain('Do not claim you are done before that');
    expect(readFileSync(`${home}/work/issue-7/game/.factory/issue.md`, 'utf8')).toContain('Drop oil behind the truck.');
  });

  it('keeps the exemption for a task nobody can see', async () => {
    const prompts: string[] = [];
    await runStage(fakeCtx([], [], prompts), 7);
    expect(prompts[0]).toContain('needs no screenshots');
    expect(prompts[0]).toContain('why nothing visible changed');
  });
});
