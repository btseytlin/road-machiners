import { changesSaveMajor } from './save-guard';

// A question only the committee can answer, like a major save bump. A retry cannot get past it, so the stage goes to Hermes at once.
export class CommitteeDecisionError extends Error {}

// Paths an agent branch must never carry: agent messages, task files, and GitHub workflows,
// which GitHub would run with the repo's secrets as soon as the factory pushes them.
const FORBIDDEN_PATH = /^\.github\/|(^|\/)\.factory(-tasks|-media)?\//;

export function factoryPaths(diff: string): string[] {
  const paths = [...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].flatMap((match) => [match[1], match[2]]);
  return [...new Set(paths)].filter((path) => FORBIDDEN_PATH.test(path));
}

// The checks every agent diff passes before it reaches a branch on GitHub. The agent's commit hook runs them too, on its staged change.
export function guardDiff(diff: string): void {
  const leaked = factoryPaths(diff);
  if (leaked.length) throw new Error(`The branch touches paths an agent may not push: ${leaked.join(', ')}`);
  if (changesSaveMajor(diff)) {
    throw new CommitteeDecisionError('The change bumps SAVE_MAJOR in game/src/three/save-migrations.ts. The committee must decide on a major save bump before this can go on.');
  }
}
