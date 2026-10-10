import { describe, expect, it } from 'vitest';
import { resolveDestroyed } from './combat';
import { playerVehicle } from './damage';
import { checkKnockout } from './defeat';
import { callVehicle, honk, raiseCalls } from './dialogue';
import { corePart, mountedParts } from './grid';
import { addGoods, dumpItem } from './inventory';
import { spillDeadRows } from './spill';
import { fightCornered, thinkNpc, topGoal } from './npc-activities';
import { optionWeights } from './npc-decisions';
import { renewSalvage } from './salvage';
import { getResources } from './resources';
import { addState, advanceStates, stateOf } from './states';
import { setBeacon } from './tow';
import { addVehicle, emptyWorld, forceOption, furyRoadWorld, npcBrain } from './testkit';
import type { GameModeId, Vehicle, World } from './types';

import { TIME } from '../data/time';

function worldIn(mode: GameModeId): World {
  const w = emptyWorld({ x: 80, y: 80 });
  w.setup = { ...w.setup, mode };
  return w;
}

function raider(w: World, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, 'raiders', 'wagon', parts, { x: 86, y: 80 }, Math.PI);
  v.brain = npcBrain('buggy', v.pos, ['raider']);
  return v;
}

function hostile(w: World, v: Vehicle): void {
  addState(w, 'feud', v.id, w.player.vehicleId, { kind: 'feud', robbery: false });
  fightCornered(w, v, playerVehicle(w));
}

describe('yielding', () => {
  it('offers no flight, truce or mercy where no driver yields', () => {
    const w = worldIn('furyRoad');
    const v = raider(w);
    const me = w.player.vehicleId;

    expect(Object.keys(optionWeights(w, v, 'attacked', me, 1))).not.toContain('flee');
    expect(Object.keys(optionWeights(w, v, 'hostileSeen', me, 1))).not.toContain('flee');
    expect(Object.keys(optionWeights(w, v, 'parley', me, 1))).toEqual(['keep']);
    expect(Object.keys(optionWeights(w, v, 'truceOffered', me, 1))).toEqual(['refuse']);
    expect(Object.keys(optionWeights(w, v, 'threatened', me, 1))).not.toContain('comply');
  });

  it('keeps every option in Roaming', () => {
    const w = worldIn('roaming');
    const v = raider(w);
    const me = w.player.vehicleId;

    expect(Object.keys(optionWeights(w, v, 'attacked', me, 1))).toContain('flee');
    expect(Object.keys(optionWeights(w, v, 'parley', me, 1))).toEqual(expect.arrayContaining(['truce', 'beg', 'flee']));
  });

  it('never flees when attacked, even when flight is all it would pick', () => {
    forceOption('attacked', 'flee');
    const fled = Array.from({ length: 20 }, (_, seed) => {
      const w = worldIn('furyRoad');
      const v = raider(w);
      v.brain!.attackers = { [w.player.vehicleId]: false };
      w.rngState = seed + 1;
      thinkNpc(w, v);
      return v.brain!.goals.some((g) => g.kind === 'flee');
    });

    expect(fled.some((f) => f)).toBe(false);
  });

  it('leaves no fight for service in town', () => {
    const w = worldIn('furyRoad');
    const v = raider(w);
    v.resources!.fuel = 1;
    hostile(w, v);

    thinkNpc(w, v);

    expect(topGoal(v)?.kind).toBe('fight');
  });

  it('keeps a fight with no gun left, so the truck rams', () => {
    const furyRoad = worldIn('furyRoad');
    const roaming = worldIn('roaming');
    const unarmed = [furyRoad, roaming].map((w) => {
      const v = raider(w, ['stockEngine']);
      hostile(w, v);
      thinkNpc(w, v);
      return v;
    });

    expect(topGoal(unarmed[0])?.kind).toBe('fight');
    expect(topGoal(unarmed[1])?.kind).not.toBe('fight');
  });

  it('never gives up a fight that stalls', () => {
    const run = (mode: GameModeId) => {
      const w = worldIn(mode);
      const v = raider(w);
      hostile(w, v);
      topGoal(v)!.worn = { turn: w.turn - 100, condition: 1 };
      w.turn += 1;
      thinkNpc(w, v);
      return { w, v };
    };
    const furyRoad = run('furyRoad');
    const roaming = run('roaming');

    expect(topGoal(furyRoad.v)?.kind).toBe('fight');
    expect(stateOf(furyRoad.w, 'backedOff', furyRoad.v.id, furyRoad.w.player.vehicleId)).toBeNull();
    expect(stateOf(roaming.w, 'backedOff', roaming.v.id, roaming.w.player.vehicleId)).not.toBeNull();
  });

  it('lets a feud lapse without backing off', () => {
    const w = worldIn('furyRoad');
    const v = raider(w);
    v.pos = { x: 300, y: 300 };
    const feud = addState(w, 'feud', v.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    feud.turnsLeft = 1;
    w.turn += 1;

    advanceStates(w);

    expect(stateOf(w, 'feud', v.id, w.player.vehicleId)).toBeNull();
    expect(stateOf(w, 'backedOff', v.id, w.player.vehicleId)).toBeNull();
  });
});

describe('radio', () => {
  it('opens no call, raises no hail and sounds no horn where there is no radio', () => {
    const w = worldIn('furyRoad');
    const v = raider(w);

    expect(() => callVehicle(w, v.id)).toThrow(/radio/);
    expect(() => honk(w)).toThrow(/radio/);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });
});

describe('salvage', () => {
  it('leaves no salvage on a wreck and renews none', () => {
    const w = worldIn('furyRoad');
    const v = raider(w);
    getResources(w, v).health = 0;
    const before = structuredClone(w.salvage);

    resolveDestroyed(w);
    w.turn = TIME.turnsPerDay * 2;
    renewSalvage(w);

    expect(w.events).toContainEqual(expect.objectContaining({ t: 'destroyed', vehicle: v.id }));
    expect(w.salvage).toEqual(before);
  });
});

describe('knockouts', () => {
  it('knocks an NPC out by the same roll as in Roaming', () => {
    const fates = (mode: GameModeId) => Array.from({ length: 12 }, (_, seed) => {
      const w = worldIn(mode);
      const v = raider(w);
      corePart(v, 'cab').hp = 0;
      w.rngState = seed + 1;
      resolveDestroyed(w);
      return w.events.flatMap((e) => (e.t === 'npcKnockout' || e.t === 'destroyed' ? [e.t] : []));
    });

    expect(fates('furyRoad')).toEqual(fates('roaming'));
    expect(fates('furyRoad').some((events) => events.includes('npcKnockout'))).toBe(true);
  });

  it('ends the run when the player would be knocked out', () => {
    const w = furyRoadWorld(4);
    corePart(playerVehicle(w), 'cab').hp = 0;

    checkKnockout(w);

    expect(w.player.state).toBe('dead');
    expect(w.events).toEqual([{ t: 'runLost', stretch: 1, cause: 'wrecked' }]);
  });

  it('still knocks the player out in Roaming', () => {
    const w = worldIn('roaming');
    corePart(playerVehicle(w), 'cab').hp = 0;

    checkKnockout(w);

    expect(w.player.state).toBe('knockedOut');
  });
});

describe('rescue', () => {
  it('turns no beacon on where nobody answers it', () => {
    const w = worldIn('furyRoad');
    w.player.fuel = 0;

    expect(() => setBeacon(w, true)).toThrow(/beacon/);
    expect(setBeacon({ ...worldIn('roaming'), player: { ...w.player } }, true).player.beacon).toBe(true);
  });
});

describe('spilled cargo', () => {
  it('is lost, not piled, where nothing is looted', () => {
    const w = worldIn('furyRoad');
    const me = playerVehicle(w);
    const before = structuredClone(w.salvage);
    const panniers = mountedParts(me, 'cargo')[0];
    addGoods(w, me, 'salt', 2);
    panniers.hp = 0;

    spillDeadRows(w);

    expect(w.salvage).toEqual(before);
    expect(w.events.filter((e) => e.t === 'cargoSpilled')).toEqual([expect.objectContaining({ pile: null })]);
  });
});

describe('dumped cargo', () => {
  it('is thrown away, not piled, where nothing is looted', () => {
    const w = worldIn('furyRoad');
    addGoods(w, playerVehicle(w), 'salt', 1);
    const salt = playerVehicle(w).items.find((it) => it.kind === 'good' && it.good === 'salt')!;
    const before = structuredClone(w.salvage);

    const after = dumpItem(w, salt.id);

    expect(after.salvage).toEqual(before);
    expect(playerVehicle(after).items.some((it) => it.id === salt.id)).toBe(false);
  });
});
