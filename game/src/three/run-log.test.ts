import { defaultSetup } from '../sim/settings';
import { describe, expect, it } from 'vitest';
import { startKit } from '../data/start';
import { makePart } from '../sim/factory';
import { clockOf } from '../sim/sun';
import { cloneWorld, newWorld } from '../sim/world';
import type { World } from '../sim/types';
import { TEST_MAP } from '../test/map';
import { logEntries, RunLog } from './run-log';
import { memoryBackend } from './save-db';

function start(): World {
  return { ...newWorld(1337, startKit('standard'), TEST_MAP, defaultSetup('roaming')), turn: 400 };
}

// The next world, as a command makes it: a clone with fresh events.
function after(world: World, change: (w: World) => void): World {
  const next = cloneWorld(world);
  next.events = [];
  change(next);
  return next;
}

describe('logEntries', () => {
  it('keeps the player outcomes, names the trucks, and drops shots, spawns and fights between others', () => {
    const prev = start();
    const me = prev.player.vehicleId;
    const [foe, other] = prev.vehicles.filter((v) => v.id !== me);
    const next = after(prev, (w) => {
      w.events.push(
        { t: 'spawn', vehicle: foe.id },
        { t: 'destroyed', vehicle: foe.id, by: me },
        { t: 'destroyed', vehicle: other.id, by: foe.id },
        { t: 'skillUp', skill: 'driving', level: 2 },
      );
    });

    const events = logEntries(prev, next, true).filter((e) => e.kind === 'event');

    expect(events.map((e) => e.event)).toEqual(['destroyed', 'skillUp']);
    expect(events[0]).toMatchObject({ turn: 400, vehicle: foe.id, by: me, trucks: { [foe.id]: { name: foe.name, faction: foe.faction, chassis: foe.chassisId } } });
  });

  it('records money and parts gained and lost, which no event covers', () => {
    const prev = start();
    const sold = prev.player.storage[0] ?? null;
    const next = after(prev, (w) => {
      w.player.money -= 150;
      w.player.storage = [...w.player.storage.filter((p) => p !== w.player.storage[0]), makePart(w, 'mg', 0)];
    });

    const change = logEntries(prev, next, true).find((e) => e.kind === 'change');

    expect(change).toMatchObject({ money: -150, gained: ['mg'], lost: sold ? [sold.defId] : [] });
  });

  it('adds nothing when nothing the log keeps changed', () => {
    const prev = start();
    expect(logEntries(prev, after(prev, () => {}), true)).toEqual([]);
  });

  it('snapshots the player on the first world of a session and of each game day', () => {
    const prev = start();
    const first = logEntries(null, prev, true).find((e) => e.kind === 'day');
    expect(first).toMatchObject({ money: prev.player.money, chassis: expect.any(String), mountedValue: expect.any(Number) });
    const sameDay = after(prev, (w) => { w.turn += 1; });
    expect(logEntries(prev, sameDay, true).some((e) => e.kind === 'day')).toBe(false);
    let dayStart = prev.turn + 1;
    while (clockOf(dayStart).day === clockOf(prev.turn).day) dayStart++;
    const nextDay = after(prev, (w) => { w.turn = dayStart; });
    expect(logEntries(prev, nextDay, true).filter((e) => e.kind === 'day')).toHaveLength(1);
  });
});

describe('RunLog', () => {
  it('numbers records on across sessions and tabs, notes a load, and writes a world once', async () => {
    const backend = memoryBackend();
    const errors: unknown[] = [];
    const world = start();
    const first = new RunLog(backend, 'run', (e) => errors.push(e));
    const otherTab = new RunLog(backend, 'run', (e) => errors.push(e));
    first.begin(world, null);
    otherTab.begin(world, 'auto');
    const next = after(world, (w) => { w.player.money += 10; });
    first.note(next);
    first.note(next);
    await Promise.all([first.flush(), otherTab.flush()]);
    const second = new RunLog(backend, 'run', (e) => errors.push(e));
    second.begin(world, 'slot1');
    await second.flush();

    const records = await backend.readLog('run');

    expect(records.map((r) => r.seq)).toEqual(records.map((_, i) => i));
    expect(records.map((r) => r.kind)).toEqual(['start', 'day', 'loaded', 'day', 'change', 'loaded', 'day']);
    expect(records[5]).toMatchObject({ slot: 'slot1', turn: 400 });
    expect(errors).toEqual([]);
  });

  it('logs the change of a world that shares the events of the last one, without its events again', async () => {
    const backend = memoryBackend();
    const world = start();
    const log = new RunLog(backend, 'run', () => {});
    log.begin(world, null);
    const turn = after(world, (w) => { w.events.push({ t: 'skillUp', skill: 'driving', level: 2 }); });
    log.note(turn);
    log.note({ ...turn, player: { ...turn.player, money: turn.player.money + 25 } });
    await log.flush();

    const kinds = (await backend.readLog('run')).map((r) => r.event ?? r.kind);

    expect(kinds).toEqual(['start', 'day', 'skillUp', 'change']);
  });

  it('exports JSON Lines with the header first', async () => {
    const log = new RunLog(memoryBackend(), 'run', () => {});
    log.begin(start(), null);
    await log.flush();

    const lines = (await log.lines({ kind: 'header', runId: 'run' })).trim().split('\n').map((l) => JSON.parse(l));

    expect(lines.map((l) => l.kind)).toEqual(['header', 'start', 'day']);
  });

  it('sends a refused write to onError', async () => {
    const errors: unknown[] = [];
    const refusing = { ...memoryBackend(), appendLog: () => Promise.reject(new Error('Quota exceeded')) };
    const log = new RunLog(refusing, 'run', (e) => errors.push(e));
    log.begin(start(), null);
    await log.flush();
    expect(errors.map((e) => (e as Error).message)).toEqual(['Quota exceeded']);
  });
});
