import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_CHECK_COMMAND, dockerContainer, readPeakGb, usageLimitMessage } from './container';
import { recordJob, takeUsage } from './ledger';
import { UsageLimitError } from './pause';
import type { FactoryConfig, Run, RunOptions } from './types';

type Call = { cmd: string; args: string[]; opts?: RunOptions };

const HOME = resolve('tmp/factory-container-test');
const tokenPrices: FactoryConfig['tokenPrices'] = { opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 } };
const cfg = { image: 'img:1', oauthToken: 'secret-token', elevenlabsKey: 'sound-key', sfxMaxGenerations: 6, agentJobMaxMinutes: 30, home: HOME, tokenPrices } as FactoryConfig;

// A finished agent run ends with this event, which the job's ledger line reads.
const AGENT_RESULT = JSON.stringify({ type: 'result', duration_ms: 60_000, total_cost_usd: 1 });

// Setup calls (network, proxy) answer per `setup`. Only the `docker run --rm` call answers with `code`.
function fakeRun(code = 0, setup: Record<string, { code: number; stdout?: string }> = {}, stderr = 'boom'): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  const run: Run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'run' && args[1] === '--rm') return { code, stdout: code === 0 ? AGENT_RESULT : '', stderr };
    const stdout = args[0] === 'inspect' ? 'true sha:1' : args[0] === 'image' ? 'sha:1\n' : '';
    const answer = setup[args.slice(0, 2).join(' ')] ?? { code: 0, stdout };
    return { code: answer.code, stdout: answer.stdout ?? '', stderr: 'setup failed' };
  };
  return { run, calls };
}

const runCall = (calls: Call[]): Call => calls.find((call) => call.args[0] === 'run' && call.args[1] === '--rm') as Call;
const setupCalls = (calls: Call[]): string[] => calls.filter((call) => call !== runCall(calls)).map((call) => call.args.join(' '));

describe('dockerContainer', () => {
  it('pins agent and shell containers to the job CPUs, and leaves a run by hand unpinned', async () => {
    const pinned = fakeRun();
    await dockerContainer(pinned.run, cfg, 'testing-8-x', '2-3').agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'p', log: '/l' });
    await dockerContainer(pinned.run, cfg, 'testing-8-x', '2-3').shell('/c', 'x', '/l');
    const runs = pinned.calls.filter((call) => call.args[0] === 'run' && call.args[1] === '--rm');
    expect(runs.map((call) => call.args.slice(call.args.indexOf('--cpuset-cpus'), call.args.indexOf('--cpuset-cpus') + 2))).toEqual([['--cpuset-cpus', '2-3'], ['--cpuset-cpus', '2-3']]);
    const free = fakeRun();
    await dockerContainer(free.run, cfg, null).shell('/c', 'x', '/l');
    expect(runCall(free.calls).args).not.toContain('--cpuset-cpus');
  });

  it('passes the secrets by env only and mounts only the clone and the npm cache', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'do it', log: '/l.log' });
    const call = runCall(calls);
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.args.join(' ')).not.toContain('sound-key');
    expect(call.opts?.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'secret-token', ELEVENLABS_API_KEY: 'sound-key', SFX_MAX_GENERATIONS: '6', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', FACTORY_JOB_MAX_MINUTES: '30' });
    expect(call.opts?.input).toContain('The limit is at most 30 minutes.');
    expect(call.opts?.input).toMatch(/^Your folder is \/work\/game\./);
    expect(call.opts?.input).toContain('When your activity changes, run factory-status');
    expect(call.opts?.input).toContain('factory-status milestone');
    expect(call.opts?.input).toMatch(/\n\ndo it$/);
    expect(call.opts?.logPath).toBe('/l.log');
    expect(call.args.filter((a) => a === '-v')).toHaveLength(2);
    expect(call.args).toContain('/w/c:/work');
    expect(call.args).toContain(`${HOME}/npm-cache:/home/pwuser/.npm`);
    expect(call.args.slice(call.args.indexOf('-w'), call.args.indexOf('-w') + 2)).toEqual(['-w', '/work/game']);
    expect(call.args.filter((a) => a === '-e')).toHaveLength(12);
    expect(call.args.slice(call.args.indexOf('img:1'))).toEqual(['img:1', 'bash', '-c', expect.stringMatching(/memory\.peak.*; factory-agent "\$@"$/), 'factory-agent', '-p', '--model', 'opus', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose']);
  });

  it('mounts the folders the stage names read only', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', readOnly: { '/h/state': '/factory/state' } });
    const args = runCall(calls).args;
    expect(args.filter((a) => a === '-v')).toHaveLength(3);
    expect(args).toContain('/h/state:/factory/state:ro');
  });

  it('mounts the bundled evidence check read only, and only when the run asks for it', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', evidenceCheck: true });
    const args = runCall(calls).args;
    expect(args).toContain(`${HOME}/agent-check:/opt/factory-check:ro`);
    expect(existsSync(`${HOME}/agent-check/check.mjs`)).toBe(true);
    const plain = fakeRun();
    await dockerContainer(plain.run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    expect(runCall(plain.calls).args.join(' ')).not.toContain('/opt/factory-check');
  });

  it('tells the agents that write evidence to run the mounted command as their last step', () => {
    for (const [name, round] of [['test', 'test'], ['test-fix-evidence', 'test'], ['patch', 'patch']]) {
      expect(readFileSync(`prompts/${name}.md`, 'utf8'), name).toContain(`${EVIDENCE_CHECK_COMMAND} ${round}`);
    }
  });

  it('mounts the reference images read only inside the clone, and only when the run has them', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', mediaDir: '/h/media/issue-7' });
    expect(runCall(calls).args).toContain('/h/media/issue-7:/work/.factory-media:ro');
    expect(runCall(calls).args.filter((a) => a === '-v')).toHaveLength(3);
  });

  it('mounts the session folder under the agent projects folder and starts the session by id', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', session: { dir: '/h/sessions/issue-7', id: 'abc', resume: false } });
    const { args } = runCall(calls);
    expect(args).toContain('/h/sessions/issue-7:/home/pwuser/.claude/projects');
    expect(args.filter((a) => a === '-v')).toHaveLength(3);
    expect(args.slice(args.indexOf('--verbose'))).toEqual(['--verbose', '--session-id', 'abc']);
    expect(args).not.toContain('--resume');
  });

  it('continues the session by id when it resumes', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', session: { dir: '/h/s', id: 'abc', resume: true } });
    const { args } = runCall(calls);
    expect(args.slice(args.indexOf('--verbose'))).toEqual(['--verbose', '--resume', 'abc']);
    expect(args).not.toContain('--session-id');
  });

  it('passes a reasoning effort right after the model', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'sonnet', prompt: 'p', log: '/l.log', effort: 'low' });
    const args = runCall(calls).args;
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4)).toEqual(['--model', 'sonnet', '--effort', 'low']);
  });

  it('passes disallowed tools only when a stage names them', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'sonnet', prompt: 'p', log: '/l.log', disallowedTools: ['Agent'] });
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'sonnet', prompt: 'p', log: '/l.log' });
    const [blocked, open] = calls.filter((call) => call.args.includes('--model')).map((call) => call.args);
    expect(blocked.slice(blocked.indexOf('--disallowedTools'), blocked.indexOf('--disallowedTools') + 2)).toEqual(['--disallowedTools', 'Agent']);
    expect(open).not.toContain('--disallowedTools');
  });

  it('puts a skill command on the first line, before the outputs note', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'do it', log: '/l.log', skill: '/code-review' });
    expect(runCall(calls).opts?.input).toMatch(/^\/code-review\n\nYour folder is \/work\/game\./);
    expect(runCall(calls).opts?.input).toMatch(/\n\ndo it$/);
  });

  it('puts a restricted agent on the internal network with the proxy env', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', openNetwork: false });
    const { args } = runCall(calls);
    expect(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2)).toEqual(['--network', 'roam-factory-agents']);
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) expect(args).toContain(`${key}=http://roam-factory-proxy:8888`);
    expect(args).toContain('NO_PROXY=localhost,127.0.0.1');
    expect(args).toContain('no_proxy=localhost,127.0.0.1');
  });

  it('runs an open agent on the default network with no proxy and no setup', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l', openNetwork: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).not.toContain('--network');
    expect(calls[0].args.join(' ')).not.toContain('PROXY');
  });

  it('keeps a running proxy and an existing network as they are', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    expect(setupCalls(calls)).toEqual(['network inspect roam-factory-agents', 'image inspect -f {{.Id}} img:1-proxy', 'inspect -f {{.State.Running}} {{.Image}} roam-factory-proxy']);
  });

  it('replaces a running proxy from an older image before the agent starts', async () => {
    const { run, calls } = fakeRun(0, { 'inspect -f': { code: 0, stdout: 'true sha:0' } });
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    const setup = setupCalls(calls);
    expect(setup).toContain('rm -f roam-factory-proxy');
    expect(setup).toContain('run -d --restart unless-stopped --name roam-factory-proxy --network roam-factory-agents img:1-proxy');
    expect(calls.indexOf(runCall(calls))).toBe(calls.length - 1);
  });

  it('keeps a proxy from an older image while other factory containers run', async () => {
    const { run, calls } = fakeRun(0, { 'inspect -f': { code: 0, stdout: 'true sha:0' }, 'ps -q': { code: 0, stdout: 'abc\n' } });
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    expect(setupCalls(calls)).toContain('ps -q --filter label=factory=1');
    expect(setupCalls(calls)).not.toContain('rm -f roam-factory-proxy');
  });

  it('labels the containers of a job with its id', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, 'testing-8-x').shell('/c', 'x', '/l');
    expect(runCall(calls).args.slice(0, 6)).toEqual(['run', '--rm', '--label', 'factory=1', '--label', 'factory-job=testing-8-x']);
  });

  it('passes the pool test worker count, and none for a pool without one', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, 'testing-8-x', '2-3', 2).shell('/c', 'x', '/l');
    expect(runCall(calls).args.join(' ')).toContain('-e TEST_WORKERS=2');
    const light = fakeRun();
    await dockerContainer(light.run, cfg, 'testing-8-x', '0').shell('/c', 'x', '/l');
    expect(runCall(light.calls).args.join(' ')).not.toContain('TEST_WORKERS');
  });

  it('records the highest container peak of a job on its ledger line, also from a failed run', async () => {
    rmSync(HOME, { recursive: true, force: true });
    const peak = (gib: number): string => `log line\nFACTORY_MEMORY_PEAK ${gib * 1024 ** 3}\n`;
    await dockerContainer(fakeRun(0, {}, peak(2.5)).run, cfg, 'checks-8-x').shell('/c', 'x', '/l');
    await expect(dockerContainer(fakeRun(1, {}, peak(3)).run, cfg, 'checks-8-x').shell('/c', 'x', '/l')).rejects.toThrow('exit 1');
    await dockerContainer(fakeRun(0, {}, peak(1)).run, cfg, 'checks-8-x').shell('/c', 'x', '/l');
    await dockerContainer(fakeRun(0, {}, 'killed, no mark').run, cfg, 'checks-8-x').shell('/c', 'x', '/l');
    recordJob(HOME, tokenPrices, new Date('2026-10-06T12:00:00Z'), { id: 'checks-8-x', stage: 'checks', issue: 8, startedAt: '2026-10-06T11:50:00Z' }, 'done');
    const lines = readFileSync(`${HOME}/ledger.jsonl`, 'utf8').trim().split('\n').map((text) => JSON.parse(text) as { kind: string; peakGb?: number });
    expect(lines.find((line) => line.kind === 'job')?.peakGb).toBe(3);
    expect(readPeakGb('no mark')).toBeUndefined();
  });

  it('takes the time limits off the game tests in every container', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).shell('/c', 'x', '/l');
    expect(runCall(calls).args.join(' ')).toContain('-e TEST_TIMEOUTS=off');
  });

  it('gives agent and shell containers the GPU with its graphics drivers only when the GPU is on', async () => {
    const on = fakeRun();
    const gpuCfg = { ...cfg, gpu: true };
    await dockerContainer(on.run, gpuCfg, null).agent({ clone: '/w/c', dir: 'game', model: 'opus', prompt: 'p', log: '/l' });
    await dockerContainer(on.run, gpuCfg, null).shell('/c', 'x', '/l');
    const runs = on.calls.filter((call) => call.args[0] === 'run' && call.args[1] === '--rm');
    expect(runs.map((call) => call.args.join(' '))).toEqual([expect.stringContaining('--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all'), expect.stringContaining('--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all')]);
    const off = fakeRun();
    await dockerContainer(off.run, { ...cfg, gpu: false }, null).shell('/c', 'x', '/l');
    expect(runCall(off.calls).args).not.toContain('--gpus');
  });

  it('fails loud when the proxy image is missing', async () => {
    const { run, calls } = fakeRun(0, { 'image inspect': { code: 1 } });
    await expect(dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('inspect image img:1-proxy');
    expect(calls.some((call) => call.args[1] === '--rm')).toBe(false);
  });

  it('creates the internal network and starts the proxy when missing', async () => {
    const { run, calls } = fakeRun(0, { 'network inspect': { code: 1 }, 'inspect -f': { code: 1 } });
    await dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    const setup = setupCalls(calls);
    expect(setup).toContain('network create --internal roam-factory-agents');
    expect(setup).toContain('run -d --restart unless-stopped --name roam-factory-proxy --network roam-factory-agents img:1-proxy');
    expect(setup).toContain('network connect bridge roam-factory-proxy');
    expect(calls.indexOf(runCall(calls))).toBe(calls.length - 1);
  });

  it('fails loud when the proxy cannot start', async () => {
    const { run, calls } = fakeRun(0, { 'inspect -f': { code: 1 }, 'run -d': { code: 125 } });
    await expect(dockerContainer(run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('setup failed');
    expect(calls.some((call) => call.args[1] === '--rm')).toBe(false);
  });

  it('throws when the agent exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(2).run, cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toThrow('exit 2');
  });

  it('runs a shell script with the given env and no token', async () => {
    const { run, calls } = fakeRun();
    await dockerContainer(run, cfg, null).shell('/w/c', 'npm ci', '/l.log', { SAVE_SCOPE: 'dev' });
    const call = runCall(calls);
    expect(call.args).toContain('SAVE_SCOPE=dev');
    expect(call.args).toContain('/work/game');
    expect(call.args).toContain(`${HOME}/npm-cache:/home/pwuser/.npm`);
    expect(call.args.slice(-3)).toEqual(['bash', '-lc', expect.stringMatching(/memory\.peak.*\nnpm ci$/)]);
    expect(call.opts?.env).toBeUndefined();
    expect(call.args).toContain('roam-factory-agents');
    expect(call.args).toContain('HTTPS_PROXY=http://roam-factory-proxy:8888');
    expect(call.args.join(' ')).not.toContain('secret-token');
    expect(call.args).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('throws when the shell exits nonzero', async () => {
    await expect(dockerContainer(fakeRun(1).run, cfg, null).shell('/c', 'x', '/l')).rejects.toThrow('boom');
  });
});

describe('agent usage', () => {
  const result = JSON.stringify({ type: 'result', duration_ms: 120_000, total_cost_usd: 2 });
  const agentRun = (code: number, stdout: string): Run => async (_cmd, args) => (args[0] === 'run' && args[1] === '--rm' ? { code, stdout, stderr: 'boom' } : { code: 0, stdout: args[0] === 'inspect' ? 'true sha:1' : 'sha:1\n', stderr: '' });
  const run = { clone: '/w/c', dir: 'game', model: 'opus', prompt: 'p', log: '/l.log' };

  it('records the cost of each run under the job id', async () => {
    rmSync(`${HOME}/usage`, { recursive: true, force: true });
    await dockerContainer(agentRun(0, `${result}\n`), cfg, 'job-7').agent(run);
    expect(takeUsage(HOME, 'job-7')).toEqual([{ model: 'opus', costUsd: 2, minutes: 2 }]);
  });

  it('fails a finished run that reports no cost', async () => {
    await expect(dockerContainer(agentRun(0, ''), cfg, 'job-8').agent(run)).rejects.toThrow(/no result event/);
  });

  it('records nothing for a run that died before Claude Code saved its transcript', async () => {
    rmSync(`${HOME}/usage`, { recursive: true, force: true });
    await expect(dockerContainer(agentRun(1, ''), cfg, 'job-9').agent(run)).rejects.toThrow('boom');
    expect(takeUsage(HOME, 'job-9')).toEqual([]);
  });

  it('prices a run that failed before its result from the transcript in its own session folder', async () => {
    rmSync(`${HOME}/usage`, { recursive: true, force: true });
    const transcriptRun: Run = async (cmd, args, opts) => {
      if (args[0] === 'run' && args[1] === '--rm') {
        const projects = args[args.findIndex((arg) => arg.endsWith(':/home/pwuser/.claude/projects'))].split(':')[0];
        const id = args[args.indexOf('--session-id') + 1];
        mkdirSync(`${projects}/-work-game`, { recursive: true });
        const usage = { input_tokens: 0, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } };
        writeFileSync(`${projects}/-work-game/${id}.jsonl`, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'opus', usage } })}\n`);
      }
      return agentRun(1, '')(cmd, args, opts);
    };
    await expect(dockerContainer(transcriptRun, cfg, 'job-10').agent(run)).rejects.toThrow('boom');
    const [usage] = takeUsage(HOME, 'job-10');
    expect([usage.costUsd, usage.fromTranscript]).toEqual([2, true]);
    expect(existsSync(`${HOME}/usage/job-10.projects`)).toBe(false);
  });
});

describe('usage limit', () => {
  // The result line of a real run that hit the weekly limit, cut to the fields the factory reads. The real message separates its parts with a middle dot.
  const LIMIT_RESULT = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, total_cost_usd: 0, result: "You've hit your weekly limit, resets 11pm (UTC)" });
  const limitRun = (stdout: string): Run => async (_cmd, args) => (args[0] === 'run' && args[1] === '--rm' ? { code: 1, stdout, stderr: '' } : { code: 0, stdout: args[0] === 'inspect' ? 'true sha:1' : 'sha:1\n', stderr: '' });
  const pause = `${HOME}/paused`;

  it('pauses the factory and throws a usage-limit error', async () => {
    mkdirSync(HOME, { recursive: true });
    rmSync(pause, { force: true });
    const agent = dockerContainer(limitRun(`{"type":"system"}\n${LIMIT_RESULT}\n`), cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' });
    await expect(agent).rejects.toBeInstanceOf(UsageLimitError);
    expect(readFileSync(pause, 'utf8')).toBe("Hermes: Claude weekly usage limit; You've hit your weekly limit, resets 11pm (UTC)\n");
    rmSync(pause);
  });

  it('keeps a pause someone else wrote', async () => {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(pause, 'Hermes repairs #4\n');
    await expect(dockerContainer(limitRun(LIMIT_RESULT), cfg, null).agent({ clone: '/c', dir: 'game', model: 'm', prompt: 'p', log: '/l' })).rejects.toBeInstanceOf(UsageLimitError);
    expect(readFileSync(pause, 'utf8')).toBe('Hermes repairs #4\n');
    rmSync(pause);
  });

  it('finds no limit in a normal failure, and fails loud on a limit result with no message', () => {
    expect(usageLimitMessage(`${AGENT_RESULT}\n`)).toBeNull();
    expect(() => usageLimitMessage(JSON.stringify({ type: 'result', api_error_status: 429 }))).toThrow('no message');
  });
});
