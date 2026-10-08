import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { emptyWorld } from '../sim/testkit';
import type { World } from '../sim/types';
import type { DriveSnapshot } from '../phys/drive';
import { ErrorReporter, type ErrorReport } from './error-report';
import { writeSave } from './save';
import { TurnFailure } from './travel';

function makeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

type Sent = { url: string; report: ErrorReport };

function reporter(storage: Storage, status = 200): { reporter: ErrorReporter; sent: Sent[] } {
  const sent: Sent[] = [];
  const post = async (url: string, init: RequestInit): Promise<Response> => {
    const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
    sent.push({ url, report: JSON.parse(gunzipSync(bytes).toString('utf8')) as ErrorReport });
    return new Response(null, { status });
  };
  return { reporter: new ErrorReporter('https://factory.test/errors', 'dev', '3.4.5+abc1234', storage, post), sent };
}

function watching(r: ErrorReporter, world: World): void {
  r.watch({ world: () => world, log: () => ['Day 2 08:00 Sold scrap', 'Day 2 07:30 Arrived'] });
}

describe('error reports', () => {
  it('sends the error, the world in memory, the log and an older autosave', async () => {
    const storage = makeStorage();
    writeSave(storage, 'auto', { ...emptyWorld(), turn: 40 }, 1);
    const { reporter: r, sent } = reporter(storage);
    watching(r, { ...emptyWorld(), turn: 44 });

    await r.report(new RangeError('wheel 7 has no axle'));

    expect(sent).toHaveLength(1);
    const { url, report } = sent[0];
    expect(url).toBe('https://factory.test/errors');
    expect(report).toMatchObject({ build: 'dev', version: '3.4.5+abc1234', turn: 44, autosaveIsWorld: false, drive: null });
    expect(report.error).toMatchObject({ name: 'RangeError', message: 'wheel 7 has no axle' });
    expect(report.error.stack).toContain('wheel 7 has no axle');
    expect(report.log).toEqual(['Day 2 08:00 Sold scrap', 'Day 2 07:30 Arrived']);
    expect((report.world as { world: { turn: number } }).world.turn).toBe(44);
    expect((JSON.parse(report.autosave ?? '') as { world: { turn: number } }).world.turn).toBe(40);
  });

  it('marks an autosave of the same turn as the world in memory and does not send it twice', async () => {
    const storage = makeStorage();
    writeSave(storage, 'auto', { ...emptyWorld(), turn: 44 }, 1);
    const { reporter: r, sent } = reporter(storage);
    watching(r, { ...emptyWorld(), turn: 44 });

    await r.report(new Error('boom'));

    expect(sent[0].report).toMatchObject({ autosave: null, autosaveIsWorld: true });
  });

  it('reports a boot error with no world', async () => {
    const { reporter: r, sent } = reporter(makeStorage());

    await r.report('map fetch failed');

    expect(sent[0].report).toMatchObject({ turn: null, world: null, log: [], autosave: null, autosaveIsWorld: false });
    expect(sent[0].report.error).toEqual({ name: 'NonError', message: 'map fetch failed', stack: '' });
  });

  it('sends a repeated error once per session', async () => {
    const { reporter: r, sent } = reporter(makeStorage());

    await r.report(new Error('every frame'));
    await r.report(new Error('every frame'));
    await r.report(new TypeError('every frame'));

    expect(sent.map((s) => `${s.report.error.name}: ${s.report.error.message}`)).toEqual(['Error: every frame', 'TypeError: every frame']);
  });

  it('carries a failed turn with the worker stack and its start drive', async () => {
    const { reporter: r, sent } = reporter(makeStorage());
    watching(r, { ...emptyWorld(), turn: 9 });
    const drive = { bodies: { player: 3 }, obstacles: {}, craters: {}, memory: {}, terrain: 1, decks: [], snapshot: new Uint8Array([0, 1, 254, 255]) } satisfies DriveSnapshot;
    const workerStack = 'TypeError: no route\n    at planRoute (turn-abc.js:1:200)';

    await r.report(new TurnFailure(workerStack, drive));

    const report = sent[0].report;
    expect(report.error).toEqual({ name: 'TypeError', message: 'no route', stack: workerStack });
    expect(report.drive).toEqual({ bodies: { player: 3 }, obstacles: {}, craters: {}, memory: {}, terrain: 1, decks: [], snapshot: 'AAH+/w==' });
  });

  it('only warns when the endpoint refuses, so the game goes on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { reporter: r, sent } = reporter(makeStorage(), 429);

    await expect(r.report(new Error('boom'))).resolves.toBeUndefined();

    expect(sent).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('Error report not sent:', new Error('the error endpoint answered 429'));
    warn.mockRestore();
  });
});
