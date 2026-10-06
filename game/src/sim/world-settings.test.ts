// The world settings scale the same rules for every truck: the player, NPCs, far NPCs and town guards.
import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { RULES } from '../data/rules';
import { applyContactCrash, applyGroundCrash, applyLanding } from './crash-contact';
import { fireWeapons } from './combat';
import { advanceFar } from './far';
import { corePart, mountedParts } from './grid';
import { fireGuards } from './guards';
import { burnFuel, consumeVehicleSupplies, getResources } from './resources';
import { parseSetup } from './settings';
import { siteGates } from './sites';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld } from './testkit';
import type { PartHit } from './armor';
import type { GameEvent, Vehicle, World, WorldSettings } from './types';
import { consumeSupplies, leakFuel } from './supplies';

function withSettings(w: World, settings: Partial<WorldSettings>): World {
  w.setup = parseSetup({ mode: 'roaming', settings: { damage: 1, fuelUse: 1, supplyUse: 1, ...settings } });
  return w;
}

// Parts that never break, so every hit walks the same lane in both worlds.
function sturdy(v: Vehicle): Vehicle {
  for (const p of mountedParts(v)) p.hp = 1e9;
  return v;
}

// Each lane's hit rounds to whole HP, so a part's damage can differ from the exact multiple by up to the rounding of
// both sides in each lane that reached it.
function expectScaled(scaled: number[], base: number[], k: number, lanes = 1): void {
  expect(base.length).toBeGreaterThan(0);
  expect(base.some((d) => d >= 4)).toBe(true);
  expect(scaled).toHaveLength(base.length);
  scaled.forEach((d, i) => expect(Math.abs(d - k * base[i])).toBeLessThanOrEqual(lanes * (0.5 + k * 0.5)));
}

const hitsOf = (hits: PartHit[]) => hits.map((h) => h.damage);

describe('Damage setting', () => {
  // The player and an NPC with cannons shoot each other at 4 tiles from the given RNG state.
  function duel(damage: number, rngState: number): { byPlayer: number[]; byNpc: number[] } {
    const w = withSettings(emptyWorld({ x: 60, y: 60 }), { damage });
    w.rngState = rngState;
    const old = w.vehicles[0];
    const me = sturdy(addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], old.pos, 0));
    me.id = old.id;
    w.vehicles = [me];
    const npc = sturdy(addVehicle(w, 'raiders', 'hauler', ['stockEngine', 'cannon'], { x: 64, y: 60 }, Math.PI));
    me.weaponOrders[vehicleStats(w, me).weapons[0].part.id] = { targetId: npc.id, aim: 'body' };
    npc.weaponOrders[vehicleStats(w, npc).weapons[0].part.id] = { targetId: me.id, aim: 'body' };
    fireWeapons(w);
    const dealtBy = (id: string) => w.events.flatMap((e) => (e.t === 'shot' && e.shooter === id ? e.rounds : [])).flatMap((r) => hitsOf(r.hits));
    return { byPlayer: dealtBy(me.id), byNpc: dealtBy(npc.id) };
  }

  it('doubles every round the player and an NPC deal, on the same rolls', () => {
    let state = 1;
    const landsBoth = (s: number) => Object.values(duel(1, s)).every((hits) => hits.length > 0);
    while (state < 1000 && !landsBoth(state)) state++;
    const base = duel(1, state);
    const doubled = duel(2, state);

    expectScaled(doubled.byPlayer, base.byPlayer, 2);
    expectScaled(doubled.byNpc, base.byNpc, 2);
  });

  it('halves the town guards rounds', () => {
    const guarded = (damage: number, rngState: number) => {
      const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
      const gate = siteGates(bowl)[0];
      const out = (d: number) => ({ x: gate.x + ((gate.x - bowl.pos.x) / bowl.radius) * d, y: gate.y + ((gate.y - bowl.pos.y) / bowl.radius) * d });
      const w = withSettings(emptyWorld(out(2)), { damage });
      w.rngState = rngState;
      const victim = addVehicle(w, 'traders', 'hauler', [], { x: out(6).x + 1.5, y: out(6).y });
      const raider = sturdy(addVehicle(w, 'raiders', 'hauler', ['mg'], out(6)));
      raider.weaponOrders[mountedParts(raider, 'weapon')[0].id] = { targetId: victim.id, aim: 'body' };
      fireWeapons(w);
      fireGuards(w);
      return w.events.flatMap((e: GameEvent) => (e.t === 'guardShot' ? e.rounds : [])).flatMap((r) => hitsOf(r.hits));
    };

    let state = 1;
    while (state < 1000 && guarded(1, state).length === 0) state++;

    expectScaled(guarded(0.5, state), guarded(1, state), 0.5);
  });

  it('doubles a crash between two NPCs on both trucks', () => {
    const crash = (damage: number) => {
      const w = withSettings(emptyWorld(), { damage });
      const a = sturdy(addVehicle(w, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 }));
      const b = sturdy(addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 43, y: 40 }, Math.PI));
      applyContactCrash(w, a, b, b.id, 6, { a: { side: 'front', lanes: [2] }, b: { side: 'front', lanes: [2] } });
      const e = w.events.find((x) => x.t === 'collision');
      if (e?.t !== 'collision') throw new Error('No collision');
      return [...hitsOf(e.hitsA), ...hitsOf(e.hitsB)];
    };

    expectScaled(crash(2), crash(1), 2);
  });

  it('doubles a ground crash and a landing', () => {
    const fall = (damage: number) => {
      const w = withSettings(emptyWorld(), { damage });
      const v = sturdy(addVehicle(w, 'raiders', 'scout', ['stockEngine'], { x: 40, y: 40 }));
      applyGroundCrash(w, v, 'ground', 8, { side: 'front', lanes: [1, 2, 3] });
      applyLanding(w, v, 'ground', 8);
      return w.events.flatMap((e) => (e.t === 'collision' ? hitsOf(e.hitsA) : []));
    };

    expectScaled(fall(2), fall(1), 2, 3);
  });

  it('leaves starving alone', () => {
    const starve = (damage: number) => {
      const w = withSettings(emptyWorld(), { damage });
      w.player.supplies = 0;
      consumeSupplies(w);
      return w.player.health;
    };

    expect(starve(2)).toBe(starve(1));
    expect(starve(1)).toBe(RULES.maxHealth - RULES.starveDamage);
  });
});

describe('Fuel use setting', () => {
  function trucks(fuelUse: number) {
    const w = withSettings(emptyWorld(), { fuelUse });
    const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 10, y: 10 });
    return { w, list: [w.vehicles[0], npc] };
  }

  it('burns 1.5 times the fuel over the same tiles, for the player and an NPC', () => {
    const burned = (fuelUse: number) => {
      const { w, list } = trucks(fuelUse);
      return list.map((v) => {
        const before = getResources(w, v).fuel;
        burnFuel(w, v, 50);
        return before - getResources(w, v).fuel;
      });
    };
    const [base, more] = [burned(1), burned(1.5)];

    base.forEach((b, i) => {
      expect(b).toBeGreaterThan(0);
      expect(more[i]).toBeCloseTo(1.5 * b, 9);
    });
  });

  it('gives every truck 1.5 times the fuel per tile, which NPC refuel reserves read', () => {
    const perTile = (fuelUse: number) => {
      const { w, list } = trucks(fuelUse);
      return list.map((v) => vehicleStats(w, v).fuelPerTile);
    };

    expect(perTile(1.5)).toEqual(perTile(1).map((x) => 1.5 * x));
  });

  it('burns 1.5 times the fuel on a far NPC step over the same way', () => {
    const farStep = (fuelUse: number) => {
      const w = withSettings(emptyWorld(), { fuelUse });
      const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 120, y: 120 });
      far.speed = 2;
      far.order = { kind: 'through', dest: { x: 200, y: 120 } };
      const before = getResources(w, far).fuel;
      advanceFar(w, far);
      return { burned: before - getResources(w, far).fuel, pos: far.pos };
    };
    const [base, more] = [farStep(1), farStep(1.5)];

    expect(more.pos).toEqual(base.pos);
    expect(more.burned).toBeCloseTo(1.5 * base.burned, 9);
  });

  it('leaves the leak of a broken tank alone', () => {
    const { w, list } = trucks(2);
    const npc = list[1];
    corePart(npc, 'tank').hp = 0;
    const before = getResources(w, npc).fuel;
    leakFuel(w);

    expect(before - getResources(w, npc).fuel).toBe(RULES.tankLeak);
  });
});

describe('Supply use setting', () => {
  it('halves the supplies the player and an NPC eat per turn', () => {
    const eaten = (supplyUse: number) => {
      const w = withSettings(emptyWorld(), { supplyUse });
      const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 10, y: 10 });
      return [w.vehicles[0], npc].map((v) => {
        const before = getResources(w, v).supplies;
        for (let i = 0; i < 10; i++) consumeVehicleSupplies(w, v);
        return before - getResources(w, v).supplies;
      });
    };
    const [base, less] = [eaten(1), eaten(0.5)];

    base.forEach((b, i) => {
      expect(b).toBeGreaterThan(0);
      expect(less[i]).toBeCloseTo(0.5 * b, 9);
    });
  });
});
