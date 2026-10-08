import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EVIDENCE_MAX, readShown } from './evidence';
import { pngBytes } from './photo-fixtures';

let home = '';
let out = '';

beforeEach(() => {
  mkdirSync('tmp', { recursive: true });
  home = mkdtempSync('tmp/evidence-');
  out = join(home, '.factory');
  mkdirSync(out);
});

function shots(count: number): void {
  for (let i = 0; i < count; i++) writeFileSync(join(out, i === 0 ? 'screenshot.png' : `view${i}.png`), pngBytes(i));
}

const image = (i: number) => ({ file: i === 0 ? 'screenshot.png' : `view${i}.png`, description: `View ${i}` });
const write = (manifest: object) => writeFileSync(join(out, 'evidence.json'), JSON.stringify(manifest));
const paths = () => readShown(home).evidence?.images.map((i) => i.path.split('/').pop());

describe('readShown', () => {
  it('is a text post with a problem when there is no screenshot', () => {
    expect(readShown(home)).toEqual({ evidence: null, problem: expect.stringContaining('screenshot.png') });
  });

  it('shows the single screenshot with no manifest', () => {
    shots(1);
    expect(readShown(home)).toEqual({ evidence: { images: [{ path: join(out, 'screenshot.png'), description: '' }] }, problem: null });
  });

  it('keeps the manifest order after the screenshot, with its descriptions', () => {
    shots(3);
    write({ images: [image(0), image(2), image(1)] });
    expect(readShown(home).evidence?.images.map((i) => i.description)).toEqual(['View 0', 'View 2', 'View 1']);
  });

  it('leaves out only the broken image and names it', () => {
    shots(2);
    writeFileSync(join(out, 'broken.png'), 'not a png');
    write({ images: [image(1), { file: 'broken.png', description: 'x' }, { file: 'missing.png', description: 'y' }] });
    const shown = readShown(home);
    expect(paths()).toEqual(['screenshot.png', 'view1.png']);
    expect(shown.problem).toContain('broken.png is left out');
    expect(shown.problem).toContain('missing.png is left out');
  });

  it('refuses a file outside .factory and an unsafe name', () => {
    shots(1);
    writeFileSync(join(home, 'outside.png'), pngBytes(9));
    symlinkSync(join('..', 'outside.png'), join(out, 'link.png'));
    write({ images: [{ file: 'link.png', description: 'x' }, { file: '../outside.png', description: 'y' }] });
    expect(paths()).toEqual(['screenshot.png']);
    expect(readShown(home).problem).toContain('points outside');
  });

  it('drops duplicates silently', () => {
    shots(2);
    writeFileSync(join(out, 'copy.png'), pngBytes(1));
    write({ images: [image(1), { file: 'copy.png', description: 'same' }] });
    expect(paths()).toEqual(['screenshot.png', 'view1.png']);
    expect(readShown(home).problem).toBeNull();
  });

  it('shows at most the Telegram album limit and says so', () => {
    shots(EVIDENCE_MAX + 2);
    write({ images: Array.from({ length: EVIDENCE_MAX + 1 }, (_, i) => image(i + 1)) });
    expect(paths()).toHaveLength(EVIDENCE_MAX);
    expect(readShown(home).problem).toContain(`first ${EVIDENCE_MAX}`);
  });

  it('keeps the screenshot when the manifest is not JSON', () => {
    shots(1);
    writeFileSync(join(out, 'evidence.json'), '{');
    expect(paths()).toEqual(['screenshot.png']);
    expect(readShown(home).problem).toContain('was not read');
  });

  it('cuts a long description', () => {
    shots(2);
    write({ images: [{ file: 'view1.png', description: 'x'.repeat(300) }] });
    expect(readShown(home).evidence?.images[1]?.description).toHaveLength(200);
  });
});
