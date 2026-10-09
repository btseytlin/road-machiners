import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOT_TEXT } from './boot-progress';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('index.html boot markup', () => {
  it('repeats the boot text exactly', () => {
    expect(html).toContain(`<h1 class="boot-title">${BOOT_TEXT.title}</h1>`);
    expect(html).toContain(`>${BOOT_TEXT.code}</p>`);
    expect(html).toContain(`aria-label="${BOOT_TEXT.barLabel}"`);
    expect(html).toContain(`'${BOOT_TEXT.failedToLoad}'`);
  });
});
