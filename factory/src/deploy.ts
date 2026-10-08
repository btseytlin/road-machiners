import { stepScript } from './activity';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeError } from './fail';
import { reportEnv, takeMaps, type ReportBuild } from './sourcemaps';
import { readState, updateState } from './state';
import { GAME_DIR, type Ctx } from './types';

const SCOPE = /^[a-z0-9-]+$/;

export function checkScope(scope: string): void {
  if (!SCOPE.test(scope)) throw new Error(`bad deploy scope "${scope}"`);
}

// Builds in the container, then publishes the build. A build with a report kind sends error reports and keeps its maps on the host.
// Card previews have none, since an error there belongs to the card's own review.
export async function buildAndDeploy(ctx: Ctx, clone: string, scope: string, log: string, reports: ReportBuild | null = null): Promise<string> {
  checkScope(scope);
  await ctx.container.shell(clone, stepScript('Building the game', [['npm ci', 'npm ci'], ['build', 'npm run build']]), log, { SAVE_SCOPE: scope, ...(reports ? reportEnv(ctx.cfg, reports) : {}) });
  if (reports) await takeMaps(ctx, clone, reports);
  return publishBuild(ctx, clone, scope);
}

// Swaps the clone's built files into the web root with one rename. Source maps never go public.
export function publishBuild(ctx: Ctx, clone: string, scope: string): string {
  checkScope(scope);
  const target = `${ctx.cfg.webRoot}/${scope}`;
  const staging = `${ctx.cfg.webRoot}/.${scope}.new`;
  mkdirSync(ctx.cfg.webRoot, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  cpSync(`${clone}/${GAME_DIR}/dist`, staging, { recursive: true, filter: (source) => !source.endsWith('.map') });
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  return `${ctx.cfg.publicUrl}/${scope}/`;
}

// Records which dev commit /dev/ serves, or which one failed and why, so the tick rebuilds /dev/ only when dev moves and Hermes sees what broke.
export async function deployDev(ctx: Ctx, log: string): Promise<string> {
  const dir = `${ctx.cfg.home}/work/dev-build`;
  rmSync(dir, { recursive: true, force: true });
  await ctx.repo.prepareWorkClone('dev', 'dev', dir);
  const head = await ctx.repo.headHash('dev');
  try {
    const url = await buildAndDeploy(ctx, dir, 'dev', log, 'dev');
    updateState(ctx.statePath, (state) => ({ ...state, devBuild: head, devFailed: null, devError: null }));
    return url;
  } catch (error) {
    updateState(ctx.statePath, (state) => ({ ...state, devFailed: head, devError: summarizeError(error instanceof Error ? error.message : String(error)) }));
    throw error;
  }
}

// The dev job: dev moved outside an approval, so the committee hears of the new build here.
export async function rebuildDev(ctx: Ctx, log: string): Promise<void> {
  const url = await deployDev(ctx, log);
  const head = readState(ctx.statePath).devBuild;
  await ctx.telegram.sendMessage(ctx.cfg.committeeChat, `Dev is rebuilt at ${head}.\nPlay it: ${url}`);
}

// The testing stage calls this after it deploys a build, so cleanup keeps the folder while the card waits in Approval.
export function recordBuild(statePath: string, issue: number, name: string): void {
  updateState(statePath, (state) => ({ ...state, builds: { ...state.builds, [String(issue)]: name } }));
}

// The web root folder that holds first-party images, like reference concepts. It is not a build and cleanup never touches it.
export const RESERVED_WEB_DIRS = ['dev', 'concepts'];

// Deletes every folder in the web root except the reserved ones and the kept builds. Returns the names it removed.
export function removeStaleBuilds(webRoot: string, keep: Set<string>, log: (msg: string) => void): string[] {
  if (!existsSync(webRoot)) return [];
  const stale = readdirSync(webRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !RESERVED_WEB_DIRS.includes(entry.name) && !keep.has(entry.name));
  for (const entry of stale) {
    rmSync(join(webRoot, entry.name), { recursive: true, force: true });
    log(`removed stale build ${entry.name}`);
  }
  return stale.map((entry) => entry.name);
}
