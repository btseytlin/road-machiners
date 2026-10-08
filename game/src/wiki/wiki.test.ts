import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataRefs, fillPage, PAGES, resolveRef, WIKI_ROOTS, WIKI_TABLES } from './wiki';

const read = (name: string): string => readFileSync(join('docs/wiki', name), 'utf8');
const blockIds = (text: string): string[] => [...text.matchAll(/<!-- wiki:([\w-]+) -->/g)].map((m) => m[1]);

describe('wiki pages', () => {
  it.each(PAGES)('%s matches the code', (name) => {
    const text = read(name);
    const fresh = fillPage(name, text, WIKI_TABLES, WIKI_ROOTS);
    expect(fresh === text, `docs/wiki/${name} is stale. Run npm run wiki.`).toBe(true);
  });

  it.each(PAGES)('%s names data paths and files that exist', (name) => {
    const { data, files } = dataRefs(read(name));
    for (const path of data) expect(() => resolveRef(WIKI_ROOTS, path), `${name}: ${path}`).not.toThrow();
    for (const file of files) expect(existsSync(file), `${name}: ${file} does not exist`).toBe(true);
  });

  it('shows every table on exactly one page', () => {
    const used = PAGES.flatMap((name) => blockIds(read(name))).filter((id) => id !== 'numbers');
    expect([...used].sort()).toEqual(Object.keys(WIKI_TABLES).sort());
  });

  it('lists every page in docs/wiki', () => {
    const files = readdirSync('docs/wiki', { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.md'));
    expect(files.sort()).toEqual([...PAGES].sort());
  });
});

describe('wiki imports', () => {
  const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));

  it('is imported by nothing in the game', () => {
    const importers = ['src/sim', 'src/data', 'src/three', 'src/ui']
      .flatMap(sourceFiles)
      .filter((file) => /from ['"][^'"]*\/wiki\//.test(readFileSync(file, 'utf8')));
    expect(importers).toEqual([]);
  });
});
