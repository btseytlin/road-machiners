// Sends each new error of a factory build to the factory's error endpoint, with the state that led to it.
// The factory maps the stack to source, finds or opens the GitHub issue for it and keeps the saves for the agents that fix it.
// factory/src/error-reports/report.ts holds the same report shape. Change both together.

import { CONFIG } from '../config';
import type { DriveSnapshot } from '../phys/drive';
import type { World } from '../sim/types';
import { saveOf } from './save';
import type { SaveSlots } from './save-db';
import { listSaves } from './save-slots';
import { TurnFailure } from './travel';

export type ErrorReport = {
  build: string; // release, dev or candidate
  version: string;
  error: { name: string; message: string; stack: string };
  userAgent: string;
  turn: number | null;
  log: string[]; // newest first
  world: object | null; // the save of the world in memory
  autosave: string | null; // the stored Autosave as written, null when there is none or it is the world in memory
  autosaveIsWorld: boolean;
  drive: (Omit<DriveSnapshot, 'snapshot'> & { snapshot: string }) | null; // a failed turn's start, the Rapier snapshot in base64
};

// What the running game shows the reporter. Boot errors come before it and report no world.
export type ReportSource = { world: () => World; log: () => string[]; slots: SaveSlots };

type Post = (url: string, init: RequestInit) => Promise<Response>;

export class ErrorReporter {
  private readonly sent = new Set<string>();
  private source: ReportSource | null = null;

  constructor(
    private readonly url: string,
    private readonly build: string,
    private readonly version: string,
    private readonly post: Post = (url, init) => fetch(url, init),
  ) {}

  watch(source: ReportSource): void {
    this.source = source;
  }

  // Sends `err` unless this session already sent the same error, so an error that repeats every frame sends once.
  // A failed send only warns, since a report must never change the game.
  report(err: unknown): Promise<void> {
    const error = describeError(err);
    const key = `${error.name}: ${error.message}`;
    if (this.sent.has(key)) return Promise.resolve();
    this.sent.add(key);
    return this.send(err, error).catch((failure: unknown) => console.warn('Error report not sent:', failure));
  }

  private async send(err: unknown, error: ErrorReport['error']): Promise<void> {
    const body = await gzip(JSON.stringify(this.compose(err, error)));
    const response = await this.post(this.url, { method: 'POST', headers: { 'content-type': 'application/gzip' }, body });
    if (!response.ok) throw new Error(`the error endpoint answered ${response.status}`);
  }

  private compose(err: unknown, error: ErrorReport['error']): ErrorReport {
    const head = { build: this.build, version: this.version, error, userAgent: navigator.userAgent, drive: driveOf(err) };
    if (!this.source) return { ...head, turn: null, log: [], world: null, autosave: null, autosaveIsWorld: false };
    const { slots } = this.source;
    const autosave = slots.has('auto') ? JSON.stringify(slots.get('auto')) : null;
    const world = this.source.world();
    const autosaveIsWorld = autosave !== null && this.autosaveTurn(slots) === world.turn;
    return { ...head, turn: world.turn, log: this.source.log(), world: saveOf(world), autosave: autosaveIsWorld ? null : autosave, autosaveIsWorld };
  }

  private autosaveTurn(slots: SaveSlots): number | null {
    const info = listSaves(slots, CONFIG.saveSlots).find((slot) => slot.slot === 'auto');
    return info ? info.turn : null;
  }
}

function driveOf(err: unknown): ErrorReport['drive'] {
  return err instanceof TurnFailure ? encodeDrive(err.drive) : null;
}

function describeError(err: unknown): ErrorReport['error'] {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? '' };
  return { name: 'NonError', message: String(err), stack: '' };
}

function encodeDrive(drive: DriveSnapshot): NonNullable<ErrorReport['drive']> {
  const { snapshot, ...handles } = drive;
  return { ...handles, snapshot: toBase64(snapshot) };
}

// String.fromCharCode takes its bytes as arguments, so a large snapshot goes in slices under the engines' argument limit.
const BASE64_SLICE = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += BASE64_SLICE) text += String.fromCharCode(...bytes.subarray(i, i + BASE64_SLICE));
  return btoa(text);
}

async function gzip(text: string): Promise<Blob> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
