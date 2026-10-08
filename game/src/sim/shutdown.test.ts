import { describe, expect, it } from 'vitest';
import { partDef } from '../data/parts';
import { fightsAgainst, fireBlock, inFeud } from './combat';
import { scannerRange, soundRange } from './detect';
import { makePart } from './factory';
import { mountPart } from './inventory';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, testDrive } from './testkit';
import type { GameEvent, PartInstance, Vehicle, World } from './types';
import { activateUtilities, isShutDown, settleShutdowns, shutDownTurnsLeft, utilityBlock } from './utility';
import { endTurn, setUtilityOrder, setWeaponOrder } from './world';

const RADIUS = emitterRadius();

function emitterRadius(): number {
  const def = partDef('emitter');
  if (def.kind !== 'utility' || def.effect.type !== 'emitter') throw new Error('The emitter is not an emitter');
  return def.effect.radius;
}

function emitterUser(): { w: World; me: Vehicle; emitter: PartInstance } {
  const w = emptyWorld({ x: 30, y: 60 });
  const me = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 30 });
  const emitter = makePart(w, 'emitter', 0);
  if (!mountPart(w, me, emitter)) throw new Error('No deck room for the emitter');
  return { w, me, emitter };
}

function trader(w: World, gap: number): Vehicle {
  return addVehicle(w, 'traders', 'hauler', ['stockEngine', 'mg', 'scanner', 'sprout'], { x: 30 + gap, y: 30 });
}

function playerOf(w: World): Vehicle {
  return w.vehicles[0];
}

function pulse(w: World, me: Vehicle, emitter: PartInstance): void {
  fireEmitter(w, me, emitter);
  settleShutdowns(w);
}

function fireEmitter(w: World, me: Vehicle, emitter: PartInstance): void {
  w.events = [];
  me.utilityOrders[emitter.id] = { kind: 'self' };
  activateUtilities(w);
}

function nextTurn(w: World): void {
  w.turn++;
  w.events = [];
}

function pulseEvent(w: World): Extract<GameEvent, { t: 'pulse' }> {
  const found = w.events.filter((e): e is Extract<GameEvent, { t: 'pulse' }> => e.t === 'pulse');
  if (found.length !== 1) throw new Error(`Expected one pulse, got ${found.length}`);
  return found[0];
}

function partOf(v: Vehicle, defId: string): PartInstance {
  const part = v.items.flatMap((it) => (it.kind === 'part' && it.part.defId === defId ? [it.part] : []))[0];
  if (!part) throw new Error(`${v.name} has no ${defId}`);
  return part;
}

describe('the emitter pulse', () => {
  it('spares its user and shuts down every other truck in the radius, allies, neutrals and hostiles alike', () => {
    const { w, me, emitter } = emitterUser();
    const ally = trader(w, RADIUS - 1);
    const raider = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 30 - 3, y: 30 });
    const player = playerOf(w);
    player.pos = { x: 30, y: 30 + RADIUS - 0.5 };
    const far = trader(w, RADIUS + 1);
    pulse(w, me, emitter);

    const window = { from: w.turn + 1, until: w.turn + 2 };
    expect(me.shutDown).toBeUndefined();
    expect([ally.shutDown, raider.shutDown, player.shutDown]).toEqual([window, window, window]);
    expect(far.shutDown).toBeUndefined();
    expect(pulseEvent(w)).toEqual({ t: 'pulse', vehicle: me.id, pos: me.pos, hit: [player.id, ally.id, raider.id] });
  });

  it('starts the reload', () => {
    const { w, me, emitter } = emitterUser();
    pulse(w, me, emitter);

    expect(emitter.charge?.reload).toBeGreaterThan(0);
  });

  it('leaves the speed of the trucks it hits as it was', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    near.speed = 6;
    pulse(w, me, emitter);

    expect(near.speed).toBe(6);
  });

  it('shuts down for the resolutions of the next 2 turns and the planning before each, and no longer', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    pulse(w, me, emitter);

    const planned = [isShutDown(w, near)];
    const resolved: boolean[] = [];
    for (let n = 0; n < 3; n++) {
      nextTurn(w);
      resolved.push(isShutDown(w, near));
      settleShutdowns(w);
      planned.push(isShutDown(w, near));
    }
    expect(resolved).toEqual([true, true, false]);
    expect(planned).toEqual([true, true, false, false]);
  });

  it('leaves the shots of the pulse turn itself alone', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    fireEmitter(w, me, emitter);
    const [mg] = vehicleStats(w, near).weapons;

    expect(fireBlock(w, near, mg, me)).not.toBe('shutDown');
    expect(utilityBlock(w, near, partOf(near, 'sprout'))).toBeNull();
  });

  it('counts the shut-down turns still ahead while the player plans', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    pulse(w, me, emitter);

    const left = [shutDownTurnsLeft(w, near)];
    for (let n = 0; n < 2; n++) {
      nextTurn(w);
      settleShutdowns(w);
      left.push(shutDownTurnsLeft(w, near));
    }
    expect(left).toEqual([2, 1, 0]);
    expect(shutDownTurnsLeft(w, me)).toBe(0);
  });

  it('starts again for a truck pulsed while still shut down', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    pulse(w, me, emitter);
    nextTurn(w);
    emitter.charge!.reload = 0;
    pulse(w, me, emitter);

    expect(near.shutDown).toEqual({ from: w.turn + 1, until: w.turn + 2 });
  });

  it('is a hostile act against a neutral it catches, which starts a feud', () => {
    const { w, me, emitter } = emitterUser();
    const near = trader(w, 3);
    pulse(w, me, emitter);

    expect(inFeud(w, me, near)).toBe(true);
    expect(fightsAgainst(w, me, near)).toBe(true);
  });

  it('is no hostile act against a truck outside the radius', () => {
    const { w, me, emitter } = emitterUser();
    const far = trader(w, RADIUS + 1);
    pulse(w, me, emitter);

    expect(inFeud(w, me, far)).toBe(false);
    expect(fightsAgainst(w, me, far)).toBe(false);
  });
});

describe('a shut-down truck', () => {
  function shutDownTrader(): { w: World; me: Vehicle; it: Vehicle } {
    const { w, me, emitter } = emitterUser();
    const it = trader(w, 3);
    pulse(w, me, emitter);
    nextTurn(w);
    return { w, me, it };
  }

  it('cannot fire its guns', () => {
    const { w, me, it } = shutDownTrader();
    const [mg] = vehicleStats(w, it).weapons;

    expect(fireBlock(w, it, mg, me)).toBe('shutDown');
  });

  it('cannot use its utilities', () => {
    const { w, it } = shutDownTrader();

    expect(utilityBlock(w, it, partOf(it, 'sprout'))).toBe('shutDown');
  });

  it('has no engine force, top speed or fuel burn', () => {
    const { w, it } = shutDownTrader();
    const s = vehicleStats(w, it);

    expect([s.maxSpeed, s.accel, s.fuelPerTile]).toEqual([0, 0, 0]);
  });

  it('makes no engine sound while it rolls, and its scanner is off', () => {
    const { w, it } = shutDownTrader();
    it.speed = 6;

    expect(soundRange(w, it)).toBe(0);
    expect(scannerRange(w, it)).toBe(0);
  });

  it('runs as before once the shutdown is over', () => {
    const { w, me, it } = shutDownTrader();
    settleShutdowns(w);
    nextTurn(w);
    settleShutdowns(w);
    nextTurn(w);
    it.speed = 6;
    const [mg] = vehicleStats(w, it).weapons;

    expect(fireBlock(w, it, mg, me)).not.toBe('shutDown');
    expect(vehicleStats(w, it).maxSpeed).toBeGreaterThan(0);
    expect(soundRange(w, it)).toBeGreaterThan(0);
    expect(scannerRange(w, it)).toBeGreaterThan(0);
  });
});

describe('the player shut down', () => {
  function pulsedPlayer(): { w: World; sprout: PartInstance } {
    const { w, me, emitter } = emitterUser();
    const player = playerOf(w);
    player.pos = { x: 33, y: 30 };
    const sprout = makePart(w, 'sprout', 0);
    if (!mountPart(w, player, sprout)) throw new Error('No deck room for the Sprout');
    pulse(w, me, emitter);
    return { w, sprout };
  }

  it('is refused utility orders while planning the 2 shut-down turns, and given them for the turn after', () => {
    const { w, sprout } = pulsedPlayer();
    const use = () => setUtilityOrder(w, sprout.id, { kind: 'self' });

    expect(use).toThrow(/shutDown/);
    nextTurn(w);
    settleShutdowns(w);
    expect(use).toThrow(/shutDown/);
    nextTurn(w);
    settleShutdowns(w);
    expect(use).not.toThrow();
  });

  it('plans the next turn with no top speed or engine force, so the path preview coasts', () => {
    const { w } = pulsedPlayer();
    const s = vehicleStats(w, playerOf(w));

    expect([s.maxSpeed, s.accel]).toEqual([0, 0]);
  });
});

describe('a pulse in the turn pipeline', () => {
  it('lets the player fire back in the pulse turn and shuts it down when the turn ends', () => {
    const w0 = emptyWorld();
    const player = playerOf(w0);
    const raider = addVehicle(w0, 'raiders', 'hauler', ['stockEngine'], { x: 33, y: 30 });
    const emitter = makePart(w0, 'emitter', 0);
    if (!mountPart(w0, raider, emitter)) throw new Error('No deck room for the emitter');
    raider.utilityOrders[emitter.id] = { kind: 'self' };
    const [mg] = vehicleStats(w0, player).weapons;
    const w = endTurn(setWeaponOrder(w0, mg.part.id, { targetId: raider.id, aim: 'body' }), testDrive);

    expect(w.events.some((e) => e.t === 'shot' && e.shooter === player.id)).toBe(true);
    expect(w.events.some((e) => e.t === 'pulse' && e.hit.includes(player.id))).toBe(true);
    expect(playerOf(w).shutDown).toEqual({ from: w.turn + 1, until: w.turn + 2 });
  });
});
