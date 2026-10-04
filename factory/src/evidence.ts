import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { readPhoto } from './photo-file';
import { OUT_DIR } from './types';

// Telegram takes at most 10 photos in one media group. The primary screenshot counts in them.
export const EVIDENCE_MAX = 10;
export const PRIMARY_FILE = 'screenshot.png';
export const MANIFEST_FILE = 'evidence.json';
const LOCATION_VIEWS = 3;
// One-time waivers of the three-view minimum for a location, by issue number. The committee granted each in an issue comment.
// A waiver lowers only that count, to its `minViews`. Provenance, distinctness, coverage, the final commit and every other rule still apply, and so do the checks and the approval.
export const LOCATION_VIEW_WAIVERS: Readonly<Record<number, { minViews: number; granted: string }>> = {
  80: { minViews: 2, granted: '2026-10-04T14:20:36Z' },
};
const DESCRIPTION_LIMIT = 200;
const KINDS = ['location', 'item', 'system', 'other'] as const;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

type Kind = (typeof KINDS)[number];
type Feature = { name: string; kind: Kind };
// `covers` names the features the image shows. `sheet` marks a labeled contact sheet built from real screenshots.
export type EvidenceImage = { path: string; description: string; covers: string[]; sheet: boolean };
// The ordered images of one task. The first is the primary, `.factory/screenshot.png`.
// `features` names what the manifest says changed. It is empty when there is no manifest.
// `waived` names the locations that passed under a location-view waiver, with the views each has. It is empty for every other card.
export type Evidence = { images: EvidenceImage[]; features: string[]; waived: string[] };

// The agent's manifest `.factory/evidence.json`:
// {"commit": "<git rev-parse HEAD>", "features": [{"name": "Salvage yard", "kind": "location"}],
//  "images": [{"file": "screenshot.png", "description": "Gate and approach", "covers": ["Salvage yard"], "sheet": false}]}
// With no manifest the single screenshot stands, as before. A manifest that fails any rule throws, so no post goes out with doubtful evidence.
export function readEvidence(home: string, head: string | null, issue: number | null = null): Evidence {
  const out = join(home, OUT_DIR);
  const manifest = join(out, MANIFEST_FILE);
  if (!existsSync(manifest)) return { images: [{ path: join(out, PRIMARY_FILE), description: '', covers: [], sheet: false }], features: [], waived: [] };
  const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
  if (head !== null) requireHead(data.commit, head);
  const features = parseFeatures(data.features);
  const images = parseImages(data.images, features, out);
  const waived = requireCoverage(features, images, issue === null ? undefined : LOCATION_VIEW_WAIVERS[issue]?.minViews);
  return { images, features: features.map((feature) => feature.name), waived };
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

// Every changed feature needs a view. A location needs several views, and a system-wide change needs a labeled sheet.
// Returns the locations that have fewer views than the rule asks for but enough for the waiver.
function requireCoverage(features: Feature[], images: EvidenceImage[], waivedMin?: number): string[] {
  const waived: string[] = [];
  for (const feature of features) {
    const views = images.filter((image) => image.covers.includes(feature.name));
    requireViews(feature, views, waivedMin);
    if (feature.kind === 'location' && views.length < LOCATION_VIEWS) waived.push(`${feature.name} (${views.length} views)`);
  }
  return waived;
}

function requireViews(feature: Feature, views: EvidenceImage[], waivedMin?: number): void {
  if (views.length === 0) throw new Error(`No evidence image covers "${feature.name}"`);
  const needed = waivedMin === undefined ? LOCATION_VIEWS : Math.min(LOCATION_VIEWS, waivedMin);
  if (feature.kind === 'location' && views.length < needed) throw new Error(`The location "${feature.name}" needs ${needed} different views (layout and landmarks, approach, traversal), it has ${views.length}`);
  if (feature.kind === 'system' && !views.some((image) => image.sheet)) throw new Error(`The system change "${feature.name}" needs one labeled contact sheet ("sheet": true) built from real screenshots`);
}
