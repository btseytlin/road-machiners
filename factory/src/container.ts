import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { must } from './exec';
import { MEDIA_MOUNT } from './media';
import { jobLabel } from './jobs';
import { appendUsage, usageFromOutput } from './ledger';
import { withLock } from './lock';
import { AGENT_NETWORK, GAME_DIR, PROXY_NAME, PROXY_PORT, type AgentSession, type Container, type FactoryConfig, type Run, type RunResult } from './types';

const FACTORY_LABEL = 'factory=1';

// Every factory container carries the factory label. A job's containers also carry its own label, so a kill finds them.
// A job's containers run on the CPUs of its pool. A run by hand has no pool, so its containers are not pinned.
// TEST_TIMEOUTS=off takes the time limits off the game's tests and playtest. On this shared server they measure load, not hangs, and the job's own time limit stops a hung run.
// With the GPU on, every container gets the card. The graphics capability gives Chromium the NVIDIA Vulkan and GL drivers for WebGL.
function baseArgs(jobId: string | null, cpus: string | null, gpu: boolean): string[] {
  const label = jobId === null ? [] : ['--label', jobLabel(jobId)];
  const pin = cpus === null ? [] : ['--cpuset-cpus', cpus];
  const card = gpu ? ['--gpus', 'all', '-e', 'NVIDIA_DRIVER_CAPABILITIES=all'] : [];
  return ['run', '--rm', '--label', FACTORY_LABEL, ...label, ...pin, ...card, '-e', 'TEST_TIMEOUTS=off'];
}
const PROXY_URL = `http://${PROXY_NAME}:${PROXY_PORT}`;
const NO_PROXY = 'localhost,127.0.0.1';

// The npm cache is shared across runs, so `npm ci` reuses downloads. npm checks every package against the lockfile's integrity hash, so a bad cache entry fails the install instead of slipping in.
const NPM_CACHE = '/home/pwuser/.npm';
const SESSIONS_MOUNT = '/home/pwuser/.claude/projects';

function mountArgs(cfg: FactoryConfig, clone: string, dir: string, mediaDir?: string): string[] {
  const cache = `${cfg.home}/npm-cache`;
  mkdirSync(cache, { recursive: true });
  // The reference images mount read only inside the clone's mount. The clone's exclude file keeps them out of its commits.
  const media = mediaDir === undefined ? [] : ['-v', `${mediaDir}:${MEDIA_MOUNT}:ro`];
  return ['-v', `${clone}:/work`, '-v', `${cache}:${NPM_CACHE}`, ...media, '-w', `/work/${dir}`];
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

// The internal network has no route out. Its only way out is the proxy, which passes the allowlisted hosts.
function networkArgs(open: boolean): string[] {
  if (open) return [];
  const proxyEnv = Object.fromEntries(
    ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'].map((key) => [key, PROXY_URL]).concat([['NO_PROXY', NO_PROXY], ['no_proxy', NO_PROXY]]),
  );
  return ['--network', AGENT_NETWORK, ...envArgs(proxyEnv)];
}

// Setting up the proxy takes seconds. A job that waits this long found a stuck lock.
const PROXY_LOCK_MS = 120_000;

// Creates the internal network and the proxy container when they are missing. Throws when either cannot start.
// Parallel jobs set it up under one lock, so two never start the proxy at once.
function ensureProxy(run: Run, cfg: FactoryConfig): Promise<void> {
  return withLock(join(cfg.home, 'locks', 'proxy'), PROXY_LOCK_MS, () => setUpProxy(run, cfg));
}

// A proxy from an older image is replaced only while no factory container runs, so a deploy never cuts off a running agent.
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

// The agent runs the factory's own evidence checks in its container. The image has Node but not the factory's code, so each run bundles the current source into one file
// and mounts its folder read only. The agent can read the checks but never change them, and they cannot drift from the ones the factory runs after the stage.
const CHECK_MOUNT = '/opt/factory-check';
export const EVIDENCE_CHECK_COMMAND = `node ${CHECK_MOUNT}/check.mjs`;
const CHECK_ENTRY = fileURLToPath(new URL('./agent-check-bin.ts', import.meta.url));

// Parallel jobs bundle at once, so each writes its own file and renames it into place.
export async function buildCheckBundle(home: string): Promise<string> {
  const dir = join(home, 'agent-check');
  mkdirSync(dir, { recursive: true });
  const part = join(dir, `check-${process.pid}-${Date.now()}.mjs`);
  await build({ entryPoints: [CHECK_ENTRY], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: part, logLevel: 'silent' });
  renameSync(part, join(dir, 'check.mjs'));
  return dir;
}

async function readOnlyMounts(home: string, readOnly: Record<string, string>, evidenceCheck: boolean): Promise<string[]> {
  const mounts = evidenceCheck ? { ...readOnly, [await buildCheckBundle(home)]: CHECK_MOUNT } : readOnly;
  return Object.entries(mounts).flatMap(([host, path]) => ['-v', `${host}:${path}:ro`]);
}

// Prompts name agent files relative to the agent folder. An agent that changes directory, say to commit from the repo root, would write them elsewhere, so the full path comes first.
export function outputsNote(dir: string): string {
  return `Your folder is /work/${dir}. Write every .factory/ and .factory-tasks/ file under /work/${dir}, even after you change directory. When your activity changes, run factory-status with one category: reading, editing, tests, typecheck, playtest, build, publish, install, git, review, design, investigate, or waiting. At each meaningful work milestone, run factory-status milestone with one of: understanding, planning, implementing, validating, reviewing, preparing-release. Do not send notes, paths, prompts or secrets. Report only when the milestone changes, without extra narration.`;
}

// Only the projects folder is mounted, since the image keeps its skills in the rest of ~/.claude.
function sessionMount(session: AgentSession | undefined): string[] {
  return session === undefined ? [] : ['-v', `${session.dir}:${SESSIONS_MOUNT}`];
}

function sessionArgs(session: AgentSession | undefined): string[] {
  return session === undefined ? [] : [session.resume ? '--resume' : '--session-id', session.id];
}

function effortArgs(effort: string | undefined): string[] {
  return effort === undefined ? [] : ['--effort', effort];
}

// A finished run must report its cost. A failed run may have died before its result event, and then it records nothing.
function recordUsage(home: string, jobId: string, result: RunResult, model: string, resumed: boolean): void {
  if (result.code === 0) return appendUsage(home, jobId, usageFromOutput(result.stdout, model, resumed));
  if (result.stdout.includes('"type":"result"')) appendUsage(home, jobId, usageFromOutput(result.stdout, model, resumed));
}

// Agents get the work clone, the npm cache, the read-only folders their stage names, the OAuth token and the ElevenLabs key with its cap, nothing else. Secrets travel in the docker process env, never in argv.
// Unless the run is open, containers sit on the internal network and reach only the proxy's allowlist.
export function dockerContainer(run: Run, cfg: FactoryConfig, jobId: string | null, cpus: string | null = null): Container {
  return {
    async agent({ clone, dir, model, prompt, log, openNetwork, mediaDir, readOnly = {}, evidenceCheck, session, skill, effort }) {
      if (!openNetwork) await ensureProxy(run, cfg);
      // A headless run ends when the agent ends its turn, and that kills anything it left in the background.
      // Agents ended turns to wait for background subagents, and the run died with their work, so background tasks are off.
      const env = {
        CLAUDE_CODE_OAUTH_TOKEN: cfg.oauthToken, ELEVENLABS_API_KEY: cfg.elevenlabsKey, SFX_MAX_GENERATIONS: String(cfg.sfxMaxGenerations),
        CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
      };
      const readOnlyArgs = await readOnlyMounts(cfg.home, readOnly, evidenceCheck === true);
      const args = [
        ...baseArgs(jobId, cpus, cfg.gpu), '-i', ...mountArgs(cfg, clone, dir, mediaDir), ...sessionMount(session), ...readOnlyArgs, ...networkArgs(openNetwork === true), ...Object.keys(env).flatMap((key) => ['-e', key]), cfg.image,
        'factory-agent', '-p', '--model', model, ...effortArgs(effort), '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose', ...sessionArgs(session),
      ];
      const input = [skill, outputsNote(dir), prompt].filter((part) => part !== undefined).join('\n\n');
      const result = await run('docker', args, { env, input, logPath: log });
      if (jobId !== null) recordUsage(cfg.home, jobId, result, model, session?.resume ?? false);
      must(result, `agent in ${clone}`);
    },
    async shell(clone, script, log, env = {}) {
      await ensureProxy(run, cfg);
      const args = [...baseArgs(jobId, cpus, cfg.gpu), ...mountArgs(cfg, clone, GAME_DIR), ...networkArgs(false), ...envArgs(env), cfg.image, 'bash', '-lc', script];
      const result = await run('docker', args, { logPath: log });
      must(result, `shell in ${clone}`);
    },
  };
}
