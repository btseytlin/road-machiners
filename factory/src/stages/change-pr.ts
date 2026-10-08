import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GUIDE_PATH = fileURLToPath(new URL('../../prompts/change-pr.md', import.meta.url));
const MAX_TITLE = 100;
const MAX_BODY = 4000;
const MAX_WHY = 200;
const MAX_FILES = 10;
const REQUIRED = ['Why / user impact', 'What changed', 'How verified'];
const NOTE = 'The factory never merges this pull request. A human reviews and merges it.';

export function prGuide(): string {
  return readFileSync(GUIDE_PATH, 'utf8');
}

const SECRETS = [/\b(?:sk|ghp|gho|ghs|github_pat|xox[a-z]|AKIA)[-_A-Za-z0-9]{12,}/g, /\b\d{6,}:[A-Za-z0-9_-]{30,}/g, /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/g];

export function redact(text: string): string {
  return SECRETS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text);
}

export function prTitle(raw: string | null, id: number): string {
  const line = redact(raw?.trim().split('\n')[0]?.trim() ?? '');
  return line ? line.slice(0, MAX_TITLE) : `Factory change ${id}`;
}

function hasSections(body: string): boolean {
  const headings = [...body.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((match) => match[1].toLowerCase());
  return REQUIRED.every((name) => headings.includes(name.toLowerCase()));
}

function firstLine(text: string, max: number): string {
  const line = redact(text.trim().split('\n')[0] ?? '').replace(/https?:\/\/\S+/g, '[link]');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function fallbackBody(request: string, paths: string[]): string {
  const shown = paths.slice(0, MAX_FILES).map((path) => `- \`${path}\``);
  if (paths.length > MAX_FILES) shown.push(`- and ${paths.length - MAX_FILES} more files`);
  return [
    '## Why / user impact',
    `- ${firstLine(request, MAX_WHY) || 'No summary available.'}`,
    '## What changed',
    shown.join('\n') || '- No file list available.',
    '## How verified',
    '- Not reported by the change agent. Run `npx vitest run factory` before merging.',
  ].join('\n\n');
}

export function prBody(agentBody: string | null, by: string, request: string, paths: string[]): string {
  const clean = agentBody ? redact(agentBody.trim()).slice(0, MAX_BODY) : '';
  const summary = clean && hasSections(clean) ? clean : fallbackBody(request, paths);
  return `${summary}\n\n## Requested by\n\n${redact(by)}, through the committee. The full request stays in the factory log.\n\n${NOTE}\n`;
}
