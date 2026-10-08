import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readPhoto } from './photo-file';
import { OUT_DIR } from './types';

export const EVIDENCE_MAX = 10;
export const PRIMARY_FILE = 'screenshot.png';
export const MANIFEST_FILE = 'evidence.json';
const DESCRIPTION_LIMIT = 200;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

export type EvidenceImage = { path: string; description: string };
export type Evidence = { images: EvidenceImage[] };
export type Shown = { evidence: Evidence | null; problem: string | null };

type Listed = { file: string; description: string };

export function readShown(home: string): Shown {
  const out = join(home, OUT_DIR);
  const problems: string[] = [];
  if (!existsSync(join(out, PRIMARY_FILE))) return { evidence: null, problem: `The testing agent wrote no .factory/${PRIMARY_FILE}.` };
  const listed = manifest(out, problems);
  const primary = usable(out, PRIMARY_FILE, listed.find((item) => item.file === PRIMARY_FILE)?.description ?? '', problems);
  if (primary === null) return { evidence: null, problem: problems.join(' ') };
  const images = [primary, ...others(out, listed.filter((entry) => entry.file !== PRIMARY_FILE), hashOf(primary.path), problems)];
  return { evidence: { images }, problem: problems.length === 0 ? null : problems.join(' ') };
}

function others(out: string, listed: Listed[], primaryHash: string, problems: string[]): EvidenceImage[] {
  const images: EvidenceImage[] = [];
  const seen = new Set([primaryHash]);
  for (const item of listed) {
    const image = usable(out, item.file, item.description, problems);
    if (image === null || seen.has(hashOf(image.path))) continue;
    seen.add(hashOf(image.path));
    images.push(image);
  }
  if (images.length >= EVIDENCE_MAX) problems.push(`Only the first ${EVIDENCE_MAX} images are shown.`);
  return images.slice(0, EVIDENCE_MAX - 1);
}

function manifest(out: string, problems: string[]): Listed[] {
  const path = join(out, MANIFEST_FILE);
  if (!existsSync(path)) return [];
  try {
    const raw = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>).images;
    if (!Array.isArray(raw)) throw new Error('it has no list "images"');
    return raw.map((item) => item as Record<string, unknown>).filter((item) => typeof item.file === 'string').map((item) => ({ file: item.file as string, description: typeof item.description === 'string' ? item.description : '' }));
  } catch (error) {
    problems.push(`.factory/${MANIFEST_FILE} was not read: ${error instanceof Error ? error.message : String(error)}.`);
    return [];
  }
}

function usable(out: string, file: string, description: string, problems: string[]): EvidenceImage | null {
  try {
    const path = safePath(out, file);
    readPhoto(path);
    return { path, description: cutDescription(description) };
  } catch (error) {
    problems.push(`${file} is left out: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function cutDescription(description: string): string {
  const text = description.trim();
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : text;
}

function safePath(out: string, file: string): string {
  if (!SAFE_PATH.test(file)) throw new Error(`"${file}" is not a plain relative name inside .factory/`);
  const path = join(out, file);
  if (!existsSync(path)) throw new Error(`.factory/${file} does not exist`);
  if (!realpathSync(path).startsWith(realpathSync(out) + sep)) throw new Error(`.factory/${file} points outside .factory/`);
  return path;
}

function hashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
