// Any uncaught error stops the game behind a fullscreen message, so a crash is never silent.
// Outside dev, once boot is done, the game keeps running: an error goes to the browser log and the debug console.
// A failed command changes nothing, since commands mutate a clone of the world. Boot errors still crash.

import { setText } from '../text/language';
import { t } from '../text/msg';

let shown = false;
let report: ((text: string) => void) | null = null;
const reported = new Set<string>();
const listeners: (() => void)[] = [];

export function installCrashScreen(): void {
  window.addEventListener('error', (e) => onError(e.error ?? e.message));
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

function onError(err: unknown): void {
  for (const listener of listeners) listener();
  if (!report) return showCrash(err);
  const text = err instanceof Error ? err.message : String(err);
  // The browser logs every error itself. The debug console gets each message once, so a per-frame error does not flood it.
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
  setText(title, t('crash.title'));
  // The error itself stays as the code wrote it, for a bug report.
  const body = document.createElement('div');
  body.textContent = text;
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:24px;color:#c8a898;';
  setText(hint, t('crash.hint'));
  box.append(title, body, hint);
  document.body.appendChild(box);
}
