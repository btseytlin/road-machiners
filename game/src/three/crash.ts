// Any uncaught error stops the game behind a fullscreen message, so a crash is never silent.
// Outside dev, once boot is done, the game keeps running: an error goes to the browser log and the debug console.
// A failed command changes nothing, since commands mutate a clone of the world. Boot errors still crash.
// A browser without WebGL gets a notice instead of the crash screen, and it is not reported.

import { noWebGLText, WebGLUnavailable } from './webgl';

let shown = false;
let report: ((text: string) => void) | null = null;
const reported = new Set<string>();
const listeners: (() => void)[] = [];
const sinks: ((err: unknown) => void)[] = [];

export function installCrashScreen(): void {
  window.addEventListener('error', (e) => onError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => onError(e.reason));
}

export function keepRunningOnErrors(to: (text: string) => void): void {
  if (!import.meta.env.DEV) report = to;
}

export function onEveryError(listener: () => void): void {
  listeners.push(listener);
}

export function onReport(sink: (err: unknown) => void): void {
  sinks.push(sink);
}

export function reportError(err: unknown): void {
  onError(err);
}

function onError(err: unknown): void {
  if (err instanceof WebGLUnavailable) showNoWebGL(err);
  else onFault(err);
}

function onFault(err: unknown): void {
  for (const sink of sinks) sink(err);
  for (const listener of listeners) listener();
  if (!report) return showCrash(err);
  const text = err instanceof Error ? err.message : String(err);
  if (reported.has(text)) return;
  reported.add(text);
  report(`Error: ${text}`);
}

function showCrash(err: unknown): void {
  if (shown) return;
  shown = true;
  const text = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
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

function showNoWebGL(err: WebGLUnavailable): void {
  if (shown) return;
  shown = true;
  const text = noWebGLText(err, navigator.userAgent);
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:#261c14;color:#e8d8c0;padding:40px;overflow:auto;' +
    'font:16px/1.6 system-ui,sans-serif;';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:28px;color:#f0b860;margin-bottom:20px;';
  title.textContent = text.title;
  box.append(title);
  for (const line of text.lines) {
    const row = document.createElement('div');
    row.textContent = line;
    box.append(row);
  }
  if (text.detail) {
    const detail = document.createElement('div');
    detail.style.cssText = 'margin-top:24px;color:#a89880;font:12px ui-monospace,Menlo,monospace;';
    detail.textContent = text.detail;
    box.append(detail);
  }
  document.body.appendChild(box);
}
