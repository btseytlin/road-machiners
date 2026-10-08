import { execFileSync } from 'node:child_process';
import { CLONE_ROUNDS, HOST_ONLY_CHECKS, checkClone } from './clone-checks';
import { guardDiff } from './diff-guard';

export const GUARD_ROUND = 'guard';
const USAGE = `Usage: factory-check <${[...CLONE_ROUNDS, GUARD_ROUND].join('|')}>, run from your folder after your last commit`;

export function runAgentCheck(args: string[], cwd: string, print: (line: string) => void): number {
  const round = args.length === 1 ? args[0] : undefined;
  if (round === GUARD_ROUND) return runGuard(cwd, print);
  if (!CLONE_ROUNDS.some((known) => known === round)) {
    print(USAGE);
    return 2;
  }
  return runRound(cwd, print);
}

function runRound(cwd: string, print: (line: string) => void): number {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const { failures } = checkClone(cwd);
  for (const failure of failures) print(`Failed: ${failure}`);
  print(`Not checked here, the factory checks it after the stage: ${HOST_ONLY_CHECKS.join('; ')}.`);
  print(summary(failures.length, head.slice(0, 7)));
  return failures.length === 0 ? 0 : 1;
}

const DIFF_BUFFER_BYTES = 256 * 1024 * 1024;

function runGuard(cwd: string, print: (line: string) => void): number {
  try {
    guardDiff(execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf8', maxBuffer: DIFF_BUFFER_BYTES }));
    return 0;
  } catch (error) {
    print(`The factory refuses this commit: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function summary(failed: number, head: string): string {
  if (failed === 0) return `The evidence checks pass at ${head}.`;
  return `${failed} check${failed === 1 ? '' : 's'} failed at ${head}. Fix each one and run this command again.`;
}
