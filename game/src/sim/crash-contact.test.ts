import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { applyContactCrash, computeClosingSpeed, locateCrashContact } from './crash-contact';
import { addVehicle, emptyWorld, npcBrain, practiceOf } from './testkit';
import { PERK_NUMBERS } from '../data/skills';
import { isHostile } from './combat';
import { addState } from './states';
import { vehicleMass } from './mass';
import { mountedParts } from './grid';

describe('crash contacts', () => {
  it('ignores sliding speed and separating contacts', () => {
    expect(computeClosingSpeed({ x: 2, y: 20 }, { x: 1, y: 0 })).toBe(2);
    expect(computeClosingSpeed({ x: -2, y: 20 }, { x: 1, y: 0 })).toBe(0);
  });

  it('selects the touched front lane rather than the whole vehicle', () => {
    const contact = locateCrashContact('scout', [{ x: 2, y: 0 }], { x: 1, y: 0 });
    expect(contact.side).toBe('front');
    expect(contact.lanes).toHaveLength(1);
  });

  it('uses the captured side even after the vehicle turns away', () => {
    const run = (heading: number) => {
      const world = emptyWorld();
      const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
      vehicle.heading = heading;
      applyContactCrash(world, vehicle, null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
      return mountedParts(vehicle).map((part) => ({ def: part.defId, hp: part.hp }));
    };
    expect(run(Math.PI)).toEqual(run(0));
  });

  it('does not damage wheels outside the touched bumper lane', () => {
    const world = emptyWorld();
    const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const wheels = mountedParts(vehicle).filter((part) => part.defId === 'wheel');
    const before = wheels.map((part) => part.hp);
    applyContactCrash(world, vehicle, null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
    expect(wheels.map((part) => part.hp)).toEqual(before);
    expect(mountedParts(vehicle).find((part) => part.defId === 'ram')?.hp).toBeLessThan(partDef('ram').hp);
  });

  it('keeps armor protection across simultaneous contact lanes', () => {
    const world = emptyWorld();
    const vehicle = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const parts = mountedParts(vehicle);
    const ram = parts.find((part) => part.defId === 'ram');
    const engine = parts.find((part) => part.defId === 'stockEngine');
    if (!ram || !engine) throw new Error('Missing front armor or engine');
    ram.hp = 1;
    const hp = engine.hp;
    applyContactCrash(world, vehicle, null, 'rock', 9, { a: { side: 'front', lanes: [1, 2, 3] }, b: null });
    expect(ram.hp).toBe(0);
    expect(engine.hp).toBe(hp);
  });

  it('rejects missing geometry', () => {
    expect(() => locateCrashContact('scout', [], { x: 1, y: 0 })).toThrow('no contact points');
    expect(() => computeClosingSpeed({ x: 2, y: 0 }, { x: 0, y: 0 })).toThrow('no horizontal direction');
  });
});

describe('ram practice', () => {
  const geometry = { a: { side: 'front' as const, lanes: [1, 2] }, b: { side: 'left' as const, lanes: [1, 2] } };

  it('pays the player for damage dealt, harder against a heavier truck', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const other = addVehicle(world, 'raiders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    applyContactCrash(world, me, other, other.id, 6, geometry);
    const collision = world.events.find((e) => e.t === 'collision');
    if (collision?.t !== 'collision') throw new Error('No collision');
    const dealt = collision.hitsB.reduce((sum, hit) => sum + hit.damage, 0);
    expect(dealt).toBeGreaterThan(0);
    const [event] = practiceOf(world, 'ram');
    expect(event.amount).toBe(dealt);
    expect(event.difficulty).toBeCloseTo(vehicleMass(other) / (vehicleMass(other) + vehicleMass(me)));
  });

  it('pays the player as the second body of a crash', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const other = addVehicle(world, 'raiders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    applyContactCrash(world, other, me, me.id, 6, geometry);
    expect(practiceOf(world, 'ram')).toHaveLength(1);
  });

  it('pays nothing for a crash into a rock', () => {
    const world = emptyWorld();
    applyContactCrash(world, world.vehicles[0], null, 'rock', 6, { a: { side: 'front', lanes: [2] }, b: null });
    expect(practiceOf(world, 'ram')).toEqual([]);
  });

  it('pays nothing for a crash between two NPCs', () => {
    const world = emptyWorld();
    const a = addVehicle(world, 'raiders', 'scout', ['stockEngine', 'ram'], { x: 40, y: 40 });
    const b = addVehicle(world, 'traders', 'hauler', ['stockEngine'], { x: 42, y: 40 });
    applyContactCrash(world, a, b, b.id, 6, geometry);
    expect(practiceOf(world, 'ram')).toEqual([]);
  });
});


describe('crash damage multiplier', () => {
  function rockCrash(mult: number, impact: number): number {
    const saved = RULES.crashDamage;
    (RULES as { crashDamage: number }).crashDamage = mult;
    try {
      const world = emptyWorld();
      const vehicle = world.vehicles[0];
      const before = mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
      applyContactCrash(world, vehicle, null, 'rock', impact, { a: { side: 'front', lanes: [1, 2, 3] }, b: null });
      return before - mountedParts(vehicle).reduce((sum, part) => sum + part.hp, 0);
    } finally {
      (RULES as { crashDamage: number }).crashDamage = saved;
    }
  }

  it('acts on crash energy like a slower impact', () => {
    const impact = RULES.hardCrashSpeed;
    expect(rockCrash(0.5, impact)).toBe(rockCrash(1, impact / Math.SQRT2));
    expect(rockCrash(0.5, impact)).toBeLessThan(rockCrash(1, impact));
  });

  it('a crash into an obstacle past the hard crash speed hits much harder than its energy alone', () => {
    const slow = rockCrash(1, RULES.hardCrashSpeed);
    expect(rockCrash(1, RULES.hardCrashSpeed * 2)).toBeGreaterThan(slow * 4 * 1.5);
  });
});

describe('the rammer perk', () => {
  const geometry = { a: { side: 'front' as const, lanes: [1, 2] }, b: { side: 'left' as const, lanes: [1, 2] } };

  function rammerWorld() {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const foe = addVehicle(world, 'raiders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    foe.brain = npcBrain('hauler', foe.pos, ['raider']);
    addState(world, 'feud', foe.id, me.id, { kind: 'feud', robbery: false });
    expect(isHostile(world, me, foe)).toBe(true);
    return { world, me, foe };
  }

  it('stalls a hostile truck the player damages through the next turn', () => {
    const { world, me, foe } = rammerWorld();
    world.player.perks.push('rammer');
    applyContactCrash(world, me, foe, foe.id, 6, geometry);
    expect(foe.stalledUntil).toBe(world.turn + PERK_NUMBERS.rammer.stallTurns);
  });

  it('stalls the hostile truck when the player is the second body of the crash', () => {
    const { world, me, foe } = rammerWorld();
    world.player.perks.push('rammer');
    applyContactCrash(world, foe, me, me.id, 6, geometry);
    expect(foe.stalledUntil).toBe(world.turn + PERK_NUMBERS.rammer.stallTurns);
    expect(me.stalledUntil).toBeUndefined();
  });

  it('stalls nothing without the perk', () => {
    const { world, me, foe } = rammerWorld();
    applyContactCrash(world, me, foe, foe.id, 6, geometry);
    expect(foe.stalledUntil).toBeUndefined();
  });

  it('stalls nothing when the rammed truck is not hostile', () => {
    const world = emptyWorld();
    world.player.perks.push('rammer');
    const me = world.vehicles[0];
    const trader = addVehicle(world, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    trader.brain = npcBrain('hauler', trader.pos, ['trader']);
    applyContactCrash(world, me, trader, trader.id, 6, geometry);
    expect(trader.stalledUntil).toBeUndefined();
  });

  it('stalls nothing in a crash between two NPCs', () => {
    const { world, foe } = rammerWorld();
    world.player.perks.push('rammer');
    const other = addVehicle(world, 'traders', 'scout', ['stockEngine', 'ram'], { x: 34, y: 30 });
    applyContactCrash(world, other, foe, foe.id, 6, geometry);
    expect(foe.stalledUntil).toBeUndefined();
  });
});

describe('crash with a tow client', () => {
  const geometry = { a: { side: 'front' as const, lanes: [1, 2] }, b: { side: 'left' as const, lanes: [1, 2] } };
  const damages = (world: ReturnType<typeof emptyWorld>) => {
    const collision = world.events.find((e) => e.t === 'collision');
    if (collision?.t !== 'collision') throw new Error('No collision');
    const sum = (hits: { damage: number }[]) => hits.reduce((total, hit) => total + hit.damage, 0);
    return { onA: sum(collision.hitsA), onB: sum(collision.hitsB) };
  };

  function pair() {
    const world = emptyWorld();
    const client = world.vehicles[0];
    const tower = addVehicle(world, 'traders', 'hauler', ['stockEngine'], { x: 32, y: 30 });
    return { world, client, tower };
  }

  it('hurts neither truck once the tower answers', () => {
    const { world, client, tower } = pair();
    addState(world, 'answering', tower.id, client.id, { kind: 'none' });
    applyContactCrash(world, client, tower, tower.id, 6, geometry);
    expect(damages(world)).toEqual({ onA: 0, onB: 0 });
  });

  it('hurts neither truck when the tower is the first body', () => {
    const { world, client, tower } = pair();
    addState(world, 'tow', tower.id, client.id, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: false });
    applyContactCrash(world, tower, client, client.id, 6, geometry);
    expect(damages(world)).toEqual({ onA: 0, onB: 0 });
  });

  it('still hurts both trucks with no tow between them', () => {
    const { world, client, tower } = pair();
    applyContactCrash(world, client, tower, tower.id, 6, geometry);
    expect(damages(world).onA).toBeGreaterThan(0);
    expect(damages(world).onB).toBeGreaterThan(0);
  });
});
