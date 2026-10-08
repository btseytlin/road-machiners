import { describe, expect, it } from 'vitest';
import { REFUSED } from '../data/dialogue';
import { SALVAGE } from '../data/salvage';
import { NPC_BEHAVIOR, NPCS, type TraitId } from '../data/npcs';
import { isHostile, noteCollision, wreckVehicle } from './combat';
import { advanceContracts } from './market';
import { update } from './world';
import { playerVehicle } from './damage';
import { callVehicle, chooseOption, currentLine, currentOptions, endCallIfOut, hangUp, raiseCalls } from './dialogue';
import { addGoods } from './inventory';
import { takeAllLoot } from './locations';
import { pushGoal, resolveNpcActivities, thinkNpc, topGoal } from './npc-activities';
import { visibleSalvage } from './npc-decisions';
import { makePeace, plead, standDownTo, surrenderTo, yieldTo } from './parley';
import { claimantOf, hasCargo, lootBlocker, looterOf } from './salvage';
import { beginSearch } from './search';
import { addState, endState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf } from './testkit';
import type { Contract } from './market';
import type { Faction, Vehicle, World } from './types';
import { refreshVision } from './vision';

function quietWorld(): World {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  return w;
}

function npcAt(w: World, faction: Faction, traits: TraitId[], x: number, y = 30): Vehicle {
  const npc = addVehicle(w, faction, 'scout', ['stockEngine', 'mg'], { x, y });
  npc.brain = npcBrain('trader', npc.pos, traits);
  refreshVision(w);
  return npc;
}

function feud(w: World, a: Vehicle, b: Vehicle): void {
  addState(w, 'feud', a.id, b.id, { kind: 'feud', robbery: false });
  addState(w, 'feud', b.id, a.id, { kind: 'feud', robbery: false });
}

function pick(w: World, text: string): World {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return chooseOption(w, i);
}

const dent = [{ part: 'cab', damage: 5 }];

describe('crashes between trucks at peace', () => {
  it('start no feud, and each damaged NPC holds a grievance', () => {
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'scavengers', ['scavenger'], 36);
    noteCollision(w, a, b, dent, dent);
    expect(isHostile(w, a, b)).toBe(false);
    expect(stateOf(w, 'grievance', a.id, b.id)).not.toBeNull();
    expect(stateOf(w, 'grievance', b.id, a.id)).not.toBeNull();
    expect(a.brain!.attackers).toEqual({});
  });

  it('a forgiven crash ends the grievance and leaves the two at peace', () => {
    forceOption('crashed', 'forgive');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'scavengers', ['scavenger'], 36);
    noteCollision(w, a, b, [], dent);
    thinkNpc(w, b);
    expect(stateOf(w, 'grievance', b.id, a.id)).toBeNull();
    expect(isHostile(w, a, b)).toBe(false);
  });

  it('a retaliating driver starts a feud and treats the other truck as an attacker', () => {
    forceOption('crashed', 'retaliate');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 36);
    addState(w, 'truce', b.id, a.id, { kind: 'none' });
    noteCollision(w, a, b, [], dent);
    thinkNpc(w, b);
    expect(stateOf(w, 'feud', b.id, a.id)).not.toBeNull();
    expect(b.brain!.attackers[a.id]).toBe(true);
  });

  it('a crash between hostiles is an attack, not a grievance', () => {
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'scavengers', ['scavenger'], 36);
    feud(w, a, b);
    noteCollision(w, a, b, [], dent);
    expect(stateOf(w, 'grievance', b.id, a.id)).toBeNull();
    expect(b.brain!.attackers[a.id]).toBe(false);
  });

  it('the player never holds a grievance', () => {
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const me = playerVehicle(w);
    noteCollision(w, a, me, [], dent);
    expect(w.states.filter((s) => s.kind === 'grievance')).toEqual([]);
  });
});

describe('peace', () => {
  it('ends feuds both ways between the sides, holds truces and drops aim at the other side', () => {
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const mate = npcAt(w, 'traders', ['trader'], 34, 33);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    feud(w, mate, b);
    b.weaponOrders = { gun: { targetId: a.id, aim: 'body' } };
    makePeace(w, a, b);
    expect(w.states.filter((s) => s.kind === 'feud')).toEqual([]);
    expect(isHostile(w, a, b)).toBe(false);
    expect(isHostile(w, mate, b)).toBe(false);
    expect(b.weaponOrders).toEqual({});
  });
});

describe('NPC pleas to NPCs', () => {
  it('an accepted truce makes peace at once', () => {
    forceOption('truceOffered', 'accept');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    plead(w, a, b, 'truce');
    expect(isHostile(w, a, b)).toBe(false);
    expect(w.events).toContainEqual({ t: 'plea', from: a.id, to: b.id, plea: 'truce', accepted: true });
  });

  it('a refused truce keeps the feud', () => {
    forceOption('truceOffered', 'refuse');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    plead(w, a, b, 'truce');
    expect(isHostile(w, a, b)).toBe(true);
    expect(stateOf(w, 'plea', a.id, b.id)).not.toBeNull();
  });

  function holdUp(): { w: World; a: Vehicle; b: Vehicle } {
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    addGoods(w, a, 'scrap', 2);
    const b = npcAt(w, 'scavengers', ['scavenger', 'scumbag'], 40);
    npcAt(w, 'scavengers', ['scavenger'], 40, 28);
    npcAt(w, 'scavengers', ['scavenger'], 40, 32);
    addState(w, 'feud', b.id, a.id, { kind: 'feud', robbery: true });
    addState(w, 'feud', a.id, b.id, { kind: 'feud', robbery: false });
    return { w, a, b };
  }

  it('a robber holding up its prey grants no truce, even when the roll would accept', () => {
    forceOption('truceOffered', 'accept');
    forceOption('threatened', 'fightBack');
    const { w, a, b } = holdUp();
    plead(w, a, b, 'truce');
    expect(isHostile(w, b, a)).toBe(true);
    expect(w.events).toContainEqual({ t: 'plea', from: a.id, to: b.id, plea: 'truce', accepted: false });
    expect(hasCargo(a)).toBe(true);
  });

  it('prey that complies drops its cargo for the robber and makes peace', () => {
    forceOption('threatened', 'comply');
    const { w, a, b } = holdUp();
    plead(w, a, b, 'truce');
    expect(hasCargo(a)).toBe(false);
    expect(isHostile(w, b, a)).toBe(false);
    expect(stateOf(w, 'plea', a.id, b.id)).toBeNull();
  });

  it('a weak robber still takes the truce', () => {
    forceOption('truceOffered', 'accept');
    const { w, a, b } = holdUp();
    b.resources = { fuel: 10, supplies: 10, money: 0, health: 1 };
    plead(w, a, b, 'truce');
    expect(isHostile(w, b, a)).toBe(false);
    expect(hasCargo(a)).toBe(true);
  });

  it('an accepted plea leaves no wait, so a driver whose truce breaks can plead again', () => {
    forceOption('truceOffered', 'accept');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    plead(w, a, b, 'truce');
    expect(stateOf(w, 'plea', a.id, b.id)).toBeNull();
  });

  it('spared mercy costs the beggar its cargo, and the winner goes to take it', () => {
    forceOption('mercyBegged', 'spare');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    addGoods(w, a, 'scrap', 2);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    plead(w, a, b, 'mercy');
    expect(hasCargo(a)).toBe(false);
    expect(isHostile(w, a, b)).toBe(false);
    expect(topGoal(b)).toMatchObject({ kind: 'loot' });
  });

  it('a hurt driver pleads with the hostile that hit it', () => {
    forceOption('parley', 'truce');
    forceOption('truceOffered', 'accept');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    a.brain!.hurt = 5;
    a.lastHitBy = b.id;
    thinkNpc(w, a);
    expect(w.events).toContainEqual({ t: 'plea', from: a.id, to: b.id, plea: 'truce', accepted: true });
    expect(isHostile(w, a, b)).toBe(false);
  });

  it('a truce with the last hostile in sight ends a flee from a truck out of sight', () => {
    forceOption('parley', 'truce');
    forceOption('truceOffered', 'accept');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    const gone = npcAt(w, 'raiders', ['raider'], 200, 200);
    feud(w, a, b);
    feud(w, a, gone);
    pushGoal(w, a, { kind: 'flee', targetId: gone.id, destination: { x: 10, y: 10 }, phase: 'travel', reason: 'damaged and threatened', perceived: w.turn - NPC_BEHAVIOR.fleeCalmTurns - 1 });
    a.brain!.hurt = 5;
    a.lastHitBy = b.id;
    thinkNpc(w, a);
    expect(isHostile(w, a, b)).toBe(false);
    expect(topGoal(a)?.kind).not.toBe('flee');
  });

  it('an unhurt driver does not plead', () => {
    forceOption('parley', 'truce');
    const w = quietWorld();
    const a = npcAt(w, 'traders', ['trader'], 34);
    const b = npcAt(w, 'raiders', ['raider'], 40);
    feud(w, a, b);
    a.lastHitBy = b.id;
    thinkNpc(w, a);
    expect(stateOf(w, 'plea', a.id, b.id)).toBeNull();
  });
});

describe('NPC pleas to the player', () => {
  function pleading(plea: 'truce' | 'mercy'): { w: World; npc: Vehicle } {
    const w = quietWorld();
    const npc = npcAt(w, 'traders', ['trader'], 36);
    addGoods(w, npc, 'scrap', 2);
    feud(w, npc, playerVehicle(w));
    plead(w, npc, playerVehicle(w), plea);
    raiseCalls(w);
    return { w, npc };
  }

  it('the driver calls with its truce, and accepting makes peace', () => {
    const { w: start, npc } = pleading('truce');
    expect(start.player.call).toMatchObject({ with: npc.id, topic: 'truceOffer' });
    const w = pick(start, 'Agreed. Guns down.');
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(false);
    expect(stateOf(w, 'plea', npc.id, w.player.vehicleId)).toBeNull();
  });

  it('a plea call ends when the plea runs out later in the same turn, so no answer throws', () => {
    const { w, npc } = pleading('truce');
    endState(w, stateOf(w, 'plea', npc.id, w.player.vehicleId)!, 'expired');

    endCallIfOut(w);

    expect(w.player.call).toBeNull();
  });

  it('refusing keeps the feud, and the driver does not call again with the same plea', () => {
    const { w: start, npc } = pleading('truce');
    const w = pick(start, 'No. We finish this.');
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(true);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  it('a pleading foe calls even while it flees another truck', () => {
    const w = quietWorld();
    const npc = npcAt(w, 'traders', ['trader'], 36);
    feud(w, npc, playerVehicle(w));
    npc.brain!.goals.push({ kind: 'flee', targetId: 'someone-else', destination: { x: 60, y: 30 }, reason: 'escape an attacker', phase: 'travel' });
    plead(w, npc, playerVehicle(w), 'mercy');
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'mercyPlea' });
  });

  it('hanging up refuses the plea', () => {
    const { w: start, npc } = pleading('truce');
    const w = hangUp(start);
    expect(w.events).toContainEqual({ t: 'plea', from: npc.id, to: w.player.vehicleId, plea: 'truce', accepted: false });
  });

  it('sparing a beggar leaves its cargo on the ground for the player', () => {
    const { w: start, npc } = pleading('mercy');
    expect(start.player.call).toMatchObject({ topic: 'mercyPlea' });
    const w = pick(start, 'Dump your cargo and drive off.');
    expect(hasCargo(w.vehicles.find((v) => v.id === npc.id)!)).toBe(false);
    expect(w.salvage.some((s) => s.id.startsWith(`cargo-${npc.id}`))).toBe(true);
  });
});

describe('player pleas', () => {
  function atWar(): { w: World; npc: Vehicle } {
    const w = quietWorld();
    const npc = npcAt(w, 'scavengers', ['scavenger'], 36);
    feud(w, npc, playerVehicle(w));
    return { w, npc };
  }

  it('a driver in a feud takes the call and offers only peace talk', () => {
    const { w: start, npc } = atWar();
    const w = callVehicle(start, npc.id);
    expect(w.player.call).toMatchObject({ with: npc.id });
    expect(currentOptions(w).map((o) => o.text)).toEqual(['Enough shooting. Can we call a truce?', 'I give up. Let me go.', 'Hang up.']);
  });

  it('a foe busy fighting another truck takes the call, and the player can offer a truce', () => {
    forceOption('truceOffered', 'accept');
    const { w: start, npc } = atWar();
    npc.brain!.goals.push({ kind: 'fight', targetId: 'someone-else', destination: { x: 40, y: 30 }, reason: 'fight back', phase: 'travel' });
    let w = pick(callVehicle(start, npc.id), 'Enough shooting. Can we call a truce?');
    w = pick(w, 'We both drive away.');
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(false);
  });

  it('an accepted truce makes peace', () => {
    forceOption('truceOffered', 'accept');
    const { w: start, npc } = atWar();
    let w = pick(callVehicle(start, npc.id), 'Enough shooting. Can we call a truce?');
    w = pick(w, 'We both drive away.');
    expect(w.player.call?.node).toBe('agreed');
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(false);
  });

  it('a refused truce keeps the feud, and the player cannot ask again at once', () => {
    forceOption('truceOffered', 'refuse');
    const { w: start, npc } = atWar();
    let w = pick(callVehicle(start, npc.id), 'Enough shooting. Can we call a truce?');
    w = pick(w, 'We both drive away.');
    w = pick(w, 'Then we finish this.');
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(true);
    w = callVehicle(w, npc.id);
    expect(w.player.call?.node).toBe(REFUSED);
  });

  it('spared mercy costs the player the cargo', () => {
    forceOption('mercyBegged', 'spare');
    const { w: start, npc } = atWar();
    addGoods(start, playerVehicle(start), 'scrap', 2);
    let w = pick(callVehicle(start, npc.id), 'I give up. Let me go.');
    w = pick(w, 'Take what I carry. Just let me drive away.');
    expect(hasCargo(playerVehicle(w))).toBe(false);
    expect(isHostile(w, w.vehicles.find((v) => v.id === npc.id)!, playerVehicle(w))).toBe(false);
  });
});

describe('player robbery', () => {
  const DEMAND = 'Drop your cargo, or we open fire.';
  const INSIST = 'You heard me. Cargo on the ground, now.';

  function loaded(): { w: World; npc: Vehicle } {
    const w = quietWorld();
    const npc = npcAt(w, 'traders', ['trader'], 36);
    addGoods(w, npc, 'scrap', 2);
    return { w, npc };
  }

  it('a complying driver drops its cargo and holds a truce with the player', () => {
    forceOption('threatened', 'comply');
    const { w: start, npc } = loaded();
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = pick(w, INSIST);
    const after = w.vehicles.find((v) => v.id === npc.id)!;
    expect(hasCargo(after)).toBe(false);
    expect(w.salvage.some((s) => s.id.startsWith(`cargo-${npc.id}`))).toBe(true);
    expect(stateOf(w, 'truce', npc.id, w.player.vehicleId)).not.toBeNull();
  });

  it('a defiant driver starts a feud and fights', () => {
    forceOption('threatened', 'fightBack');
    const { w: start, npc } = loaded();
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = pick(w, INSIST);
    const after = w.vehicles.find((v) => v.id === npc.id)!;
    expect(stateOf(w, 'feud', npc.id, w.player.vehicleId)).not.toBeNull();
    expect(topGoal(after)).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
  });

  it('a scared driver starts a feud and runs', () => {
    forceOption('threatened', 'flee');
    const { w: start, npc } = loaded();
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = pick(w, INSIST);
    expect(topGoal(w.vehicles.find((v) => v.id === npc.id)!)).toMatchObject({ kind: 'flee' });
  });

  it('is not offered to a driver without cargo, and only once per driver', () => {
    forceOption('threatened', 'comply');
    const { w: start, npc } = loaded();
    const empty = npcAt(start, 'traders', ['trader'], 36, 33);
    expect(currentOptions(callVehicle(start, empty.id)).map((o) => o.text)).not.toContain(DEMAND);
    let w = pick(callVehicle(start, npc.id), DEMAND);
    w = hangUp(w);
    w = pick(callVehicle(w, npc.id), DEMAND);
    expect(w.player.call?.topic).toBeNull();
  });
});

describe('warning a looter off', () => {
  const WARN = 'This wreck is mine. Back off.';
  const INSIST = 'You heard me. Leave it.';

  function contested(): { w: World; npc: Vehicle; wreckId: string } {
    const w = quietWorld();
    const wreck = { id: 'wreck901', pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 6 }, parts: [] };
    w.salvage.push(wreck);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'mg'], { x: 31.5, y: 30 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    npc.brain.goals = [{ kind: 'scavenge', targetId: wreck.id, destination: { ...wreck.pos }, phase: 'act', reason: 'test loot' }];
    beginSearch(w, npc, wreck.id);
    refreshVision(w);
    return { w, npc, wreckId: wreck.id };
  }

  function warn(start: World, npc: Vehicle): { w: World; after: Vehicle } {
    const w = pick(pick(callVehicle(start, npc.id), WARN), INSIST);
    return { w, after: w.vehicles.find((v) => v.id === npc.id)! };
  }

  it('a complying driver leaves the wreck to the player', () => {
    forceOption('warnedOff', 'comply');
    const { w: start, npc, wreckId } = contested();
    const { w, after } = warn(start, npc);
    expect(after.job).toBeNull();
    expect(after.brain!.goals.some((g) => g.targetId === wreckId)).toBe(false);
    expect(looterOf(w, wreckId)?.id).toBe(w.player.vehicleId);
    expect(w.player.talked[npc.id]).toEqual({ warnOff: 'agreed' });
    expect(practiceOf(w, 'deal')).toEqual([]);
  });

  it('a defiant driver starts a feud and fights', () => {
    forceOption('warnedOff', 'fightBack');
    const { w: start, npc } = contested();
    const { w, after } = warn(start, npc);
    expect(stateOf(w, 'feud', npc.id, w.player.vehicleId)).not.toBeNull();
    expect(topGoal(after)).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
    expect(w.player.talked[npc.id]).toEqual({ warnOff: 'refused' });
  });

  it('a refusing driver keeps looting, and nothing else changes', () => {
    forceOption('warnedOff', 'refuse');
    const { w: start, npc, wreckId } = contested();
    const { w, after } = warn(start, npc);
    expect(after.job).toEqual(npc.job);
    expect(after.brain!.goals).toEqual(npc.brain!.goals);
    expect(w.states).toEqual(start.states);
    expect(looterOf(w, wreckId)?.id).toBe(npc.id);
    expect(w.player.talked[npc.id]).toEqual({ warnOff: 'refused' });
  });

  it('a hang-up counts as refused and leaves the driver looting', () => {
    forceOption('warnedOff', 'comply');
    const { w: start, npc, wreckId } = contested();
    const w = hangUp(pick(callVehicle(start, npc.id), WARN));
    expect(w.player.talked[npc.id]).toEqual({ warnOff: 'refused' });
    expect(looterOf(w, wreckId)?.id).toBe(npc.id);
  });
});

describe('bounty talk', () => {
  const bounty: Contract = { id: 'ct-b', shop: 'bowl', kind: 'bounty', template: 'trader', targetName: 'Test Driver', reward: 400, deadline: 900, window: 900, tier: 2 };

  function beggar(perks: World['player']['perks']): { w: World; npc: Vehicle } {
    const w = quietWorld();
    const npc = npcAt(w, 'raiders', ['raider'], 36);
    feud(w, npc, playerVehicle(w));
    w.player.perks = perks;
    w.player.contracts = [{ ...bounty }];
    w.player.money = 0;
    plead(w, npc, playerVehicle(w), 'mercy');
    raiseCalls(w);
    return { w, npc };
  }

  it('a driver of the bounty template that gives up to the player pays the bounty', () => {
    const { w: start } = beggar(['bountyTalk']);
    const w = pick(start, 'Dump your cargo and drive off.');
    expect(w.player.contracts).toEqual([]);
    expect(w.player.money).toBe(bounty.reward);
    expect(w.events).toContainEqual({ t: 'contract', contract: bounty, outcome: 'done' });
  });

  it('pays nothing without the perk', () => {
    const { w: start } = beggar([]);
    const w = pick(start, 'Dump your cargo and drive off.');
    expect(w.player.contracts).toEqual([bounty]);
    expect(w.player.money).toBe(0);
  });

  function standsDown(start: World, npcId: string): World {
    return update(start, (d) => standDownTo(d, d.vehicles.find((x) => x.id === npcId)!, playerVehicle(d)));
  }

  function wreckGivenUp(start: World, npcId: string): World {
    return update(start, (d) => {
      const v = d.vehicles.find((x) => x.id === npcId)!;
      d.events = [];
      v.lastHitBy = d.player.vehicleId;
      wreckVehicle(d, v);
      advanceContracts(d);
    });
  }

  it('a driver that gave up without the perk pays nothing when the player then wrecks it', () => {
    const { w: start, npc } = beggar([]);
    const w = wreckGivenUp(standsDown(start, npc.id), npc.id);
    expect(w.events).toContainEqual({ t: 'destroyed', vehicle: npc.id, by: w.player.vehicleId });
    expect(w.events.filter((e) => e.t === 'contract' && e.outcome === 'done')).toEqual([]);
    expect(w.player.money).toBe(0);
  });

  it('a driver that gave up with the perk pays once, though the player then wrecks it', () => {
    const { w: start, npc } = beggar(['bountyTalk']);
    const gaveUp = standsDown(start, npc.id);
    expect(gaveUp.player.money).toBe(bounty.reward);
    const w = wreckGivenUp(update(gaveUp, (d) => { d.player.contracts = [{ ...bounty, id: 'ct-b2' }]; }), npc.id);
    expect(w.events.filter((e) => e.t === 'contract' && e.outcome === 'done')).toEqual([]);
    expect(w.player.money).toBe(bounty.reward);
  });

  it('pays nothing when the player gives up', () => {
    const w = quietWorld();
    const npc = npcAt(w, 'raiders', ['raider'], 36);
    w.player.perks = ['bountyTalk'];
    w.player.contracts = [{ ...bounty }];
    yieldTo(w, playerVehicle(w), npc);
    expect(w.player.contracts).toEqual([bounty]);
  });
});

describe('pile claims', () => {
  function handover(winnerKind: 'npc' | 'player') {
    const w = quietWorld();
    const robber = npcAt(w, 'scavengers', ['raider'], 36);
    const victim = addVehicle(w, 'scavengers', 'scout', ['mg'], { x: 37, y: 30 });
    victim.brain = npcBrain('trader', victim.pos, ['raider']);
    addGoods(w, victim, 'scrap', 2);
    refreshVision(w);
    if (winnerKind === 'npc') yieldTo(w, victim, robber);
    else yieldTo(w, victim, playerVehicle(w));
    return { w, robber, victim, pile: w.salvage.find((s) => s.pile)! };
  }

  it('an NPC winner claims the handed-over pile', () => {
    const { w, robber, victim, pile } = handover('npc');
    expect(pile.pile!.claim).toEqual({ by: robber.id, until: w.turn + SALVAGE.claimTurns, warned: [victim.id] });
  });

  describe('with a fight open', () => {
    const fightBetween = (w: World, a: Vehicle, b: Vehicle) => {
      addState(w, 'combat', a.id, b.id, { kind: 'none' });
      addState(w, 'combat', b.id, a.id, { kind: 'none' });
    };
    const fights = (w: World, a: Vehicle, b: Vehicle) =>
      [stateOf(w, 'combat', a.id, b.id), stateOf(w, 'combat', b.id, a.id)].filter(Boolean);

    function setup(loser: 'npc' | 'player') {
      const w = quietWorld();
      const robber = npcAt(w, 'scavengers', ['raider'], 36);
      const victim = loser === 'player' ? playerVehicle(w) : addVehicle(w, 'scavengers', 'scout', ['mg'], { x: 37, y: 30 });
      if (loser === 'npc') victim.brain = npcBrain('trader', victim.pos, ['raider']);
      addGoods(w, victim, 'scrap', 2);
      pushGoal(w, robber, { kind: 'fight', targetId: victim.id, destination: null, phase: 'travel', reason: 'robbery' });
      fightBetween(w, robber, victim);
      refreshVision(w);
      return { w, robber, victim };
    }

    function expectsLoot(w: World, robber: Vehicle, victim: Vehicle) {
      const pile = w.salvage.find((s) => s.pile)!;
      thinkNpc(w, robber);
      expect(fights(w, robber, victim)).toEqual([]);
      expect(topGoal(robber)?.kind).toBe('loot');
      expect(claimantOf(w, pile)?.id).toBe(robber.id);
    }

    it('an NPC victim hands over and the robber keeps its loot goal', () => {
      const { w, robber, victim } = setup('npc');
      yieldTo(w, victim, robber);
      expectsLoot(w, robber, victim);
    });

    it('the player hands over cargo and the robber keeps its loot goal', () => {
      const { w, robber, victim } = setup('player');
      yieldTo(w, victim, robber);
      expectsLoot(w, robber, victim);
    });

    it('the player surrenders and the robber keeps its loot goal', () => {
      const { w, robber, victim } = setup('player');
      surrenderTo(w, victim, robber);
      expectsLoot(w, robber, victim);
    });

    it('peace also ends the fights of a faction mate of either side', () => {
      const { w, robber, victim } = setup('npc');
      const mate = npcAt(w, 'scavengers', ['raider'], 38);
      fightBetween(w, mate, victim);
      makePeace(w, robber, victim);
      expect(fights(w, mate, victim)).toEqual([]);
    });

    it('a fight with a third truck stays', () => {
      const { w, robber, victim } = setup('npc');
      const other = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 20, y: 20 });
      fightBetween(w, robber, other);
      yieldTo(w, victim, robber);
      expect(fights(w, robber, other)).toHaveLength(2);
    });
  });

  it('a player winner makes no claim', () => {
    expect(handover('player').pile.pile!.claim).toBeUndefined();
  });

  it('a claimant starts no tow of its stranded victim before it takes the pile', () => {
    const { w, robber, victim } = handover('npc');
    forceOption('strandedSeen', 'tow');
    thinkNpc(w, robber);
    expect(robber.brain!.goals.some((g) => g.kind === 'tow' && g.targetId === victim.id)).toBe(false);
    expect(topGoal(robber)?.kind).toBe('loot');
  });

  it('a player parked at the pile does not keep its claimant from starting there', () => {
    const { w, robber, pile } = handover('npc');
    const me = playerVehicle(w);
    me.pos = { x: pile.pos.x + 1, y: pile.pos.y };
    expect(lootBlocker(w, robber, pile.id)).toBeNull();
  });

  it('a backed-off driver does not see the pile', () => {
    const { w, pile } = handover('npc');
    const other = npcAt(w, 'scavengers', [], 34);
    expect(visibleSalvage(w, other)).toContain(pile);
    pile.pile!.claim!.warned.push(other.id);
    expect(visibleSalvage(w, other)).not.toContain(pile);
  });
});

describe('warning off a trespasser', () => {
  function trespass(armed = true) {
    const w = quietWorld();
    const claimant = npcAt(w, 'scavengers', ['raider'], 30);
    const victim = addVehicle(w, 'scavengers', 'scout', ['mg'], { x: 40, y: 34 });
    victim.brain = npcBrain('trader', victim.pos, ['raider']);
    addGoods(w, victim, 'scrap', 2);
    yieldTo(w, victim, claimant);
    if (!armed) claimant.items = claimant.items.filter((item) => item.kind !== 'part' || !/mg/.test(item.part.defId));
    const pile = w.salvage.find((s) => s.pile)!;
    const trespasser = npcAt(w, 'scavengers', ['scavenger'], pile.pos.x + 1, pile.pos.y);
    pushGoal(w, trespasser, { kind: 'loot', targetId: pile.id, destination: { ...pile.pos }, phase: 'travel', reason: 'test' });
    refreshVision(w);
    return { w, claimant, trespasser, pile };
  }

  it('comply: the trespasser backs off and starts no search', () => {
    const { w, trespasser, pile } = trespass();
    forceOption('threatened', 'comply');
    resolveNpcActivities(w);
    expect(pile.pile!.claim!.warned).toContain(trespasser.id);
    expect(trespasser.job).toBeNull();
    expect(trespasser.brain!.goals.some((g) => g.kind === 'loot')).toBe(false);
  });

  it('fightBack: both feud and fight, and nobody searches', () => {
    const { w, claimant, trespasser } = trespass();
    forceOption('threatened', 'fightBack');
    resolveNpcActivities(w);
    expect(stateOf(w, 'feud', trespasser.id, claimant.id)).not.toBeNull();
    expect(stateOf(w, 'feud', claimant.id, trespasser.id)).not.toBeNull();
    expect(topGoal(claimant)).toMatchObject({ kind: 'fight', reason: 'defend its claimed loot' });
    expect(topGoal(trespasser)?.kind).toBe('fight');
    expect(trespasser.job).toBeNull();
  });

  it('a claimant that cannot see the trespasser lets it search', () => {
    const { w, claimant, trespasser } = trespass();
    claimant.pos = { x: 5, y: 5 };
    refreshVision(w);
    forceOption('threatened', 'comply');
    resolveNpcActivities(w);
    expect(trespasser.job?.kind).toBe('search');
  });

  it('an unarmed claimant flees a refusal', () => {
    const { w, claimant } = trespass(false);
    forceOption('threatened', 'fightBack');
    resolveNpcActivities(w);
    expect(topGoal(claimant)).toMatchObject({ kind: 'flee', reason: 'defend its claimed loot' });
  });
});

describe('the player at a claimed pile', () => {
  function claimedNearPlayer() {
    const w = quietWorld();
    const claimant = npcAt(w, 'scavengers', ['raider'], 30, 38);
    const victim = addVehicle(w, 'scavengers', 'scout', ['mg'], { x: 31, y: 31 });
    victim.brain = npcBrain('trader', victim.pos, ['raider']);
    addGoods(w, victim, 'scrap', 2);
    yieldTo(w, victim, claimant);
    const pile = w.salvage.find((s) => s.pile)!;
    w.player.scavenged.push(pile.id);
    refreshVision(w);
    return { w, claimant, pile };
  }
  const me = (w: World) => playerVehicle(w);
  const feuding = (w: World, claimant: Vehicle) => stateOf(w, 'feud', claimant.id, me(w).id) !== null;

  it('a take in the claimant sight starts a feud and a fight', () => {
    const { w, claimant, pile } = claimedNearPlayer();
    const next = takeAllLoot(w, pile.id);
    expect(feuding(next, claimant)).toBe(true);
    expect(topGoal(next.vehicles.find((v) => v.id === claimant.id)!)?.kind).toBe('fight');
  });

  it('the player who handed the pile over gets no warning call, but taking it back is a refusal', () => {
    const w = quietWorld();
    const claimant = npcAt(w, 'scavengers', ['raider'], 30, 38);
    addGoods(w, me(w), 'scrap', 2);
    yieldTo(w, me(w), claimant);
    const pile = w.salvage.find((s) => s.pile)!;
    w.player.scavenged.push(pile.id);
    refreshVision(w);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
    expect(feuding(takeAllLoot(w, pile.id), claimant)).toBe(true);
  });

  it('a take the claimant cannot see starts nothing', () => {
    const { w, claimant, pile } = claimedNearPlayer();
    claimant.pos = { x: 5, y: 5 };
    refreshVision(w);
    expect(feuding(takeAllLoot(w, pile.id), claimant)).toBe(false);
  });

  it('the claimant calls once, and rolling on leaves no feud and no second call', () => {
    const { w, claimant } = claimedNearPlayer();
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: claimant.id, topic: 'claim' });
    expect(currentLine(w)).toBe('This is mine.');
    const done = pick(w, 'Rolling on.');
    expect(feuding(done, claimant)).toBe(false);
    raiseCalls(done);
    expect(done.player.call).toBeNull();
  });

  it('refusing starts the feud', () => {
    const { w, claimant } = claimedNearPlayer();
    raiseCalls(w);
    expect(feuding(pick(w, 'Finders keepers.'), claimant)).toBe(true);
  });

  it('hanging up backs off', () => {
    const { w, claimant, pile } = claimedNearPlayer();
    raiseCalls(w);
    const done = hangUp(w);
    expect(feuding(done, claimant)).toBe(false);
    expect(done.salvage.find((s) => s.id === pile.id)!.pile!.claim!.warned).toContain(me(done).id);
  });
});
