// Any uncaught error stops the game behind a fullscreen message, so a crash is never silent.
// Outside dev, once boot is done, the game keeps running: an error goes to the browser log and the debug console.
// A failed command changes nothing, since commands mutate a clone of the world. Boot errors still crash.
// A hidden error from a script outside the game, like a browser extension's, never crashes and never holds saves.
// The crash screen lists what a player can post in a public issue: the error, its source, the version, the boot step,
// the browser and the page address. It holds no save, world or storage content.

import { GAME_VERSION } from '../config';

let shown = false;
let report: ((text: string) => void) | null = null;
const reported = new Set<string>();
const warned = new Set<string>();
let step = 'starting the page';
const listeners: (() => void)[] = [];
const FOREIGN_NOTE = 'Ignored an error from a script outside the game';
const MUTED_MESSAGE = /^script error\.?$/i;

// The fields of a window error event the crash screen reads.
export interface ErrorFacts {
  error: unknown;
  message: string;
  filename: string;
  lineno: number;
  colno: number;
}

// A browser hides the message, file and stack of an error thrown by a classic script from another origin, and reports
// only "Script error." with no error object. The game's code is same-origin module scripts and module workers, which
// browsers fetch in CORS mode and never mute, so such an event is never the game's. Only that sign counts as foreign.
export function isForeignError(event: ErrorFacts, pageOrigin: string): boolean {
  if (event.error != null || !MUTED_MESSAGE.test(event.message)) return false;
  if (event.filename === '') return true;
  try {
    return new URL(event.filename).origin !== pageOrigin;
  } catch {
    return false;
  }
}

// What the crash screen says around the error.
export interface CrashContext {
  version: string;
  step: string;
  userAgent: string;
  page: string;
}

// Names the boot step under way, so a crash screen says where boot stopped. "running" once boot is done.
export function bootStep(name: string): void {
  step = name;
}

// The body of the crash screen: the message, the source and stack when known, then the details.
export function crashText(err: unknown, facts: ErrorFacts | null, context: CrashContext): string {
  const lines = [err instanceof Error ? err.message : String(err)];
  if (facts && facts.filename !== '') lines.push(`Source: ${facts.filename}:${facts.lineno}:${facts.colno}`);
  if (err instanceof Error && err.stack) lines.push('', err.stack);
  lines.push(
    '',
    `Version: ${context.version}`,
    `Boot step: ${context.step}`,
    `Browser: ${context.userAgent}`,
    `Page: ${context.page.split(/[?#]/)[0]}`,
  );
  return lines.join('\n');
}

export function installCrashScreen(): void {
  window.addEventListener('error', (e) =>
    onWindowError({ error: e.error, message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }),
  );
  window.addEventListener('unhandledrejection', (e) => onError(e.reason));
}

// Call once the game runs. Does nothing in dev, where every error crashes.
export function keepRunningOnErrors(to: (text: string) => void): void {
  if (!import.meta.env.DEV) report = to;
}

// Calls `listener` on every error after boot, repeats included, in dev too.
export function onEveryError(listener: () => void): void {
  listeners.push(listener);
}

// Routes a handled error like an uncaught one: the crash screen in dev, the debug console outside dev.
export function reportError(err: unknown): void {
  onError(err);
}

function onWindowError(facts: ErrorFacts): void {
  if (isForeignError(facts, location.origin)) return ignoreForeign(facts);
  onError(facts.error ?? facts.message, facts);
}

// The browser log and the debug console get each hidden foreign error once. No listener runs, so saves go on.
function ignoreForeign(facts: ErrorFacts): void {
  const text = `${FOREIGN_NOTE}: ${facts.message} ${facts.filename}`.trim();
  if (!warned.has(text)) console.warn(FOREIGN_NOTE, facts.message, facts.filename);
  warned.add(text);
  if (!report || reported.has(FOREIGN_NOTE)) return;
  reported.add(FOREIGN_NOTE);
  report(FOREIGN_NOTE);
}

function onError(err: unknown, facts: ErrorFacts | null = null): void {
  for (const listener of listeners) listener();
  if (!report) return showCrash(err, facts);
  const text = err instanceof Error ? err.message : String(err);
  // The browser logs every error itself. The debug console gets each message once, so a per-frame error does not flood it.
  if (reported.has(text)) return;
  reported.add(text);
  report(`Error: ${text}`);
}

function showCrash(err: unknown, facts: ErrorFacts | null): void {
  if (shown) return;
  shown = true;
  const text = crashText(err, facts, { version: GAME_VERSION, step, userAgent: navigator.userAgent, page: location.href });
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(40,8,6,0.96);color:#ffd8c8;padding:40px;overflow:auto;' +
    'font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:28px;color:#ff7058;margin-bottom:20px;';
  title.textContent = 'The game crashed';
  const body = document.createElement('div');
  body.textContent = text;
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:24px;color:#c8a898;';
  hint.textContent = 'Reload the page to start again.';
  box.append(title, body, hint);
  document.body.appendChild(box);
}
