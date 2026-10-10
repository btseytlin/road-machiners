import { describe, expect, it } from 'vitest';
import type { LineId } from '../data/dialogue';
import { NPC_BEHAVIOR, NPCS, type TraitId } from '../data/npcs';
import { playerVehicle } from './damage';
import { chooseOption, currentOptions, hangUp, raiseCalls } from './dialogue';
import { pushGoal, resolveNpcActivities, topGoal } from './npc-activities';
import { lootTaken, optionChances, optionWeights, visibleSalvage } from './npc-decisions';
import { answerLootWarning, contestLoot, pendingWarningTo, settleLootWarning, warnedOffTarget, warnTruck } from './loot-warning';
import { emptyHidden, looterOf } from './salvage';
import { beginSearch, startSearch } from './search';
import { addState, advanceStates, lootWarningData, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls } from './testkit';
import type { GameEvent, Vehicle, World } from './types';
import { refreshVision } from './vision';

const WRECK = 'wreck901';

function quietWorld(): World {
  const w = emptyWorld({ x: 30, y: 30 });
  for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
  w.salvage.push({ id: WRECK, pos: { x: 30.5, y: 30 }, radius: 1, goods: { scrap: 6 }, parts: [], hidden: emptyHidden() });
  w.rngState = rngStateForForcedRolls(8);
  return w;
}

function driver(w: World, x: number, y: number, traits: TraitId[] = ['scavenger']): Vehicle {
  const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'mg'], { x, y });
  npc.brain = npcBrain('scavenger', npc.pos, traits);
  npc.speed = 0;
  return npc;
}

function npcLooting(w: World): Vehicle {
  playerVehicle(w).pos = { x: 60, y: 60 };
  const looter = driver(w, 31.5, 30);
  looter.brain!.goals = [{ kind: 'scavenge', targetId: WRECK, destination: { x: 30.5, y: 30 }, phase: 'act', reason: 'searchSpot' }];
  beginSearch(w, looter, WRECK);
  return looter;
}

function arriving(w: World): Vehicle {
  const npc = driver(w, 30.5, 31.2);
  pushGoal(w, npc, { kind: 'loot', targetId: WRECK, destination: { x: 30.5, y: 30 }, phase: 'travel', reason: 'lootOnTheWay' });
  refreshVision(w);
  return npc;
}

function after(w: World, v: Vehicle): Vehicle {
  return w.vehicles.find((x) => x.id === v.id)!;
}

function arguments_(w: World): Extract<GameEvent, { t: 'lootArgument' }>[] {
  return w.events.filter((e): e is Extract<GameEvent, { t: 'lootArgument' }> => e.t === 'lootArgument');
}

function pick(w: World, line: LineId): World {
  const i = currentOptions(w).findIndex((o) => o.line === line);
  if (i < 0) throw new Error(`No option "${line}" in ${currentOptions(w).map((o) => o.line).join(' | ')}`);
  return chooseOption(w, i);
}

describe('a driver that reaches loot another NPC is looting', () => {
  it('still sees the taken loot until the two argued, then passes it up', () => {
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = driver(w, 34, 30);
    refreshVision(w);
    expect(lootTaken(w, npc, WRECK)).toBeNull();
    expect(visibleSalvage(w, npc).map((s) => s.id)).toContain(WRECK);
    npc.brain!.noticed[`lootContested:${looter.id}`] = w.turn;
    expect(lootTaken(w, npc, WRECK)).toBe('lootTaken');
    expect(visibleSalvage(w, npc).map((s) => s.id)).not.toContain(WRECK);
  });

  it('warns it off, and a looter that complies leaves the loot to the warner', () => {
    forceOption('lootContested', 'warn');
    forceOption('warnedOff', 'comply');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(looter.job).toBeNull();
    expect(looter.brain!.goals).toEqual([]);
    expect(lootWarningData(stateOf(w, 'lootWarning', npc.id, looter.id)!).answer).toBe('comply');
    expect(arguments_(w)).toEqual([{ t: 'lootArgument', warner: npc.id, looter: looter.id, place: 'wreck', end: 'yielded' }]);
    expect(npc.brain!.noticed).toHaveProperty(`lootContested:${looter.id}`);
    expect(looter.brain!.noticed).toHaveProperty(`lootContested:${npc.id}`);
    resolveNpcActivities(w);
    expect(npc.job).toMatchObject({ kind: 'search', stockId: WRECK });
    expect(lootTaken(w, looter, WRECK)).toBe('lootTaken');
  });

  it('on a refusal leaves, or fights, as its own roll says', () => {
    forceOption('lootContested', 'warn');
    forceOption('warnedOff', 'refuse');
    forceOption('warnRefused', 'leave');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(npc.brain!.goals).toEqual([]);
    expect(looter.job).toMatchObject({ kind: 'search', stockId: WRECK });
    expect(stateOf(w, 'lootWarning', npc.id, looter.id)).toBeNull();
    expect(arguments_(w).map((e) => e.end)).toEqual(['backedOff']);
  });

  it('fights a looter that refuses when its roll says fight', () => {
    forceOption('lootContested', 'warn');
    forceOption('warnedOff', 'refuse');
    forceOption('warnRefused', 'fight');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: looter.id, reason: 'fightOverLoot' });
    expect(stateOf(w, 'feud', npc.id, looter.id)).not.toBeNull();
    expect(arguments_(w).map((e) => e.end)).toEqual(['fight']);
  });

  it('meets a looter that fights back, and both fight', () => {
    forceOption('lootContested', 'warn');
    forceOption('warnedOff', 'fightBack');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(topGoal(looter)).toMatchObject({ kind: 'fight', targetId: npc.id });
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: looter.id });
    expect(arguments_(w).map((e) => e.end)).toEqual(['fight']);
  });

  it('leaves without a word when its roll says leave', () => {
    forceOption('lootContested', 'leave');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(npc.brain!.goals).toEqual([]);
    expect(looter.job).toMatchObject({ kind: 'search' });
    expect(w.states.some((s) => s.kind === 'lootWarning')).toBe(false);
    expect(arguments_(w)).toEqual([]);
  });

  it('rarely fights over it without a word', () => {
    forceOption('lootContested', 'fight');
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: looter.id });
    expect(stateOf(w, 'feud', npc.id, looter.id)).not.toBeNull();
  });

  it('argues once while the looter stays in sight', () => {
    forceOption('lootContested', 'warn');
    forceOption('warnedOff', 'refuse');
    forceOption('warnRefused', 'leave');
    const w = quietWorld();
    npcLooting(w);
    const npc = arriving(w);
    resolveNpcActivities(w);
    pushGoal(w, npc, { kind: 'loot', targetId: WRECK, destination: { x: 30.5, y: 30 }, phase: 'travel', reason: 'lootOnTheWay' });
    w.events = [];
    resolveNpcActivities(w);
    expect(npc.brain!.goals).toEqual([]);
    expect(arguments_(w)).toEqual([]);
  });

  it('never argues with a hostile looter or a deal partner', () => {
    for (const bind of ['feud', 'trade'] as const) {
      const w = quietWorld();
      const looter = npcLooting(w);
      const npc = arriving(w);
      if (bind === 'feud') addState(w, 'feud', npc.id, looter.id, { kind: 'feud', robbery: false });
      else addState(w, 'trade', npc.id, looter.id, { kind: 'none' });
      resolveNpcActivities(w);
      expect(topGoal(npc)?.kind === 'loot').toBe(false);
      expect(w.states.some((s) => s.kind === 'lootWarning')).toBe(false);
      expect(() => warnTruck(w, npc, looter, WRECK, 'roll')).toThrow('cannot warn');
    }
  });

  it('throws on a contest with no looter or a warning answered twice', () => {
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    looter.job = null;
    looter.brain!.goals = [];
    expect(() => contestLoot(w, npc, looter, WRECK)).toThrow('does not keep');
    const s = addState(w, 'lootWarning', npc.id, looter.id, { kind: 'lootWarning', targetId: WRECK, answer: 'refuse' });
    expect(() => settleLootWarning(w, s, 'comply', 'roll')).toThrow('already answered');
    expect(() => answerLootWarning(w, npc, 'comply', 'leave')).toThrow('no loot warning waiting');
  });

  it('without traits warns about two times in five, leaves about half the time and seldom fights', () => {
    const w = quietWorld();
    const looter = npcLooting(w);
    const npc = arriving(w);
    npc.brain!.traits = ['roamer'];
    npc.brain!.goals = [];
    const contest = optionChances(optionWeights(w, npc, 'lootContested', looter.id, null));
    expect(contest.warn).toBeCloseTo(0.4, 1);
    expect(contest.leave).toBeCloseTo(0.57, 1);
    expect(contest.fight).toBeCloseTo(0.03, 1);
    const refused = optionChances(optionWeights(w, npc, 'warnRefused', looter.id, null));
    expect(refused.leave).toBeCloseTo(0.75, 1);
    expect(refused.fight).toBeCloseTo(0.25, 1);
    const threat = optionChances(optionWeights(w, npc, 'lootContested', looter.id, 99));
    expect(threat.leave!).toBeGreaterThan(0.9);
  });
});

describe('a driver that reaches loot the player is looting', () => {
  function warned(): { w: World; npc: Vehicle } {
    forceOption('lootContested', 'warn');
    const w = quietWorld();
    const npc = arriving(w);
    resolveNpcActivities(w);
    return { w, npc };
  }

  it('radios the player in its own voice and waits for the answer outside the act phase', () => {
    const { w, npc } = warned();
    expect(pendingWarningTo(w, npc)).not.toBeNull();
    for (let i = 0; i < 3; i++) resolveNpcActivities(w);
    expect(topGoal(npc)).toMatchObject({ kind: 'loot', targetId: WRECK, phase: 'travel' });
    expect(looterOf(w, WRECK)?.id).toBe(w.player.vehicleId);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'lootWarning' });
    expect(w.player.call!.vars.warnLine).toEqual({ kind: 'line', line: 'thatsMyPick' });
    expect(currentOptions(w).map((o) => o.line)).toEqual(['rollingOn', 'findYourOwn', 'makeMe', 'hangUp']);
  });

  it('gets the loot when the player rolls on, and the player no longer holds it', () => {
    const { w: start, npc } = warned();
    raiseCalls(start);
    const w = pick(start, 'rollingOn');
    const me = playerVehicle(w);
    expect(w.player.call).toBeNull();
    expect(warnedOffTarget(w, me, WRECK)).not.toBeNull();
    expect(looterOf(w, WRECK)).toBeNull();
    const d = structuredClone(w);
    resolveNpcActivities(d);
    expect(after(d, npc).job).toMatchObject({ kind: 'search', stockId: WRECK });
  });

  it('stops the player search on the target when the player rolls on', () => {
    const { w: start } = warned();
    beginSearch(start, playerVehicle(start), WRECK);
    raiseCalls(start);
    const w = pick(start, 'rollingOn');
    expect(playerVehicle(w).job).toBeNull();
  });

  it.each([['leave', 'keepYourScrapsThen'], ['fight', 'thenWeSettleIt']] as const)('on a refusal it rolled to %s, it says so and does it', (refusal, line) => {
    forceOption('warnRefused', refusal);
    const { w: start, npc } = warned();
    raiseCalls(start);
    const w = pick(start, 'findYourOwn');
    expect(w.player.call?.line.line).toBe(line);
    if (refusal === 'leave') expect(after(w, npc).brain!.goals).toEqual([]);
    else expect(topGoal(after(w, npc))).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
    expect(stateOf(w, 'lootWarning', npc.id, w.player.vehicleId)).toBeNull();
    expect(looterOf(w, WRECK)?.id).toBe(w.player.vehicleId);
  });

  it('fights a player that dares it', () => {
    const { w: start, npc } = warned();
    raiseCalls(start);
    const w = pick(start, 'makeMe');
    expect(stateOf(w, 'feud', npc.id, w.player.vehicleId)).not.toBeNull();
    expect(topGoal(after(w, npc))).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId });
  });

  it('takes a hang-up as a refusal, and a hang-up after the answer changes nothing', () => {
    forceOption('warnRefused', 'leave');
    const { w: start, npc } = warned();
    raiseCalls(start);
    const w = hangUp(start);
    expect(after(w, npc).brain!.goals).toEqual([]);
    expect(pendingWarningTo(w, after(w, npc))).toBeNull();
    const { w: again } = warned();
    raiseCalls(again);
    expect(() => hangUp(pick(again, 'findYourOwn'))).not.toThrow();
  });

  it('leaves when the player cannot answer in time', () => {
    const { w, npc } = warned();
    for (let i = 0; i < NPC_BEHAVIOR.warnAnswerTurns; i++) {
      w.turn++;
      advanceStates(w);
    }
    expect(pendingWarningTo(w, npc)).toBeNull();
    expect(npc.brain!.goals).toEqual([]);
  });

  it('fights a player that breaks its word in sight', () => {
    const { w: start, npc } = warned();
    raiseCalls(start);
    const left = pick(start, 'rollingOn');
    after(left, npc).brain!.goals = [];
    const w = startSearch(left, WRECK);
    expect(warnedOffTarget(w, playerVehicle(w), WRECK)).toBeNull();
    expect(topGoal(after(w, npc))).toMatchObject({ kind: 'fight', targetId: w.player.vehicleId, reason: 'defendPromisedLoot' });
  });
});

describe('the player warning a looting driver off', () => {
  it('keeps a complying driver off the target, and rolls nothing for the player after a refusal', () => {
    const w = quietWorld();
    const looter = npcLooting(w);
    playerVehicle(w).pos = { x: 30, y: 30 };
    refreshVision(w);
    const s = warnTruck(w, playerVehicle(w), looter, WRECK, 'roll', 'comply');
    expect(lootWarningData(s).answer).toBe('comply');
    expect(warnedOffTarget(w, looter, WRECK)).toBe(s);
    expect(looter.job).toBeNull();
    const other = quietWorld();
    const stays = npcLooting(other);
    playerVehicle(other).pos = { x: 30, y: 30 };
    const rng = other.rngState;
    warnTruck(other, playerVehicle(other), stays, WRECK, 'roll', 'refuse');
    expect(other.rngState).toBe(rng);
    expect(stays.job).toMatchObject({ kind: 'search' });
    expect(other.states.some((x) => x.kind === 'lootWarning')).toBe(false);
  });
});
