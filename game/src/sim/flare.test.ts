import { describe, expect, it } from 'vitest';
import { DETECT } from '../data/detect';
import { partDef } from '../data/parts';
import { TIME } from '../data/time';
import { contactsOf } from './detect';
import { makePart } from './factory';
import { launchFlare, litAt } from './hazards';
import { mountPart } from './inventory';
import { planNpcOrders } from './ai';
import { topGoal } from './npc-activities';
import { sunAt } from './sun';
import { addVehicle, editableTerrain, emptyWorld, forceOption, npcBrain, testDrive } from './testkit';
import type { PartInstance, Vehicle, World } from './types';
import { activateUtilities, advanceUtilityEffects } from './utility';
import { dist, type Vec } from './vec';
import { canVehicleSee, tileOf, visibleTiles } from './vision';
import { endTurn } from './world';

const night = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
const day = () => Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;

// The flare cannon's burn: radius 10 tiles for 6 turns.
function burn(): { radius: number; turns: number } {
  const def = partDef('flareCannon');
  if (def.kind !== 'utility' || def.effect.type !== 'flare') throw new Error('flareCannon is not a flare');
  return def.effect;
}

function mounted(w: World, v: Vehicle, defId: string): PartInstance {
  const part = makePart(w, defId, 0);
  if (!mountPart(w, v, part)) throw new Error(`No deck room for ${defId}`);
  return part;
}

// A parked trader at 100,100, the player far off. Night sight is 10 tiles and day sight 20, so a point 15 tiles east
// lies past night sight and within day sight.
function viewer(turn: number): { w: World; npc: Vehicle; east: Vec } {
  const w = emptyWorld({ x: 300, y: 300 });
  w.turn = turn;
  const npc = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 100, y: 100 });
  return { w, npc, east: { x: 115, y: 100 } };
}

describe('flare light', () => {
  it('at night shows a point inside the flare at the day radius', () => {
    const { w, npc, east } = viewer(night());
    expect(canVehicleSee(w, npc, east)).toBe(false);

    launchFlare(w, w.vehicles[0], east, burn());

    expect(litAt(w, east)).toBe(true);
    expect(canVehicleSee(w, npc, east)).toBe(true);
  });

  it('at night leaves a point outside the flare at night sight', () => {
    const { w, npc, east } = viewer(night());
    const south = { x: 100, y: 115 };

    launchFlare(w, w.vehicles[0], east, burn());

    expect(litAt(w, south)).toBe(false);
    expect(canVehicleSee(w, npc, south)).toBe(false);
  });

  it('by day changes nothing', () => {
    const { w, npc, east } = viewer(day());
    const far = { x: 125, y: 100 };
    const before = [canVehicleSee(w, npc, east), canVehicleSee(w, npc, far)];

    launchFlare(w, w.vehicles[0], { x: 120, y: 100 }, burn());

    expect(litAt(w, east)).toBe(false);
    expect([canVehicleSee(w, npc, east), canVehicleSee(w, npc, far)]).toEqual(before);
    expect(before).toEqual([true, false]);
  });

  it('lights the player view at night inside the flare only', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    w.turn = night();
    const east = { x: 115, y: 100 };
    const south = { x: 100, y: 115 };
    const dark = visibleTiles(w, { x: 100, y: 100 });

    launchFlare(w, w.vehicles[0], east, burn());
    const lit = visibleTiles(w, { x: 100, y: 100 });

    expect(dark.has(tileOf(w, east))).toBe(false);
    expect(lit.has(tileOf(w, east))).toBe(true);
    expect(lit.has(tileOf(w, south))).toBe(false);
    expect([...lit].every((idx) => dark.has(idx) || litAt(w, { x: (idx % w.size) + 0.5, y: Math.floor(idx / w.size) + 0.5 }))).toBe(true);
  });

  it('does not see through a hill', () => {
    const { w, npc, east } = viewer(night());
    w.vehicles[0].pos = { x: 100, y: 96 }; // in the live range, where hills count
    const terrain = editableTerrain(w);
    for (let y = 0; y <= w.size; y++) terrain.heights[y * (w.size + 1) + 108] = 5; // a ridge across x = 108

    launchFlare(w, w.vehicles[0], east, burn());

    expect(canVehicleSee(w, npc, east)).toBe(false);
  });

  it('still loses sight to a storm around the viewer', () => {
    const { w, npc, east } = viewer(night());
    w.weather = [{ id: 'w1', kind: 'storm', pos: { ...npc.pos }, radius: 30, vel: { x: 0, y: 0 }, turnsLeft: 5 }];

    launchFlare(w, w.vehicles[0], east, burn());

    expect(canVehicleSee(w, npc, east)).toBe(false);
  });
});

describe('the Flare cannon', () => {
  // The player at 100,100 with a flare cannon on its deck, at the given time of day.
  function launcher(turn: number): { w: World; me: Vehicle; part: PartInstance } {
    const w = emptyWorld({ x: 100, y: 100 });
    w.turn = turn;
    const me = w.vehicles[0];
    return { w, me, part: mounted(w, me, 'flareCannon') };
  }

  it('puts its flare on the chosen point and starts its reload', () => {
    const { w, me, part } = launcher(night());
    const pos = { x: 100, y: 120 };
    me.utilityOrders[part.id] = { kind: 'point', pos };

    activateUtilities(w);

    expect(w.flares).toEqual([{ id: expect.any(String), source: me.id, pos, r: 10, turnsLeft: 6 }]);
    expect(part.charge).toEqual({ reload: 10 });
  });

  it('at night shows its launch to a truck 70 tiles off, and not to one 90 tiles off', () => {
    const { w, me, part } = launcher(night());
    const near = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 170, y: 100 });
    const far = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 10, y: 100 });
    me.utilityOrders[part.id] = { kind: 'point', pos: { x: 100, y: 120 } };

    activateUtilities(w);
    const seen = contactsOf(w, near, Infinity).find((c) => c.vehicleId === me.id);

    expect(seen?.sources).toEqual(['flare']);
    expect(seen!.radius).toBeLessThanOrEqual(DETECT.fuzz.base);
    expect(dist(seen!.center, me.pos)).toBeLessThanOrEqual(seen!.radius);
    expect(contactsOf(w, far, Infinity).some((c) => c.vehicleId === me.id)).toBe(false);
  });

  it('by day gives no contact', () => {
    const { w, me, part } = launcher(day());
    const near = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 170, y: 100 });
    me.utilityOrders[part.id] = { kind: 'point', pos: { x: 100, y: 120 } };

    activateUtilities(w);

    expect(contactsOf(w, near, Infinity).some((c) => c.vehicleId === me.id)).toBe(false);
  });

  it('after its launch turn shows its light: a contact at the flare that holds the launcher', () => {
    const { w, me, part } = launcher(night());
    const pos = { x: 124, y: 100 };
    const watcher = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 184, y: 100 }); // 84 from the launcher, 60 from the flare
    me.utilityOrders[part.id] = { kind: 'point', pos };
    activateUtilities(w);

    advanceUtilityEffects(w);
    const seen = contactsOf(w, watcher, Infinity).find((c) => c.vehicleId === me.id);

    expect(seen?.sources).toEqual(['flare']);
    expect(seen!.center).toEqual(pos);
    expect(dist(seen!.center, me.pos)).toBeLessThanOrEqual(seen!.radius);
  });

  it('reaches the player\'s contacts in the turn an NPC launches it', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    w.turn = night() - 1;
    const raider = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 170, y: 100 });
    const part = mounted(w, raider, 'flareCannon');
    raider.utilityOrders[part.id] = { kind: 'point', pos: { x: 190, y: 100 } };

    const next = endTurn(w, testDrive);

    expect(sunAt(next.turn)).toBeNull();
    expect(next.player.contacts.find((c) => c.vehicleId === raider.id)?.sources).toEqual(['flare']);
  });

  it('makes an NPC roll on the launch it saw', () => {
    const { w, me, part } = launcher(night());
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 170, y: 100 });
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('contactHeard', 'investigate');
    me.utilityOrders[part.id] = { kind: 'point', pos: { x: 100, y: 120 } };

    activateUtilities(w);
    planNpcOrders(w);

    expect(topGoal(raider)?.kind).toBe('investigate');
    expect(topGoal(raider)?.targetId).toBe(me.id);
  });

  it('burns for 6 turns, then is gone and lights nothing', () => {
    const { w, me, part } = launcher(night());
    const pos = { x: 100, y: 120 };
    me.utilityOrders[part.id] = { kind: 'point', pos };
    activateUtilities(w);

    for (let turn = 1; turn < 6; turn++) advanceUtilityEffects(w);
    expect(w.flares).toHaveLength(1);

    advanceUtilityEffects(w);
    expect(w.flares).toEqual([]);
    expect(litAt(w, pos)).toBe(false);
  });
});
