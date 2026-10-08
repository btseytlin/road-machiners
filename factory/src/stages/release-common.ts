import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readState, updateState } from '../state';
import { RELEASE_TASK_LABEL, type Card, type Ctx, type ReleaseState } from '../types';

export type Feature = { issue: number; title: string };

const FEATURE_MERGE = /^Merge issue #(\d+): (.*)$/;

export function featureMerges(subjects: string[]): Feature[] {
  return subjects.flatMap((subject) => {
    const match = FEATURE_MERGE.exec(subject);
    return match ? [{ issue: Number(match[1]), title: match[2] }] : [];
  });
}

export function featureLine(feature: Feature): string {
  return `#${feature.issue} ${feature.title}`;
}

const CHANGE_LINE = /^- \[#(\d+)\] \S/;

export function changeLines(notes: string, features: Feature[]): string[] {
  const lines = notes.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const issues = lines.map((line) => {
    const match = CHANGE_LINE.exec(line);
    if (!match) throw new Error(`release.md has a line that is not "- [#N] what changed": ${line}`);
    return Number(match[1]);
  });
  const named = issues.map((n) => `#${n}`).sort().join(', ');
  const wanted = features.map((feature) => `#${feature.issue}`).sort().join(', ');
  if (named !== wanted) throw new Error(`release.md names ${named || 'nothing'}, but the release holds ${wanted || 'nothing'}`);
  return lines;
}

export async function openReleaseTasks(ctx: Ctx): Promise<number[]> {
  return openTasks(await ctx.github.cards(), requireRelease(ctx).tasks);
}

export function openTasks(cards: Card[], recorded: number[]): number[] {
  const labeled = cards.filter((card) => card.labels.includes(RELEASE_TASK_LABEL) && card.column !== 'Done').map((card) => card.issue);
  const unseen = recorded.filter((issue) => !cards.some((card) => card.issue === issue && card.column === 'Done'));
  return [...new Set([...labeled, ...unseen])].sort((a, b) => a - b);
}

export function recordReleaseTask(ctx: Ctx, issue: number): void {
  updateState(ctx.statePath, (state) => {
    if (state.release === null) throw new Error(`No release is open to record task #${issue}`);
    return state.release.tasks.includes(issue) ? state : { ...state, release: { ...state.release, tasks: [...state.release.tasks, issue] } };
  });
}

export function requireRelease(ctx: Ctx): ReleaseState {
  const release = readState(ctx.statePath).release;
  if (release === null) throw new Error('No release is open');
  return release;
}

export async function releaseFeatures(ctx: Ctx, release: ReleaseState): Promise<Feature[]> {
  const merges = featureMerges(await ctx.repo.mergeLog(release.branch, 'main'));
  return merges.filter((feature) => !release.removed.includes(feature.issue));
}

export function candidateDir(ctx: Ctx): string {
  return join(ctx.cfg.home, 'work', 'release-candidate');
}

export function releaseLog(ctx: Ctx, name: string): string {
  const dir = join(ctx.cfg.home, 'logs');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${name}.log`);
}

export function trackingLink(ctx: Ctx, issue: number): string {
  return `https://github.com/${ctx.cfg.repo}/issues/${issue}`;
}
