import { describe, expect, it } from 'vitest';
import { partDef, type UtilityDef } from '../data/parts';
import { HARPOON } from '../data/utilities';
import { fightsAgainst, hitOdds } from './combat';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { deploySmoke } from './hazards';
import { endLines, lineAnchors, tearLine } from './harpoon';
import { addVehicle, emptyWorld } from './testkit';
import type { GameEvent, PartInstance, UtilityOrder, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects, harpoonWait, tickCharges, utilityOrderError, wornReload } from './utility';
import { setUtilityOrder } from './world';

// The player facing east with a harpoon on its deck, and a trader hauler `gap` tiles east of it, broadside.
function duel(gap = 5): { w: World; me: Vehicle; part: PartInstance; trader: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  me.heading = 0;
  const part = makePart(w, 'harpoon', 0);
  if (!mountPart(w, me, part)) throw new Error('No deck room for the harpoon');
  const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: me.pos.x + gap, y: me.pos.y }, Math.PI / 2);
  return { w, me, part, trader };
}

function shotOf(w: World): Extract<GameEvent, { t: 'shot' }> {
  const shots = w.events.filter((e): e is Extract<GameEvent, { t: 'shot' }> => e.t === 'shot');
  if (shots.length !== 1) throw new Error(`Expected one shot, got ${shots.length}`);
  return shots[0];
}

// Fires the harpoon from the given random state, as the activation step does.
function fire(rngState: number, gap?: number): ReturnType<typeof duel> {
  const s = duel(gap);
  s.w.rngState = rngState;
  s.w.events = [];
  s.me.utilityOrders[s.part.id] = { kind: 'truck', targetId: s.trader.id, aim: 'body' };
  activateUtilities(s.w);
  return s;
}

// The first random state whose shot ends as wanted. The rolls are seeded, so the search is deterministic.
function firstFire(wanted: (s: ReturnType<typeof duel>) => boolean, gap?: number): ReturnType<typeof duel> {
  for (let seed = 1; seed < 2000; seed++) {
    const s = fire(seed, gap);
    if (wanted(s)) return s;
  }
  throw new Error('No seed gave the wanted shot');
}

const hit = (gap?: number) => firstFire((s) => s.w.lines.length === 1, gap);
const miss = (gap?: number) => firstFire((s) => shotOf(s.w).rounds[0].struck === null, gap);

describe('firing the harpoon', () => {
  it('starts the reload on a miss and makes no line', () => {
    const { w, part } = miss(8);

    expect(w.lines).toEqual([]);
    expect(part.charge).toEqual({ reload: wornReload(part) });
    expect(shotOf(w).rounds).toHaveLength(1);
  });

  it('clears its order on a miss', () => {
    const { me } = miss(8);

    expect(me.utilityOrders).toEqual({});
  });

  it('attaches the line to the first part the round touches in its lane', () => {
    const { w, me, part, trader } = hit();
    const round = shotOf(w).rounds[0];

    expect(round.struck).toBe(trader.id);
    expect(w.lines).toEqual([
      { id: w.lines[0].id, from: me.id, fromPart: part.id, to: trader.id, toPart: round.hits[0].part, length: w.lines[0].length, turnsLeft: 3 },
    ]);
    expect(part.charge).toEqual({ reload: wornReload(part) });
    expect(trader.lastHitBy).toBe(me.id);
  });

  it('sets the line length to the anchor distance in meters at the hit', () => {
    const { w } = hit();
    const [anchor] = lineAnchors(w);

    // 5 tiles of 4 m between the centers, less the reach of the two anchors toward each other.
    expect(w.lines[0].length).toBeGreaterThan(10);
    expect(w.lines[0].length).toBeLessThan(20);
    expect(anchor.length).toBe(w.lines[0].length);
  });

  it('is a hostile act, hit or miss', () => {
    for (const s of [hit(), miss(8)]) {
      expect(fightsAgainst(s.w, s.me, s.trader)).toBe(true);
    }
  });

  it('takes a target past its range or behind it, and waits on it', () => {
    const far = duel(9);
    const behind = duel(-5);

    expect(utilityOrderError(far.w, far.me, far.part.id, { kind: 'truck', targetId: far.trader.id, aim: 'body' })).toBeNull();
    expect(utilityOrderError(behind.w, behind.me, behind.part.id, { kind: 'truck', targetId: behind.trader.id, aim: 'body' })).toBeNull();
    expect(harpoonWait(far.w, far.me, far.part, far.trader)).toBe('range');
    expect(harpoonWait(behind.w, behind.me, behind.part, behind.trader)).toBe('arc');
  });

  it('takes a target while it recharges, and waits on the charge', () => {
    const { w, me, part, trader } = duel();
    part.charge = { reload: 2 };

    expect(utilityOrderError(w, me, part.id, { kind: 'truck', targetId: trader.id, aim: 'body' })).toBeNull();
    expect(harpoonWait(w, me, part, trader)).toBe('cooldown');
  });

  it('refuses a target it does not see, itself, a missing aim part, and a broken harpoon', () => {
    const unseen = duel(80);
    const s = duel();
    const order = { kind: 'truck' as const, targetId: s.trader.id, aim: 'body' as const };

    expect(utilityOrderError(unseen.w, unseen.me, unseen.part.id, { ...order, targetId: unseen.trader.id })).toMatch(/unseen/);
    expect(utilityOrderError(s.w, s.me, s.part.id, { ...order, targetId: s.me.id })).toMatch(/Bad target/);
    expect(utilityOrderError(s.w, s.me, s.part.id, { ...order, aim: 'p-none' })).toMatch(/no part p-none/);
    s.part.hp = 0;
    expect(utilityOrderError(s.w, s.me, s.part.id, order)).toMatch(/disabled/);
  });

  it('has lower odds through smoke', () => {
    const { w, me, trader } = duel();
    const harpoon = { def: partDef('harpoon') as UtilityDef };
    const clear = hitOdds(w, me, harpoon, trader, 'body');

    deploySmoke(w, me, trader.pos, 2, 3);
    const smoky = hitOdds(w, me, harpoon, trader, 'body');

    expect(smoky.causes.smoke).toBeGreaterThan(0);
    expect(smoky.chance).toBeLessThan(clear.chance);
  });
});

// A truck order on the trader, given straight to the truck, as the order commands leave it.
function order(s: ReturnType<typeof duel>): UtilityOrder {
  const given = { kind: 'truck' as const, targetId: s.trader.id, aim: 'body' as const };
  s.me.utilityOrders[s.part.id] = given;
  return given;
}

function shots(w: World): GameEvent[] {
  return w.events.filter((e) => e.t === 'shot');
}

describe('the standing order', () => {
  it('waits on a target 12 tiles away, then fires on the turn it comes within 8', () => {
    const s = duel(12);
    const given = order(s);
    s.w.events = [];

    activateUtilities(s.w);
    expect(s.me.utilityOrders).toEqual({ [s.part.id]: given });
    expect(shots(s.w)).toEqual([]);
    expect(s.part.charge).toEqual({ reload: 0 });

    s.trader.pos.x = s.me.pos.x + 7;
    activateUtilities(s.w);
    expect(shots(s.w)).toHaveLength(1);
    expect(s.me.utilityOrders).toEqual({});
    expect(s.part.charge).toEqual({ reload: wornReload(s.part) });
  });

  it('given while recharging, fires on the turn the charge is ready', () => {
    const s = duel();
    s.part.charge = { reload: 2 };
    order(s);
    s.w.events = [];

    activateUtilities(s.w);
    tickCharges(s.w);
    expect(shots(s.w)).toEqual([]);
    expect(s.part.charge).toEqual({ reload: 1 });

    activateUtilities(s.w);
    tickCharges(s.w);
    expect(shots(s.w)).toEqual([]);
    expect(s.part.charge).toEqual({ reload: 0 });

    activateUtilities(s.w);
    expect(shots(s.w)).toHaveLength(1);
    expect(s.me.utilityOrders).toEqual({});
  });

  it('waits on a target out of its arc', () => {
    const s = duel(-5);
    const given = order(s);
    s.w.events = [];

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({ [s.part.id]: given });
    expect(shots(s.w)).toEqual([]);
  });

  it('waits on a target it no longer sees', () => {
    const s = duel(80);
    const given = order(s);
    s.w.events = [];

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({ [s.part.id]: given });
    expect(shots(s.w)).toEqual([]);
  });

  it('drops the order when the target is knocked out', () => {
    const s = duel();
    order(s);
    s.trader.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: false };
    s.w.events = [];

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({});
    expect(shots(s.w)).toEqual([]);
    expect(s.part.charge).toEqual({ reload: 0 });
  });

  it('drops the order when the target leaves the world', () => {
    const s = duel(12);
    order(s);
    s.w.vehicles = s.w.vehicles.filter((v) => v.id !== s.trader.id);

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({});
    expect(s.part.charge).toEqual({ reload: 0 });
  });

  it('drops the order when the harpoon breaks', () => {
    const s = duel(12);
    order(s);
    s.part.hp = 0;

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({});
  });

  it('drops the order when the harpoon leaves the truck', () => {
    const s = duel(12);
    order(s);
    s.me.items = s.me.items.filter((it) => it.kind !== 'part' || it.part.id !== s.part.id);

    activateUtilities(s.w);

    expect(s.me.utilityOrders).toEqual({});
  });

  it('a second order replaces the first', () => {
    const s = duel(12);
    const other = addVehicle(s.w, 'traders', 'hauler', ['stockEngine'], { x: s.me.pos.x + 6, y: s.me.pos.y + 2 }, Math.PI / 2);

    const first = setUtilityOrder(s.w, s.part.id, { kind: 'truck', targetId: s.trader.id, aim: 'body' });
    const second = setUtilityOrder(first, s.part.id, { kind: 'truck', targetId: other.id, aim: 'body' });

    expect(second.vehicles[0].utilityOrders).toEqual({ [s.part.id]: { kind: 'truck', targetId: other.id, aim: 'body' } });
  });

  it('starts its line in the turn it fires, and the line lasts 3 turns from then', () => {
    const fired = (seed: number): ReturnType<typeof duel> => {
      const s = duel(12);
      order(s);
      activateUtilities(s.w);
      advanceUtilityEffects(s.w);
      s.trader.pos.x = s.me.pos.x + 5;
      s.w.rngState = seed;
      activateUtilities(s.w);
      return s;
    };
    const seed = Array.from({ length: 2000 }, (_, i) => i + 1).find((n) => fired(n).w.lines.length === 1);
    if (seed === undefined) throw new Error('No seed gave a hit');
    const { w } = fired(seed);

    expect(w.lines[0].turnsLeft).toBe(3);
    advanceUtilityEffects(w);
    advanceUtilityEffects(w);
    expect(w.lines).toHaveLength(1);
    advanceUtilityEffects(w);
    expect(w.lines).toEqual([]);
  });
});

describe('the harpoon line', () => {
  it('lasts 3 turns', () => {
    const { w } = hit();

    advanceUtilityEffects(w);
    advanceUtilityEffects(w);
    expect(w.lines).toHaveLength(1);

    advanceUtilityEffects(w);
    expect(w.lines).toEqual([]);
  });

  it('ends when the anchor part leaves its truck', () => {
    const { w, trader } = hit();
    const toPart = w.lines[0].toPart;
    trader.items = trader.items.filter((it) => it.kind !== 'part' || it.part.id !== toPart);

    expect(lineAnchors(w)).toEqual([]);
    endLines(w);

    expect(w.lines).toEqual([]);
  });

  it('ends when the harpoon breaks', () => {
    const { w, part } = hit();
    part.hp = 0;

    endLines(w);

    expect(w.lines).toEqual([]);
  });

  it('a tear damages the held part once and ends the line', () => {
    const { w, trader } = hit();
    const line = w.lines[0];
    const held = trader.items.flatMap((it) => (it.kind === 'part' && it.part.id === line.toPart ? [it.part] : []))[0];
    held.hp = 30;
    w.events = [];

    tearLine(w, line.id);

    expect(held.hp).toBe(30 - HARPOON.tearDamage);
    expect(w.lines).toEqual([]);
    expect(w.events).toContainEqual({ t: 'lineTorn', line: line.id, vehicle: trader.id, part: line.toPart, damage: HARPOON.tearDamage });
    expect(() => tearLine(w, line.id)).toThrow(/no line/);
  });
});
