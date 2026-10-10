import { describe, expect, it } from 'vitest';
import { ramValue } from './crash-contact';
import { afterTurn, exposure, fightOrder, fightPoint, leadOf, scorePoint, noteTarget, perceivedTarget, planNpcOrders } from './ai';
import { mountedParts, sideOf, type SideLetter } from './grid';
import { decide } from './npc-decisions';
import { thinkNpc } from './npc-activities';
import { chooseOn } from './tracks';
import { PARTS } from '../data/parts';
import { RULES } from '../data/rules';
import { dist } from './vec';
import { bodyHitChance, inArc } from './combat';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { makePart } from './factory';
import { mountPart } from './inventory';
import type { Vehicle, World } from './types';
import { angleDiff, bearing, type Vec } from './vec';

function fighter(w: World, templateId: string, parts: string[], pos: Vec, chassis = 'hauler'): Vehicle {
  const v = addVehicle(w, 'raiders', chassis, parts, pos, 0);
  v.brain = npcBrain(templateId, pos, ['raider']);
  return v;
}

function bearsFrom(w: World, v: Vehicle, target: Vehicle, p: Vec): boolean {
  const me = afterTurn(w, v, p);
  return vehicleStats(w, v).weapons.every((mw) => inArc(me, mw, target));
}

function inReachAfter(w: World, v: Vehicle, target: Vehicle, p: Vec): boolean {
  const me = afterTurn(w, v, p);
  return vehicleStats(w, v).weapons.some((mw) => dist(me.pos, target.pos) <= mw.def.range && inArc(me, mw, target));
}

const CLEAR = 3;

describe('fight driving', () => {
  it('closes in on a target that cannot shoot back, where its rounds land more often', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 30, y: 30 });
    v.speed = 6;
    const range = vehicleStats(w, v).weapons[0].def.range;
    expect(dist(fightPoint(w, v, me, CLEAR), me.pos)).toBeLessThan(range / 2);
  });

  it('a forward-gun fighter inside its range picks a point it can shoot from, not the one straight back', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'cannon'], { x: 40, y: 27 });
    expect(bearsFrom(w, v, me, { x: 40, y: 24 })).toBe(false);
    const p = fightPoint(w, v, me, CLEAR);
    expect(bearsFrom(w, v, me, p)).toBe(true);
  });

  it('scores a spot facing the target\'s bare side above one facing its plates', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const target = addVehicle(w, 'player', 'hauler', ['stockEngine'], { x: 40, y: 30 }, 0);
    target.id = w.vehicles[0].id;
    w.vehicles = [target, ...w.vehicles.slice(1, -1)];
    while (mountPart(w, target, makePart(w, 'plates', 0), ['F']));
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 40, y: 37 });
    v.speed = 6;
    const ahead = { x: 46, y: 30 };
    const behind = { x: 34, y: 30 };
    expect(scorePoint(w, v, target, target.pos, behind, 0)).toBeGreaterThan(scorePoint(w, v, target, target.pos, ahead, 0));
  });

  it('keeps out of the target\'s forward cannon arc', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const gun = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], me.pos, 0);
    gun.id = me.id;
    w.vehicles = [gun, ...w.vehicles.slice(1, -1)];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 45, y: 30 });
    v.speed = 4;
    const next = afterTurn(w, v, fightPoint(w, v, gun, CLEAR));
    expect(Math.abs(angleDiff(gun.heading, bearing(gun.pos, next.pos)))).toBeGreaterThan(Math.PI / 6);
  });

  it('a light fighter leaves the ram path of a much heavier target', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const heavy = addVehicle(w, 'player', 'hauler', ['stockEngine', 'mg', 'plowRam'], { x: 40, y: 30 }, 0);
    heavy.id = w.vehicles[0].id;
    heavy.speed = 4;
    w.vehicles = [heavy, ...w.vehicles.slice(1, -1)];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 46, y: 30 }, 'buggy');
    v.speed = 1;
    const next = afterTurn(w, v, fightPoint(w, v, heavy, CLEAR));
    expect(ramValue(w, { ...heavy, pos: leadOf(heavy) }, next)).toBe(0);
  });

  it('a fighter that rams readily scores a spot that lines its ram up higher than one that does not', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    me.speed = 0;
    const raider = fighter(w, 'gunwagon', ['stockEngine', 'mg', 'plowRam'], { x: 47, y: 30 });
    raider.heading = Math.PI;
    raider.speed = 4;
    const trader = fighter(w, 'trader', ['stockEngine', 'mg', 'plowRam'], { x: 47, y: 30 });
    trader.heading = Math.PI;
    trader.speed = 4;
    trader.brain!.traits = ['trader'];
    const lined = { x: 45, y: 30 };
    expect(scorePoint(w, raider, me, me.pos, lined, 0)).toBeGreaterThan(scorePoint(w, trader, me, me.pos, lined, 0));
  });

  it('a circling fighter picks a point ahead around the target in its direction', () => {
    for (const turn of [1, -1] as const) {
      const w = emptyWorld({ x: 40, y: 30 });
      const me = w.vehicles[0];
      const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
      v.brain!.fightTurn = turn;
      const p = fightPoint(w, v, me, CLEAR);
      expect(turn * angleDiff(bearing(me.pos, v.pos), bearing(me.pos, p))).toBeGreaterThan(0);
    }
  });

  it('a holding fighter parks by a parked target and keeps up with a moving one', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 34, y: 30 });
    const dest = { x: 34, y: 34 };
    expect(fightOrder(w, v, me, dest).kind).toBe('stopAt');
    me.speed = 4;
    const order = fightOrder(w, v, me, dest);
    expect(order.kind).toBe('through');
    expect(order.kind === 'through' && order.pace).toBeGreaterThanOrEqual(4);
  });

  it('a fighter that cannot fire from where it stands drives to a spot where it can, even when it is slow', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'convoyGuard', ['stockEngine', 'shotgun'], { x: 48.3, y: 30 });
    v.heading = 0;
    for (const part of mountedParts(v)) if (PARTS[part.defId].kind === 'core') part.hp = 0;
    expect(inReachAfter(w, v, me, v.pos)).toBe(false);
    const p = fightPoint(w, v, me, CLEAR);
    expect(inReachAfter(w, v, me, p)).toBe(true);
  });

  it('a parked fighter aims inside its gun range, so falling short of its stop point still leaves it in reach', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'convoyGuard', ['stockEngine', 'shotgun'], { x: 48.3, y: 30 });
    v.heading = Math.PI;
    const range = vehicleStats(w, v).weapons[0].def.range;
    chooseOn(w, v, me.id, me.pos, 'fight', true);
    v.brain!.noticed[`ramChance:${me.id}`] = w.turn;
    v.brain!.goals.push({ kind: 'fight', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'tripToSite', worn: { turn: w.turn, condition: 1 } });
    v.brain!.whim = { kind: 'keep', until: w.turn + 4, angle: 0 };
    planNpcOrders(w);
    const dest = v.order?.kind === 'stopAt' ? v.order.dest : null;
    expect(dest && dist(dest, me.pos)).toBeLessThanOrEqual(range - RULES.arriveRadius);
  });

  it('a circling fighter never parks', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
    const order = fightOrder(w, v, w.vehicles[0], { x: 34, y: 34 });
    expect(order.kind).toBe('through');
  });
});

function inFight(): { w: World; v: Vehicle } {
  const w = emptyWorld({ x: 40, y: 30 });
  const v = fighter(w, 'buggy', ['stockEngine', 'mg'], { x: 34, y: 30 }, 'buggy');
  const me = w.player.vehicleId;
  chooseOn(w, v, me, w.vehicles[0].pos, 'fight', true);
  v.brain!.noticed[`ramChance:${me}`] = w.turn;
  v.brain!.goals.push({ kind: 'fight', targetId: me, destination: { x: 40, y: 30 }, phase: 'travel', reason: 'tripToSite', worn: { turn: w.turn, condition: 1 } });
  return { w, v };
}

describe('reaction delay', () => {
  it('a fighter reads its target where it was and how it faced last turn', () => {
    const w = emptyWorld({ x: 40, y: 30 });
    const me = w.vehicles[0];
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 46, y: 30 });
    expect(perceivedTarget(w, v, me)).toBe(me);
    const before = { pos: { ...me.pos }, heading: me.heading, speed: me.speed };
    noteTarget(w, v, me);
    expect(perceivedTarget(w, v, me)).toBe(me);
    w.turn++;
    me.pos = { x: 41, y: 31 };
    me.heading = Math.PI;
    me.speed = 3;
    const seen = perceivedTarget(w, v, me);
    expect({ pos: seen.pos, heading: seen.heading, speed: seen.speed }).toEqual(before);
    expect(seen.id).toBe(me.id);
  });
});

describe('exposure', () => {
  function faceOff(keep: SideLetter | null) {
    const w = emptyWorld({ x: 40, y: 30 });
    const gun = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], { x: 40, y: 30 }, 0);
    gun.id = w.vehicles[0].id;
    w.vehicles = [gun, ...w.vehicles.slice(1, -1)];
    const plates = Array.from({ length: 20 }, () => 'steelPlate');
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg', ...plates], { x: 48, y: 30 });
    v.heading = Math.PI;
    const mg = v.items.find((it) => it.kind === 'part' && it.part.defId === 'mg')!;
    mg.x = 2;
    mg.y = 1;
    const strip = new Set(mountedParts(v, 'armor').filter((p) => sideOf(v, p) !== keep).map((p) => p.id));
    v.items = v.items.filter((it) => it.kind !== 'part' || !strip.has(it.part.id));
    return exposure(w, gun, gun, v);
  }

  function bareAt(gap: number) {
    const w = emptyWorld({ x: 40, y: 30 });
    const gun = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], { x: 40, y: 30 }, 0);
    const v = fighter(w, 'gunwagon', ['stockEngine', 'mg'], { x: 40 + gap, y: 30 });
    v.heading = Math.PI;
    return { exposure: exposure(w, gun, gun, v), chance: bodyHitChance(w, gun, vehicleStats(w, gun).weapons[0], v) };
  }

  it('is the hit chance for a bare side facing a gun that bears', () => {
    const { exposure: share, chance } = bareAt(8);
    expect(share).toBeCloseTo(chance);
    expect(chance).toBeLessThan(1);
  });

  it('grows as the gun closes in, since hit chance falls with distance', () => {
    expect(bareAt(4).exposure).toBeGreaterThan(bareAt(8).exposure);
  });

  it('drops when the side facing the gun is plated, and not when only the far side is', () => {
    expect(faceOff('F')).toBeLessThan(faceOff(null) * 0.8);
    expect(faceOff('B')).toBeCloseTo(faceOff(null));
  });
});

describe('fight whims', () => {
  it('rolls every whim over many seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const { w, v } = inFight();
      w.rngState = seed * 7919;
      seen.add(decide(w, v, 'fightWhim', w.player.vehicleId, null));
    }
    expect([...seen].sort()).toEqual(['halt', 'keep', 'rush', 'veer']);
  });

  it('holds a whim until its turn, then rolls again', () => {
    const { w, v } = inFight();
    thinkNpc(w, v);
    const first = v.brain!.whim!;
    expect(first.until).toBe(w.turn + 4);
    w.turn += 3;
    thinkNpc(w, v);
    expect(v.brain!.whim).toBe(first);
    w.turn += 1;
    thinkNpc(w, v);
    expect(v.brain!.whim!.until).toBe(w.turn + 4);
  });

  it('a halt brakes', () => {
    const { w, v } = inFight();
    v.brain!.whim = { kind: 'halt', until: w.turn + 4, angle: 0 };
    planNpcOrders(w);
    expect(v.order?.kind).toBe('brake');
  });

  it('a rush drives through the target', () => {
    const { w, v } = inFight();
    v.brain!.whim = { kind: 'rush', until: w.turn + 4, angle: 0 };
    planNpcOrders(w);
    expect(v.brain!.ramTarget).toBe(w.player.vehicleId);
    expect(v.order?.kind === 'through' && dist(v.order.dest, w.vehicles[0].pos)).toBe(0);
  });

  it('a veer turns the circling direction around and drives to its spot', () => {
    let flipped = false;
    for (let seed = 1; seed <= 400 && !flipped; seed++) {
      const { w, v } = inFight();
      v.brain!.fightTurn = 1;
      w.rngState = seed * 7919;
      thinkNpc(w, v);
      if (v.brain!.whim!.kind !== 'veer') continue;
      flipped = (v.brain!.fightTurn as number) === -1;
      const a = v.brain!.whim!.angle;
      planNpcOrders(w);
      const dest = v.order?.kind === 'through' ? v.order.dest : null;
      expect(dest && bearing(w.vehicles[0].pos, dest)).toBeCloseTo(a, 9);
    }
    expect(flipped).toBe(true);
  });
});
