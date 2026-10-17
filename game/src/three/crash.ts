

import { GAME_VERSION } from '../config';
import { DownloadFailed } from '../download';
import { noWebGLText, WebGLUnavailable } from './webgl';

import { setText } from '../text/language';
import { t, type Msg } from '../text/msg';

let shown = false;
let report: ((text: string) => void) | null = null;
const reported = new Set<string>();
const warned = new Set<string>();
let step = 'starting the page';
const listeners: (() => void)[] = [];
const FOREIGN_NOTE = 'Ignored an error from a script outside the game';
const MUTED_MESSAGE = /^script error\.?$/i;

export interface ErrorFacts {
  error: unknown;
  message: string;
  filename: string;
  lineno: number;
  colno: number;
}

export function isForeignError(event: ErrorFacts, pageOrigin: string): boolean {
  if (event.error != null || !MUTED_MESSAGE.test(event.message)) return false;
  if (event.filename === '') return true;
  try {
    return new URL(event.filename).origin !== pageOrigin;
  } catch {
    return false;
  }
}

export interface CrashContext {
  version: string;
  step: string;
  userAgent: string;
  page: string;
}

export function bootStep(name: string): void {
  step = name;
}

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
const sinks: ((err: unknown) => void)[] = [];

export function installCrashScreen(): void {
  window.addEventListener('error', (e) =>
    onWindowError({ error: e.error, message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }),
  );
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

export function noteError(err: unknown): void {
  console.warn(err);
  for (const sink of sinks) sink(err);
}

export function reportError(err: unknown): void {
  onError(err);
}

function onWindowError(facts: ErrorFacts): void {
  if (isForeignError(facts, location.origin)) return ignoreForeign(facts);
  onError(facts.error ?? facts.message, facts);
}

function ignoreForeign(facts: ErrorFacts): void {
  const key = `${facts.message} ${facts.filename}`;
  if (!warned.has(key)) console.warn(FOREIGN_NOTE, facts.message, facts.filename);
  warned.add(key);
  if (!report || reported.has(FOREIGN_NOTE)) return;
  reported.add(FOREIGN_NOTE);
  report(FOREIGN_NOTE);
}

export function screenFor(err: unknown): 'webgl' | 'download' | 'crash' {
  if (err instanceof WebGLUnavailable) return 'webgl';
  if (err instanceof DownloadFailed) return 'download';
  return 'crash';
}

export function downloadFailedText(err: DownloadFailed): { title: Msg; lines: Msg[]; detail: string; action: Msg } {
  const cause = err.cause instanceof Error ? err.cause.message : String(err.cause);
  return { title: t('download.title'), lines: [t('download.reload'), t('download.saves')], detail: `${err.url}\n${cause}`, action: t('download.action') };
}

function onError(err: unknown, facts: ErrorFacts | null = null): void {
  const screen = screenFor(err);
  if (screen === 'webgl') showNotice(noWebGLText(err as WebGLUnavailable, navigator.userAgent));
  else if (screen === 'download') {
    console.warn(err);
    showNotice(downloadFailedText(err as DownloadFailed));
  } else onFault(err, facts);
}

function onFault(err: unknown, facts: ErrorFacts | null): void {
  for (const sink of sinks) sink(err);
  for (const listener of listeners) listener();
  if (!report) return showCrash(err, facts);
  const text = err instanceof Error ? err.message : String(err);
  if (reported.has(text)) return;
  reported.add(text);
  report(`Error: ${text}`);
}

function showCrash(err: unknown, facts: ErrorFacts | null): void {
  if (shown) return;
  shown = true;
  const text = crashText(err, facts, { version: GAME_VERSION, step, userAgent: navigator.userAgent, page: location.href });
  const box = document.createElement('div');
  box.className = 'crash-screen';
  const title = document.createElement('div');
  title.className = 'crash-title';
  setText(title, t('crash.title'));
  const body = document.createElement('div');
  body.textContent = text;
  const hint = document.createElement('div');
  hint.className = 'crash-hint';
  setText(hint, t('crash.hint'));
  box.append(title, body, hint);
  document.body.appendChild(box);
}

function showNotice(text: { title: Msg; lines: Msg[]; detail: string | null; action?: Msg }): void {
  if (shown) return;
  shown = true;
  const box = document.createElement('div');
  box.className = 'crash-screen';
  const title = document.createElement('div');
  title.className = 'crash-title';
  setText(title, text.title);
  box.append(title);
  for (const line of text.lines) {
    const row = document.createElement('div');
    setText(row, line);
    box.append(row);
  }
  let reload: HTMLButtonElement | null = null;
  if (text.action) {
    reload = document.createElement('button');
    reload.className = 'crash-reload';
    setText(reload, text.action);
    reload.addEventListener('click', () => location.reload());
    box.append(reload);
  }
  if (text.detail) {
    const detail = document.createElement('div');
    detail.className = 'crash-hint';
    detail.textContent = text.detail;
    box.append(detail);
  }
  document.body.appendChild(box);
  reload?.focus();
}
