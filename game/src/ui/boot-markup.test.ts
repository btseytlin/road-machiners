import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { t } from '../text/msg';
import { resolve } from '../text/resolve';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('index.html boot markup', () => {
  it('repeats the English boot text exactly', () => {
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
    expect(html).toContain(`<h1 class="boot-title">${title}</h1>`);
    expect(html).toContain(`>${resolve(t('boot.code'), 'en')}</p>`);
    expect(html).toContain(`aria-label="${resolve(t('boot.loading'), 'en')}"`);
    expect(html).toContain(`'${resolve(t('boot.failedToLoad'), 'en')}'`);
  });
});
