import { changesSaveMajor } from './save-guard';

export class CommitteeDecisionError extends Error {}

const FORBIDDEN_PATH = /^\.github\/|(^|\/)\.factory(-tasks|-media)?\//;

export function factoryPaths(diff: string): string[] {
  const paths = [...diff.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].flatMap((match) => [match[1], match[2]]);
  return [...new Set(paths)].filter((path) => FORBIDDEN_PATH.test(path));
}

const FILE_HEADER = /^diff --git a\/.+ b\/(.+)$/m;

export function changedAgainstAll(diffs: string[]): string {
  const [first = '', ...others] = diffs;
  const files = others.map((diff) => new Set(diff.split(/^(?=diff --git )/m).map((section) => FILE_HEADER.exec(section)?.[1])));
  return first.split(/^(?=diff --git )/m).filter((section) => {
    const file = FILE_HEADER.exec(section)?.[1];
    return file !== undefined && files.every((set) => set.has(file));
  }).join('');
}

export function guardDiff(diff: string): void {
  const leaked = factoryPaths(diff);
  if (leaked.length) throw new Error(`The branch touches paths an agent may not push: ${leaked.join(', ')}`);
  if (changesSaveMajor(diff)) {
    throw new CommitteeDecisionError('The change bumps SAVE_MAJOR in game/src/three/save-migrations.ts. The committee must decide on a major save bump before this can go on.');
  }
}
