import { describe, expect, it } from 'vitest';
import { BASIN_DIRECTIONS, RADIO, RADIO_LINES, type RadioTopic } from '../data/radio';
import { REGION } from '../data/region';
import { GOODS } from '../data/goods';
import { PARTS } from '../data/parts';
import { TIME } from '../data/time';
import type { Contract } from '../sim/market';
import { startFeuds } from '../sim/combat';
import { addState } from '../sim/states';
import { addVehicle, emptyWorld } from '../sim/testkit';
import type { GameEvent, World } from '../sim/types';
import { cloneWorld } from '../sim/world';
import { fill, RadioStation, revealed, type Broadcast } from './radio';

const first = () => 0;
const site = (id: string) => [...REGION.towns, ...REGION.locations].find((s) => s.id === id)!;

function world(turn: number, discovered: string[] = ['bowl', 'nose']): World {
  const w = emptyWorld();
  w.turn = turn;
  w.player.discovered = [...discovered];
  for (const shop of Object.values(w.shops)) shop.contracts = [];
  w.events = [];
  return w;
}

function later(w: World, turns: number, events: GameEvent[] = []): World {
  const next = cloneWorld(w);
  next.turn += turns;
  next.events = events;
  return next;
}

function tuned(w: World): RadioStation {
  const s = new RadioStation(first);
  s.hear(w);
  expect(s.next()?.topic).toBe('ident');
  return s;
}

function haul(id: string, shop: string, to: string, reward: number): Contract {
  return { id, shop, kind: 'haul', good: 'grain', units: 4, to, reward, deadline: 9999, window: 100, rush: false, tier: 1 };
}

function heatwave(outcome: 'started' | 'ended'): GameEvent {
  return { t: 'weather', event: { id: 'wx1', kind: 'heatwave', turnsLeft: 50 }, outcome } as GameEvent;
}

function storm(pos: { x: number; y: number }, vel = { x: 1, y: 0 }): GameEvent {
  return { t: 'weather', event: { id: 'wx2', kind: 'storm', pos, vel, radius: 20, turnsLeft: 50 }, outcome: 'started' } as GameEvent;
}

function drain(s: RadioStation, w: World): Broadcast | null {
  return s.next() ?? (s.hear(later(w, RADIO.minGapTurns)), s.next());
}

describe('RadioStation', () => {
  it('plays the ident on the first world it hears', () => {
    const s = new RadioStation(first);
    s.hear(world(10));
    expect(s.next()).toMatchObject({ topic: 'ident', text: RADIO_LINES.ident[0] });
  });

  it('reports a heat wave starting', () => {
    const w = world(10);
    const s = tuned(w);
    const w2 = later(w, RADIO.minGapTurns, [heatwave('started')]);
    s.hear(w2);
    expect(s.next()).toMatchObject({ topic: 'heatwaveStart', rank: 'news' });
  });

  it('names a found place near a storm and a basin direction for an unfound one', () => {
    const granary = site('granary');
    const found = world(10, ['granary']);
    const s = tuned(found);
    s.hear(later(found, RADIO.minGapTurns, [storm({ x: granary.pos.x + 5, y: granary.pos.y })]));
    expect(s.next()?.text).toBe('Dust storm rolling near The Granary, heading east.');

    const unfound = world(10, []);
    const s2 = tuned(unfound);
    s2.hear(later(unfound, RADIO.minGapTurns, [storm({ x: granary.pos.x + 5, y: granary.pos.y }, { x: 0, y: -1 })]));
    const text = s2.next()!.text;
    expect(text).not.toContain('Granary');
    expect(BASIN_DIRECTIONS.some((d) => text.includes(d))).toBe(true);
    expect(text).toContain('heading north');
  });

  it('never announces a board that was full when it tuned in', () => {
    const w = world(10);
    w.shops.bowl.contracts = [haul('c1', 'bowl', 'nose', 100)];
    const s = tuned(w);
    s.hear(later(w, RADIO.minGapTurns));
    expect(s.next()).toBeNull();
  });

  it('announces one new haul, the best paid, and none on an unfound board or to an unfound place', () => {
    const w = world(10, ['bowl', 'nose']);
    const s = tuned(w);
    const w2 = later(w, RADIO.minGapTurns);
    w2.shops.bowl.contracts = [haul('c1', 'bowl', 'nose', 100), haul('c2', 'bowl', 'nose', 300), haul('c3', 'bowl', 'dustwell', 900)];
    w2.shops.granary.contracts = [haul('c4', 'granary', 'nose', 900)];
    s.hear(w2);
    const b = s.next()!;
    expect(b.topic).toBe('haul');
    expect(b.text).toBe('New haul posted at Bowl: grain out to Nose.');
    expect(drain(s, w2)).toBeNull();
  });

  it('re-baselines when the turn goes backwards or the seed changes', () => {
    const w = world(100);
    const s = tuned(w);
    const loaded = world(50);
    loaded.shops.bowl.contracts = [haul('c9', 'bowl', 'nose', 100)];
    s.hear(loaded);
    expect(s.next()?.topic).toBe('ident');
    s.hear(later(loaded, RADIO.minGapTurns));
    expect(s.next()).toBeNull();

    const other = world(60);
    other.seed = loaded.seed + 1;
    other.shops.bowl.contracts = [haul('c10', 'bowl', 'nose', 100)];
    s.hear(other);
    expect(s.next()?.topic).toBe('ident');
  });

  it('reports a raider robbing an NPC, never one robbing the player', () => {
    const bowl = site('bowl');
    const w = world(10);
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: bowl.pos.x + 3, y: bowl.pos.y });
    const trader = addVehicle(w, 'traders', 'buggy', [], { x: bowl.pos.x + 4, y: bowl.pos.y });
    addState(w, 'feud', raider.id, w.player.vehicleId, { kind: 'feud', robbery: true });
    addState(w, 'feud', raider.id, trader.id, { kind: 'feud', robbery: true });
    const s = tuned(w);
    s.hear(later(w, RADIO.minGapTurns, [{ t: 'hostile', vehicle: raider.id, against: w.player.vehicleId }]));
    expect(s.next()).toBeNull();
    s.hear(later(w, 2 * RADIO.minGapTurns, [{ t: 'hostile', vehicle: raider.id, against: trader.id }]));
    expect(s.next()).toMatchObject({ topic: 'raid' });
    expect(s.next()).toBeNull();
  });

  it('reports no robbery when a raider fights back, and keeps the place free for a real one', () => {
    const bowl = site('bowl');
    const w = world(10);
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: bowl.pos.x + 3, y: bowl.pos.y });
    const trader = addVehicle(w, 'traders', 'buggy', [], { x: bowl.pos.x + 4, y: bowl.pos.y });
    const s = tuned(w);
    const shot = later(w, RADIO.minGapTurns);
    startFeuds(shot, shot.vehicles.find((v) => v.id === trader.id)!, shot.vehicles.find((v) => v.id === raider.id)!);
    expect(shot.events).toContainEqual({ t: 'hostile', vehicle: raider.id, against: trader.id });
    s.hear(shot);
    expect(s.next()).toBeNull();

    const robbed = later(shot, RADIO.minGapTurns, [{ t: 'hostile', vehicle: raider.id, against: trader.id }]);
    addState(robbed, 'feud', raider.id, trader.id, { kind: 'feud', robbery: true });
    s.hear(robbed);
    expect(s.next()).toMatchObject({ topic: 'raid' });
  });

  it('reports a raider knockout once per place per cooldown', () => {
    const bowl = site('bowl');
    const w = world(10);
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: bowl.pos.x + 3, y: bowl.pos.y });
    const trader = addVehicle(w, 'traders', 'buggy', [], { x: bowl.pos.x + 4, y: bowl.pos.y });
    const s = tuned(w);
    const ko: GameEvent = { t: 'npcKnockout', vehicle: trader.id, by: raider.id };
    s.hear(later(w, RADIO.minGapTurns, [ko]));
    expect(s.next()?.text).toContain('near Bowl');
    s.hear(later(w, 2 * RADIO.minGapTurns, [ko]));
    expect(s.next()).toBeNull();
    s.hear(later(w, RADIO.minGapTurns + RADIO.placeCooldownTurns + 1, [ko]));
    expect(s.next()?.topic).toBe('raidKnockout');
  });

  it('keeps the gap between broadcasts and caps the queue', () => {
    const w = world(10);
    const s = tuned(w);
    s.hear(later(w, 1, [heatwave('started'), storm({ x: 300, y: 300 })]));
    expect(s.next()).toBeNull();
    for (let i = 0; i < 5; i++) s.hear(later(w, 2 + i, [heatwave('ended')]));
    expect(s.queued).toBe(RADIO.queueCap);
    s.hear(later(w, RADIO.minGapTurns));
    expect(s.next()).not.toBeNull();
    expect(s.next()).toBeNull();
  });

  it('varies the gap and never dumps a backlog in one turn', () => {
    const values = [0, 0.99, 0, 0, 0, 0.99];
    const s = new RadioStation(() => values.shift() ?? 0);
    const w = world(1);
    s.hear(w);
    expect(s.next()?.topic).toBe('ident');
    const queued = later(w, RADIO.minGapTurns, [heatwave('started'), heatwave('ended')]);
    s.hear(queued);
    expect(s.queued).toBe(2);
    expect(s.next()).toBeNull();
    s.hear(later(queued, RADIO.gapJitterTurns - 1));
    expect(s.next()).toBeNull();
    s.hear(later(queued, RADIO.gapJitterTurns));
    expect(s.next()?.rank).toBe('news');
    expect(s.next()).toBeNull();
    s.hear(later(queued, RADIO.gapJitterTurns + RADIO.minGapTurns));
    expect(s.next()).toBeNull();
    expect(s.queued).toBe(0);
  });

  it('resets its randomized schedule on a new game', () => {
    const s = new RadioStation(() => 0.99);
    const w = world(100);
    s.hear(w);
    expect(s.next()?.topic).toBe('ident');
    const fresh = world(2);
    s.hear(fresh);
    expect(s.next()?.topic).toBe('ident');
  });

  it('drops stale news', () => {
    const w = world(10);
    const s = tuned(w);
    s.hear(later(w, 1, [heatwave('started')]));
    s.hear(later(w, 2 + RADIO.staleTurns));
    expect(s.next()).toBeNull();
  });

  it('fills a quiet stretch with road wisdom', () => {
    const w = world(1);
    const s = new RadioStation(() => 0.99);
    s.hear(w);
    expect(s.next()?.topic).toBe('ident');
    s.hear(later(w, RADIO.idleTurns - 1));
    expect(s.next()).toBeNull();
    s.hear(later(w, RADIO.idleTurns));
    expect(s.next()).toMatchObject({ topic: 'wisdom', rank: 'filler' });
  });

  it('calls the dawn when the clock crosses sunrise', () => {
    const perHour = TIME.turnsPerDay / 24;
    const before = Math.round(1 + (24 - TIME.startHour + TIME.sunrise - 0.5) * perHour);
    const w = world(before);
    const s = tuned(w);
    s.hear(later(w, Math.ceil(perHour)));
    expect(s.next()).toBeNull();
    s.hear(later(w, RADIO.minGapTurns));
    expect(s.next()).toMatchObject({ topic: 'dawn', rank: 'time' });
  });
});

describe('RADIO_LINES', () => {
  const longest = (names: string[]) => names.reduce((a, b) => (b.length > a.length ? b : a));
  const sites = [...REGION.towns, ...REGION.locations].map((s) => s.name);
  const vars = {
    place: longest([...sites.map((n) => `near ${n}`), ...BASIN_DIRECTIONS]),
    heading: 'northwest',
    shop: longest(sites),
    to: longest(sites),
    good: longest(Object.values(GOODS).map((g) => g.name.toLowerCase())),
    part: longest(Object.values(PARTS).map((p) => p.name)),
    target: 'Bartholomew Cartwright-Ash',
  };
  const lines = Object.entries(RADIO_LINES).flatMap(([topic, list]) => list.map((t) => ({ topic: topic as RadioTopic, text: fill(t, vars) })));

  it('holds at least 15 lines', () => {
    expect(lines.length).toBeGreaterThanOrEqual(15);
  });

  it.each(lines)('$topic fits the screen and stays in character: $text', ({ text }) => {
    expect(text.length).toBeLessThanOrEqual(RADIO.maxChars);
    expect(text).not.toContain('{');
    for (const word of RADIO.banned) expect(text).not.toMatch(new RegExp(`\\b${word}`, 'i'));
  });

  it('fails loud on an unknown slot', () => {
    expect(() => fill('{nope}', {})).toThrow();
  });
});

describe('revealed', () => {
  it('types the text out over real time and stops at the end', () => {
    expect(revealed('ROAD MACHINERS', 0, 10)).toBe('');
    expect(revealed('ROAD MACHINERS', 450, 10)).toBe('ROAD');
    expect(revealed('ROAD MACHINERS', 60_000, 10)).toBe('ROAD MACHINERS');
  });
});
