import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BYTES, detectType, imageSize, validSize, type MediaEntry } from './media';

// Images a member sent with a Telegram reply to an approval post. They never block a route, and they never reach GitHub.
// The Hermes plugin copies them, best effort, into the inbox's media folder under the post. A file it could not copy is a `.skipped` note with the reason.
// When the post is routed as a patch or a redesign, the factory checks each file itself and moves it into the issue's media folder, where the agent reads it.

const SKIPPED = '.skipped';
const FOLDER = 'committee';
const MANIFEST = 'committee.json';

export function replyMediaDir(home: string, post: number): string {
  return join(home, 'inbox', 'media', `post-${post}`);
}

// Moves the post's files into the issue's media folder and records each one. Returns what the route brought, in order.
export function adoptReplyMedia(home: string, post: number, issueDir: string, by: string): MediaEntry[] {
  const from = replyMediaDir(home, post);
  if (!existsSync(from)) return [];
  const source = `committee reply in Telegram by ${by}`;
  mkdirSync(join(issueDir, FOLDER), { recursive: true });
  const names = readdirSync(from).filter((name) => !name.endsWith('.tmp')).sort(byMessage);
  const entries = names.map((name) => adopt(join(from, name), `post-${post}-${name}`, issueDir, source));
  writeFileSync(join(issueDir, MANIFEST), JSON.stringify([...readCommitteeMedia(issueDir), ...entries], null, 2));
  rmSync(from, { recursive: true, force: true });
  return entries;
}

// Files are named `<message>-<n>`, so the message ids sort as numbers.
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

// The committee images of every earlier route of the issue, which later stages read too. A file that is gone shows as not available.
export function readCommitteeMedia(issueDir: string): MediaEntry[] {
  const path = join(issueDir, MANIFEST);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as MediaEntry[]).map((entry) => entry.status === 'ok' && !existsSync(join(issueDir, entry.file ?? ''))
    ? { url: entry.url, source: entry.source, status: 'failed', reason: 'its file is gone from the media folder' }
    : entry);
}

// Files of posts that closed without a patch or a redesign. They are private, so they do not wait around.
export function dropReplyMedia(home: string, posts: number[]): void {
  for (const post of posts) rmSync(replyMediaDir(home, post), { recursive: true, force: true });
}

// One line per image for the feedback comment on the issue. It names the file's type, size and hash, never its pixels or its chat path.
export function replyMediaLines(entries: MediaEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => entry.status === 'ok'
    ? `- ${entry.type}, ${entry.width}x${entry.height}, ${entry.bytes} bytes, sha256 ${entry.sha256}`
    : `- not available: ${entry.reason}`);
  return `\n\nThe reply came with ${entries.length} file(s) in Telegram. They stay private: the agent sees them in its media folder, and they are not posted here.\n${lines.join('\n')}`;
}
