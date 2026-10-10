import { describe, expect, it } from 'vitest';
import { CRATER } from '../data/rules';
import { PHYSICS } from '../data/physics';
import { TIME } from '../data/time';
import { DECKS } from './bridge';
import { craterRimPoints, digCrater, fadeCraters } from './craters';
import { fireBlock, fireWeapons } from './combat';
import { vehicleStats } from './stats';
import { cloneWorld } from './world';
import { gunFor } from './factory';
import { mountedParts } from './grid';
import { addVehicle, editableTerrain, emptyWorld, npcBrain } from './testkit';
import { tileAt } from './terrain';
import type { ShotRound, Vehicle, World } from './types';
import { dist, type Vec } from './vec';

const M = PHYSICS.metersPerTile;

function gunnery(gun: string, range: number): { w: World; me: Vehicle; target: Vehicle } {
  const w = emptyWorld();
  editableTerrain(w).types.fill('sand');
  const old = w.vehicles[0];
  const me = addVehicle(w, 'player', 'hauler', ['stockEngine', gun], old.pos, old.heading);
  me.id = old.id;
  w.vehicles = [me, ...w.vehicles.slice(1, -1)];
  const target = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: old.pos.x + range, y: old.pos.y }, Math.PI / 2);
  target.brain = npcBrain('buggy', target.pos, ['raider']);
  const part = mountedParts(me, 'weapon')[0];
  me.weaponOrders[part.id] = { targetId: target.id, aim: 'body' };
  for (let quarter = 0; quarter < 4 && fireBlock(w, me, vehicleStats(w, me).weapons[0], target) !== null; quarter++) me.heading = (quarter * Math.PI) / 2;
  return { w, me, target };
}

function fireUntil(w: World, me: Vehicle, want: (rounds: ShotRound[]) => boolean): ShotRound[] {
  for (let i = 0; i < 200; i++) {
    const rounds = fireOnce(w, me);
    if (want(rounds)) return rounds;
  }
  throw new Error('No shot matched in 200 turns');
}

function fireOnce(w: World, me: Vehicle): ShotRound[] {
  for (const p of mountedParts(me, 'weapon')) Object.assign(p, gunFor(p.defId));
  w.events = [];
  w.craters = [];
  fireWeapons(w);
  const shot = w.events.find((e) => e.t === 'shot');
  if (shot?.t !== 'shot') throw new Error('The gun did not fire');
  return shot.rounds;
}

function turnBeforeGroundMiss(w: World, me: Vehicle): World {
  for (let i = 0; i < 200; i++) {
    const before = cloneWorld(w);
    if (fireOnce(w, me).some(groundMiss)) return before;
  }
  throw new Error('No ground miss in 200 turns');
}

const groundMiss = (r: ShotRound) => r.struck === null;

describe('craters from rounds', () => {
  it('a grenade that misses onto sand digs a 0.9 m crater at its burst point', () => {
    const { w, me } = gunnery('grenadeLauncher', 9);
    const rounds = fireUntil(w, me, (rs) => rs.some(groundMiss));
    const bursts = rounds.filter(groundMiss).map((r) => r.burst);
    expect(bursts.every((b) => b !== null)).toBe(true);
    expect(w.craters.length).toBeGreaterThan(0);
    for (const c of w.craters) {
      expect(c.radius).toBe(0.9);
      expect(bursts).toContainEqual(c.pos);
    }
    for (const b of bursts) expect(w.craters.some((c) => b !== null && dist(c.pos, b) * M <= c.radius)).toBe(true);
  });

  it('a round that strikes a truck digs none and has no burst point', () => {
    const { w, me } = gunnery('grenadeLauncher', 3);
    const rounds = fireUntil(w, me, (rs) => rs.every((r) => r.struck !== null));
    expect(rounds.map((r) => r.burst)).toEqual(rounds.map(() => null));
    expect(w.craters).toEqual([]);
  });

  it('a flamer miss digs none', () => {
    const { w, me } = gunnery('flamer', 4);
    const rounds = fireUntil(w, me, (rs) => rs.some(groundMiss));
    expect(rounds.filter(groundMiss).every((r) => r.burst !== null)).toBe(true);
    expect(w.craters).toEqual([]);
  });

  it('an mg miss has no burst point and digs none', () => {
    const { w, me } = gunnery('mg', 9);
    const rounds = fireUntil(w, me, (rs) => rs.some(groundMiss));
    expect(rounds.filter(groundMiss).map((r) => r.burst)).toEqual(rounds.filter(groundMiss).map(() => null));
    expect(w.craters).toEqual([]);
  });

  it('a volley that digs plays out as one on ground that takes no craters', () => {
    const { w, me } = gunnery('grenadeLauncher', 9);
    const before = turnBeforeGroundMiss(w, me);
    const water = cloneWorld(before);
    editableTerrain(water).types.fill('dirtyWater');
    const [dug, wet] = [before, water].map((x) => {
      fireOnce(x, x.vehicles[0]);
      return x;
    });
    expect(dug.craters.length).toBeGreaterThan(0);
    expect(wet.craters).toEqual([]);
    expect({ ...wet, craters: dug.craters, terrain: dug.terrain }).toEqual(dug);
  });
});

describe('digCrater', () => {
  const at: Vec = { x: 40.5, y: 40.5 };

  it('digs no crater on a deck', () => {
    const w = emptyWorld();
    const deck = DECKS[0];
    const mid = { x: (deck.from.x + deck.to.x) / 2, y: (deck.from.y + deck.to.y) / 2 };
    digCrater(w, mid, 1);
    expect(w.craters).toEqual([]);
  });

  it('digs no crater on dirty water or in a canal', () => {
    const w = emptyWorld();
    const types = editableTerrain(w).types;
    types[tileAt(w.terrain, at)] = 'dirtyWater';
    const canal = { x: at.x + 5, y: at.y };
    types[tileAt(w.terrain, canal)] = 'canal';
    digCrater(w, at, 1);
    digCrater(w, canal, 1);
    expect(w.craters).toEqual([]);
  });

  it('digs a crater on road', () => {
    const w = emptyWorld();
    w.turn = 7;
    digCrater(w, at, 1.2);
    expect(w.craters).toEqual([{ id: 'crater-7-0', pos: at, radius: 1.2, turn: 7 }]);
  });

  it('a crater centred inside another replaces it with the larger radius and the new turn', () => {
    const w = emptyWorld();
    w.turn = 3;
    digCrater(w, at, 1.5);
    w.turn = 9;
    digCrater(w, { x: at.x + 0.5 / M, y: at.y }, 0.9);
    expect(w.craters).toEqual([{ id: 'crater-9-0', pos: at, radius: 1.5, turn: 9 }]);
  });

  it('craters dug apart in one turn get unique ids', () => {
    const w = emptyWorld();
    w.turn = 4;
    digCrater(w, at, 1);
    digCrater(w, { x: at.x + 2, y: at.y }, 1);
    digCrater(w, { x: at.x + 0.1, y: at.y }, 1);
    digCrater(w, { x: at.x + 4, y: at.y }, 1);
    const ids = w.craters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it('a big crater swallows every crater whose centre it covers', () => {
    const w = emptyWorld();
    digCrater(w, at, 0.9);
    digCrater(w, { x: at.x + 1.5 / M, y: at.y }, 0.9);
    digCrater(w, { x: at.x + 0.75 / M, y: at.y }, 3);
    expect(w.craters.map((c) => c.radius)).toEqual([3]);
  });

  it('uses no world randomness and no ids', () => {
    const w = emptyWorld();
    const before = { rng: w.rngState, market: structuredClone(w.marketRng), name: structuredClone(w.nameRng), nextId: w.nextId };
    digCrater(w, at, 1);
    digCrater(w, { x: at.x + 0.1, y: at.y }, 1.5);
    expect({ rng: w.rngState, market: w.marketRng, name: w.nameRng, nextId: w.nextId }).toEqual(before);
  });
});

describe('fadeCraters', () => {
  const days = CRATER.days * TIME.turnsPerDay;

  function dug(): { w: World; at: Vec } {
    const w = emptyWorld({ x: 30, y: 30 });
    const at = { x: 33, y: 30 };
    w.turn = 0;
    digCrater(w, at, 1.2);
    return { w, at };
  }

  it('keeps a crater before its days have passed, even out of view', () => {
    const { w } = dug();
    w.turn = days - 1;
    w.vehicles[0].pos = { x: 90, y: 90 };
    fadeCraters(w);
    expect(w.craters).toHaveLength(1);
  });

  it('keeps an old crater in the player gray vision', () => {
    const { w } = dug();
    w.turn = days;
    fadeCraters(w);
    expect(w.craters).toHaveLength(1);
  });

  it('keeps an old crater under a truck', () => {
    const { w, at } = dug();
    w.turn = days;
    w.vehicles[0].pos = { x: 90, y: 90 };
    addVehicle(w, 'traders', 'hauler', ['stockEngine'], at);
    fadeCraters(w);
    expect(w.craters).toHaveLength(1);
  });

  it('removes an old crater once out of view and clear of trucks', () => {
    const { w } = dug();
    w.turn = days;
    w.vehicles[0].pos = { x: 90, y: 90 };
    fadeCraters(w);
    expect(w.craters).toEqual([]);
  });
});

describe('craterRimPoints', () => {
  it('rings the crater with one point per rim segment, raggedly inside its radius and within its reach', () => {
    const c = { id: 'crater-0-0', pos: { x: 10, y: 10 }, radius: 1.2, turn: 0 };
    const pts = craterRimPoints(c);
    const radii = pts.map((p) => dist(p, c.pos) * M);
    expect(pts).toHaveLength(CRATER.rimSegments);
    for (const r of radii) {
      expect(r).toBeLessThanOrEqual(1.2);
      expect(r).toBeGreaterThanOrEqual(1.2 * (1 - CRATER.rimJitter));
    }
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
  });

  it('gives the same rim to the same crater every time', () => {
    const c = { id: 'crater-0-0', pos: { x: 31.4, y: 7.25 }, radius: 0.9, turn: 3 };
    expect(craterRimPoints({ ...c })).toEqual(craterRimPoints(c));
  });
});
