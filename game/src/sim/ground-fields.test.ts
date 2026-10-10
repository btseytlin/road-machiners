import { describe, expect, it } from 'vitest';
import { chassisDef } from '../data/chassis';
import { PHYSICS } from '../data/physics';
import { CALTROPS, OIL } from '../data/utilities';
import { routeBlockers } from './ai';
import { bodyOf } from './body';
import { stateOf, strayData } from './states';
import { coreParts } from './grid';
import { makePart } from './factory';
import { caltropHits, dropClearance, dropField, oilPatches, pathBehind, spillOil } from './hazards';
import { mountPart } from './inventory';
import { route } from './path';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { GroundField, PartInstance, Pose, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects, utilityOrderError } from './utility';
import { dist, segmentDist, type Vec } from './vec';
import { sightRadius } from './vision';

const DROP = { radius: 1.25, turns: 10, behind: 1 };
const SPILL = { turns: 8, behind: 1, fuel: 2 };

function playerWith(defId: string): { w: World; me: Vehicle; part: PartInstance } {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const part = makePart(w, defId, 0);
  if (!mountPart(w, me, part)) throw new Error(`No deck room for ${defId}`);
  return { w, me, part };
}

function field(w: World, source: Vehicle, pos: Vec, kind: GroundField['kind'] = 'caltrops'): GroundField {
  const f: GroundField = { id: `f${w.fields.length}`, kind, source: source.id, pos, r: DROP.radius, turnsLeft: 10, hit: [] };
  w.fields.push(f);
  return f;
}

function drive(v: Vehicle, a: Vec, b: Vec): void {
  const heading = Math.atan2(b.y - a.y, b.x - a.x);
  const pose = (p: Vec): Pose => ({ x: p.x, y: p.y, heading });
  v.trail = [pose(a), pose(b)];
  v.pos = { ...b };
  v.heading = heading;
}

function wheelHp(v: Vehicle): number[] {
  return coreParts(v, 'wheel').map((p) => p.hp);
}

describe('dropField', () => {
  it('puts the near edge of the field `behind` tiles behind the rear of a stopped truck', () => {
    const { w, me } = playerWith('caltrops');
    me.heading = Math.PI / 2;

    dropField(w, me, 'caltrops', DROP);

    const rear = bodyOf(me.chassisId).half.x / PHYSICS.metersPerTile;
    const [f] = w.fields;
    expect(f.pos.x).toBeCloseTo(30);
    expect(f.pos.y).toBeCloseTo(30 - (rear + DROP.behind + DROP.radius));
    expect(f).toMatchObject({ kind: 'caltrops', source: me.id, r: DROP.radius, turnsLeft: DROP.turns, hit: [] });
  });

  it('puts the field on the ground the truck drove over, not behind its end heading', () => {
    const { w, me } = playerWith('caltrops');
    drive(me, { x: 20, y: 30 }, { x: 30, y: 30 });
    me.heading = Math.PI / 2;

    dropField(w, me, 'caltrops', DROP);

    const [f] = w.fields;
    expect(f.pos.x).toBeCloseTo(30 - dropClearance(me, DROP.behind) - DROP.radius);
    expect(f.pos.y).toBeCloseTo(30);
  });

  it('leaves the dropper clear of its fresh field', () => {
    const { w, me } = playerWith('caltrops');
    drive(me, { x: 30, y: 30 }, { x: 30, y: 30 });
    dropField(w, me, 'caltrops', DROP);
    const before = wheelHp(me);

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
  });
});

describe('pathBehind', () => {
  it('walks back along the trail from the truck', () => {
    const { me } = playerWith('caltrops');
    drive(me, { x: 20, y: 30 }, { x: 30, y: 30 });

    expect(pathBehind(me, 4)).toEqual({ x: 26, y: 30 });
  });

  it('goes on straight past the start of the trail, the way the trail started', () => {
    const { me } = playerWith('caltrops');
    me.trail = [{ x: 30, y: 26, heading: Math.PI / 2 }, { x: 30, y: 28, heading: 0 }, { x: 30, y: 30, heading: 0 }];
    me.pos = { x: 30, y: 30 };

    const p = pathBehind(me, 7);

    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(23);
  });

  it('goes on past the start the way its first tile ran, not along a first leg of jitter', () => {
    const { me } = playerWith('caltrops');
    me.trail = [{ x: 30, y: 26.03, heading: Math.PI / 2 }, { x: 30.02, y: 26, heading: Math.PI / 2 }, { x: 30, y: 28, heading: Math.PI / 2 }];
    me.pos = { x: 30, y: 30 };

    const p = pathBehind(me, 7);

    expect(Math.abs(p.x - 30)).toBeLessThan(0.1);
    expect(Math.abs(p.y - 23)).toBeLessThan(0.1);
  });

  it('throws on a negative distance', () => {
    const { me } = playerWith('caltrops');

    expect(() => pathBehind(me, -0.1)).toThrow();
  });
});

describe('drops land on the path behind in travel', () => {
  const unit = (h: number): Vec => ({ x: Math.cos(h), y: Math.sin(h) });
  const END = { x: 30, y: 30 };

  type Motion = { name: string; lay: (v: Vehicle, h: number) => Vec };
  const MOTIONS: Motion[] = [
    {
      name: 'driving forward',
      lay: (v, h) => {
        drive(v, { x: END.x - 6 * unit(h).x, y: END.y - 6 * unit(h).y }, END);
        return unit(h);
      },
    },
    {
      name: 'reversing',
      lay: (v, h) => {
        drive(v, { x: END.x + 6 * unit(h).x, y: END.y + 6 * unit(h).y }, END);
        v.heading = h;
        v.trail = v.trail.map((p) => ({ ...p, heading: h }));
        return { x: -unit(h).x, y: -unit(h).y };
      },
    },
    {
      name: 'stopped',
      lay: (v, h) => {
        drive(v, END, END);
        v.heading = h;
        return unit(h);
      },
    },
    {
      name: 'stopped with a settling wobble',
      lay: (v, h) => {
        const back = unit(h + Math.PI);
        const side = unit(h + Math.PI / 2);
        v.trail = [
          { x: END.x - 0.03 * back.x, y: END.y - 0.03 * back.y, heading: h },
          { x: END.x - 0.01 * back.x + 0.02 * side.x, y: END.y - 0.01 * back.y + 0.02 * side.y, heading: h },
          { x: END.x, y: END.y, heading: h },
        ];
        v.pos = { ...END };
        v.heading = h;
        return unit(h);
      },
    },
  ];
  const HEADINGS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const CASES = MOTIONS.flatMap((m) => HEADINGS.map((h) => [m.name, h, m] as const));

  function expectBehind(v: Vehicle, fields: GroundField[], travel: Vec, gap: number): void {
    const clearance = dropClearance(v, gap);
    for (const f of fields) {
      const off = { x: f.pos.x - END.x, y: f.pos.y - END.y };
      expect(dist(f.pos, END)).toBeGreaterThanOrEqual(clearance);
      expect(off.x * travel.x + off.y * travel.y).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(off.x * travel.y - off.y * travel.x)).toBeLessThan(1e-9);
    }
  }

  it.each(CASES)('drops caltrops behind a truck %s at heading %f', (_name, h, motion) => {
    const { w, me } = playerWith('caltrops');
    const travel = motion.lay(me, h);

    dropField(w, me, 'caltrops', DROP);

    expectBehind(me, w.fields, travel, DROP.behind);
  });

  it.each(CASES)('spills oil behind a truck %s at heading %f', (_name, h, motion) => {
    const { w, me } = playerWith('oilSpiller');
    w.player.fuel = 5;
    const travel = motion.lay(me, h);

    spillOil(w, me, SPILL);

    expectBehind(me, w.fields, travel, SPILL.behind);
  });
});

describe('spillOil', () => {
  it('spills one streak of OIL.blobs oil fields, spaced along the path', () => {
    const { w, me } = playerWith('oilSpiller');
    w.player.fuel = 5;
    drive(me, { x: 10, y: 30 }, { x: 30, y: 30 });

    spillOil(w, me, SPILL);

    expect(OIL.blobs).toBe(6);
    expect(w.fields).toHaveLength(6);
    expect(new Set(w.fields.map((f) => f.id)).size).toBe(6);
    expect(w.fields.every((f) => f.kind === 'oil' && f.source === me.id && f.r === OIL.blobR && f.turnsLeft === SPILL.turns)).toBe(true);
    const first = 30 - dropClearance(me, SPILL.behind) - OIL.blobR;
    w.fields.forEach((f, i) => {
      expect(f.pos.x).toBeCloseTo(first - i * OIL.spacing);
      expect(f.pos.y).toBeCloseTo(30);
    });
    expect(w.player.fuel).toBe(3);
  });

  it('lays the streak on a curved trail, each blob on the curve', () => {
    const { w, me } = playerWith('oilSpiller');
    w.player.fuel = 5;
    const arc = Array.from({ length: 31 }, (_, i) => {
      const a = Math.PI - (i / 30) * (Math.PI / 2);
      return { x: 30 + 6 * Math.cos(a), y: 24 + 6 * Math.sin(a), heading: a - Math.PI / 2 };
    });
    me.trail = arc;
    me.pos = { x: arc[30].x, y: arc[30].y };
    me.heading = 0;

    spillOil(w, me, SPILL);

    const points: Vec[] = [...me.trail, me.pos];
    const toTrail = (p: Vec): number => Math.min(...points.slice(1).map((q, i) => segmentDist(p, points[i], q)));
    for (const f of w.fields) expect(toTrail(f.pos)).toBeLessThanOrEqual(0.1);
    expect(Math.max(...w.fields.map((f) => Math.abs(f.pos.y - 30)))).toBeGreaterThan(0.5);
  });
});

describe('caltropHits', () => {
  it('damages each of the four wheels of a truck that drives through, and logs it', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    const f = field(w, trader, { x: 40, y: 31 });
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before.map((hp) => hp - CALTROPS.damage));
    expect(f.hit).toEqual([me.id]);
    expect(w.events).toContainEqual({ t: 'caltrops', vehicle: me.id, field: f.id, source: trader.id, hits: coreParts(me, 'wheel').map((wheel) => ({ part: wheel.id, damage: CALTROPS.damage })) });
  });

  it('misses a truck whose trail passes farther than the field radius plus its own radius', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    const reach = DROP.radius + chassisDef(me.chassisId).radius;
    const f = field(w, trader, { x: 40, y: 30 + reach + 0.05 });
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
    expect(f.hit).toEqual([]);
  });

  it('hits a truck once per field, so a truck parked on it takes no second hit', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    field(w, trader, { x: 40, y: 30 });
    drive(me, { x: 35, y: 30 }, { x: 40, y: 30 });
    caltropHits(w);
    const after = wheelHp(me);
    drive(me, { x: 40, y: 30 }, { x: 40, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(after);
  });

  it('hits the dropper that drives over its own field, and blames nobody', () => {
    const w = emptyWorld();
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    trader.brain = npcBrain('hauler', trader.pos, []);
    const f = field(w, trader, { x: 40, y: 30 });
    const before = wheelHp(trader);
    drive(trader, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(trader)).toEqual(before.map((hp) => hp - CALTROPS.damage));
    expect(f.hit).toEqual([trader.id]);
    expect(w.states).toEqual([]);
    expect(trader.lastHitBy).toBeNull();
  });

  it('counts as an attack on a truck already hostile to the dropper', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 35, y: 30 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    field(w, me, { x: 40, y: 30 });
    drive(raider, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(raider.brain.attackers[me.id]).toBe(false);
    expect(stateOf(w, 'combat', me.id, raider.id)).not.toBeNull();
    expect(raider.lastHitBy).toBe(me.id);
  });

  it('counts as stray damage to a neutral truck, summed toward a feud', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 35, y: 30 });
    trader.brain = npcBrain('hauler', trader.pos, []);
    field(w, me, { x: 40, y: 30 });
    drive(trader, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    const stray = stateOf(w, 'strayFire', trader.id, me.id);
    expect(stray && strayData(stray).damage).toBe(4 * CALTROPS.damage);
    expect(stateOf(w, 'combat', me.id, trader.id)).toBeNull();
  });

  it('leaves oil patches harmless', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', [], { x: 50, y: 30 });
    field(w, trader, { x: 40, y: 30 }, 'oil');
    const before = wheelHp(me);
    drive(me, { x: 35, y: 30 }, { x: 45, y: 30 });

    caltropHits(w);

    expect(wheelHp(me)).toEqual(before);
  });
});

describe('the caltrops and the oil spiller in use', () => {
  it('drop a caltrop field behind the truck on a self order', () => {
    const { w, me, part } = playerWith('caltrops');
    me.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(w.fields.map((f) => [f.kind, f.source, f.turnsLeft])).toEqual([['caltrops', me.id, 10]]);
    expect(w.fields[0].pos.x).toBeLessThan(me.pos.x);
  });

  it('refuses the oil spiller without 2 fuel units, with a reason', () => {
    const { w, me, part } = playerWith('oilSpiller');
    w.player.fuel = 1.9;

    expect(utilityOrderError(w, me, part.id, { kind: 'self' })).toMatchObject({ id: 'utilityBlocked', block: 'fuel' });
    me.utilityOrders[part.id] = { kind: 'self' };
    activateUtilities(w);
    expect(w.fields).toEqual([]);
    expect(w.player.fuel).toBe(1.9);
  });

  it('spends 2 fuel units on an oil streak', () => {
    const { w, me, part } = playerWith('oilSpiller');
    w.player.fuel = 5;
    me.utilityOrders[part.id] = { kind: 'self' };

    activateUtilities(w);

    expect(w.player.fuel).toBe(3);
    expect(w.fields.map((f) => [f.kind, f.turnsLeft])).toEqual(Array.from({ length: OIL.blobs }, () => ['oil', 8]));
  });

  it('end fields after their turns', () => {
    const { w, me } = playerWith('caltrops');
    dropField(w, me, 'caltrops', { ...DROP, turns: 2 });

    advanceUtilityEffects(w);
    expect(w.fields).toHaveLength(1);
    advanceUtilityEffects(w);
    expect(w.fields).toEqual([]);
  });
});

describe('oilPatches', () => {
  it('lists the oil patches only, in tiles', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    field(w, me, { x: 40, y: 30 });
    field(w, me, { x: 44, y: 32 }, 'oil');

    expect(oilPatches(w)).toEqual([{ pos: { x: 44, y: 32 }, r: DROP.radius }]);
  });
});

describe('routes around fields', () => {
  function trader(): { w: World; v: Vehicle } {
    const w = emptyWorld({ x: 30, y: 60 });
    const v = addVehicle(w, 'traders', 'hauler', [], { x: 20, y: 30 });
    v.brain = npcBrain('hauler', v.pos, []);
    return { w, v };
  }

  it('steers an NPC around a field it sees', () => {
    const { w, v } = trader();
    const f = field(w, w.vehicles[0], { x: 30, y: 30 });
    const radius = chassisDef(v.chassisId).radius;

    const points = [v.pos, ...route(w, v.pos, { x: 40, y: 30 }, radius, routeBlockers(w, v), v)];

    const closest = Math.min(...points.slice(1).map((p, i) => segmentDist(f.pos, points[i], p)));
    expect(closest).toBeGreaterThan(f.r + radius);
  });

  it('ignores a field out of the NPC\'s sight', () => {
    const { w, v } = trader();
    const far = { x: v.pos.x + sightRadius(w, v) + 5, y: 30 };
    field(w, w.vehicles[0], far);

    expect(routeBlockers(w, v).some((b) => b.pos.x === far.x && b.pos.y === far.y)).toBe(false);
  });
});
