import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

import type { ReportBuild } from '../sourcemaps';

// An error report from a game build, as game/src/three/error-report.ts sends it. Change both together.
// Everything in it comes from a stranger, so each field is checked before use.
export type ErrorReport = {
  build: ReportBuild;
  version: string;
  error: { name: string; message: string; stack: string };
  userAgent: string;
  turn: number | null;
  log: string[];
  world: object | null;
  autosave: string | null;
  autosaveIsWorld: boolean;
  drive: object | null;
};

export type RejectReason = 'origin' | 'address' | 'rate' | 'size' | 'shape' | 'commit' | 'stack' | 'disk';

// A report the service refuses. The status is the HTTP answer, and the reason counts in the store.
export class Rejected extends Error {
  constructor(readonly reason: RejectReason, readonly status: number, message: string) {
    super(message);
  }
}

const BUILDS: readonly string[] = ['release', 'dev', 'candidate'];
// SAVE_MAJOR.minor.commits+hash, from game/src/version.ts.
const VERSION = /^\d+\.\d+\.\d+\+([0-9a-f]{7,40})$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const orNull = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);

const FIELDS: Record<keyof ErrorReport, (value: unknown) => boolean> = {
  build: (value) => isString(value) && BUILDS.includes(value),
  version: (value) => isString(value) && VERSION.test(value),
  error: (value) => isObject(value) && isString(value.name) && isString(value.message) && isString(value.stack),
  userAgent: isString,
  turn: orNull((value) => Number.isInteger(value)),
  log: (value) => Array.isArray(value) && value.every(isString),
  world: orNull(isObject),
  autosave: orNull(isString),
  autosaveIsWorld: (value) => typeof value === 'boolean',
  drive: orNull(isObject),
};

export function parseReport(value: unknown): ErrorReport {
  if (!isObject(value)) throw new Rejected('shape', 400, 'The report is not a JSON object.');
  const bad = Object.entries(FIELDS).filter(([field, check]) => !check(value[field])).map(([field]) => field);
  if (bad.length > 0) throw new Rejected('shape', 400, `The report has bad fields: ${bad.join(', ')}.`);
  return value as ErrorReport;
}

// The short commit hash at the end of the version.
export function commitOf(report: ErrorReport): string {
  return (VERSION.exec(report.version) as RegExpExecArray)[1];
}

export type Frame = { source: string; line: number; column: number; name: string | null };
type RawFrame = { url: string; line: number; column: number };

// Chrome and Safari write "at fn (url:line:col)" or "at url:line:col". Firefox writes "fn@url:line:col".
const FRAME = /(?:\(|@|at )(\S+?):(\d+):(\d+)\)?$/;

function rawFrames(stack: string): RawFrame[] {
  return stack.split('\n').flatMap((line) => {
    const match = FRAME.exec(line.trim());
    return match ? [{ url: match[1], line: Number(match[2]), column: Number(match[3]) }] : [];
  });
}

// Maps each stack frame of a build file through that file's map in `mapDir`. A frame with no map, like a browser
// extension's, drops out. Columns in stacks count from 1, in maps from 0.
export function mapFrames(stack: string, mapDir: string): Frame[] {
  const maps = existsSync(mapDir) ? mapFiles(mapDir) : new Map<string, string>();
  const loaded = new Map<string, TraceMap>();
  return rawFrames(stack).flatMap((frame) => {
    const path = maps.get(`${basename(frame.url.split(/[?#]/)[0])}.map`);
    if (!path) return [];
    if (!loaded.has(path)) loaded.set(path, new TraceMap(readFileSync(path, 'utf8')));
    const found = originalPositionFor(loaded.get(path) as TraceMap, { line: frame.line, column: frame.column - 1 });
    if (found.source === null || found.line === null) return [];
    return [{ source: sourcePath(found.source), line: found.line, column: found.column + 1, name: found.name }];
  });
}

function mapFiles(dir: string): Map<string, string> {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.map'));
  return new Map(files.map((file) => [basename(file), join(dir, file)]));
}

// Vite writes sources relative to the map, like ../../src/sim/damage.ts. The game path reads better.
function sourcePath(source: string): string {
  return source.replace(/^(\.\.\/)+/, '');
}

// Three frames tell code paths apart, while callers further up may change without making a new error.
const FINGERPRINT_FRAMES = 3;

// The same error from any commit gets the same fingerprint. Line numbers move between commits, so the fingerprint
// takes the file and the name at the top game frames, and the message with its numbers blanked.
export function fingerprintOf(error: ErrorReport['error'], frames: readonly Frame[]): string {
  const game = frames.filter((frame) => !frame.source.includes('node_modules'));
  const top = (game.length > 0 ? game : frames).slice(0, FINGERPRINT_FRAMES).map((frame) => `${frame.source}:${frame.name ?? ''}`);
  const message = error.message.replace(/\d+(\.\d+)?/g, 'N');
  return createHash('sha256').update([error.name, message, ...top].join('\n')).digest('hex').slice(0, 16);
}
