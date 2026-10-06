import { describe, expect, it } from 'vitest';
import { prBody, prGuide, prTitle, redact } from './change-pr';

const GOOD = '## Why / user impact\n- Faster\n\n## What changed\n- Stage\n\n## How verified\n- `npx vitest run factory`: 5 passed\n';
const LONG = `Do this ${'very long operational prompt '.repeat(100)}`;

describe('prBody', () => {
  it('uses the agent summary and adds attribution without the raw request', () => {
    const body = prBody(GOOD, 'Dr. Boris', LONG, []);
    expect(body).toContain('5 passed');
    expect(body).toContain('## Requested by');
    expect(body).toContain('Dr. Boris');
    expect(body).not.toContain('operational prompt');
  });

  it('falls back to a short body when the agent wrote nothing', () => {
    const body = prBody(null, 'ann', LONG, ['factory/a.ts']);
    for (const heading of ['## Why / user impact', '## What changed', '## How verified', '## Requested by']) expect(body).toContain(heading);
    expect(body).toContain('`factory/a.ts`');
    expect(body).toContain('Not reported');
    expect(body.length).toBeLessThan(800);
  });

  it('falls back when required sections are missing', () => {
    expect(prBody('just words', 'ann', 'tweak', [])).toContain('## How verified');
    expect(prBody('just words', 'ann', 'tweak', [])).not.toContain('just words');
  });

  it('keeps links and secrets out of the fallback and the agent body', () => {
    const fallback = prBody(null, 'ann', 'see https://example.com/x?t=1 key ghp_abcdefghijklmnop1234', []);
    expect(fallback).not.toContain('example.com');
    expect(fallback).not.toContain('ghp_');
    expect(prBody(`${GOOD}\nTOKEN=abc123`, 'ann', 'x', [])).not.toContain('abc123');
  });

  it('lists at most ten files', () => {
    const paths = Array.from({ length: 14 }, (_, i) => `factory/f${i}.ts`);
    expect(prBody(null, 'ann', 'x', paths)).toContain('and 4 more files');
  });
});

describe('prTitle', () => {
  it('uses the first line, capped', () => {
    expect(prTitle('Short\nmore', 3)).toBe('Short');
    expect(prTitle('x'.repeat(300), 3)).toHaveLength(100);
  });
  it('falls back to the id', () => {
    expect(prTitle(null, 3)).toBe('Factory change 3');
    expect(prTitle('  \n', 3)).toBe('Factory change 3');
  });
});

describe('guide', () => {
  it('names every required section and has no unfilled placeholders', () => {
    const guide = prGuide();
    for (const name of ['Why / user impact', 'What changed', 'How verified', 'Risks / rollback']) expect(guide).toContain(`## ${name}`);
    expect(redact('plain')).toBe('plain');
  });
});
