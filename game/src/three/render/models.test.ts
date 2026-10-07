import { describe, expect, it } from 'vitest';
import { loadModels } from './models';

// The model files as base64 data URLs, since tests run without a server.
const FILES = import.meta.glob<string>('/public/models/*.glb', { query: '?inline', import: 'default', eager: true });

describe('loadModels progress', () => {
  it('reports 0 first, then one more file each time, ending at the total', async () => {
    const calls: [number, number][] = [];
    await loadModels(
      async (name) => {
        const url = FILES[`/public/models/${name}.glb`];
        if (!url) throw new Error(`Missing model file for ${name}`);
        return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0)).buffer;
      },
      (done, total) => calls.push([done, total]),
    );
    const total = calls[0][1];
    expect(total).toBe(Object.keys(FILES).length);
    expect(calls.map(([done]) => done)).toEqual(Array.from({ length: total + 1 }, (_, i) => i));
    expect(calls.every(([, t]) => t === total)).toBe(true);
  });
});
