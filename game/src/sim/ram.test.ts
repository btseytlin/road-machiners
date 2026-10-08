import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { corePart, itemCells, mountedItems, mountedParts } from './grid';
import { applyContactCrash, estimateCrashGeometry, forecastRam, ramHitChance, ramImpact, ramValue } from './crash-contact';
import { RULES } from '../data/rules';
import { thinkNpc } from './npc-activities';
import { addState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { GameEvent, Vehicle, World } from './types';
import type { Vec } from './vec';

const FULL_SPEED = 6;

function applyCrash(world: World, a: Vehicle, b: Vehicle | null, what: string, from: Vec, impact: number): void {
  applyContactCrash(world, a, b, what, impact, estimateCrashGeometry(a, b, from));
}

function crashOf(w: World): Extract<GameEvent, { t: 'collision' }> {
  const e = w.events.find((x) => x.t === 'collision');
  if (!e || e.t !== 'collision') throw new Error('No collision event');
  return e;
}

const total = (hits: { damage: number }[]) => hits.reduce((a, h) => a + h.damage, 0);
const partAt = (v: Vehicle, x: number, y: number) => mountedItems(v).find((it) => itemCells(it).some((c) => c.x === x && c.y === y))!.part;
const partOf = (v: Vehicle, defId: string) => mountedParts(v).find((p) => p.defId === defId)!;

function ramToRear(v: Vehicle): void {
  const item = mountedItems(v).find((it) => it.part.defId === 'ram')!;
  const owner = v.items.find((it) => it.id === item.id)!;
  owner.y = 7;
  expect(mountedItems(v).some((it) => it.part.defId === 'ram')).toBe(true);
}

function plowToNose(v: Vehicle): void {
  const item = mountedItems(v).find((it) => it.part.defId === 'plowRam')!;
  Object.assign(v.items.find((it) => it.id === item.id)!, { x: 3, y: 0, rot: 0 });
  expect(mountedItems(v).some((it) => it.part.defId === 'plowRam')).toBe(true);
}

describe('rams', () => {
  it('a light truck takes more damage than a heavy one in a head-on crash', () => {
    const w = emptyWorld();
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 40 }, 0);
    const hauler = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine'], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(w, buggy, hauler, hauler.id, hauler.pos, FULL_SPEED);
    const e = crashOf(w);
    expect(total(e.hitsA)).toBeGreaterThan(total(e.hitsB));
    expect(total(e.hitsB)).toBeGreaterThan(0);
  });

  it('a front ram takes the hit before the cab', () => {
    const bare = emptyWorld();
    const plain = addVehicle(bare, 'raiders', 'scout', [], { x: 40, y: 40 }, 0);
    const h1 = addVehicle(bare, 'traders', 'hauler', [], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(bare, h1, plain, plain.id, plain.pos, FULL_SPEED);
    expect(corePart(plain, 'cab').hp).toBeLessThan(partDef('cab').hp);

    const w = emptyWorld();
    const rammed = addVehicle(w, 'raiders', 'scout', ['ram'], { x: 40, y: 40 }, 0);
    const h2 = addVehicle(w, 'traders', 'hauler', [], { x: 41.5, y: 40 }, Math.PI);
    applyCrash(w, h2, rammed, rammed.id, rammed.pos, FULL_SPEED);
    expect(corePart(rammed, 'cab').hp).toBe(partDef('cab').hp);
    expect(partOf(rammed, 'ram').hp).toBeLessThan(partDef('ram').hp);
  });

  it('a ram on the striking side raises damage to the other truck', () => {
    const run = (rear: boolean) => {
      const w = emptyWorld();
      const scout = addVehicle(w, 'raiders', 'scout', ['ram'], { x: 40, y: 40 }, 0);
      if (rear) ramToRear(scout);
      const buggy = addVehicle(w, 'traders', 'buggy', ['mg', 'stockEngine'], { x: 41.2, y: 40 }, Math.PI);
      applyCrash(w, scout, buggy, buggy.id, buggy.pos, FULL_SPEED);
      return total(crashOf(w).hitsB);
    };
    expect(run(false)).toBeGreaterThan(run(true));
  });

  it('a rear hit lands on rear lanes', () => {
    const firstHit = (fromX: number) => {
      const w = emptyWorld();
      const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 }, 0);
      const other = addVehicle(w, 'traders', 'hauler', [], { x: fromX, y: 40 }, 0);
      applyCrash(w, other, v, v.id, v.pos, FULL_SPEED);
      return { v, part: crashOf(w).hitsB[0].part };
    };
    const rear = firstHit(38.5);
    expect(rear.part).toBe(partAt(rear.v, 1, 6).id);
    const front = firstHit(41.5);
    expect(front.part).toBe(partAt(front.v, 1, 1).id);
  });

  it('an obstacle hit lands on the side facing it at full share', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 }, 0);
    applyCrash(w, v, null, 'rock', { x: 41.5, y: 40 }, FULL_SPEED);
    const e = crashOf(w);
    expect(e.hitsB).toEqual([]);
    expect(e.hitsA.some((h) => h.part === partOf(v, 'stockEngine').id)).toBe(true);
  });
});

describe('slow bumps', () => {
  it('a bump into a rock at a slow speed only scratches parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const before = new Map(mountedParts(me).map((p) => [p.id, p.hp]));
    applyCrash(w, me, null, 'rock', { x: me.pos.x + 1, y: me.pos.y }, 2);
    for (const p of mountedParts(me)) expect(p.hp).toBeGreaterThan(before.get(p.id)! * 0.8);
  });
});

describe('rams as attacks', () => {
  function ramSetup(): { w: World; trader: Vehicle; victim: Vehicle; mate: Vehicle } {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 40, y: 40 }, 0);
    trader.brain = npcBrain('trader', trader.pos, ['trader']);
    const victim = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], { x: 41.6, y: 40 }, Math.PI / 2);
    victim.brain = npcBrain('scavenger', victim.pos, ['scavenger']);
    const mate = addVehicle(w, 'scavengers', 'hauler', ['stockEngine'], { x: 44, y: 44 }, 0);
    mate.brain = npcBrain('scavenger', mate.pos, ['scavenger']);
    return { w, trader, victim, mate };
  }

  it('a damaging ram between trucks at peace gives the victim a grievance, not a feud', () => {
    const { w, trader, victim } = ramSetup();
    applyCrash(w, trader, victim, victim.id, victim.pos, FULL_SPEED);
    expect(total(crashOf(w).hitsB)).toBeGreaterThan(0);
    expect(stateOf(w, 'grievance', victim.id, trader.id)).not.toBeNull();
    expect(w.states.filter((s) => s.kind === 'feud')).toEqual([]);
    expect(victim.brain!.attackers).toEqual({});
  });

  it('a victim that retaliates feuds with its mate against the rammer and decides on it as an attacker', () => {
    forceOption('crashed', 'retaliate');
    const { w, trader, victim, mate } = ramSetup();
    applyCrash(w, trader, victim, victim.id, victim.pos, FULL_SPEED);
    thinkNpc(w, victim);
    expect(stateOf(w, 'feud', victim.id, trader.id)).not.toBeNull();
    expect(stateOf(w, 'feud', mate.id, trader.id)).not.toBeNull();
    expect(victim.brain!.attackers).toEqual({ [trader.id]: true });
  });

  it('a crash with measured physics contact geometry gives a grievance too', () => {
    const { w, trader, victim } = ramSetup();
    applyContactCrash(w, trader, victim, victim.id, FULL_SPEED, { a: { side: 'front', lanes: [1, 2] }, b: { side: 'left', lanes: [2, 3] } });
    expect(total(crashOf(w).hitsB)).toBeGreaterThan(0);
    expect(stateOf(w, 'grievance', victim.id, trader.id)).not.toBeNull();
    expect(victim.lastHitBy).toBe(trader.id);
  });

  it('a ram forecast damages nothing and attacks no one', () => {
    const { w, victim, mate } = ramSetup();
    const raider = addVehicle(w, 'raiders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 38, y: 40 }, 0);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    raider.speed = 5;
    const before = JSON.stringify(w.vehicles);
    forecastRam(w, raider, victim, FULL_SPEED);
    expect(JSON.stringify(w.vehicles)).toBe(before);
    expect(w.states).toEqual([]);
    expect(w.events).toEqual([]);
    expect(mate.brain!.attackers).toEqual({});
  });

  it('the player ramming an NPC at peace gives it a grievance too', () => {
    const { w, victim } = ramSetup();
    const me = w.vehicles[0];
    me.pos = { x: 41.6, y: 38.4 };
    applyCrash(w, me, victim, victim.id, victim.pos, FULL_SPEED);
    expect(stateOf(w, 'grievance', victim.id, me.id)).not.toBeNull();
  });

  it('a slow bump with no damage is no attack', () => {
    const { w, trader, victim } = ramSetup();
    applyCrash(w, trader, victim, victim.id, victim.pos, RULES.collisionMinImpact * 0.9);
    expect(crashOf(w).hitsB).toEqual([]);
    expect(w.states).toEqual([]);
    expect(victim.brain!.attackers).toEqual({});
  });

  it('a tower and the player it tows never attack each other by contact', () => {
    const { w, trader } = ramSetup();
    const me = w.vehicles[0];
    me.pos = { x: 38.4, y: 40 };
    addState(w, 'tow', trader.id, me.id, { kind: 'tow', site: 'bowl', fee: 50, waived: 0, hitched: true });
    applyCrash(w, me, trader, trader.id, trader.pos, FULL_SPEED);
    expect(crashOf(w).hitsB).toEqual([]);
    expect(stateOf(w, 'feud', trader.id, me.id)).toBeNull();
    expect(trader.brain!.attackers).toEqual({});
  });
});

function duel(rammerParts: string[], targetParts: string[], gap = 6): { w: World; rammer: Vehicle; target: Vehicle } {
  const w = emptyWorld({ x: 1, y: 1 });
  const rammer = addVehicle(w, 'raiders', 'hauler', rammerParts, { x: 30, y: 30 }, 0);
  const target = addVehicle(w, 'traders', 'hauler', targetParts, { x: 30 + gap, y: 30 }, Math.PI);
  rammer.speed = 5;
  return { w, rammer, target };
}

describe('ram value', () => {
  it('is 0 when the target lies outside the ram cone', () => {
    const { w, rammer, target } = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine']);
    rammer.heading = Math.PI;
    expect(ramValue(w, rammer, target)).toBe(0);
  });

  it('rises with a ram bar on the rammer nose against an equal truck', () => {
    const bare = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine']);
    const barred = duel(['cannon', 'stockEngine', 'plowRam'], ['cannon', 'stockEngine']);
    plowToNose(barred.rammer);
    expect(ramValue(barred.w, barred.rammer, barred.target)).toBeGreaterThan(ramValue(bare.w, bare.rammer, bare.target));
  });

  it('is not vetoed by a broken ram bar on a ram that hurts the target far more', () => {
    const { w, rammer, target } = duel(['cannon', 'stockEngine', 'plowRam'], ['cannon', 'stockEngine']);
    plowToNose(rammer);
    const bar = mountedParts(rammer, 'armor')[0];
    bar.hp = 1;
    expect(ramValue(w, rammer, target)).toBeGreaterThan(0);
  });

  it('is 0 when the ram costs the rammer more than it deals', () => {
    const w = emptyWorld({ x: 1, y: 1 });
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 30 }, 0);
    const hauler = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plowRam'], { x: 36, y: 30 }, Math.PI);
    buggy.speed = 5;
    expect(ramImpact(w, buggy, hauler)).not.toBeNull();
    expect(ramValue(w, buggy, hauler)).toBe(0);
  });
});

describe('ram hit chance', () => {
  it('is higher for a near slow target than for a far fast one', () => {
    const near = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine'], 4);
    near.target.speed = 1;
    const far = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine'], 24);
    far.target.speed = 5;
    far.target.heading = Math.PI / 2;
    const chance = (d: typeof near) => ramHitChance(d.w, d.rammer, d.target, ramImpact(d.w, d.rammer, d.target)!);
    expect(chance(near)).toBeGreaterThan(chance(far));
    expect(chance(far)).toBeLessThan(0.3);
  });

  it('is certain against a parked truck at any distance', () => {
    const { w, rammer, target } = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine'], 24);
    target.speed = 0;
    expect(ramHitChance(w, rammer, target, ramImpact(w, rammer, target)!)).toBe(1);
  });

  it('is lower for a target crossing the line than for one driving along it at the same speed', () => {
    const along = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine'], 12);
    along.target.speed = 3;
    const across = duel(['cannon', 'stockEngine'], ['cannon', 'stockEngine'], 12);
    across.target.speed = 3;
    across.target.heading = Math.PI / 2;
    const chance = (d: typeof along) => ramHitChance(d.w, d.rammer, d.target, ramImpact(d.w, d.rammer, d.target)!);
    expect(chance(across)).toBeLessThan(chance(along));
  });
});
