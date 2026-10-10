import { describe, expect, it } from 'vitest';
import { resolve } from '../text/resolve';
import { GAME_GL, noWebGLText, openWebGL, WebGLUnavailable } from './webgl';

type Listener = (e: { statusMessage?: string }) => void;

function fakeCanvas(opts: { context?: object | null; throws?: Error; creationError?: string }) {
  const asked: string[] = [];
  const listeners = new Map<string, Listener>();
  let passed: unknown;
  const canvas = {
    getContext(kind: string, attributes: unknown) {
      asked.push(kind);
      passed = attributes;
      if (opts.creationError) listeners.get('webglcontextcreationerror')?.({ statusMessage: opts.creationError });
      if (opts.throws) throw opts.throws;
      return opts.context ?? null;
    },
    addEventListener: (type: string, fn: Listener) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, asked, listeners, passed: () => passed };
}

const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

describe('openWebGL', () => {
  it('returns the canvas and the context it was given, with the attributes passed through', () => {
    const context = {};
    const fake = fakeCanvas({ context });
    const surface = openWebGL(fake.canvas, GAME_GL);
    expect(surface.canvas).toBe(fake.canvas);
    expect(surface.context).toBe(context);
    expect(fake.passed()).toBe(GAME_GL);
  });

  it('throws WebGLUnavailable when the context is null', () => {
    expect(() => openWebGL(fakeCanvas({}).canvas, GAME_GL)).toThrow(WebGLUnavailable);
  });

  it('throws WebGLUnavailable with the thrown error as cause when getContext throws', () => {
    const cause = new Error('boom');
    try {
      openWebGL(fakeCanvas({ throws: cause }).canvas, GAME_GL);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WebGLUnavailable);
      expect((e as Error).cause).toBe(cause);
    }
  });

  it("keeps the browser's reason", () => {
    try {
      openWebGL(fakeCanvas({ creationError: 'BlockedByDriver' }).canvas, GAME_GL);
      expect.unreachable();
    } catch (e) {
      expect((e as WebGLUnavailable).reason).toBe('BlockedByDriver');
      expect((e as Error).message).toContain('BlockedByDriver');
    }
  });

  it('asks only for webgl2', () => {
    const fake = fakeCanvas({});
    expect(() => openWebGL(fake.canvas, GAME_GL)).toThrow();
    expect(fake.asked).toEqual(['webgl2']);
  });

  it('removes its listener afterwards', () => {
    const ok = fakeCanvas({ context: {} });
    openWebGL(ok.canvas, GAME_GL);
    expect(ok.listeners.size).toBe(0);
    const bad = fakeCanvas({ creationError: 'x' });
    expect(() => openWebGL(bad.canvas, GAME_GL)).toThrow();
    expect(bad.listeners.size).toBe(0);
  });
});

describe('noWebGLText', () => {
  const err = new WebGLUnavailable('BlockedByDriver');

  it('names the problem, the fixes, the reason and the saves on Firefox', () => {
    const text = noWebGLText(err, FIREFOX);
    const lines = text.lines.map((l) => resolve(l, 'en'));
    expect(resolve(text.title, 'en')).toContain('needs WebGL');
    expect(lines.some((l) => l.includes('hardware acceleration'))).toBe(true);
    expect(lines.some((l) => l.includes('about:support'))).toBe(true);
    expect(lines.some((l) => l.includes('saves'))).toBe(true);
    expect(text.detail).toBe('BlockedByDriver');
  });

  it('has no Firefox line in another browser, and no detail without a reason', () => {
    const text = noWebGLText(new WebGLUnavailable(null), CHROME);
    expect(text.lines.map((l) => resolve(l, 'en')).some((l) => l.includes('about:support'))).toBe(false);
    expect(text.detail).toBeNull();
  });

  it('shows no stack and no crash wording', () => {
    for (const ua of [FIREFOX, CHROME]) {
      const all = JSON.stringify(noWebGLText(err, ua).lines.map((l) => resolve(l, 'en')));
      expect(all).not.toContain('crashed');
      expect(all).not.toContain(err.stack ?? 'no stack');
    }
  });
});
