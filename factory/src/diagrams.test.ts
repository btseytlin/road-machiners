import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'docs', 'diagrams');
const sources = readdirSync(DIR).filter((file) => file.endsWith('.dot'));

describe('process diagrams', () => {
  it('has diagrams to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)('%s has a rendered SVG of its current source', (name) => {
    const svg = join(DIR, name.replace(/\.dot$/, '.svg'));
    expect(existsSync(svg), `${svg} is missing, run npm run diagrams`).toBe(true);
    const hash = createHash('sha256').update(readFileSync(join(DIR, name), 'utf8')).digest('hex');
    expect(readFileSync(svg, 'utf8').split('\n')[1], `${name} changed since its render, run npm run diagrams`).toBe(`<!-- source-sha256: ${hash} -->`);
  });

  it('shows every diagram in process.md', () => {
    const doc = readFileSync(join(DIR, '..', 'process.md'), 'utf8');
    for (const name of sources) expect(doc).toContain(`diagrams/${name.replace(/\.dot$/, '.svg')}`);
  });
});
