import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNLOAD } from '../config';
import { BANK, beatLoopSeconds, type Cue } from '../data/sounds';
import { BeatLengthMismatch, loadBank, recoverBank, reportFailures, type BankOptions } from './bank';

const SOUNDS = { a: { files: ['a.ogg'] }, b: { files: ['b.ogg'] } } as unknown as Record<string, Cue>;
const PAIR = { hit: { files: ['hit-1.ogg', 'hit-2.ogg'] } } as unknown as Record<string, Cue>;
const BEAT = { score: { files: ['score-1.ogg'], beat: { bpm: 120, bars: 2 } } } as unknown as Record<string, Cue>;
const SIZE = 24;
const OGG_NAMES = ['a.ogg', 'b.ogg', 'hit-1.ogg', 'hit-2.ogg', 'score-1.ogg', ...Array.from({ length: 20 }, (_, i) => `f${i}.ogg`)];
const NAMES = [...OGG_NAMES, ...OGG_NAMES.map((n) => n.replace('.ogg', '.m4a'))];
const SUPPORT = { ogg: 'probably', m4a: 'maybe' };
const expectedBytes = Object.fromEntries(NAMES.map((n) => [n, SIZE]));
const options = (extra: Partial<BankOptions> = {}): BankOptions => ({ expectedBytes, support: SUPPORT, ...extra });

function body(length: number, signed = true): ArrayBuffer {
  const bytes = new Uint8Array(length);
  if (signed) bytes.set([...'OggSftyp'].slice(0, length).map((c) => c.charCodeAt(0)));
  return bytes.buffer;
}
function tagged(url: string): ArrayBuffer {
  const bytes = new Uint8Array(SIZE);
  const signature = url.endsWith('.m4a') ? 'ftyp' : 'OggS';
  bytes.set([...signature].map((c) => c.charCodeAt(0)), url.endsWith('.m4a') ? 4 : 0);
  bytes.set(new TextEncoder().encode(url.slice(-16).padStart(16)), 8);
  return bytes.buffer;
}
const tag = (data: ArrayBuffer) => new TextDecoder().decode(new Uint8Array(data).subarray(8));
function reply(over: Record<string, unknown> = {}, data: ArrayBuffer = body(SIZE)) {
  return { ok: true, status: 200, redirected: false, headers: { get: () => 'audio/ogg' }, arrayBuffer: async () => data, ...over };
}
const ok = reply();
const real = { length: 100, numberOfChannels: 1 } as unknown as AudioBuffer;
const silent = { sampleRate: 100, state: 'suspended', createBuffer: (_c: number, length: number) => ({ length, duration: length / 100 }) };

function ctxOf(decode: (data: ArrayBuffer) => Promise<AudioBuffer>) {
  return { ...silent, decodeAudioData: decode } as unknown as BaseAudioContext;
}
const ctx = ctxOf(async () => real);
const rejecting = ctxOf(async () => { throw new Error('bad'); });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadBank', () => {
  it('reports 0 first, then each decoded file', async () => {
    vi.stubGlobal('fetch', async () => ok);
    const calls: [number, number][] = [];
    const { failures } = await loadBank(ctx, SOUNDS, options({ progress: (done, total) => calls.push([done, total]) }));
    expect(calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(failures).toEqual([]);
  });

  it('fetches a file that decodes once', async () => {
    const fetch = vi.fn(async () => ok);
    vi.stubGlobal('fetch', fetch);
    await loadBank(ctx, SOUNDS, options());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives a failed file the buffer of a decoded sibling', async () => {
    vi.stubGlobal('fetch', async (url: string) => reply({ ok: !url.includes('hit-2.'), status: 404 }));
    vi.useFakeTimers();
    const calls: number[] = [];
    const { bank, failures } = await afterRetries(loadBank(ctx, PAIR, options({ progress: (done) => calls.push(done) })));
    expect(bank.get('hit-2.ogg')).toBe(real);
    expect(failures.map((f) => f.file)).toEqual(['hit-2.ogg']);
    expect(Math.max(...calls)).toBe(2);
  });

  it('gives a file that never decodes the buffer of a decoded sibling', async () => {
    const good = { id: 'good' } as unknown as AudioBuffer;
    const fetch = vi.fn(async (url: string) => {
      return reply({}, tagged(url));
    });
    vi.stubGlobal('fetch', fetch);
    const decode = vi.fn(async (data: ArrayBuffer) => {
      if (tag(data).includes('hit-2')) throw new Error('EncodingError');
      return good;
    });
    const { bank, failures } = await loadBank(ctxOf(decode), PAIR, options());
    expect(bank.get('hit-1.ogg')).toBe(good);
    expect(bank.get('hit-2.ogg')).toBe(good);
    expect(failures.map((f) => f.file)).toEqual(['hit-2.ogg']);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('hit-2.ogg'))).toHaveLength(BANK.tries);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('hit-2.m4a'))).toHaveLength(BANK.tries);
  });

  it('retries a file that fails once', async () => {
    const fetch = vi.fn(async () => ok);
    vi.stubGlobal('fetch', fetch);
    let calls = 0;
    const flaky = ctxOf(async () => {
      if (++calls === 1) throw new Error('once');
      return real;
    });
    const { failures } = await loadBank(flaky, { a: SOUNDS.a }, options());
    expect(failures).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('tries a failing file BANK.tries times in each format, and only the later tries skip the cache', async () => {
    const fetch = vi.fn(async (..._args: unknown[]) => ok);
    vi.stubGlobal('fetch', fetch);
    await loadBank(rejecting, { a: SOUNDS.a }, options());
    expect(fetch).toHaveBeenCalledTimes(BANK.tries * BANK.formats.length);
    fetch.mock.calls.forEach((call, i) => {
      if (i % BANK.tries === 0) expect(call).toHaveLength(1);
      else expect(call[1]).toEqual({ cache: 'reload' });
    });
  });

  it('gives a cue with no decoded file a silent buffer', async () => {
    vi.stubGlobal('fetch', async () => ok);
    const { bank } = await loadBank(rejecting, { a: SOUNDS.a }, options());
    expect(bank.get('a.ogg')!.duration).toBeCloseTo(BANK.silentSeconds, 1);
  });

  it('gives a beat cue a silent buffer one loop long', async () => {
    vi.stubGlobal('fetch', async () => ok);
    const { bank } = await loadBank(rejecting, BEAT, options());
    expect(bank.get('score-1.ogg')!.duration).toBeCloseTo(beatLoopSeconds({ bpm: 120, bars: 2 }), 1);
  });

  it('treats a 404 like a decode failure', async () => {
    vi.stubGlobal('fetch', async () => reply({ ok: false, status: 404 }));
    vi.useFakeTimers();
    const { bank, failures, unreachable } = await afterRetries(loadBank(ctx, SOUNDS, options()));
    expect(failures).toHaveLength(2);
    expect(unreachable).toEqual([]);
    expect(bank.size).toBe(2);
  });

  it('runs at most BANK.decodeAtOnce jobs at the same time', async () => {
    const many = { m: { files: Array.from({ length: 20 }, (_, i) => `f${i}.ogg`) } } as unknown as Record<string, Cue>;
    vi.stubGlobal('fetch', async () => ok);
    let running = 0;
    let peak = 0;
    const counting = ctxOf(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return real;
    });
    await loadBank(counting, many, options());
    expect(peak).toBe(BANK.decodeAtOnce);
  });

  it('throws on a file with no expected size', async () => {
    vi.stubGlobal('fetch', async () => ok);
    await expect(loadBank(ctx, SOUNDS, options({ expectedBytes: {} }))).rejects.toThrow('no expected size');
  });
});

async function afterRetries<T>(run: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b) * 4);
  return run;
}

describe('failure classes', () => {
  const kindOf = async (fetchStub: unknown, context = rejecting, support = SUPPORT) => {
    vi.stubGlobal('fetch', fetchStub);
    vi.useFakeTimers();
    const { failures } = await afterRetries(loadBank(context, { a: SOUNDS.a }, options({ support })));
    return failures[0];
  };

  it('calls a 404 fetch', async () => {
    expect((await kindOf(async () => reply({ ok: false, status: 404 }))).kind).toBe('fetch');
  });

  it('calls a short body and a body that is not Ogg bytes', async () => {
    expect((await kindOf(async () => reply({}, body(4)))).kind).toBe('bytes');
    expect((await kindOf(async () => reply({}, body(SIZE, false)))).kind).toBe('bytes');
  });

  it('does not decode a body it already knows is wrong', async () => {
    const decode = vi.fn(async () => real);
    await kindOf(async () => reply({}, body(4)), ctxOf(decode));
    expect(decode).not.toHaveBeenCalled();
  });

  it('calls a rejected decode of intact bytes decoder, or codec with no support for the format', async () => {
    expect((await kindOf(async () => ok)).kind).toBe('decoder');
    expect((await kindOf(async () => ok, rejecting, { ogg: '', m4a: '' })).kind).toBe('codec');
  });

  it('keeps the response facts and the browser state', async () => {
    const failure = await kindOf(async () => reply({ status: 200, redirected: true }, body(4)));
    expect(failure.evidence).toMatchObject({
      status: 200,
      contentType: 'audio/ogg',
      redirected: true,
      receivedBytes: 4,
      expectedBytes: SIZE,
      signature: false,
      contextState: 'suspended',
    });
  });

  it('counts the megabytes decoded so far', async () => {
    const big = { length: 1_000_000, numberOfChannels: 1 } as unknown as AudioBuffer;
    let calls = 0;
    const mixed = ctxOf(async () => {
      if (++calls <= 4) return big;
      throw new Error('late');
    });
    vi.stubGlobal('fetch', async () => ok);
    const many = { m: { files: Array.from({ length: 6 }, (_, i) => `f${i}.ogg`) } } as unknown as Record<string, Cue>;
    const { failures } = await loadBank(mixed, many, options());
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0].evidence.decodedMegabytes).toBeGreaterThanOrEqual(4);
  });
});

describe('recoverBank', () => {
  it('decodes bytes and decoder failures once more, past the cache, and replaces the stand-ins', async () => {
    const fresh = { length: 50, numberOfChannels: 1 } as unknown as AudioBuffer;
    let served = 0;
    const fetch = vi.fn(async (_url: string, _init?: unknown) => (served++ < BANK.tries * BANK.formats.length ? reply({}, body(4)) : ok));
    vi.stubGlobal('fetch', fetch);
    let healed = false;
    const context = ctxOf(async () => (healed ? fresh : real));
    const hit = { hit: { files: ['hit-1.ogg'] } } as unknown as Record<string, Cue>;
    const loaded = await loadBank(context, hit, options());
    expect(loaded.failures[0].kind).toBe('bytes');
    healed = true;
    const recovered = await recoverBank(context, loaded, hit, options());
    expect([...recovered]).toEqual(['hit-1.ogg']);
    expect(loaded.bank.get('hit-1.ogg')).toBe(fresh);
    expect(fetch.mock.calls.at(-1)![1]).toEqual({ cache: 'reload' });
  });

  it('leaves fetch and codec failures alone', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.includes('hit-2.') ? reply({ ok: false, status: 503 }) : ok));
    vi.useFakeTimers();
    const run = loadBank(rejecting, PAIR, options({ support: { ogg: '', m4a: '' } }));
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b) * 4);
    const loaded = await run;
    const fetch = vi.fn(async () => ok);
    vi.stubGlobal('fetch', fetch);
    expect(loaded.failures.map((f) => f.kind).sort()).toEqual(['codec', 'fetch']);
    expect([...(await recoverBank(ctx, loaded, PAIR, options()))]).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the stand-in when the decode fails again, and decodes one file at a time', async () => {
    vi.stubGlobal('fetch', async () => ok);
    const many = { m: { files: ['f0.ogg', 'f1.ogg', 'f2.ogg'] } } as unknown as Record<string, Cue>;
    const loaded = await loadBank(rejecting, many, options());
    let running = 0;
    let peak = 0;
    const slow = ctxOf(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      throw new Error('still bad');
    });
    const before = [...loaded.bank.values()];
    expect([...(await recoverBank(slow, loaded, many, options()))]).toEqual([]);
    expect(peak).toBe(1);
    expect([...loaded.bank.values()]).toEqual(before);
  });
});

describe('loadBank with the network down', () => {
  const down = new TypeError('Failed to fetch');
  beforeEach(() => { vi.useFakeTimers(); });

  it('stands in for an unreachable file and does not report it', async () => {
    const fetch = vi.fn(async () => { throw down; });
    vi.stubGlobal('fetch', fetch);
    const run = loadBank(ctx, { a: SOUNDS.a }, options());
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b));
    const { bank, failures, unreachable } = await run;
    expect(failures).toEqual([]);
    expect(unreachable.map((f) => f.file)).toEqual(['a.ogg']);
    expect(bank.get('a.ogg')!.duration).toBeCloseTo(BANK.silentSeconds, 1);
    expect(fetch).toHaveBeenCalledTimes(DOWNLOAD.tries);
  });

  it('recovers when a later try gets through', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      if (++calls === 1) throw down;
      return ok;
    });
    const run = loadBank(ctx, { a: SOUNDS.a }, options());
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs[0]);
    const { failures, unreachable } = await run;
    expect(failures).toEqual([]);
    expect(unreachable).toEqual([]);
  });

  it('gives an unreachable file the buffer of its sibling', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('hit-2.ogg')) throw down;
      return ok;
    });
    const run = loadBank(ctx, PAIR, options());
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b));
    const { bank, failures, unreachable } = await run;
    expect(bank.get('hit-2.ogg')).toBe(bank.get('hit-1.ogg'));
    expect(failures).toEqual([]);
    expect(unreachable.map((f) => f.file)).toEqual(['hit-2.ogg']);
  });
});

describe('reportFailures', () => {
  it('sends one report per class with the evidence, the counts and the browser text', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.includes('hit-2.') ? reply({ ok: false, status: 503 }) : ok));
    const named = ctxOf(async () => { throw Object.assign(new Error('The buffer is bad'), { name: 'EncodingError' }); });
    vi.useFakeTimers();
    const run = loadBank(named, PAIR, options());
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b) * 4);
    const loaded = await run;
    const reports = reportFailures(loaded.failures, 104, new Set(['hit-1.ogg']), SUPPORT);
    expect(reports.map((r) => r.message)).toEqual([
      'Sound decode failed (decoder): 1 of 104, got 24 of 24 bytes, signature yes, HTTP 200 audio/ogg, context suspended, page visible, 0 MB decoded, device memory unknown, recovered later 1: ogg "probably" EncodingError: The buffer is bad; m4a "maybe" EncodingError: The buffer is bad',
      'Sound decode failed (fetch): 1 of 104, got no of 24 bytes, signature no, HTTP 503 no content type, context suspended, page visible, 0 MB decoded, device memory unknown, recovered later 0: ogg "probably" Error: File /sfx/hit-2.ogg failed to load: HTTP 503; m4a "maybe" Error: File /sfx-m4a/hit-2.m4a failed to load: HTTP 503',
    ]);
    expect(reports[0].files).toEqual(['hit-1.ogg']);
  });

  it('sends nothing when nothing failed', () => {
    expect(reportFailures([], 104, new Set(), SUPPORT)).toEqual([]);
  });

  it('counts a file once when its download is retried', async () => {
    vi.useFakeTimers();
    let first = true;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('a.ogg') && first) {
        first = false;
        throw new TypeError('Load failed');
      }
      return ok;
    });
    const calls: [number, number][] = [];
    const run = loadBank(ctx, SOUNDS, options({ progress: (done, total) => calls.push([done, total]) }));
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs[0] * 10);
    const { failures } = await run;
    expect(calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(failures).toEqual([]);
  });
});

describe('loadBank with a browser that refuses Ogg Opus', () => {
  const MANY = { m: { files: Array.from({ length: 20 }, (_, i) => `f${i}.ogg`) } } as unknown as Record<string, Cue>;
  const good = { id: 'good' } as unknown as AudioBuffer;
  const served = (url: string) => reply({}, tagged(url));
  const refusing = (refused: string) =>
    ctxOf(async (data) => {
      if (tag(data).endsWith(refused)) throw Object.assign(new Error('x'), { name: 'EncodingError' });
      return good;
    });
  const urls = (fetch: { mock: { calls: unknown[][] } }, ext: string) => fetch.mock.calls.filter(([url]) => (url as string).endsWith(ext));

  it('decodes every file from the twin and learns the format', async () => {
    const fetch = vi.fn(async (url: string) => served(url));
    vi.stubGlobal('fetch', fetch);
    const { bank, failures, format } = await loadBank(refusing('.ogg'), MANY, options());
    expect(failures).toEqual([]);
    expect(format).toBe('m4a');
    expect([...bank.values()].every((b) => b === good)).toBe(true);
    expect(urls(fetch, '.m4a')).toHaveLength(20);
    expect(urls(fetch, '.ogg').length).toBeLessThanOrEqual(BANK.decodeAtOnce * BANK.tries);
    expect(fetch.mock.calls.some(([url]) => (url as string).includes('sfx-m4a/f19.m4a'))).toBe(true);
  });

  it('fetches only .ogg when it decodes', async () => {
    const fetch = vi.fn(async (url: string) => served(url));
    vi.stubGlobal('fetch', fetch);
    const { format } = await loadBank(refusing('.never'), MANY, options());
    expect(format).toBe('ogg');
    expect(urls(fetch, '.m4a')).toHaveLength(0);
    expect(urls(fetch, '.ogg')).toHaveLength(20);
  });

  it('fails a file that decodes in neither format with one error each', async () => {
    vi.stubGlobal('fetch', async (url: string) => served(url));
    const { failures } = await loadBank(ctxOf(async (data) => {
      if (tag(data).includes('hit-2')) throw new Error('bad');
      return good;
    }), PAIR, options());
    expect(failures.map((f) => f.file)).toEqual(['hit-2.ogg']);
    expect(failures[0].errors).toHaveLength(2);
  });

  it('does not try the twin of an unreachable file or switch the format', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('hit-2.ogg')) throw new TypeError('Failed to fetch');
      return served(url);
    });
    vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers();
    const run = loadBank(ctxOf(async () => good), PAIR, options());
    await vi.advanceTimersByTimeAsync(DOWNLOAD.waitMs.reduce((a, b) => a + b));
    const { unreachable, failures, format } = await run;
    expect(unreachable.map((f) => f.file)).toEqual(['hit-2.ogg']);
    expect(failures).toEqual([]);
    expect(format).toBe('ogg');
    expect(urls(fetch, '.m4a')).toHaveLength(0);
  });

  it('counts a 404 of the twin as a failure', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('.m4a') ? reply({ ok: false, status: 404 }) : served(url)));
    vi.useFakeTimers();
    const { failures, unreachable } = await afterRetries(loadBank(refusing('.ogg'), { a: SOUNDS.a }, options()));
    expect(failures).toHaveLength(1);
    expect(unreachable).toEqual([]);
  });

  it('recovers a failed file from the format the bank learned', async () => {
    const fetch = vi.fn(async (url: string) => served(url));
    vi.stubGlobal('fetch', fetch);
    let healed = false;
    const context = ctxOf(async (data) => {
      const name = tag(data);
      if (name.includes('hit-2') || (!healed && name.endsWith('.ogg'))) throw new Error('bad');
      return good;
    });
    const loaded = await loadBank(context, PAIR, options());
    expect(loaded.format).toBe('m4a');
    healed = true;
    fetch.mockClear();
    expect([...(await recoverBank(context, loaded, PAIR, options()))]).toEqual([]);
    expect(urls(fetch, '.ogg')).toHaveLength(1);
  });
});

describe('loadBank with beat cues', () => {
  const loop = Math.round(beatLoopSeconds({ bpm: 120, bars: 2 }) * 100);
  const sized = (length: number) => {
    const context = {
      sampleRate: 100,
      decodeAudioData: async () => ({ length, numberOfChannels: 1, getChannelData: () => new Float32Array(length).fill(1) }),
      createBuffer: (_c: number, n: number) => {
        const channel = new Float32Array(n);
        return { length: n, duration: n / 100, numberOfChannels: 1, getChannelData: () => channel };
      },
    };
    return context as unknown as BaseAudioContext;
  };

  it('trims a long buffer and pads a short one to exactly one loop', async () => {
    vi.stubGlobal('fetch', async () => ok);
    for (const length of [loop + 1, loop - 1]) {
      const { bank, failures } = await loadBank(sized(length), BEAT, options());
      expect(failures).toEqual([]);
      expect(bank.get('score-1.ogg')!.length).toBe(loop);
    }
  });

  it('fails a format whose buffer is far off a loop', async () => {
    vi.stubGlobal('fetch', async () => ok);
    const { failures } = await loadBank(sized(loop + 20), BEAT, options());
    expect(failures[0].errors.every((e) => e instanceof BeatLengthMismatch)).toBe(true);
    expect(failures[0].errors).toHaveLength(BANK.formats.length);
  });
});
