import { describe, expect, it } from 'vitest';
import { partDef, type WeaponDef } from '../data/parts';
import { PHYSICS } from '../data/physics';
import { HARPOON } from '../data/utilities';
import { fightsAgainst, fireBlock, fireWeapons, gunOf, hitOdds } from './combat';
import { vehicleStats } from './stats';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { deploySmoke } from './hazards';
import { endLines, lineAnchors, tearLine } from './harpoon';
import { addVehicle, emptyWorld } from './testkit';
import type { GameEvent, PartInstance, Vehicle, World } from './types';
import { advanceUtilityEffects } from './utility';
import { cutPlayerLine } from './world';

// The player facing west with a harpoon on its deck, and a trader hauler `gap` tiles east of it, broadside. The
// truck's machine gun covers the front, so auto-mount turns the harpoon to face the rear, toward the trader.
function duel(gap = 5): { w: World; me: Vehicle; part: PartInstance; trader: Vehicle } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  me.heading = Math.PI;
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

// Fires the harpoon from the given random state, as the fire phase does.
function fire(rngState: number, gap?: number): ReturnType<typeof duel> {
  const s = duel(gap);
  s.w.rngState = rngState;
  s.w.events = [];
  s.me.weaponOrders[s.part.id] = { targetId: s.trader.id, aim: 'body' };
  fireWeapons(s.w);
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
  it('is a gun with a one-round magazine, a five-turn reload and a ten-turn line', () => {
    const def = partDef('harpoon') as WeaponDef;

    expect(def.kind).toBe('weapon');
    expect({ magazine: def.magazine, reload: def.reload, line: def.line }).toEqual({ magazine: 1, reload: 5, line: { turns: 10 } });
  });

  it('empties its magazine on a miss and makes no line', () => {
    const { w, part } = miss(8);

    expect(w.lines).toEqual([]);
    expect(gunOf(part).ammo).toBe(0);
    expect(shotOf(w).rounds).toHaveLength(1);
  });

  it('attaches the line to the first part the round touches in its lane', () => {
    const { w, me, part, trader } = hit();
    const round = shotOf(w).rounds[0];

    expect(round.struck).toBe(trader.id);
    expect(w.lines).toEqual([
      { id: w.lines[0].id, from: me.id, fromPart: part.id, to: trader.id, toPart: round.hits[0].part, length: w.lines[0].length, turnsLeft: 10 },
    ]);
    expect(gunOf(part).ammo).toBe(0);
    expect(trader.lastHitBy).toBe(me.id);
  });

  it('ties a line on every round that strikes the target, through empty lanes too', () => {
    let struck = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = fire(seed);
      if (shotOf(s.w).rounds[0].struck !== s.trader.id) continue;
      struck++;
      expect(s.w.lines, `seed ${seed}`).toHaveLength(1);
    }
    expect(struck).toBeGreaterThan(200);
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

  it('keeps its target through the reload and fires again on the turn the round is back', () => {
    const s = miss(8);
    s.w.events = [];
    const turns: number[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      s.w.events = [];
      fireWeapons(s.w);
      if (s.w.events.some((e) => e.t === 'shot')) turns.push(turn);
    }

    expect(s.me.weaponOrders[s.part.id]).toEqual({ targetId: s.trader.id, aim: 'body' });
    expect(turns).toEqual([6]);
  });

  it('does not fire past its range or behind it', () => {
    for (const gap of [9, -5]) {
      const s = duel(gap);
      s.me.weaponOrders[s.part.id] = { targetId: s.trader.id, aim: 'body' };
      fireWeapons(s.w);
      expect(s.w.events.filter((e) => e.t === 'shot')).toEqual([]);
      expect(gunOf(s.part).ammo).toBe(1);
    }
  });

  it('has lower odds through smoke', () => {
    const { w, me, trader } = duel();
    const harpoon = { def: partDef('harpoon') as WeaponDef };
    const clear = hitOdds(w, me, harpoon, trader, 'body');

    deploySmoke(w, me, trader.pos, 2, 3);
    const smoky = hitOdds(w, me, harpoon, trader, 'body');

    expect(smoky.causes.smoke).toBeGreaterThan(0);
    expect(smoky.chance).toBeLessThan(clear.chance);
  });
});

describe('the harpoon line', () => {
  it('holds fire while its line is out, reloaded or not, and fires again once the line ends', () => {
    const s = hit();
    s.me.weaponOrders[s.part.id] = { targetId: s.trader.id, aim: 'body' };
    const fired: number[] = [];
    for (let turn = 1; turn <= 11; turn++) {
      s.w.events = [];
      advanceUtilityEffects(s.w);
      fireWeapons(s.w);
      if (s.w.events.some((e) => e.t === 'shot')) fired.push(turn);
    }

    expect(fired).toEqual([10]);
    expect(fireBlock(s.w, s.me, vehicleStats(s.w, s.me).weapons.find((m) => m.part.id === s.part.id)!, s.trader)).not.toBe('lineOut');
  });

  it('lasts 10 turns', () => {
    const { w } = hit();

    for (let turn = 1; turn <= 9; turn++) advanceUtilityEffects(w);
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

  it('ends when the shooter cuts it, with no damage to the held part, and the harpoon fires again once reloaded', () => {
    const s = hit();
    const line = s.w.lines[0];
    const held = s.trader.items.flatMap((it) => (it.kind === 'part' && it.part.id === line.toPart ? [it.part] : []))[0];
    const hp = held.hp;
    s.part.gun = { cooldown: 0, ammo: 1, reloadWork: 0 };

    const after = cutPlayerLine(s.w, s.part.id);

    expect(after.lines).toEqual([]);
    expect(after.vehicles.find((v) => v.id === s.trader.id)!.items.flatMap((it) => (it.kind === 'part' && it.part.id === line.toPart ? [it.part.hp] : []))).toEqual([hp]);
    const me = after.vehicles.find((v) => v.id === s.me.id)!;
    expect(fireBlock(after, me, vehicleStats(after, me).weapons.find((m) => m.part.id === s.part.id)!, null)).not.toBe('lineOut');
  });

  it('cannot cut a line the harpoon does not have out', () => {
    const s = duel();
    expect(() => cutPlayerLine(s.w, s.part.id)).toThrow(/no line out/);
  });

  it('pulls the shooter at its center of mass and the held truck at its body center', () => {
    const { w } = hit();
    const [anchor] = lineAnchors(w);

    expect(anchor.fromAt.y).toBe(-PHYSICS.truck.comBelow);
    expect(anchor.toAt.y).toBe(0);
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
