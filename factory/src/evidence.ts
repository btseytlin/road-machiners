import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readPhoto } from './photo-file';
import { OUT_DIR } from './types';

// Telegram takes at most 10 photos in one media group. The primary screenshot counts in them.
export const EVIDENCE_MAX = 10;
export const PRIMARY_FILE = 'screenshot.png';
export const MANIFEST_FILE = 'evidence.json';
const DESCRIPTION_LIMIT = 200;
const KINDS = ['location', 'item', 'system', 'other'] as const;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

type Kind = (typeof KINDS)[number];
type Feature = { name: string; kind: Kind };
// `covers` names the features the image shows. `sheet` marks a labeled contact sheet built from real screenshots.
export type EvidenceImage = { path: string; description: string; covers: string[]; sheet: boolean };
// The ordered images of one task. The first is the primary, `.factory/screenshot.png`.
// `features` names what the manifest says changed. It is empty when there is no manifest.
export type Evidence = { images: EvidenceImage[]; features: string[] };

// The agent's manifest `.factory/evidence.json`:
// {"commit": "<git rev-parse HEAD>", "features": [{"name": "Salvage yard", "kind": "location"}],
//  "images": [{"file": "screenshot.png", "description": "Gate and approach", "covers": ["Salvage yard"], "sheet": false}]}
// With no manifest the single screenshot stands, as before. A manifest that fails any rule throws.
export function readEvidence(home: string, head: string | null): Evidence {
  const out = join(home, OUT_DIR);
  const manifest = join(out, MANIFEST_FILE);
  if (!existsSync(manifest)) return { images: [{ path: join(out, PRIMARY_FILE), description: '', covers: [], sheet: false }], features: [] };
  const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  if (head !== null) requireHead(data.commit, head);
  const features = parseFeatures(data.features);
  const images = parseImages(data.images, features, out);
  requireCoverage(features, images);
  return { images, features: features.map((feature) => feature.name) };
}

// What an approval post shows. `problem` says what was missing or dropped, and the post and the issue say it too.
export type Shown = { evidence: Evidence | null; problem: string | null };

// Evidence never blocks a card. With no screenshot the post is text. A manifest that breaks a rule is dropped, and the one screenshot stands.
export function readShown(home: string, head: string | null): Shown {
  const primary = join(home, OUT_DIR, PRIMARY_FILE);
  if (!existsSync(primary)) return { evidence: null, problem: `The testing agent wrote no .factory/${PRIMARY_FILE}.` };
  try {
    return { evidence: readEvidence(home, head), problem: null };
  } catch (error) {
    const evidence = { images: [{ path: primary, description: '', covers: [], sheet: false }], features: [] };
    return { evidence, problem: `The evidence manifest was dropped: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// The evidence must come from the final branch. An agent that changed code after it captured has to capture again.
function requireHead(commit: unknown, head: string): void {
  const same = typeof commit === 'string' && commit.length >= 7 && (head.startsWith(commit) || commit.startsWith(head));
  if (!same) throw new Error(`.factory/evidence.json is from commit ${String(commit)}, the final branch is at ${head}. Capture the views again on the final build.`);
}

function parseFeatures(raw: unknown): Feature[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('.factory/evidence.json needs a non-empty list "features" of what changed');
  const features = raw.map((item): Feature => {
    const { name, kind } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '' || !KINDS.includes(kind as Kind)) throw new Error(`Each evidence feature needs a name and a kind of ${KINDS.join(', ')}`);
    return { name, kind: kind as Kind };
  });
  if (new Set(features.map((feature) => feature.name)).size !== features.length) throw new Error('Evidence feature names must be unique');
  return features;
}

function parseImages(raw: unknown, features: Feature[], out: string): EvidenceImage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('.factory/evidence.json needs a non-empty list "images"');
  if (raw.length > EVIDENCE_MAX) throw new Error(`.factory/evidence.json lists ${raw.length} images, the limit is ${EVIDENCE_MAX} including the primary. Pick or composite.`);
  const names = new Set(features.map((feature) => feature.name));
  const images = raw.map((item, index) => parseImage(item, index, names, out));
  if (images[0]!.path !== join(out, PRIMARY_FILE)) throw new Error(`The first evidence image must be ${PRIMARY_FILE}`);
  requireDistinct(images);
  return images;
}

function parseImage(item: unknown, index: number, names: Set<string>, out: string): EvidenceImage {
  const { file, description, covers, sheet } = (item ?? {}) as Record<string, unknown>;
  const at = `Evidence image ${index + 1}`;
  if (typeof file !== 'string') throw new Error(`${at} needs a string "file"`);
  const text = requireDescription(description, at);
  const list = Array.isArray(covers) ? covers : [];
  if (list.length === 0 || list.some((name) => !names.has(name as string))) throw new Error(`${at} must cover one or more of the listed features, by exact name`);
  const path = safePath(out, file, at);
  readPhoto(path);
  return { path, description: text, covers: list as string[], sheet: sheet === true };
}

// A long description is cut with a mark, never refused, so a wordy caption cannot stop a card.
function requireDescription(description: unknown, at: string): string {
  if (typeof description !== 'string' || description.trim() === '') throw new Error(`${at} needs a description`);
  const text = description.trim();
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : text;
}

// The file lives inside .factory/ by a plain relative name. Links that point outside are refused.
function safePath(out: string, file: string, at: string): string {
  if (!SAFE_PATH.test(file)) throw new Error(`${at} has an unsafe file name "${file}". Use a relative path inside .factory/.`);
  const path = join(out, file);
  if (!existsSync(path)) throw new Error(`${at} file ${file} does not exist`);
  if (!realpathSync(path).startsWith(realpathSync(out) + sep)) throw new Error(`${at} file ${file} is outside .factory/`);
  return path;
}

function requireDistinct(images: EvidenceImage[]): void {
  const seen = new Set<string>();
  for (const image of images) {
    const hash = createHash('sha256').update(readFileSync(image.path)).digest('hex');
    if (seen.has(hash)) throw new Error(`Evidence image ${image.path} duplicates another image`);
    seen.add(hash);
  }
}

// Every changed feature needs a view. The count of views is the agent's judgment, so there is no minimum. A system-wide change needs a labeled sheet.
function requireCoverage(features: Feature[], images: EvidenceImage[]): void {
  for (const feature of features) requireViews(feature, images.filter((image) => image.covers.includes(feature.name)));
}

function requireViews(feature: Feature, views: EvidenceImage[]): void {
  if (views.length === 0) throw new Error(`No evidence image covers "${feature.name}"`);
  if (feature.kind === 'system' && !views.some((image) => image.sheet)) throw new Error(`The system change "${feature.name}" needs one labeled contact sheet ("sheet": true) built from real screenshots`);
}
