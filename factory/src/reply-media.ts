import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BYTES, MAX_FILES, detectType, imageSize, validSize, type MediaEntry } from './media';

const SKIPPED = '.skipped';
const FOLDER = 'committee';
const MANIFEST = 'committee.json';

export function replyMediaDir(home: string, post: number): string {
  return join(home, 'inbox', 'media', `post-${post}`);
}

export function adoptReplyMedia(home: string, post: number, issueDir: string, by: string): MediaEntry[] {
  const from = replyMediaDir(home, post);
  const source = `committee reply in Telegram by ${by}`;
  let names: string[];
  try {
    names = existsSync(from) ? readdirSync(from).filter((name) => !name.endsWith('.tmp')).sort(byMessage) : [];
    if (names.length > 0) mkdirSync(join(issueDir, FOLDER), { recursive: true });
  } catch (error) {
    return [{ url: `telegram:post-${post}`, source, status: 'failed', reason: `the factory could not read the files: ${messageOf(error)}` }];
  }
  if (names.length === 0) return [];
  const entries = names.map((name) => safeAdopt(join(from, name), `post-${post}-${name}`, issueDir, source));
  writeFileSync(join(issueDir, MANIFEST), JSON.stringify(merged(readCommitteeMedia(issueDir), entries), null, 2));
  rmSync(from, { recursive: true, force: true });
  return entries;
}

function merged(earlier: MediaEntry[], added: MediaEntry[]): MediaEntry[] {
  const seen = new Set<string>();
  const unique = [...added].reverse().concat([...earlier].reverse()).filter((entry) => {
    if (entry.sha256 === undefined) return true;
    if (seen.has(entry.sha256)) return false;
    seen.add(entry.sha256);
    return true;
  });
  return unique.slice(0, MAX_FILES).reverse();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeAdopt(path: string, name: string, issueDir: string, source: string): MediaEntry {
  try {
    return adopt(path, name, issueDir, source);
  } catch (error) {
    return { url: `telegram:${name}`, source, status: 'failed', reason: `the factory could not read it: ${messageOf(error)}` };
  }
}

function byMessage(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function adopt(path: string, name: string, issueDir: string, source: string): MediaEntry {
  const url = `telegram:${name}`;
  if (name.endsWith(SKIPPED)) return { url: url.slice(0, -SKIPPED.length), source, status: 'failed', reason: `the chat bot could not keep it: ${readFileSync(path, 'utf8').trim()}` };
  if (statSync(path).size > MAX_BYTES) return { url, source, status: 'failed', reason: `it is over the ${MAX_BYTES} byte limit` };
  const data = readFileSync(path);
  const type = detectType(data);
  if (type === null) return { url, source, status: 'failed', bytes: data.length, reason: 'it is not a PNG, JPEG, GIF or WebP image' };
  const size = imageSize(data, type);
  if (!validSize(size)) return { url, source, status: 'failed', bytes: data.length, reason: `it does not decode as a ${type} image` };
  const sha256 = createHash('sha256').update(data).digest('hex');
  const file = `${FOLDER}/${sha256.slice(0, 16)}.${type === 'jpeg' ? 'jpg' : type}`;
  renameSync(path, join(issueDir, file));
  return { url, source, status: 'ok', file, type, ...size, bytes: data.length, sha256 };
}

export function readCommitteeMedia(issueDir: string): MediaEntry[] {
  const path = join(issueDir, MANIFEST);
  let entries: MediaEntry[];
  try {
    entries = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as MediaEntry[]) : [];
  } catch {
    return [];
  }
  return entries.map((entry) => entry.status === 'ok' && !existsSync(join(issueDir, entry.file ?? ''))
    ? { url: entry.url, source: entry.source, status: 'failed', reason: 'its file is gone from the media folder' }
    : entry);
}

export function dropReplyMedia(home: string, posts: number[]): void {
  for (const post of posts) rmSync(replyMediaDir(home, post), { recursive: true, force: true });
}

export function replyMediaLines(entries: MediaEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => entry.status === 'ok'
    ? `- ${entry.type}, ${entry.width}x${entry.height}, ${entry.bytes} bytes, sha256 ${entry.sha256}`
    : `- not available: ${entry.reason}`);
  return `\n\nThe reply came with ${entries.length} file(s) in Telegram. They stay private: the agent sees them in its media folder, and they are not posted here.\n${lines.join('\n')}`;
}
