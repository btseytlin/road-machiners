import { execFileSync } from 'node:child_process';
import { CLONE_ROUNDS, HOST_ONLY_CHECKS, checkClone } from './clone-checks';

const USAGE = `Usage: factory-check <${CLONE_ROUNDS.join('|')}>, run from your folder after your last commit`;

// The command an agent runs in its container as its last step, from its folder. Argument: the round.
// It prints each failure with the factory's own message and returns the exit code. The factory still gates after the stage.
export function runAgentCheck(args: string[], cwd: string, print: (line: string) => void): number {
  const round = args.length === 1 ? CLONE_ROUNDS.find((known) => known === args[0]) : undefined;
  if (round === undefined) {
    print(USAGE);
    return 2;
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const { failures } = checkClone(cwd);
  for (const failure of failures) print(`Failed: ${failure}`);
  print(`Not checked here, the factory checks it after the stage: ${HOST_ONLY_CHECKS.join('; ')}.`);
  print(summary(failures.length, head.slice(0, 7)));
  return failures.length === 0 ? 0 : 1;
}

function summary(failed: number, head: string): string {
  if (failed === 0) return `The evidence checks pass at ${head}.`;
  return `${failed} check${failed === 1 ? '' : 's'} failed at ${head}. Fix each one and run this command again.`;
}
