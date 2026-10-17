import { afterEach, describe, expect, it, vi } from 'vitest';
import { download, DownloadFailed } from './download';

const URL = 'models/truck.glb';

function ok(): Response {
  return new Response(new Uint8Array([1, 2, 3]));
}

function status(code: number): Response {
  return new Response('', { status: code });
}

function setup(...outcomes: (Response | Error)[]) {
  const waits: number[] = [];
  const fetch = vi.fn(async () => {
    const next = outcomes.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  return { fetch, wait, waits };
}

function drops(n: number): Error[] {
  return Array.from({ length: n }, () => new TypeError('Failed to fetch'));
}

afterEach(() => vi.unstubAllGlobals());

describe('download', () => {
  it('returns the body after one call and no wait', async () => {
    const d = setup(ok());
    expect(new Uint8Array(await download(URL, d))).toEqual(new Uint8Array([1, 2, 3]));
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(d.waits).toEqual([]);
  });

  it('tries again after a dropped request', async () => {
    const d = setup(new TypeError('Failed to fetch'), ok());
    expect((await download(URL, d)).byteLength).toBe(3);
    expect(d.fetch).toHaveBeenCalledTimes(2);
    expect(d.waits).toEqual([500]);
  });

  it('tries again after a body read that drops', async () => {
    const broken = new Response(new ReadableStream({ pull: (c) => c.error(new TypeError('Load failed')) }));
    const d = setup(broken, ok());
    expect((await download(URL, d)).byteLength).toBe(3);
    expect(d.waits).toEqual([500]);
  });

  it('throws DownloadFailed with the last error after every try dropped', async () => {
    const last = new TypeError('Failed to fetch');
    const d = setup(...drops(5), last);
    const err = await download(URL, d).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err.url).toBe(URL);
    expect(err.cause).toBe(last);
    expect(d.fetch).toHaveBeenCalledTimes(6);
    expect(d.waits).toEqual([500, 1000, 2000, 4000, 4000]);
  });

  it('tries again after a 404 and returns the bytes once the file appears', async () => {
    const d = setup(status(404), status(404), ok());
    expect((await download(URL, d)).byteLength).toBe(3);
    expect(d.fetch).toHaveBeenCalledTimes(3);
  });

  it('throws the plain HTTP error naming the url and status when every try got a 404', async () => {
    const d = setup(...Array.from({ length: 6 }, () => status(404)));
    const err = await download(URL, d).catch((e) => e);
    expect(err).not.toBeInstanceOf(DownloadFailed);
    expect(err.message).toContain(URL);
    expect(err.message).toContain('404');
    expect(d.fetch).toHaveBeenCalledTimes(6);
  });

  it.each([400, 403])('throws at once on a %i', async (code) => {
    const d = setup(status(code));
    const err = await download(URL, d).catch((e) => e);
    expect(err.message).toContain(String(code));
    expect(d.fetch).toHaveBeenCalledTimes(1);
  });

  it('tries again after a 503', async () => {
    const d = setup(status(503), ok());
    expect((await download(URL, d)).byteLength).toBe(3);
  });

  it('throws the plain HTTP error when every try got a 503', async () => {
    const d = setup(...Array.from({ length: 6 }, () => status(503)));
    const err = await download(URL, d).catch((e) => e);
    expect(err).not.toBeInstanceOf(DownloadFailed);
    expect(err.message).toContain('503');
    expect(d.fetch).toHaveBeenCalledTimes(6);
  });

  it('throws the plain HTTP error when the last try got a 503 after drops', async () => {
    const d = setup(...drops(5), status(503));
    const err = await download(URL, d).catch((e) => e);
    expect(err).not.toBeInstanceOf(DownloadFailed);
  });

  it('uses the global fetch looked up at call time', async () => {
    vi.stubGlobal('fetch', async () => ok());
    expect((await download(URL)).byteLength).toBe(3);
  });
});
