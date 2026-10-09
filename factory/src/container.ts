import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { GUARD_ROUND } from './agent-check';
import { must } from './exec';
import { MEDIA_MOUNT } from './media';
import { jobLabel } from './jobs';
import { closeRun, closeRunFromTranscript, openRun, recordPeak, runProjectsDir, usageFromOutput } from './ledger';
import { withLock } from './lock';
import { pauseForUsageLimit, UsageLimitError } from './pause';
import { AGENT_NETWORK, GAME_DIR, PROXY_NAME, PROXY_PORT, type AgentSession, type Container, type FactoryConfig, type Run, type RunResult } from './types';

export const CHECKS_TIMEOUT_MARK = 'the checks ran past their';
const CLIENT_GRACE_MINUTES = 2;
const REMOVE_TIMEOUT_MS = 60_000;

const FACTORY_LABEL = 'factory=1';

function baseArgs(jobId: string | null, cpus: string | null, testWorkers: number | null, gpu: boolean): string[] {
  const label = jobId === null ? [] : ['--label', jobLabel(jobId)];
  const pin = cpus === null ? [] : ['--cpuset-cpus', cpus];
  const workers = testWorkers === null ? [] : ['-e', `TEST_WORKERS=${testWorkers}`];
  const card = gpu ? ['--gpus', 'all', '-e', 'NVIDIA_DRIVER_CAPABILITIES=all'] : [];
  return ['run', '--rm', '--label', FACTORY_LABEL, ...label, ...pin, ...workers, ...card, '-e', 'TEST_TIMEOUTS=off'];
}

const PEAK_MARK = 'FACTORY_MEMORY_PEAK';
const PEAK_TRAP = `trap 'echo "${PEAK_MARK} $(cat /sys/fs/cgroup/memory.peak)" >&2' EXIT`;
const GB = 1024 ** 3;

export function readPeakGb(stderr: string): number | undefined {
  const bytes = [...stderr.matchAll(new RegExp(`^${PEAK_MARK} (\\d+)$`, 'gm'))].at(-1)?.[1];
  return bytes === undefined ? undefined : Math.round((Number(bytes) / GB) * 100) / 100;
}

function recordContainerPeak(cfg: FactoryConfig, jobId: string | null, result: RunResult): void {
  const peak = readPeakGb(result.stderr);
  if (jobId !== null && peak !== undefined) recordPeak(cfg.home, jobId, peak);
}
const PROXY_URL = `http://${PROXY_NAME}:${PROXY_PORT}`;
const NO_PROXY = 'localhost,127.0.0.1';

const NPM_CACHE = '/home/pwuser/.npm';
const SESSIONS_MOUNT = '/home/pwuser/.claude/projects';

function mountArgs(cfg: FactoryConfig, clone: string, dir: string, mediaDir?: string): string[] {
  const cache = `${cfg.home}/npm-cache`;
  mkdirSync(cache, { recursive: true });
  const media = mediaDir === undefined ? [] : ['-v', `${mediaDir}:${MEDIA_MOUNT}:ro`];
  return ['-v', `${clone}:/work`, '-v', `${cache}:${NPM_CACHE}`, ...media, '-w', `/work/${dir}`];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

function networkArgs(open: boolean): string[] {
  if (open) return [];
  const proxyEnv = Object.fromEntries(
    ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].map((key) => [key, PROXY_URL]).concat([['NO_PROXY', NO_PROXY], ['no_proxy', NO_PROXY]]),
  );
  return ['--network', AGENT_NETWORK, ...envArgs(proxyEnv)];
}

const PROXY_LOCK_MS = 120_000;

function ensureProxy(run: Run, cfg: FactoryConfig): Promise<void> {
  return withLock(join(cfg.home, 'locks', 'proxy'), PROXY_LOCK_MS, () => setUpProxy(run, cfg));
}

async function setUpProxy(run: Run, cfg: FactoryConfig): Promise<void> {
  const docker = async (what: string, args: string[]) => must(await run('docker', args), what);
  if ((await run('docker', ['network', 'inspect', AGENT_NETWORK])).code !== 0) {
    await docker(`create network ${AGENT_NETWORK}`, ['network', 'create', '--internal', AGENT_NETWORK]);
  }
  const image = (await docker(`inspect image ${cfg.image}-proxy`, ['image', 'inspect', '-f', '{{.Id}}', `${cfg.image}-proxy`])).trim();
  const state = await run('docker', ['inspect', '-f', '{{.State.Running}} {{.Image}}', PROXY_NAME]);
  const running = state.code === 0 && state.stdout.startsWith('true ');
  if (running && (state.stdout.trim() === `true ${image}` || (await othersRun(docker)))) return;
  await run('docker', ['rm', '-f', PROXY_NAME]);
  await docker(`start ${PROXY_NAME}`, ['run', '-d', '--restart', 'unless-stopped', '--name', PROXY_NAME, '--network', AGENT_NETWORK, `${cfg.image}-proxy`]);
  await docker(`connect ${PROXY_NAME} to the default bridge`, ['network', 'connect', 'bridge', PROXY_NAME]);
}

async function othersRun(docker: (what: string, args: string[]) => Promise<string>): Promise<boolean> {
  return (await docker('docker ps', ['ps', '-q', '--filter', `label=${FACTORY_LABEL}`])).trim() !== '';
}

const CHECK_MOUNT = '/opt/factory-check';
export const EVIDENCE_CHECK_COMMAND = `node ${CHECK_MOUNT}/check.mjs`;

export const GUARD_HOOK = `#!/bin/sh
[ -f ${CHECK_MOUNT}/check.mjs ] || exit 0
exec ${EVIDENCE_CHECK_COMMAND} ${GUARD_ROUND}
`;
const CHECK_ENTRY = fileURLToPath(new URL('./agent-check-bin.ts', import.meta.url));

export async function buildCheckBundle(home: string): Promise<string> {
  const dir = join(home, 'agent-check');
  mkdirSync(dir, { recursive: true });
  const part = join(dir, `check-${process.pid}-${Date.now()}.mjs`);
  await build({ entryPoints: [CHECK_ENTRY], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: part, logLevel: 'silent' });
  renameSync(part, join(dir, 'check.mjs'));
  return dir;
}

async function readOnlyMounts(home: string, readOnly: Record<string, string>): Promise<string[]> {
  const mounts = { ...readOnly, [await buildCheckBundle(home)]: CHECK_MOUNT };
  return Object.entries(mounts).flatMap(([host, path]) => ['-v', `${host}:${path}:ro`]);
}

export function outputsNote(dir: string, jobMaxMinutes: number): string {
  return `Your folder is /work/${dir}. Write every .factory/ and .factory-tasks/ file under /work/${dir}, even after you change directory. When your activity changes, run factory-status with one category: reading, editing, tests, typecheck, playtest, build, publish, install, git, review, design, investigate, or waiting. ${MILESTONE_NOTE} ${longJobsNote(jobMaxMinutes)}`;
}

const MILESTONE_NOTE = 'Each time you start a new part of the work, run factory-status milestone \'<step>\' with a short step in the card\'s words, like \'Building orchard buildings\' or \'Testing the tow fee\'. Use 3 to 80 letters, digits, spaces and , . \' - only. Never name files, commands or secrets.';

function longJobsNote(jobMaxMinutes: number): string {
  return `Start a command that may run longer than 5 minutes with factory-job start <name> <activity> <minutes> '<command>', with a time limit of about twice its expected run. The limit is at most ${jobMaxMinutes} minutes. A check that needs longer is too big, so use fewer seeds, fewer turns or a direct test. Then check it with sleep 240; factory-job check <name>, with a Bash timeout of 5 minutes, until it ends. If its log has not changed for 15 minutes, stop it with factory-job stop <name> and find out why. Never end your run while a job is running, since the end of the run kills it.`;
}

function sessionMount(session: AgentSession | undefined): string[] {
  return session === undefined ? [] : ['-v', `${session.dir}:${SESSIONS_MOUNT}`];
}

function sessionArgs(session: AgentSession | undefined): string[] {
  return session === undefined ? [] : [session.resume ? '--resume' : '--session-id', session.id];
}

function effortArgs(effort: string | undefined): string[] {
  return effort === undefined ? [] : ['--effort', effort];
}

function advisorArgs(advisor: string | undefined): string[] {
  return advisor === undefined ? [] : ['--advisor', advisor];
}

function disallowedArgs(tools: string[] | undefined): string[] {
  return tools === undefined ? [] : ['--disallowedTools', tools.join(',')];
}

function recordUsage(cfg: FactoryConfig, jobId: string | null, result: RunResult, model: string, session: AgentSession | undefined): void {
  if (jobId === null) return;
  if (result.code === 0 || result.stdout.includes('"type":"result"')) return closeRun(cfg.home, jobId, usageFromOutput(result.stdout, model, session?.resume ?? false));
  closeRunFromTranscript(cfg.home, jobId, cfg.tokenPrices, new Date());
}

export function usageLimitMessage(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    if (!line.includes('"api_error_status":429')) continue;
    const event = JSON.parse(line) as { type?: string; result?: unknown };
    if (event.type !== 'result') continue;
    if (typeof event.result !== 'string') throw new Error(`A usage-limit result has no message: ${line.slice(0, 200)}`);
    return event.result;
  }
  return null;
}

function openRecordedRun(cfg: FactoryConfig, jobId: string | null, model: string, session: AgentSession | undefined): void {
  if (jobId === null || session === undefined) return;
  openRun(cfg.home, jobId, { model, projects: session.dir, sessionId: session.id, resumed: session.resume, startedAt: new Date().toISOString() });
}

function recordedSession(cfg: FactoryConfig, jobId: string | null, session: AgentSession | undefined): AgentSession | undefined {
  if (session !== undefined || jobId === null) return session;
  const dir = runProjectsDir(cfg.home, jobId);
  mkdirSync(dir, { recursive: true });
  return { dir, id: randomUUID(), resume: false };
}

export function dockerContainer(run: Run, cfg: FactoryConfig, jobId: string | null, cpus: string | null = null, testWorkers: number | null = null): Container {
  return {
    async agent({ clone, dir, model, prompt, log, openNetwork, mediaDir, readOnly = {}, session: issueSession, skill, effort, disallowedTools, advisor }) {
      if (!openNetwork) await ensureProxy(run, cfg);
      const session = recordedSession(cfg, jobId, issueSession);
      const env = {
        CLAUDE_CODE_OAUTH_TOKEN: cfg.oauthToken, ELEVENLABS_API_KEY: cfg.elevenlabsKey, SFX_MAX_GENERATIONS: String(cfg.sfxMaxGenerations),
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', FACTORY_JOB_MAX_MINUTES: String(cfg.agentJobMaxMinutes),
      };
      const readOnlyArgs = await readOnlyMounts(cfg.home, readOnly);
      const args = [
        ...baseArgs(jobId, cpus, testWorkers, cfg.gpu), '-i', ...mountArgs(cfg, clone, dir, mediaDir), ...sessionMount(session), ...readOnlyArgs, ...networkArgs(openNetwork === true), ...Object.keys(env).flatMap((key) => ['-e', key]), cfg.image,
        'bash', '-c', `${PEAK_TRAP}; factory-agent "$@"`, 'factory-agent', '-p', '--model', model, ...effortArgs(effort), ...advisorArgs(advisor), ...disallowedArgs(disallowedTools), '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', ...sessionArgs(session),
      ];
      const input = [skill, outputsNote(dir, cfg.agentJobMaxMinutes), prompt].filter((part) => part !== undefined).join('\n\n');
      openRecordedRun(cfg, jobId, model, session);
      const result = await run('docker', args, { env, input, logPath: log });
      recordUsage(cfg, jobId, result, model, session);
      recordContainerPeak(cfg, jobId, result);
      const limit = usageLimitMessage(result.stdout);
      if (limit !== null) {
        pauseForUsageLimit(cfg.home, limit);
        throw new UsageLimitError(`agent in ${clone} hit the usage limit: ${limit}`);
      }
      return must(result, `agent in ${clone}`);
    },
    async shell(clone, script, log, env = {}, mounts = {}, limitMinutes) {
      await ensureProxy(run, cfg);
      const extraMounts = Object.entries(mounts).flatMap(([host, path]) => ['-v', `${host}:${path}`]);
      const args = (named: string[]) => [...baseArgs(jobId, cpus, testWorkers, cfg.gpu), ...named, ...mountArgs(cfg, clone, GAME_DIR), ...extraMounts, ...networkArgs(false), ...envArgs(env), cfg.image, 'bash', '-lc', `${PEAK_TRAP}\n${script}`];
      const result = await runLimited(run, log, limitMinutes, args);
      recordContainerPeak(cfg, jobId, result);
      must(result, `shell in ${clone}`);
    },
  };
}

async function runLimited(run: Run, log: string, limitMinutes: number | undefined, args: (named: string[]) => string[]): Promise<RunResult> {
  if (limitMinutes === undefined) return run('docker', args([]), { logPath: log });
  const name = `factory-checks-${randomUUID()}`;
  const limit = removeAfter(run, name, limitMinutes);
  let result: RunResult;
  try {
    result = await run('docker', args(['--name', name]), { logPath: log, timeoutMs: (limitMinutes + CLIENT_GRACE_MINUTES) * 60_000 });
  } finally {
    limit.cancel();
  }
  const removal = await limit.removal();
  if (removal !== null) throw checksTimedOut(log, limitMinutes, removal);
  return result;
}

function removeAfter(run: Run, name: string, minutes: number): { cancel: () => void; removal: () => Promise<RunResult | null> } {
  let removal: Promise<RunResult> | null = null;
  const timer = setTimeout(() => { removal = run('docker', ['rm', '-f', name], { timeoutMs: REMOVE_TIMEOUT_MS }); }, minutes * 60_000);
  return { cancel: () => clearTimeout(timer), removal: async () => removal };
}

function checksTimedOut(log: string, minutes: number, removal: RunResult): Error {
  const cleanup = removal.code === 0 ? 'the factory removed their container' : `removing their container failed: ${removal.stderr.trim().slice(-300)}`;
  const message = `CheckTimeoutError: ${CHECKS_TIMEOUT_MARK} ${minutes} minute limit, and ${cleanup}.`;
  appendFileSync(log, `\n${message}\n`);
  return new Error(message);
}
