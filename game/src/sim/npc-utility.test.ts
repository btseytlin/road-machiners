import { describe, expect, it } from 'vitest';
import { REGION } from '../data/region';
import { TIME } from '../data/time';
import { makePart } from './factory';
import { corePart, mountedParts } from './grid';
import { mountPart } from './inventory';
import { assignUtilityOrders } from './npc-utility';
import { siteGates } from './sites';
import { addState } from './states';
import { sunAt } from './sun';
import { activateUtilities } from './utility';
import { addVehicle, emptyWorld, npcBrain, startCombat, testDrive } from './testkit';
import { endTurn } from './world';
import type { NpcActivity, PartInstance, Vehicle, World } from './types';
import { maxHp } from './wear';

const NPC_POS = { x: 60, y: 40 };
const NIGHT = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => !sunAt(t))!;
const GATE = siteGates(REGION.towns[0])[0];
const DAY = Array.from({ length: TIME.turnsPerDay }, (_, i) => i + 1).find((t) => sunAt(t))!;

// A trader hauler facing east with one utility, far from the player.
function npcWith(defId: string): { w: World; npc: Vehicle; part: PartInstance } {
  const w = emptyWorld();
  const npc = addVehicle(w, 'traders', 'hauler', ['stockEngine', defId], { ...NPC_POS });
  npc.brain = npcBrain('trader', npc.pos, ['trader']);
  const part = mountedParts(npc).find((p) => p.defId === defId);
  if (!part) throw new Error(`${defId} did not mount`);
  return { w, npc, part };
}

// A raider hauler `dx` tiles east of the NPC, driving along `heading`, in a feud with it.
function foeAt(w: World, npc: Vehicle, dx: number, heading = 0, speed = 3): Vehicle {
  const foe = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: npc.pos.x + dx, y: npc.pos.y }, heading);
  foe.speed = speed;
  addState(w, 'feud', foe.id, npc.id, { kind: 'feud', robbery: false });
  return foe;
}

function goal(kind: NpcActivity['kind'], target: Vehicle | null, destination: { x: number; y: number } | null = null): NpcActivity {
  return { kind, targetId: target?.id ?? null, destination, phase: 'travel', reason: 'test' };
}

// The NPC is fleeing `foe`, which shot at it.
function fleeing(w: World, npc: Vehicle, foe: Vehicle): void {
  npc.brain!.goals = [goal('flee', foe, { x: npc.pos.x + 30, y: npc.pos.y })];
  npc.brain!.attackers[foe.id] = true;
  startCombat(w, foe, npc);
}

describe('NPC harpoon', () => {
  it('fires at its fight target when the target is in range and driving away', () => {
    const { w, npc, part } = npcWith('harpoon');
    const foe = foeAt(w, npc, 5, 0);
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'truck', targetId: foe.id, aim: 'body' });
  });

  it('holds fire at a target that drives toward it', () => {
    const { w, npc, part } = npcWith('harpoon');
    const foe = foeAt(w, npc, 5, Math.PI);
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('holds fire inside a town guard', () => {
    const { w, npc, part } = npcWith('harpoon');
    npc.pos = { ...GATE };
    const foe = foeAt(w, npc, 5, 0);
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('sets a standing order on a target out of range, which waits for it', () => {
    const { w, npc, part } = npcWith('harpoon');
    const foe = foeAt(w, npc, 12, 0);
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);
    activateUtilities(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'truck', targetId: foe.id, aim: 'body' });
  });

  it('keeps its standing order while the fight with that target goes on', () => {
    const { w, npc, part } = npcWith('harpoon');
    const foe = foeAt(w, npc, 12, Math.PI);
    npc.brain!.goals = [goal('fight', foe)];
    npc.utilityOrders[part.id] = { kind: 'truck', targetId: foe.id, aim: 'body' };

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'truck', targetId: foe.id, aim: 'body' });
  });

  it('clears its standing order when its fight with that target ends', () => {
    const { w, npc, part } = npcWith('harpoon');
    const foe = foeAt(w, npc, 12, 0);
    npc.brain!.goals = [goal('fight', foe)];
    assignUtilityOrders(w);
    expect(npc.utilityOrders[part.id]).toBeDefined();

    npc.brain!.goals = [];
    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('moves its standing order to a new fight target', () => {
    const { w, npc, part } = npcWith('harpoon');
    const old = foeAt(w, npc, 12, 0);
    const foe = foeAt(w, npc, 6, 0);
    npc.utilityOrders[part.id] = { kind: 'truck', targetId: old.id, aim: 'body' };
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'truck', targetId: foe.id, aim: 'body' });
  });
});

describe('NPC sprout', () => {
  it('smokes up while fleeing a fight with an attacker in sight', () => {
    const { w, npc, part } = npcWith('sprout');
    fleeing(w, npc, foeAt(w, npc, 6));

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });
  });

  it('smokes up when its cab is below half with an attacker in sight', () => {
    const { w, npc, part } = npcWith('sprout');
    const foe = foeAt(w, npc, 6);
    npc.brain!.attackers[foe.id] = true;
    const cab = corePart(npc, 'cab');
    cab.hp = maxHp(cab) * 0.4;

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });
  });

  it('keeps it with no attacker in sight', () => {
    const { w, npc, part } = npcWith('sprout');
    npc.brain!.goals = [goal('flee', null, { x: 90, y: 40 })];
    const cab = corePart(npc, 'cab');
    cab.hp = maxHp(cab) * 0.4;

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('gives no order while the sprout recharges', () => {
    const { w, npc, part } = npcWith('sprout');
    fleeing(w, npc, foeAt(w, npc, 6));
    part.charge = { reload: 4 };

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });
});

describe('NPC caltrops and oil', () => {
  it.each(['caltrops', 'oilSpiller'])('drops %s while fleeing a hostile close behind', (defId) => {
    const { w, npc, part } = npcWith(defId);
    fleeing(w, npc, foeAt(w, npc, -6));

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });
  });

  it.each(['caltrops', 'oilSpiller'])('keeps %s when the hostile is ahead', (defId) => {
    const { w, npc, part } = npcWith(defId);
    fleeing(w, npc, foeAt(w, npc, 6));

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it.each(['caltrops', 'oilSpiller'])('drops %s on the ground it drove over while fleeing east', (defId) => {
    const { w, npc, part } = npcWith(defId);
    npc.speed = 8;
    npc.trail = Array.from({ length: 5 }, (_, i) => ({ x: npc.pos.x - 8 + i * 2, y: npc.pos.y, heading: 0 }));
    fleeing(w, npc, foeAt(w, npc, -6));

    assignUtilityOrders(w);
    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });

    activateUtilities(w);
    expect(npc.utilityOrders).toEqual({});
    expect(w.fields.filter((f) => f.source === npc.id).length).toBeGreaterThan(0);
  });

  it('keeps caltrops when the hostile behind is far', () => {
    const { w, npc, part } = npcWith('caltrops');
    fleeing(w, npc, foeAt(w, npc, -14));

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });
});

describe('NPC smoke mortar', () => {
  it('shells the midpoint toward its nearest attacker while fleeing', () => {
    const { w, npc, part } = npcWith('smokeMortar');
    fleeing(w, npc, foeAt(w, npc, -12));

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'point', pos: { x: npc.pos.x - 6, y: npc.pos.y } });
  });

  it('holds fire when not fleeing', () => {
    const { w, npc, part } = npcWith('smokeMortar');
    const foe = foeAt(w, npc, -12);
    npc.brain!.attackers[foe.id] = true;
    npc.brain!.goals = [goal('fight', foe)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });
});

describe('NPC flare cannon', () => {
  it('lights the contact it investigates at night', () => {
    const { w, npc, part } = npcWith('flareCannon');
    w.turn = NIGHT;
    const center = { x: npc.pos.x + 15, y: npc.pos.y };
    npc.brain!.goals = [goal('investigate', null, center)];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'point', pos: center });
  });

  it('keeps it by day', () => {
    const { w, npc, part } = npcWith('flareCannon');
    w.turn = DAY;
    npc.brain!.goals = [goal('investigate', null, { x: npc.pos.x + 15, y: npc.pos.y })];

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });
});

describe('NPC emitter', () => {
  it('pulses in a fight with a hostile in the radius and no other truck', () => {
    const { w, npc, part } = npcWith('emitter');
    startCombat(w, foeAt(w, npc, 4), npc);

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });
  });

  it('holds the pulse with a faction mate in the radius', () => {
    const { w, npc, part } = npcWith('emitter');
    startCombat(w, foeAt(w, npc, 4), npc);
    addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: npc.pos.x, y: npc.pos.y + 4 });

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('holds the pulse with no hostile in the radius', () => {
    const { w, npc, part } = npcWith('emitter');
    startCombat(w, foeAt(w, npc, 9), npc);

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('holds the pulse out of a fight', () => {
    const { w, npc, part } = npcWith('emitter');
    foeAt(w, npc, 4);

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });

  it('holds the pulse inside a town guard', () => {
    const { w, npc, part } = npcWith('emitter');
    npc.pos = { ...GATE };
    startCombat(w, foeAt(w, npc, 4), npc);

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toBeUndefined();
  });
});

describe('NPC claymore ram', () => {
  it('arms when the driver chose to ram', () => {
    const { w, npc, part } = npcWith('claymoreRam');
    const foe = foeAt(w, npc, 6);
    npc.brain!.goals = [goal('fight', foe)];
    npc.brain!.ramChoice = foe.id;

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual({ kind: 'self' });
  });

  it('gives no order to an armed claymore or a driver that chose no ram', () => {
    const armed = npcWith('claymoreRam');
    const foe = foeAt(armed.w, armed.npc, 6);
    armed.npc.brain!.ramChoice = foe.id;
    armed.part.charge = { reload: 0, armed: true };
    const calm = npcWith('claymoreRam');

    assignUtilityOrders(armed.w);
    assignUtilityOrders(calm.w);

    expect(armed.npc.utilityOrders[armed.part.id]).toBeUndefined();
    expect(calm.npc.utilityOrders[calm.part.id]).toBeUndefined();
  });
});

describe('who gets utility orders', () => {
  it('never orders for the player truck, even in a fight', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const part = makePart(w, 'sprout', 0);
    if (!mountPart(w, me, part)) throw new Error('No deck room for the sprout');
    const foe = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: me.pos.x + 6, y: me.pos.y });
    startCombat(w, foe, me);

    assignUtilityOrders(w);

    expect(me.utilityOrders).toEqual({});
  });

  it('keeps an order already given this turn', () => {
    const { w, npc, part } = npcWith('smokeMortar');
    fleeing(w, npc, foeAt(w, npc, -12));
    const given = { kind: 'point' as const, pos: { x: npc.pos.x, y: npc.pos.y + 8 } };
    npc.utilityOrders[part.id] = given;

    assignUtilityOrders(w);

    expect(npc.utilityOrders[part.id]).toEqual(given);
  });
});

describe('NPC utility use in the turn', () => {
  it('resolves an NPC order in the same turn, through the shared activation step', () => {
    const { w, npc, part } = npcWith('sprout');
    fleeing(w, npc, foeAt(w, npc, 6, 0, 0));

    const after = endTurn(w, testDrive);

    const used = after.events.filter((e) => e.t === 'utility' && e.vehicle === npc.id && e.part === part.id);
    expect(used).toHaveLength(1);
    expect(after.smoke.filter((cloud) => cloud.source === npc.id)).toHaveLength(1);
    expect(after.vehicles.find((v) => v.id === npc.id)?.utilityOrders).toEqual({});
  });
});
