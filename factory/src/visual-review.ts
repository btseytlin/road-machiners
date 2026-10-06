import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence } from './evidence';
import { readPhoto } from './photo-file';
import { OUT_DIR } from './types';

export const VISUAL_REVIEW_FILE = 'visual-review.json';
// Recapture-and-recheck rounds the testing agent may spend repairing look defects, and send-backs one card may get in all.
export const VISUAL_REPAIR_ROUNDS = 2;
export const VISUAL_SEND_BACKS = 2;
const MIN_NOTE = 20;
const VERDICTS = ['correct', 'wrong'] as const;
const SCOPES = ['tune', 'rebuild', 'plan'] as const;

type Verdict = (typeof VERDICTS)[number];
// `tune`: a value, placement, orientation, scale or color of existing code is off. `rebuild`: the shape, state or behavior needs new or replaced code.
// `plan`: the task's plan contradicts the issue or the game docs, so building it again would build the same thing.
export type Scope = (typeof SCOPES)[number];
export type Mismatch = { description: string; scope: Scope };
export type SendBack = { to: 'implementation' | 'design'; mismatches: Mismatch[] };
export type VisualReview = { visual: false; reason: string } | { visual: true; sendBack: SendBack | null };

// The agent's decision artifact `.factory/visual-review.json`. It is the testing agent's own reading of the final pixels:
// {"commit": "<git rev-parse HEAD>", "visual": true, "repairs": 1,
//  "images": [{"file": "screenshot.png", "sha256": "<of the file>", "observations": "what the image shows", "verdict": "correct"}],
//  "decisions": [{"feature": "Oil patch", "verdict": "correct", "notes": "why it fits the issue and the docs"}],
//  "mismatches": [{"description": "...", "scope": "tune"}]}
// A change with no visible part sets "visual": false and gives a "reason". The factory cannot judge a picture, so it checks that the decision names
// every shown image by its hash, covers every feature and agrees with itself, and that its routing follows the rules below.
export function readVisualReview(home: string, head: string, evidence: Evidence): VisualReview {
  const features = evidence.features;
  const path = join(home, OUT_DIR, VISUAL_REVIEW_FILE);
  if (!existsSync(path)) throw new Error(`The testing stage wrote no .factory/${VISUAL_REVIEW_FILE}. Inspect the captured images with the Read tool and write the decision, or set "visual": false with a reason for a change nobody can see.`);
  const data = parse(readFileSync(path, 'utf8'));
  requireHead(data.commit, head);
  if (data.visual === false) return nonvisual(data, features);
  if (data.visual !== true) throw new Error(`.factory/${VISUAL_REVIEW_FILE} needs "visual": true or false`);
  const verdicts = [...imageVerdicts(data.images, evidence), ...decisionVerdicts(data.decisions, features)];
  return { visual: true, sendBack: sendBackOf(verdicts, parseMismatches(data.mismatches), repairRounds(data.repairs)) };
}

function repairRounds(raw: unknown): number {
  const repairs = typeof raw === 'number' ? raw : 0;
  if (!Number.isInteger(repairs) || repairs < 0 || repairs > VISUAL_REPAIR_ROUNDS) throw new Error(`.factory/${VISUAL_REVIEW_FILE} reports ${String(raw)} repair rounds, the limit is ${VISUAL_REPAIR_ROUNDS}`);
  return repairs;
}

function sendBackOf(verdicts: Verdict[], mismatches: Mismatch[], repairs: number): SendBack | null {
  const wrong = verdicts.includes('wrong');
  if (!wrong && mismatches.length === 0) return null;
  if (mismatches.length === 0) throw new Error(`.factory/${VISUAL_REVIEW_FILE} marks something wrong but lists no mismatch`);
  return route(mismatches, repairs);
}

function parse(text: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(text);
    if (data !== null && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // The error below names the file.
  }
  throw new Error(`.factory/${VISUAL_REVIEW_FILE} is not a JSON object`);
}

function requireHead(commit: unknown, head: string): void {
  const same = typeof commit === 'string' && commit.length >= 7 && (head.startsWith(commit) || commit.startsWith(head));
  if (!same) throw new Error(`.factory/${VISUAL_REVIEW_FILE} is from commit ${String(commit)}, the final branch is at ${head}. Capture and inspect the views again on the final build.`);
}

// A change with a manifest of visible features is visual by its own account. The exemption is for a change with none.
function nonvisual(data: Record<string, unknown>, features: string[]): VisualReview {
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
  if (reason.length < MIN_NOTE) throw new Error(`.factory/${VISUAL_REVIEW_FILE} sets "visual": false without a "reason" of at least ${MIN_NOTE} characters that says why nobody can see this change`);
  if (features.length > 0) throw new Error(`.factory/${VISUAL_REVIEW_FILE} sets "visual": false, but .factory/evidence.json lists visible features (${features.join(', ')})`);
  return { visual: false, reason };
}

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

// Every shown image has an entry that names its file by hash. A recapture after a fix changes the hash, so a stale reading fails here.
function imageVerdicts(raw: unknown, evidence: Evidence): Verdict[] {
  if (!Array.isArray(raw)) throw new Error(`.factory/${VISUAL_REVIEW_FILE} needs a list "images" with one reading per shown image`);
  const entries = new Map(raw.map((item) => [String((item as Record<string, unknown> | null)?.file), item as Record<string, unknown>]));
  return evidence.images.map((image) => {
    const name = image.path.split('/').pop() ?? image.path;
    const entry = entries.get(name);
    if (!entry) throw new Error(`.factory/${VISUAL_REVIEW_FILE} has no reading of the shown image ${name}`);
    try {
      readPhoto(image.path);
    } catch (error) {
      throw new Error(`The image ${name} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (entry.sha256 !== sha256(image.path)) throw new Error(`.factory/${VISUAL_REVIEW_FILE} read an older ${name}. Its sha256 differs from the file the post would show.`);
    return verdictOf(entry, `The reading of ${name}`, 'observations');
  });
}

// With no manifest the single screenshot stands for the whole change, so one decision is enough.
function decisionVerdicts(raw: unknown, features: string[]): Verdict[] {
  if (!Array.isArray(raw)) throw new Error(`.factory/${VISUAL_REVIEW_FILE} needs a list "decisions"`);
  const entries = raw.map((item) => (item ?? {}) as Record<string, unknown>);
  const wanted = features.length > 0 ? features : [null];
  return wanted.map((name) => {
    const entry = name === null ? entries[0] : entries.find((item) => item.feature === name);
    if (!entry) throw new Error(`.factory/${VISUAL_REVIEW_FILE} has no decision for ${name === null ? 'the change' : `the feature "${name}"`}`);
    return verdictOf(entry, `The decision on ${name ?? 'the change'}`, 'notes');
  });
}

function verdictOf(entry: Record<string, unknown>, at: string, noteKey: string): Verdict {
  const note = entry[noteKey];
  if (typeof note !== 'string' || note.trim().length < MIN_NOTE) throw new Error(`${at} needs "${noteKey}" of at least ${MIN_NOTE} characters, written from the pixels`);
  if (!VERDICTS.includes(entry.verdict as Verdict)) throw new Error(`${at} needs a verdict of ${VERDICTS.join(' or ')}`);
  return entry.verdict as Verdict;
}

function parseMismatches(raw: unknown): Mismatch[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`.factory/${VISUAL_REVIEW_FILE} "mismatches" must be a list`);
  return raw.map((item) => {
    const { description, scope } = (item ?? {}) as Record<string, unknown>;
    if (typeof description !== 'string' || description.trim() === '' || !SCOPES.includes(scope as Scope)) throw new Error(`Each mismatch needs a description and a scope of ${SCOPES.join(', ')}`);
    return { description: description.trim(), scope: scope as Scope };
  });
}

// The routing is a rule, not the agent's mood. Any `plan` mismatch goes to Design, any `rebuild` to Implementation.
// A look defect that only needs tuning is the testing agent's own to fix, so it cannot be sent back until the repair rounds are spent on it.
function route(mismatches: Mismatch[], repairs: number): SendBack {
  const to = mismatches.some((m) => m.scope === 'plan') ? 'design' : mismatches.some((m) => m.scope === 'rebuild' || repairs >= VISUAL_REPAIR_ROUNDS) ? 'implementation' : null;
  if (to === null) throw new Error(`.factory/${VISUAL_REVIEW_FILE} lists only tune-sized mismatches and ${repairs} of ${VISUAL_REPAIR_ROUNDS} repair rounds are used. Fix them, capture again on the final commit and inspect again.`);
  return { to, mismatches };
}
