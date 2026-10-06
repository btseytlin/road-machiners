import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEvidence } from './evidence';
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

const image = (i: number, covers: string[], extra: object = {}) => ({ file: i === 0 ? 'screenshot.png' : `view${i}.png`, description: `View ${i}`, covers, ...extra });
const write = (manifest: object) => writeFileSync(join(out, 'evidence.json'), JSON.stringify({ commit: 'abc1234', ...manifest }));
const read = () => readEvidence(home, 'abc1234def');

describe('readEvidence', () => {
  it('falls back to the single screenshot with no manifest', () => {
    expect(read().images.map((i) => i.path)).toEqual([join(out, 'screenshot.png')]);
  });

  it('accepts one screenshot that covers the whole change', () => {
    shots(1);
    write({ features: [{ name: 'Horn', kind: 'other' }], images: [image(0, ['Horn'])] });
    expect(read().images).toHaveLength(1);
  });

  it('keeps the manifest order, with the screenshot first', () => {
    shots(3);
    write({ features: [{ name: 'A', kind: 'item' }, { name: 'B', kind: 'item' }, { name: 'C', kind: 'item' }], images: [image(0, ['A']), image(1, ['B']), image(2, ['C'])] });
    expect(read().images.map((i) => i.description)).toEqual(['View 0', 'View 1', 'View 2']);
  });

  it('accepts a location with any number of real views, down to one', () => {
    shots(3);
    const features = [{ name: 'Yard', kind: 'location' }];
    write({ features, images: [image(0, ['Yard'])] });
    expect(read().images).toHaveLength(1);
    write({ features, images: [image(0, ['Yard']), image(1, ['Yard'])] });
    expect(read().images).toHaveLength(2);
    write({ features, images: [image(0, ['Yard']), image(1, ['Yard']), image(2, ['Yard'])] });
    expect(read().images).toHaveLength(3);
  });

  it('still rejects a location no image covers, and a location covered only under a wrong name', () => {
    shots(2);
    const features = [{ name: 'Yard', kind: 'location' }, { name: 'Horn', kind: 'item' }];
    write({ features, images: [image(0, ['Horn'])] });
    expect(read).toThrow('No evidence image covers "Yard"');
    write({ features, images: [image(0, ['Horn']), image(1, ['Yard Gate'])] });
    expect(read).toThrow('by exact name');
  });

  it('requires a labeled sheet for a system change', () => {
    shots(2);
    const features = [{ name: 'Grids', kind: 'system' }];
    write({ features, images: [image(0, ['Grids']), image(1, ['Grids'])] });
    expect(read).toThrow('contact sheet');
    write({ features, images: [image(0, ['Grids']), image(1, ['Grids'], { sheet: true })] });
    expect(read().images[1]!.sheet).toBe(true);
  });

  it('rejects a feature no image covers', () => {
    shots(2);
    write({ features: [{ name: 'A', kind: 'item' }, { name: 'B', kind: 'item' }], images: [image(0, ['A']), image(1, ['A'])] });
    expect(read).toThrow('No evidence image covers "B"');
  });

  it('rejects more than ten images', () => {
    shots(11);
    write({ features: [{ name: 'A', kind: 'other' }], images: Array.from({ length: 11 }, (_, i) => image(i, ['A'])) });
    expect(read).toThrow('limit is 10');
  });

  it('accepts exactly ten images', () => {
    shots(10);
    write({ features: [{ name: 'A', kind: 'other' }], images: Array.from({ length: 10 }, (_, i) => image(i, ['A'])) });
    expect(read().images).toHaveLength(10);
  });

  it('rejects a primary that is not screenshot.png', () => {
    shots(2);
    write({ features: [{ name: 'A', kind: 'other' }], images: [image(1, ['A']), image(0, ['A'])] });
    expect(read).toThrow('first evidence image must be screenshot.png');
  });

  it('rejects a missing file, an unsafe path, a link out of the folder and a non-image', () => {
    shots(2);
    const features = [{ name: 'A', kind: 'other' }];
    write({ features, images: [image(0, ['A']), { ...image(1, ['A']), file: 'gone.png' }] });
    expect(read).toThrow('does not exist');
    for (const file of ['../x.png', '/etc/passwd', 'a/../b.png']) {
      write({ features, images: [image(0, ['A']), { ...image(1, ['A']), file }] });
      expect(read).toThrow('unsafe file name');
    }
    writeFileSync(join(home, 'outside.png'), pngBytes(9));
    symlinkSync(join(process.cwd(), home, 'outside.png'), join(out, 'link.png'));
    write({ features, images: [image(0, ['A']), { ...image(1, ['A']), file: 'link.png' }] });
    expect(read).toThrow('outside .factory');
    writeFileSync(join(out, 'view1.png'), 'plain text');
    write({ features, images: [image(0, ['A']), image(1, ['A'])] });
    expect(read).toThrow('not a PNG');
  });

  it('rejects duplicate images', () => {
    shots(2);
    writeFileSync(join(out, 'view1.png'), pngBytes(0));
    write({ features: [{ name: 'A', kind: 'other' }], images: [image(0, ['A']), image(1, ['A'])] });
    expect(read).toThrow('duplicates');
  });

  it('rejects evidence from another commit', () => {
    shots(1);
    write({ commit: 'ffffff0', features: [{ name: 'A', kind: 'other' }], images: [image(0, ['A'])] });
    expect(read).toThrow('Capture the views again');
  });

  it('rejects an image with no description or an unknown feature', () => {
    shots(1);
    write({ features: [{ name: 'A', kind: 'other' }], images: [{ ...image(0, ['A']), description: ' ' }] });
    expect(read).toThrow('description');
    write({ features: [{ name: 'A', kind: 'other' }], images: [image(0, ['Z'])] });
    expect(read).toThrow('by exact name');
  });

  it('cuts a long description to 200 characters instead of refusing it', () => {
    shots(1);
    write({ features: [{ name: 'A', kind: 'other' }], images: [{ ...image(0, ['A']), description: 'x'.repeat(215) }] });
    const text = read().images[0].description;
    expect(text).toHaveLength(200);
    expect(text.endsWith('…')).toBe(true);
  });
});
