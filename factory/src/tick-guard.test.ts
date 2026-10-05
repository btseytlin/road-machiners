import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_STATE, readState, writeState } from './state';
import { guardTick } from './tick-guard';
import type { Ctx } from './types';

const ROOT = resolve('tmp/factory-tick-guard-test');
const statePath = join(ROOT, 'state.json');

function fakeCtx(posts: string[]): Ctx {
  return {
    cfg: { committeeChat: 'c', home: ROOT }, statePath, now: () => new Date(),
    telegram: { sendMessage: async (_c: string, text: string) => { posts.push(text); return 1; } },
  } as unknown as Ctx;
}

describe('guardTick', () => {
  beforeEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    writeState(statePath, structuredClone(EMPTY_STATE));
  });

  it('records a crash for Hermes and posts nothing', async () => {
    const posts: string[] = [];
    await expect(guardTick(fakeCtx(posts), async () => { throw new Error('GitHub is down'); })).rejects.toThrow();
    expect(readState(statePath).lastTickError).toBe('GitHub is down');
    expect(posts).toEqual([]);
  });

  it('clears the last error after a good tick', async () => {
    const posts: string[] = [];
    await expect(guardTick(fakeCtx(posts), async () => { throw new Error('x'); })).rejects.toThrow();
    await guardTick(fakeCtx(posts), async () => undefined);
    expect(readState(statePath).lastTickError).toBeNull();
  });
});
