import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { must } from './exec';
import { withLockSync } from './lock';
import { GAME_DIR, type Ctx, type FactoryConfig } from './types';

// The source maps of the game builds that send error reports, kept on the host by commit, so the error service maps a
// player's stack to source. No build publishes its maps: /dev/ and the candidate are served from our web root, and itch is public.

export type ReportBuild = 'release' | 'dev' | 'candidate';
export type Published = { sha: string; kind: ReportBuild; publishedAt: string };

const LOCK_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const mapsRoot = (home: string): string => join(home, 'sourcemaps');
export const publishedPath = (home: string): string => join(mapsRoot(home), 'published.jsonl');

// The error endpoint sits beside the play links, so /dev/ and the candidate post to their own origin.
export function errorUrl(publicUrl: string): string {
  return new URL('/errors', publicUrl).href;
}

// The build env that turns error reports on in the game.
export function reportEnv(cfg: Pick<FactoryConfig, 'publicUrl'>, kind: ReportBuild): Record<string, string> {
  return { ERROR_REPORT_URL: errorUrl(cfg.publicUrl), ERROR_REPORT_BUILD: kind };
}

// Moves every map out of the clone's build into the host's store under its commit, and records the publish, before the
// build goes out. Dev and candidate maps older than FACTORY_ERROR_MAP_DAYS go at the same time.
export async function takeMaps(ctx: Ctx, clone: string, kind: ReportBuild): Promise<void> {
  const dist = join(clone, GAME_DIR, 'dist');
  const maps = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.map'));
  if (maps.length === 0) throw new Error(`The ${kind} build in ${dist} has no source maps, so its error reports could not be read.`);
  const sha = must(await ctx.run('git', ['rev-parse', 'HEAD'], { cwd: clone }), 'git rev-parse HEAD').trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`git rev-parse HEAD in ${clone} gave "${sha}", not a commit hash`);
  const home = ctx.cfg.home;
  withLockSync(join(mapsRoot(home), 'published.lock'), LOCK_MS, () => {
    for (const file of maps) {
      const target = join(mapsRoot(home), sha, file);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(dist, file), target);
    }
    pruneMaps(home, ctx.now(), ctx.cfg.errorMapDays);
    appendFileSync(publishedPath(home), `${JSON.stringify({ sha, kind, publishedAt: ctx.now().toISOString() } satisfies Published)}\n`);
  });
}

export function readPublished(home: string): Published[] {
  const path = publishedPath(home);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Published);
}

// Players keep old itch tabs and saves, so release maps stay. A dev or candidate tab left open sends reports for a while
// after the next build, so its maps stay FACTORY_ERROR_MAP_DAYS.
function pruneMaps(home: string, now: Date, days: number): void {
  const published = readPublished(home);
  const released = new Set(published.filter((entry) => entry.kind === 'release').map((entry) => entry.sha));
  const old = (entry: Published) => !released.has(entry.sha) && now.getTime() - Date.parse(entry.publishedAt) > days * DAY_MS;
  const gone = published.filter(old);
  if (gone.length === 0) return;
  const kept = new Set(published.filter((entry) => !old(entry)).map((entry) => entry.sha));
  for (const entry of gone) if (!kept.has(entry.sha)) rmSync(join(mapsRoot(home), entry.sha), { recursive: true, force: true });
  const temp = `${publishedPath(home)}.tmp`;
  writeFileSync(temp, published.filter((entry) => !old(entry)).map((entry) => `${JSON.stringify(entry)}\n`).join(''));
  renameSync(temp, publishedPath(home));
}
