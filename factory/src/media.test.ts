import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { solidPng } from './media-fixtures';
import { MAX_BYTES, MAX_FILES, MEDIA_MOUNT, allowedSource, firstPartySource, detectType, extractMediaUrls, fetchMedia, imageSize, mediaSection } from './media';

const UUID = '24c78bbf-b445-42bb-a191-2eba2e36379e';
const ASSET = `https://github.com/user-attachments/assets/${UUID}`;
const S3 = 'https://github-production-user-asset-6210df.s3.amazonaws.com/1/2?X-Amz-Signature=secret';

type Reply = { status: number; location?: string; body?: Buffer; length?: string };
type Seen = { url: string; auth: string | undefined; redirect: string | undefined };

function fakeFetch(replies: Record<string, Reply>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fake = async (input: URL | string, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    seen.push({ url, auth: headers?.Authorization, redirect: init?.redirect });
    const reply = replies[url.split('?')[0]];
    if (reply === undefined) throw new Error(`unexpected request to ${url}`);
    const responseHeaders: Record<string, string> = {};
    if (reply.location) responseHeaders.location = reply.location;
    if (reply.length) responseHeaders['content-length'] = reply.length;
    return new Response(reply.body === undefined ? null : new Uint8Array(reply.body), { status: reply.status, headers: responseHeaders });
  };
  return { fetch: fake as typeof fetch, seen };
}

const PNG = solidPng(4, 3, [200, 30, 30]);
const OK: Record<string, Reply> = { [ASSET]: { status: 302, location: S3 }, [S3.split('?')[0]]: { status: 200, body: PNG } };

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'factory-media-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('extractMediaUrls', () => {
  it('finds markdown images, html images and bare attachment links once, in order', () => {
    const text = `a ![x](${ASSET}) b <img width="3" src="https://example.com/a.png"> c ${ASSET} d https://github.com/user-attachments/assets/${UUID.replace('24', '25')}`;
    expect(extractMediaUrls(text)).toEqual([ASSET, 'https://example.com/a.png', `https://github.com/user-attachments/assets/${UUID.replace('24', '25')}`]);
  });

  it('ignores plain links that are not attachments or images', () => {
    expect(extractMediaUrls('see https://example.com/page and [doc](https://github.com/o/r)')).toEqual([]);
  });
});

describe('allowedSource', () => {
  it('accepts GitHub attachment links only', () => {
    expect(allowedSource(ASSET)).toBe(true);
    expect(allowedSource('https://user-images.githubusercontent.com/123/abc.png')).toBe(true);
    for (const bad of ['http://github.com/user-attachments/assets/' + UUID, 'https://evil.com/user-attachments/assets/' + UUID, 'https://github.com.evil.com/user-attachments/assets/' + UUID,
      'https://github.com@evil.com/user-attachments/assets/' + UUID, 'https://github.com:8443/user-attachments/assets/' + UUID, 'https://github.com/o/r/raw/main/a.png', 'https://169.254.169.254/latest', 'not a url']) {
      expect(allowedSource(bad), bad).toBe(false);
    }
  });
});

describe('fetchMedia', () => {
  it('follows GitHub\'s redirect to its storage host and saves the image under a generated name', async () => {
    const { fetch, seen } = fakeFetch(OK);
    const [entry] = await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
    expect(entry).toMatchObject({ status: 'ok', type: 'png', width: 4, height: 3, source: 'issue body', url: ASSET });
    expect(entry.file).toMatch(/^ref-[0-9a-f]{12}\.png$/);
    expect(readFileSync(join(dir, entry.file as string)).equals(PNG)).toBe(true);
    expect(seen.map((s) => s.redirect)).toEqual(['manual', 'manual']);
    expect(readdirSync(dir).sort()).toEqual(['manifest.json', entry.file]);
  });

  it('sends the token to the first github.com hop only, never to the storage host', async () => {
    const { fetch, seen } = fakeFetch(OK);
    await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: ASSET }], token: 'gh-secret' });
    expect(seen.map((s) => s.auth)).toEqual(['Bearer gh-secret', undefined]);
  });

  it('fails a redirect to a host that is not GitHub storage, without requesting it', async () => {
    const { fetch, seen } = fakeFetch({ [ASSET]: { status: 302, location: 'https://evil.example.com/x.png?sig=secret' } });
    const [entry] = await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
    expect(entry.status).toBe('failed');
    expect(entry.reason).toContain('evil.example.com');
    expect(entry.reason).not.toContain('secret');
    expect(seen).toHaveLength(1);
  });

  it('fails a redirect to plain http, to an internal address and a redirect loop', async () => {
    for (const location of ['http://github.com/x', 'https://169.254.169.254/latest/meta-data', 'https://github.com:444/x']) {
      const { fetch } = fakeFetch({ [ASSET]: { status: 302, location } });
      const [entry] = await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
      expect(entry.status, location).toBe('failed');
    }
    const loop = fakeFetch({ [ASSET]: { status: 302, location: ASSET } });
    const [entry] = await fetchMedia({ fetch: loop.fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
    expect(entry.reason).toContain('redirects more than');
    expect(loop.seen).toHaveLength(4);
  });

  it('fails an HTTP error, a file over the byte limit and a file that does not decode', async () => {
    const cases: [Reply, string][] = [
      [{ status: 404 }, 'HTTP 404'],
      [{ status: 200, body: Buffer.alloc(1), length: String(MAX_BYTES + 1) }, 'limit'],
      [{ status: 200, body: Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(5)]) }, 'does not decode'],
    ];
    for (const [reply, reason] of cases) {
      const [entry] = await fetchMedia({ fetch: fakeFetch({ [ASSET]: reply }).fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
      expect(entry.status, reason).toBe('failed');
      expect(entry.reason).toContain(reason);
    }
  });

  it('lists a non-image attachment as skipped, and an image on another host as skipped without any request', async () => {
    const { fetch, seen } = fakeFetch({ [ASSET]: { status: 200, body: Buffer.from('%PDF-1.7 not an image') } });
    const text = `${ASSET}\n![o](https://i.imgur.com/a.png)`;
    const entries = await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text }] });
    expect(entries.map((e) => e.status)).toEqual(['skipped', 'skipped']);
    expect(entries[1].reason).toContain('i.imgur.com');
    expect(seen).toHaveLength(1);
  });

  it('adds the images of feedback comments to those of the body, and keeps every earlier one', async () => {
    const second = `https://github.com/user-attachments/assets/${UUID.replace('24', '25')}`;
    const { fetch } = fakeFetch({ ...OK, [second]: { status: 200, body: solidPng(2, 2, [0, 0, 255]) } });
    const entries = await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: ASSET }, { source: 'comment by ann', text: `## Committee feedback\n![](${second})` }] });
    expect(entries.map((e) => [e.source, e.status])).toEqual([['issue body', 'ok'], ['comment by ann', 'ok']]);
  });

  it('keeps a fetched image across stages, so a link that expired later still works', async () => {
    await fetchMedia({ fetch: fakeFetch(OK).fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
    const dead = fakeFetch({});
    const [entry] = await fetchMedia({ fetch: dead.fetch, dir, texts: [{ source: 'issue body', text: ASSET }] });
    expect(entry.status).toBe('ok');
    expect(dead.seen).toHaveLength(0);
  });

  it('stops at the file count limit and says which images it left out', async () => {
    const ids = Array.from({ length: MAX_FILES + 2 }, (_, i) => `https://github.com/user-attachments/assets/${String(i).padStart(8, '0')}-b445-42bb-a191-2eba2e36379e`);
    const replies = Object.fromEntries(ids.map((id) => [id, { status: 200, body: PNG }]));
    const entries = await fetchMedia({ fetch: fakeFetch(replies).fetch, dir, texts: [{ source: 'issue body', text: ids.join('\n') }] });
    expect(entries.filter((e) => e.status === 'ok')).toHaveLength(MAX_FILES);
    expect(entries.slice(MAX_FILES).map((e) => e.status)).toEqual(['skipped', 'skipped']);
  });

  it('never writes a query string, which can hold a signature, into the manifest or the failure text', async () => {
    const { fetch } = fakeFetch(OK);
    await fetchMedia({ fetch, dir, texts: [{ source: 'issue body', text: `${ASSET}?token=abc` }] });
    expect(readFileSync(join(dir, 'manifest.json'), 'utf8')).not.toContain('abc');
  });
});

describe('mediaSection', () => {
  it('lists the absolute path of each image and marks one nobody saw', async () => {
    const entries = await fetchMedia({ fetch: fakeFetch(OK).fetch, dir, texts: [{ source: 'issue body', text: `${ASSET}\n![o](https://i.imgur.com/a.png)` }] });
    const text = mediaSection(entries);
    expect(text).toContain(`1. ${MEDIA_MOUNT}/${entries[0].file} (png, 4x3,`);
    expect(text).toContain('2. NOT AVAILABLE, https://i.imgur.com/a.png');
    expect(text).toContain('Read tool');
  });

  it('says so when the issue shows none', () => {
    expect(mediaSection([])).toBe('The issue shows no reference images.');
  });
});

describe('image detection', () => {
  it('knows the four types by their first bytes and size from the header', () => {
    expect(detectType(PNG)).toBe('png');
    expect(imageSize(PNG, 'png')).toEqual({ width: 4, height: 3 });
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectType(Buffer.from('GIF89a'))).toBe('gif');
    expect(detectType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(detectType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('first-party images', () => {
  const FP = 'https://roam-game.online/unique-name.jpg';
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 3, 0, 4, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), Buffer.alloc(8)]);
  const run = (replies: Record<string, Reply>, text = FP, token?: string) => {
    const f = fakeFetch(replies);
    return fetchMedia({ fetch: f.fetch, dir: mkdtempSync(join(dir, 'run-')), texts: [{ source: 'issue body', text }], token }).then((entries) => ({ entries, seen: f.seen }));
  };

  it('accepts only plain root-level and concepts image paths on https', () => {
    for (const ok of [FP, 'https://roam-game.online/a.png', 'https://roam-game.online/concepts/safe-name_1.webp']) expect(firstPartySource(ok), ok).toBe(true);
    for (const bad of ['http://roam-game.online/a.jpg', 'https://roam-game.online/a.jpg?x=1', 'https://roam-game.online/a.jpg#f', 'https://roam-game.online/.env', 'https://roam-game.online/a.svg',
      'https://roam-game.online/dev/a.jpg', 'https://roam-game.online/concepts%2fa.jpg', 'https://roam-game.online/concepts/x/a.jpg', 'https://roam-game.online/.hidden.jpg',
      'https://www.roam-game.online/a.jpg', 'https://roam-game.online.evil.com/a.jpg', 'https://roam-game.online@evil.com/a.jpg', 'https://roam-game.online:8443/a.jpg', 'https://evil.com/roam-game.online/a.jpg']) {
      expect(firstPartySource(bad), bad).toBe(false);
    }
  });

  it('extracts bare first-party links but not other paths', () => {
    expect(extractMediaUrls(`see ${FP} and https://roam-game.online/page and https://roam-game.online/a.jpg?x=1`)).toEqual([FP]);
  });

  it('downloads an allowed image without any credentials', async () => {
    const { entries, seen } = await run({ [FP]: { status: 200, body: JPG } }, `![x](${FP})`, 'gh-secret');
    expect(entries[0]).toMatchObject({ status: 'ok', type: 'jpeg', url: FP });
    expect(seen.map((s) => s.auth)).toEqual([undefined]);
    expect(mediaSection(entries)).toContain(`${MEDIA_MOUNT}/${entries[0].file}`);
  });

  it('marks a missing url and for wrong content', async () => {
    for (const reply of [{ status: 404 }, { status: 200, body: Buffer.from('<html>not an image</html>') }, { status: 200, body: Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(5)]) }]) {
      const { entries } = await run({ [FP]: reply });
      expect(entries[0].status).toBe('failed');
    }
  });

  it('follows a redirect only to another allowed first-party image and never to GitHub or other hosts', async () => {
    const other = 'https://roam-game.online/concepts/b.png';
    const good = await run({ [FP]: { status: 301, location: '/concepts/b.png' }, [other]: { status: 200, body: PNG } });
    expect(good.entries[0].status).toBe('ok');
    for (const location of ['https://evil.example.com/a.jpg', 'http://roam-game.online/a.jpg', 'https://169.254.169.254/latest', 'https://roam-game.online/.env', 'https://roam-game.online/a.jpg?k=1', `${ASSET}`]) {
      const { entries, seen } = await run({ [FP]: { status: 302, location } });
      expect(entries[0].status, location).toBe('failed');
      expect(seen, location).toHaveLength(1);
    }
  });

  it('does not let a GitHub attachment redirect to the first-party host', async () => {
    const { entries } = await run({ [ASSET]: { status: 302, location: FP } }, ASSET);
    expect(entries[0].status).toBe('failed');
  });

  it('skips non-allowlisted first-party paths without any request', async () => {
    const { entries, seen } = await run({}, '![x](https://roam-game.online/secrets/key.jpg) ![y](https://roam-game.online/a.jpg?x=1)');
    expect(entries.map((e) => e.status)).toEqual(['skipped', 'skipped']);
    expect(seen).toHaveLength(0);
  });
});
