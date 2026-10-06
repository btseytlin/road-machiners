import { chmodSync, copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DOCUMENT_MAX_BYTES } from './telegram';
import { OUT_DIR } from './types';

// The only place an ad hoc agent may leave a file for the member, inside its work clone.
export const ARTIFACT_DIR = 'files';
export const ARTIFACT_MAX_FILES = 10;
export const ARTIFACT_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const ARTIFACT_EXTENSIONS = ['.html', '.htm', '.pdf', '.csv', '.tsv', '.json', '.txt', '.md', '.log', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.zip'];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;

export type Artifact = { name: string; path: string; size: number };

// Lists the files the agent left in its output folder and checks each one before anything is sent.
// Only plain files directly in the folder pass. A link, a folder, an odd name, a wrong extension, an empty file or a file Telegram refuses throws with a message the member can act on.
export function collectArtifacts(home: string): Artifact[] {
  const dir = join(home, OUT_DIR, ARTIFACT_DIR);
  if (!lstatSync(dir, { throwIfNoEntry: false })) return [];
  requireConfined(home);
  const names = readdirSync(dir).sort();
  if (names.length > ARTIFACT_MAX_FILES) throw new Error(`The agent made ${names.length} files, the limit is ${ARTIFACT_MAX_FILES}.`);
  const artifacts = names.map((name) => checkFile(dir, name));
  const total = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
  if (total > ARTIFACT_MAX_TOTAL_BYTES) throw new Error(`The files add up to ${total} bytes, the limit is ${ARTIFACT_MAX_TOTAL_BYTES}.`);
  return artifacts;
}

function requireConfined(home: string): void {
  const out = join(home, OUT_DIR);
  const dir = join(out, ARTIFACT_DIR);
  const plain = isRealDir(out) && isRealDir(dir) && realpathSync(dir) === join(realpathSync(home), OUT_DIR, ARTIFACT_DIR);
  if (!plain) throw new Error(`${OUT_DIR}/${ARTIFACT_DIR} is not a plain folder inside the work clone, so no file was sent.`);
}

function checkFile(dir: string, name: string): Artifact {
  const path = join(dir, name);
  const stat = lstatSync(path);
  const problem = stat.isFile() ? (nameProblem(name) ?? sizeProblem(stat.size)) : 'is not a regular file. Links and folders are not sent';
  if (problem) throw new Error(`"${name}" ${problem}.`);
  return { name, path, size: stat.size };
}

function nameProblem(name: string): string | null {
  if (!SAFE_NAME.test(name) || name.includes('..')) return 'has a name that is not allowed. Use letters, digits, spaces, dots, dashes and underscores';
  if (!ARTIFACT_EXTENSIONS.includes(extname(name).toLowerCase())) return `has an extension that is not allowed. Allowed: ${ARTIFACT_EXTENSIONS.join(' ')}`;
  return null;
}

function sizeProblem(size: number): string | null {
  if (size === 0) return 'is empty';
  return size > DOCUMENT_MAX_BYTES ? `is ${size} bytes, Telegram takes at most ${DOCUMENT_MAX_BYTES} for a file` : null;
}

const isRealDir = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

// Where validated files wait for delivery. It is under the factory home, never under the web root, and only the factory user can read it.
export const heldDir = (home: string, issue: number): string => join(home, 'adhoc-artifacts', `issue-${issue}`);

export function holdArtifacts(home: string, issue: number, artifacts: Artifact[]): Artifact[] {
  const dir = heldDir(home, issue);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return artifacts.map((artifact) => {
    const path = join(dir, artifact.name);
    copyFileSync(artifact.path, path);
    return { ...artifact, path };
  });
}

export const releaseArtifacts = (home: string, issue: number): void => rmSync(heldDir(home, issue), { recursive: true, force: true });
