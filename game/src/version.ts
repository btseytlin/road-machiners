// The game version, worked out at build time in Node only, for vite.config.ts and vitest.config.ts. The browser never
// imports it. It is SAVE_MAJOR.minor format.commits since the commit that brought in the format, +short hash of HEAD.
// Nothing stores it, so no change bumps it by hand and parallel branches never conflict on it.

import { execFileSync } from 'node:child_process';

const SHAPE_FILE = 'src/three/save-shape.json';

function git(gameDir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: gameDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function savedFormat(gameDir: string): string {
  const shape = JSON.parse(git(gameDir, ['show', `HEAD:./${SHAPE_FILE}`])) as { format?: unknown };
  if (typeof shape.format !== 'string') throw new Error(`${SHAPE_FILE} in HEAD has no format string`);
  return shape.format;
}

function formatCommit(gameDir: string, format: string): string {
  if (git(gameDir, ['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error('Cannot work out the game version in a shallow clone. Fetch the full git history.');
  }
  const found = git(gameDir, ['log', '-1', '--format=%H', `-S"format": "${format}"`, '--', SHAPE_FILE]);
  if (!found) {
    throw new Error(`No commit brings format ${format} into ${SHAPE_FILE}. Commit the output of npm run save:shape, with full git history.`);
  }
  return found;
}

function commitsSince(gameDir: string, commit: string): number {
  return Number(git(gameDir, ['rev-list', '--count', `${commit}..HEAD`]));
}

function shortHash(gameDir: string): string {
  return git(gameDir, ['rev-parse', '--short', 'HEAD']);
}

export function versionOf(format: string, sinceFormat: number, hash: string): string {
  return `${format}.${sinceFormat}+${hash}`;
}

export function gameVersion(gameDir: string): string {
  const format = savedFormat(gameDir);
  return versionOf(format, commitsSince(gameDir, formatCommit(gameDir, format)), shortHash(gameDir));
}
