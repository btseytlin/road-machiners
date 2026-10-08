import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERK_NUMBERS, XP_SOURCES } from '../data/skills';
import { SHOPS } from '../data/market';
import { buyPrice, sellPrice } from './economy';
import { goodBasePrice, goodValue, vehicleValue } from './market';
import { BUSY_LINE, TRAIT_TALK, END, HONK_RANGE, HUB, REFUSED, TOPICS, type Topic } from '../data/dialogue';
import { REGION } from '../data/region';
import { playerVehicle } from './damage';
import { callVehicle, callTrucks, chooseOption, currentOptions, endCallIfOut, hangUp, honk, placeholders, radioSpeakers, raiseCalls } from './dialogue';
import { fireBlock, isHostile } from './combat';
import { MEMORY, NPC_UPKEEP, NPCS } from '../data/npcs';
import { RULES } from '../data/rules';
import { aidPrice, offerAid, playerAid, spareAid, wantedAid } from './aid';
import { corePart, isMounted } from './grid';
import { addGoods } from './inventory';
import { hasCargo, emptyHidden } from './salvage';
import { fuelCap, suppliesCap, vehicleStats } from './stats';
import { CONDITIONS, EFFECTS, PREPARES } from './dialogue-rules';
import { addState, aidData, endState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, rngStateForForcedRolls, startCombat, testDrive } from './testkit';
import type { TraitId } from '../data/npcs';
import type { SalvageStock, Vehicle, World } from './types';
import { dist } from './vec';
import { refreshVision } from './vision';
import { autoRuns, endTurn, setMoveOrder } from './world';
import { beginSearch } from './search';
import { knockOutNpc } from './defeat';
import { forgetOld, remember } from './memory';
import { chassisDef } from '../data/chassis';

const TRAITS_OF: Record<string, TraitId[]> = { trader: ['trader'], scavenger: ['scavenger'], buggy: ['raider'] };

function withNpc(templateId: string, faction: Vehicle['faction'], x = 36): { w: World; npc: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const npc = addVehicle(w, faction, 'scout', ['stockEngine'], { x, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  refreshVision(w);
  return { w, npc };
}

function optionIndex(w: World, text: string): number {
  const i = currentOptions(w).findIndex((o) => o.text === text);
  if (i < 0) throw new Error(`No option "${text}" in ${currentOptions(w).map((o) => o.text).join(' | ')}`);
  return i;
}

describe('topic data', () => {
  it('every option leads to a node of its topic, the hub or the end, and every node is reachable', () => {
    for (const topic of Object.values(TOPICS)) {
      expect(topic.nodes[topic.start], `${topic.id} start`).toBeDefined();
      const reached = new Set([topic.start]);
      const queue = [topic.start];
      while (queue.length > 0) {
        for (const option of topic.nodes[queue.pop()!].options) {
          if (option.go === HUB || option.go === END) continue;
          expect(topic.nodes[option.go], `${topic.id} → ${option.go}`).toBeDefined();
          if (!reached.has(option.go)) { reached.add(option.go); queue.push(option.go); }
        }
      }
      expect([...reached].sort()).toEqual(Object.keys(topic.nodes).sort());
    }
  });

  it('every condition, effect and prepare step named in the data exists', () => {
    for (const topic of Object.values(TOPICS)) {
      const conditions = [...(topic.ask?.when ?? []), ...(topic.raise?.when ?? []), ...Object.values(topic.nodes).flatMap((n) => n.options.flatMap((o) => o.when))];
      const effects = [...topic.hangUp, ...Object.values(topic.nodes).flatMap((n) => n.options.flatMap((o) => o.effects))];
      for (const id of conditions) expect(CONDITIONS[id], id).toBeTypeOf('function');
      for (const id of effects) expect(EFFECTS[id], id).toBeTypeOf('function');
      if (topic.prepare) expect(PREPARES[topic.prepare], topic.prepare).toBeTypeOf('function');
    }
  });

  it('class talk lines need no call values', () => {
    for (const { voice } of Object.values(TRAIT_TALK)) {
      for (const line of voice ? [voice.greeting, voice.repeatLine, voice.refusal] : []) expect(placeholders(line)).toEqual([]);
    }
  });
});

describe('calls', () => {
  it('opens on the hub with the greeting when the player sees the truck', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toEqual({ with: npc.id, topic: null, node: HUB, vars: {}, line: { text: TRAIT_TALK.trader.voice!.greeting, vars: {} } });
    expect(next.events).toContainEqual({ t: 'call', with: npc.id, outcome: 'opened' });
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: TRAIT_TALK.trader.voice!.greeting, vars: {} });
  });

  it('cannot reach a truck out of sight', () => {
    const { w, npc } = withNpc('trader', 'traders', 200);
    expect(() => callVehicle(w, npc.id)).toThrow(/out of sight/);
  });

  // A refusal shows in the call panel with only hang up on offer. Neither side's line reaches the log.
  function expectRefused(w: World, npcId: string, line: string): void {
    const next = callVehicle(w, npcId);
    expect(next.player.call).toEqual({ with: npcId, topic: null, node: REFUSED, vars: {}, line: { text: line, vars: {} } });
    expect(currentOptions(next).map((o) => o.text)).toEqual(['Hang up.']);
    const closed = chooseOption(next, 0);
    expect(closed.player.call).toBeNull();
    expect([...next.events, ...closed.events].filter((e) => e.t === 'say')).toEqual([]);
  }

  it('a truck in a feud with nothing left to talk about refuses the call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    addState(w, 'plea', w.player.vehicleId, npc.id, { kind: 'plea', plea: 'truce', answered: true });
    expectRefused(w, npc.id, TRAIT_TALK.trader.voice!.refusal);
  });

  it('a truck in combat with another truck refuses the call with the busy line', () => {
    const { w, npc } = withNpc('trader', 'traders');
    startCombat(w, addVehicle(w, 'scavengers', 'scout', [], { x: 50, y: 50 }), npc);
    expectRefused(w, npc.id, BUSY_LINE);
    expect(hangUp(callVehicle(w, npc.id)).player.call).toBeNull();
  });

  it('a hostile truck busy fighting another truck takes the call and offers peace talk', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    npc.brain!.goals.push({ kind: 'fight', targetId: 'someone-else', destination: { x: 40, y: 30 }, reason: 'fight back', phase: 'travel' });
    expect(isHostile(w, npc, playerVehicle(w))).toBe(true);
    const next = callVehicle(w, npc.id);
    expect(next.player.call).toMatchObject({ with: npc.id, node: HUB });
    expect(currentOptions(next).map((o) => o.text)).toEqual(['Enough shooting. Can we call a truce?', 'I give up. Let me go.', 'Hang up.']);
  });

  it('a truck fighting the player still takes the call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    npc.brain!.goals.push({ kind: 'fight', targetId: w.player.vehicleId, destination: { x: 30, y: 30 }, reason: 'fight back', phase: 'travel' });
    expect(callVehicle(w, npc.id).player.call).not.toBeNull();
  });

  it('stops turns and other commands until it ends', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(() => endTurn(open, testDrive)).toThrow(/radio call/);
    expect(() => setMoveOrder(open, { kind: 'brake' })).toThrow(/radio call/);
    expect(autoRuns({ ...open, player: { ...open.player, state: 'knockedOut' } })).toBe(false);
    const closed = hangUp(open);
    expect(closed.player.call).toBeNull();
    expect(() => endTurn(closed, testDrive)).not.toThrow();
  });

  it('a hostile raider offers only peace talk', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).toEqual(['Enough shooting. Can we call a truce?', 'I give up. Let me go.', 'Hang up.']);
    expect(chooseOption(open, 2).player.call).toBeNull();
  });

  it('rejects an option that is not on offer', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(() => chooseOption(open, currentOptions(open).length)).toThrow(/No option/);
  });
});

describe('directions', () => {
  it('names the known town nearest the player and marks it discovered', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.discovered = [];
    const me = playerVehicle(w).pos;
    const nearest = REGION.towns.filter((t) => ['bowl', 'nose'].includes(t.id)).sort((a, b) => dist(me, a.pos) - dist(me, b.pos))[0];
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.vars.town).toEqual({ kind: 'town', id: nearest.id });
    expect(next.player.call?.vars.distance).toEqual({ kind: 'distance', tiles: dist(me, nearest.pos) });
    next = chooseOption(next, optionIndex(next, 'Thanks. Over and out.'));
    expect(next.player.call).toBeNull();
    expect(next.player.discovered).toContain(nearest.id);
    expect(next.events).toContainEqual({ t: 'discover', location: nearest.id });
  });

  it('returns to the hub and can be asked again', () => {
    const { w, npc } = withNpc('scavenger', 'scavengers');
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    next = chooseOption(next, optionIndex(next, 'Thanks. Something else.'));
    expect(next.player.call?.topic).toBeNull();
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.topic).toBe('directions');
  });
});

describe('NPC calls', () => {
  // Directions stands in for a topic NPCs raise once, so the raise rules run without real raised content.
  const original = { ...TOPICS.directions };
  beforeEach(() => Object.assign(TOPICS.directions, { once: true, raise: { when: ['knowsTown'], priority: 1, duringFeud: false, duringCombat: false }, hangUp: ['settleRefused'] } satisfies Partial<Topic>));
  afterEach(() => Object.assign(TOPICS.directions, original));

  it('an NPC that sees the player opens one call on the topic it raises', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const other = addVehicle(w, 'traders', 'scout', [], { x: 30, y: 36 });
    other.brain = npcBrain('trader', other.pos, ['trader']);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'directions', node: 'answer' });
    expect(w.events.filter((e) => e.t === 'call')).toHaveLength(1);
  });

  it('never raises a `once` topic again after it was settled', () => {
    const { w, npc } = withNpc('trader', 'traders');
    raiseCalls(w);
    const closed = hangUp(w);
    expect(closed.player.talked[npc.id]).toEqual({ directions: 'refused' });
    raiseCalls(closed);
    expect(closed.player.call).toBeNull();
  });

  it('an NPC in combat with another truck raises no call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    startCombat(w, addVehicle(w, 'scavengers', 'scout', [], { x: 50, y: 50 }), npc);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  // A raider with no brain in the player's sight. It puts the player in combat only when it attacks.
  function withRaiderInSight(w: World, attacking = true): void {
    const raider = addVehicle(w, 'raiders', 'scout', [], { x: 26, y: 30 });
    refreshVision(w);
    expect(isHostile(w, raider, playerVehicle(w))).toBe(true);
    if (attacking) startCombat(w, raider, playerVehicle(w));
  }

  it('an NPC calls a player beside a raider that is only passing by, with a topic outside the fight', () => {
    const { w, npc } = withNpc('trader', 'traders');
    TOPICS.directions.raise = { ...TOPICS.directions.raise!, duringCombat: false };
    withRaiderInSight(w, false);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'directions' });
  });

  it('an NPC does not call a player in combat with a topic that is not part of the fight', () => {
    const { w } = withNpc('trader', 'traders');
    withRaiderInSight(w);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  it('a topic raised during combat still calls a player in combat', () => {
    const { w, npc } = withNpc('trader', 'traders');
    TOPICS.directions.raise = { ...TOPICS.directions.raise!, duringCombat: true };
    withRaiderInSight(w);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'directions' });
  });

  it('only the fight topics call during combat', () => {
    const fight = Object.values(TOPICS).filter((t) => t.raise?.duringCombat).map((t) => t.id);
    expect(fight.sort()).toEqual(['demand', 'giveUp', 'mercyPlea', 'spillClaim', 'surrender', 'truceOffer']);
  });

  it('an NPC that does not see the player stays quiet', () => {
    const { w } = withNpc('trader', 'traders', 200);
    raiseCalls(w);
    expect(w.player.call).toBeNull();
  });

  it('a settled `once` topic asked from the hub gets the repeat line', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.talked[npc.id] = { directions: 'done' };
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, TOPICS.directions.ask!.text));
    expect(next.player.call?.topic).toBeNull();
    expect(next.events).toContainEqual({ t: 'say', speaker: npc.id, text: TRAIT_TALK.trader.voice!.repeatLine, vars: {} });
    expect(next.player.call?.line).toEqual({ text: TRAIT_TALK.trader.voice!.repeatLine, vars: {} });
  });
});

function npcAt(w: World, templateId: string, faction: Vehicle['faction'], x: number): Vehicle {
  const npc = addVehicle(w, faction, 'scout', [], { x, y: 30 });
  npc.brain = npcBrain(templateId, npc.pos, TRAITS_OF[templateId]);
  return npc;
}

const honkers = (w: World) => w.events.filter((e) => e.t === 'honk').map((e) => e.vehicle);

describe('honk', () => {
  it('the player honks, and friendly trucks in earshot answer nearest first', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const far = npcAt(w, 'scavenger', 'scavengers', 30 + HONK_RANGE);
    const near = npcAt(w, 'trader', 'traders', 36);
    expect(honkers(honk(w))).toEqual([w.player.vehicleId, near.id, far.id]);
  });

  it('trucks out of earshot, raiders, trucks in a feud and trucks busy fighting stay silent', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    npcAt(w, 'trader', 'traders', 30 + HONK_RANGE + 1);
    const feuding = npcAt(w, 'scavenger', 'scavengers', 34);
    addState(w, 'feud', feuding.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    npcAt(w, 'buggy', 'raiders', 36);
    const busy = npcAt(w, 'trader', 'traders', 32);
    startCombat(w, addVehicle(w, 'scavengers', 'scout', [], { x: 60, y: 60 }), busy);
    expect(honkers(honk(w))).toEqual([w.player.vehicleId]);
  });

  it('a knocked-out driver does not honk back', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    npcAt(w, 'trader', 'traders', 36).defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    expect(honkers(honk(w))).toEqual([w.player.vehicleId]);
  });

  it('a truck in sight that honks back pays the player once', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    npcAt(w, 'trader', 'traders', 36);
    refreshVision(w);
    const once = honk(w);
    expect(practiceOf(once, 'honk')).toMatchObject([{ amount: 1, difficulty: null, xp: XP_SOURCES.honk.weight }]);
    expect(practiceOf(honk(once), 'honk')).toMatchObject([{ xp: 0 }]);
  });

  it('a truck honking back out of sight pays nothing', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = npcAt(w, 'trader', 'traders', 36);
    w.player.visible = [];
    expect(honkers(honk(w))).toContain(npc.id);
    expect(practiceOf(honk(w), 'honk')).toEqual([]);
  });

  it('cannot honk during a call', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = npcAt(w, 'trader', 'traders', 36);
    expect(() => honk(callVehicle(w, npc.id))).toThrow(/radio call/);
  });
});

describe('calls during a turn', () => {
  it('neither side of a call can shoot the other', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 36, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    const open = callVehicle(w, raider.id);
    const r = open.vehicles.find((v) => v.id === raider.id)!;
    const me = open.vehicles.find((v) => v.id === open.player.vehicleId)!;
    expect(fireBlock(open, r, vehicleStats(open, r).weapons[0], me)).toBe('talking');
    expect(fireBlock(w, raider, vehicleStats(w, raider).weapons[0], w.vehicles[0])).not.toBe('talking');
  });

  it('a call ends when the player is knocked out during the turn', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    open.player.state = 'knockedOut';
    endCallIfOut(open);
    expect(open.player.call).toBeNull();
    expect(open.events).toContainEqual({ t: 'call', with: npc.id, outcome: 'ended' });
  });

  it('a call ends when the NPC is knocked out during the turn', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    open.vehicles.find((v) => v.id === npc.id)!.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    endCallIfOut(open);
    expect(open.player.call).toBeNull();
  });

  it('the player cannot call a knocked-out driver', () => {
    const { w, npc } = withNpc('trader', 'traders');
    npc.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    expect(() => callVehicle(w, npc.id)).toThrow(/knocked-out/);
  });
});

describe('demand', () => {
  // A raider with a machine gun spots a player who carries goods. It always picks the fight, and calls first unless
  // told to open fire unwarned.
  function ambush(mugging: 'demand' | 'attack' = 'demand'): { w: World; raider: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(w, playerVehicle(w), 'scrap', 2);
    const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
    raider.brain = npcBrain('buggy', raider.pos, ['raider']);
    forceOption('hostileSeen', 'fight');
    forceOption('mugging', mugging);
    return { w, raider };
  }

  const shotsBetween = (w: World, a: string, b: string) =>
    w.events.filter((e) => e.t === 'shot' && ((e.shooter === a && e.target === b) || (e.shooter === b && e.target === a)));

  it('a raider calls with its demand before the first shot', () => {
    const { w: start, raider } = ambush();
    const w = endTurn(start, testDrive);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'demand' });
    expect(shotsBetween(w, raider.id, w.player.vehicleId)).toEqual([]);
  });

  it('a knocked-out raider does not raise its demand', () => {
    const { w: start, raider } = ambush();
    const w = endTurn(start, testDrive);
    w.player.call = null;
    const out = structuredClone(w);
    out.vehicles.find((v) => v.id === raider.id)!.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    raiseCalls(w);
    raiseCalls(out);
    expect(w.player.call).toMatchObject({ with: raider.id, topic: 'demand' });
    expect(out.player.call).toBeNull();
  });

  it('a raider that picks attack opens fire with no call', () => {
    const { w: start, raider } = ambush('attack');
    // Demand keeps its minimum chance, so take the first seed that rolls attack.
    const seed = Array.from({ length: 20 }, (_, i) => i).find((i) => endTurn({ ...start, rngState: i }, testDrive).player.call === null);
    if (seed === undefined) throw new Error('No seed in 20 attacks unwarned');
    let w = endTurn({ ...start, rngState: seed }, testDrive);
    expect(w.player.call).toBeNull();
    for (let i = 0; i < 5 && shotsBetween(w, raider.id, w.player.vehicleId).length === 0; i++) {
      w = endTurn(w, testDrive);
      expect(w.player.call?.topic).not.toBe('demand');
    }
    expect(shotsBetween(w, raider.id, w.player.vehicleId).length).toBeGreaterThan(0);
  });

  it('handing over drops every goods item and loose part, and buys a truce', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    const me = playerVehicle(w);
    const cargo = me.items.filter((i) => i.kind === 'good' || !isMounted(me.chassisId, i)).length;
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Fine. Take it.'));
    const stock = w.salvage.find((s) => s.id.startsWith(`cargo-${me.id}`))!;
    const inStock = Object.values(stock.goods).reduce((a, b) => a + b, 0) + stock.parts.length;
    expect(inStock).toBe(cargo);
    expect(hasCargo(playerVehicle(w))).toBe(false);
    expect(stateOf(w, 'truce', raider.id, me.id)).not.toBeNull();
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, r, playerVehicle(w))).toBe(false);
    for (let i = 0; i < 5; i++) {
      w = endTurn(w, testDrive);
      expect(shotsBetween(w, raider.id, me.id)).toEqual([]);
    }
  });

  it('handing over pays the player for a closed deal', () => {
    const { w: start } = ambush();
    const w = endTurn(start, testDrive);
    const next = chooseOption(w, optionIndex(w, 'Fine. Take it.'));
    expect(practiceOf(next, 'deal')).toMatchObject([{ amount: 1, difficulty: null }]);
  });

  it('refusing pays nothing for a deal', () => {
    const { w: start } = ambush();
    const w = endTurn(start, testDrive);
    const next = chooseOption(w, optionIndex(w, 'Come and get it.'));
    expect(practiceOf(next, 'deal')).toEqual([]);
  });

  it('refusing keeps the fight, and the demand is not made twice', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Come and get it.'));
    let shots = 0;
    for (let i = 0; i < 8; i++) {
      w = endTurn(w, testDrive);
      // A raider that shot the player to a standstill may offer surrender. The demand itself never returns.
      expect(w.player.call?.topic).not.toBe('demand');
      if (w.player.call) w = hangUp(w);
      shots += shotsBetween(w, raider.id, w.player.vehicleId).length;
    }
    expect(shots).toBeGreaterThan(0);
  });

  it('shots end a truce through a feud, and the truce expires on its own', () => {
    const { w: start, raider } = ambush();
    let w = endTurn(start, testDrive);
    w = chooseOption(w, currentOptions(w).findIndex((o) => o.text === 'Fine. Take it.'));
    const me = w.player.vehicleId;
    addState(w, 'feud', raider.id, me, { kind: 'feud', robbery: false });
    const r = w.vehicles.find((v) => v.id === raider.id)!;
    expect(isHostile(w, r, playerVehicle(w))).toBe(true);
    endState(w, stateOf(w, 'feud', raider.id, me)!, 'broken');
    stateOf(w, 'truce', raider.id, me)!.turnsLeft = 1;
    w = endTurn(w, testDrive);
    expect(stateOf(w, 'truce', raider.id, me)).toBeNull();
  });
});

describe('warn off', () => {
  const WARN = TOPICS.warnOff.ask!.text;
  const asks = (w: World, npcId: string) => currentOptions(callVehicle(w, npcId)).map((o) => o.text);

  // A scavenger parked at a road wreck at `at` with a scavenge goal in the act phase. With `search` it searches it.
  function looterAt(at: { x: number; y: number }, search: boolean): { w: World; npc: Vehicle; wreckId: string } {
    const w = emptyWorld({ x: 30, y: 30 });
    const wreck = { id: 'wreck901', pos: { ...at }, radius: 1, goods: { scrap: 6 }, parts: [], hidden: emptyHidden() };
    w.salvage.push(wreck);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'mg'], { x: at.x + 1, y: at.y });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    if (search) {
      npc.brain.goals = [{ kind: 'scavenge', targetId: wreck.id, destination: { ...wreck.pos }, phase: 'act', reason: 'test loot' }];
      beginSearch(w, npc, wreck.id);
    }
    refreshVision(w);
    return { w, npc, wreckId: wreck.id };
  }

  it('is asked of a driver looting the wreck the player is parked at', () => {
    const { w, npc } = looterAt({ x: 30.5, y: 30 }, true);
    expect(asks(w, npc.id)).toContain(WARN);
  });

  it('is not asked of a looter at another wreck, or of a driver merely parked at the player\'s wreck', () => {
    const far = looterAt({ x: 40, y: 30 }, true);
    expect(asks(far.w, far.npc.id)).not.toContain(WARN);
    const idle = looterAt({ x: 30.5, y: 30 }, false);
    expect(asks(idle.w, idle.npc.id)).not.toContain(WARN);
  });

  it('is not asked of a driver at odds with the player', () => {
    const { w, npc } = looterAt({ x: 30.5, y: 30 }, true);
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(asks(w, npc.id)).not.toContain(WARN);
  });

  it('is asked of a driver stripping a knocked-out truck beside the player', () => {
    const gap = chassisDef('scout').radius + chassisDef('buggy').radius + 0.2;
    const w = emptyWorld({ x: 30, y: 30 });
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30 + gap, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    corePart(buggy, 'cab').hp = 0;
    knockOutNpc(w, buggy);
    const npc = addVehicle(w, 'scavengers', 'scout', ['stockEngine', 'mg'], { x: 30 + 2 * gap, y: 30 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    npc.speed = 0;
    npc.brain.goals = [{ kind: 'loot', targetId: buggy.id, destination: { ...buggy.pos }, phase: 'act', reason: 'test loot' }];
    refreshVision(w);
    expect(asks(w, npc.id)).toContain(WARN);
  });

  it('is asked once per driver', () => {
    const { w: start, npc } = looterAt({ x: 30.5, y: 30 }, true);
    const open = callVehicle(start, npc.id);
    const w = hangUp(chooseOption(open, optionIndex(open, WARN)));
    expect(w.player.talked[npc.id]).toEqual({ warnOff: 'refused' });
    const again = callVehicle(w, npc.id);
    expect(chooseOption(again, optionIndex(again, WARN)).player.call?.topic).toBeNull();
  });
});

describe('trade', () => {
  const askText = TOPICS.trade.ask!.text;

  it('a raider never offers to trade', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain(askText);
  });

  it('agreeing ends the call, starts a trade meeting and sends the driver over', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    const asked = chooseOption(open, optionIndex(open, askText));
    const next = chooseOption(asked, optionIndex(asked, 'Pulling over.'));
    expect(next.player.call).toBeNull();
    expect(stateOf(next, 'trade', npc.id, next.player.vehicleId)).not.toBeNull();
    expect(next.vehicles.find((v) => v.id === npc.id)!.brain!.goals.at(-1)).toMatchObject({ kind: 'meet', targetId: next.player.vehicleId });
  });

  it('a driver already meeting the player is not asked again', () => {
    const { w, npc } = withNpc('trader', 'traders');
    addState(w, 'trade', npc.id, w.player.vehicleId, { kind: 'none' });
    const open = callVehicle(w, npc.id);
    expect(currentOptions(open).map((o) => o.text)).not.toContain(askText);
  });
});

describe('call practice', () => {
  it('pays the player when a call takes up a topic, targeting the driver and topic', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(practiceOf(open, 'call')).toEqual([]);
    const asked = chooseOption(open, optionIndex(open, 'Where is the nearest town?'));
    expect(practiceOf(asked, 'call')).toMatchObject([{ amount: 1, difficulty: null, target: `${npc.id}:directions`, xp: XP_SOURCES.call.weight }]);
  });

  it('pays nothing for a topic already taken up with the same driver, and in full with another driver', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const ask = (from: World, id: string): World => {
      const open = callVehicle(from, id);
      const asked = chooseOption(open, optionIndex(open, 'Where is the nearest town?'));
      return chooseOption(asked, optionIndex(asked, 'Thanks. Over and out.'));
    };
    const once = ask(w, npc.id);
    const again = ask(once, npc.id);
    expect(again.player.xp).toBeCloseTo(once.player.xp);
    const other = addVehicle(again, 'traders', 'scout', [], { x: 30, y: 36 });
    other.brain = npcBrain('trader', other.pos, ['trader']);
    refreshVision(again);
    expect(ask(again, other.id).player.xp).toBeCloseTo(once.player.xp + XP_SOURCES.call.weight);
  });

  it('pays nothing for a call hung up without a topic', () => {
    const { w, npc } = withNpc('trader', 'traders');
    expect(practiceOf(hangUp(callVehicle(w, npc.id)), 'call')).toEqual([]);
  });

  it('pays nothing for a refused call', () => {
    const { w, npc } = withNpc('trader', 'traders');
    addState(w, 'feud', npc.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(practiceOf(callVehicle(w, npc.id), 'call')).toEqual([]);
  });
});


describe('market ears', () => {
  const askText = TOPICS.marketNews.ask!.text;

  // The trader did business at Nose this turn, at its standing prices.
  function backFromNose(w: World, npc: Vehicle): void {
    remember(w, npc, { kind: 'prices', shop: 'nose', pressure: { ...w.shops.nose.pressure } });
  }

  it('a trader back from a town tells its buy and sell prices', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['marketEars'];
    backFromNose(w, npc);
    const open = callVehicle(w, npc.id);
    const asked = chooseOption(open, optionIndex(open, askText));
    const goods = SHOPS.nose.goods.map((good) => ({ good, buy: buyPrice(w, 'nose', good), sell: sellPrice(w, 'nose', good) }));
    expect(asked.player.call?.vars).toEqual({ town: { kind: 'town', id: 'nose' }, prices: { kind: 'prices', town: 'nose', goods } });
  });

  it('tells the prices as they were when the trader left, not as they are now', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['marketEars'];
    backFromNose(w, npc);
    const goods = SHOPS.nose.goods.map((good) => ({ good, buy: buyPrice(w, 'nose', good), sell: sellPrice(w, 'nose', good) }));
    for (const good of SHOPS.nose.goods) w.shops.nose.pressure[good] = 0.5;
    const open = callVehicle(w, npc.id);
    const asked = chooseOption(open, optionIndex(open, askText));
    expect(asked.player.call?.vars.prices).toEqual({ kind: 'prices', town: 'nose', goods });
  });

  it('is not offered once the trader has forgotten the town', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['marketEars'];
    backFromNose(w, npc);
    w.turn += MEMORY.turns.prices;
    forgetOld(w);
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });

  it('is not offered without the perk', () => {
    const { w, npc } = withNpc('trader', 'traders');
    backFromNose(w, npc);
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });

  it('is not offered by a driver that has not been to a town', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['marketEars'];
    remember(w, npc, { kind: 'prices', shop: 'granary', pressure: { ...w.shops.granary.pressure } });
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });
});

describe('trading tips', () => {
  const askText = TOPICS.tips.ask!.text;

  function visit(w: World, npc: Vehicle, shop: string): void {
    remember(w, npc, { kind: 'prices', shop, pressure: { ...w.shops[shop].pressure } });
  }

  function tipOf(w: World, npc: Vehicle): unknown {
    return PREPARES.tradeTip(w, npc).tip;
  }

  // Pressure that puts the good's standing price at `ratio` of its value.
  function pressureFor(shop: string, good: string, ratio: number): number {
    return (ratio * goodValue(good)) / goodBasePrice(shop, good) - 1;
  }

  it('tells of a good it saw far over its value', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'bowl');
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } });
  });

  it('tells of a good it saw far under its value', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'salvage-yard');
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'salvage-yard', good: 'parts', dear: false } });
  });

  it('tells nothing when every price sits within a fifth of its value', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const goods = SHOPS.bowl.goods;
    const pressure = Object.fromEntries(goods.map((good, i) => [good, pressureFor('bowl', good, i % 2 ? 1.1 : 0.9)]));
    remember(w, npc, { kind: 'prices', shop: 'bowl', pressure });
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: null });
  });

  it('tells of the price furthest off its value', () => {
    const { w, npc } = withNpc('trader', 'traders');
    remember(w, npc, { kind: 'prices', shop: 'salvage-yard', pressure: { scrap: -0.3, parts: 0, tools: 0 } });
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'salvage-yard', good: 'scrap', dear: false } });
  });

  it('breaks a tie by the newer memory, then by the good', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'bowl');
    w.turn += 1;
    visit(w, npc, 'nose');
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'nose', good: 'electronics', dear: true } });
    w.turn += 1;
    visit(w, npc, 'bowl');
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } });
  });

  it('tells nothing once the memory has faded', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'bowl');
    w.turn += MEMORY.turns.prices;
    forgetOld(w);
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: null });
  });

  it('tells what it saw, whatever the live prices did since, and rolls nothing', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'bowl');
    for (const good of SHOPS.bowl.goods) w.shops.bowl.pressure[good] = 0;
    w.shops.bowl.pressure.salt = -0.5;
    const rng = w.rngState;
    expect(tipOf(w, npc)).toEqual({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } });
    expect(w.rngState).toBe(rng);
  });

  it('is asked from the hub and answered with the tip', () => {
    const { w, npc } = withNpc('trader', 'traders');
    visit(w, npc, 'bowl');
    const open = callVehicle(w, npc.id);
    const asked = chooseOption(open, optionIndex(open, askText));
    expect(asked.player.call?.vars.tip).toEqual({ kind: 'tip', tip: { shop: 'bowl', good: 'salt', dear: true } });
    expect(currentOptions(asked).map((o) => o.text)).toEqual(expect.arrayContaining(['Thanks. Something else.', 'Over and out.']));
  });

  it('is answered with no tip by a driver that remembers nothing', () => {
    const { w, npc } = withNpc('scavenger', 'scavengers');
    const open = callVehicle(w, npc.id);
    const asked = chooseOption(open, optionIndex(open, askText));
    expect(asked.player.call?.vars.tip).toEqual({ kind: 'tip', tip: null });
  });

  it('is not offered by raiders', () => {
    const { w, npc } = withNpc('buggy', 'raiders');
    visit(w, npc, 'bowl');
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });
});

describe('rumor mill', () => {
  const askText = TOPICS.rumor.ask!.text;

  function rumorWorld(): { w: World; npc: Vehicle } {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['rumorMill'];
    w.player.discovered = [...REGION.towns, ...REGION.locations].map((s) => s.id);
    w.salvage = [];
    return { w, npc };
  }

  function wreck(id: string, pos: { x: number; y: number }): SalvageStock {
    return { id, pos, radius: 0.6, goods: { scrap: 2 }, parts: [], hidden: emptyHidden() };
  }

  it('names the nearest wreck to the driver and marks it rumored', () => {
    const { w, npc } = rumorWorld();
    w.salvage = [wreck('wreck8', { x: 36, y: 50 }), wreck('wreck7', { x: 50, y: 30 })];
    const me = playerVehicle(w).pos;
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    next = chooseOption(next, optionIndex(next, 'Where?'));
    expect(next.player.call?.node).toBe('wreck');
    expect(next.player.call?.vars).toEqual({ bearing: { kind: 'bearing', rad: 0 }, distance: { kind: 'distance', tiles: dist(me, { x: 50, y: 30 }) } });
    next = chooseOption(next, optionIndex(next, 'Thanks. Over and out.'));
    expect(next.player.rumored).toEqual(['wreck7']);
  });

  it('breaks a tie by stock id', () => {
    const { w, npc } = rumorWorld();
    w.salvage = [wreck('wreck3', { x: 36, y: 40 }), wreck('wreck12', { x: 36, y: 20 })];
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    next = chooseOption(next, optionIndex(next, 'Where?'));
    next = chooseOption(next, optionIndex(next, 'Thanks. Over and out.'));
    expect(next.player.rumored).toEqual(['wreck12']);
  });

  it('names an undiscovered site and discovers it', () => {
    const { w } = rumorWorld();
    const site = REGION.locations.find((l) => l.id === 'dustwell')!;
    w.player.discovered = w.player.discovered.filter((id) => id !== site.id);
    playerVehicle(w).pos = { x: site.pos.x - 30, y: site.pos.y };
    const npc = addVehicle(w, 'traders', 'scout', [], { x: site.pos.x - 24, y: site.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    refreshVision(w);
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    next = chooseOption(next, optionIndex(next, 'Where?'));
    expect(next.player.call?.node).toBe('site');
    expect(next.player.call?.vars.site).toEqual({ kind: 'site', id: site.id });
    next = chooseOption(next, optionIndex(next, 'Thanks. Over and out.'));
    expect(next.player.discovered).toContain(site.id);
    expect(next.player.rumored).toEqual([]);
  });

  it('is told once per driver', () => {
    const { w, npc } = rumorWorld();
    w.salvage = [wreck('wreck7', { x: 50, y: 30 }), wreck('wreck8', { x: 60, y: 30 })];
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    next = chooseOption(next, optionIndex(next, 'Where?'));
    next = chooseOption(next, optionIndex(next, 'Thanks. Something else.'));
    next = chooseOption(next, optionIndex(next, askText));
    expect(next.player.call?.topic).toBeNull();
    expect(next.player.rumored).toEqual(['wreck7']);
  });

  it('skips stocks searched, already rumored, empty, far or not a wreck', () => {
    const { w, npc } = rumorWorld();
    w.salvage = [
      wreck('wreck1', { x: 40, y: 30 }),
      wreck('wreck2', { x: 41, y: 30 }),
      { ...wreck('wreck3', { x: 42, y: 30 }), goods: {} },
      wreck('wreck4', { x: 36 + PERK_NUMBERS.rumorMill.radius + 1, y: 30 }),
      wreck('cargo-v9-1', { x: 43, y: 30 }),
    ];
    w.player.scavenged = ['wreck1'];
    w.player.rumored = ['wreck2'];
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });

  it('is not offered without the perk', () => {
    const { w, npc } = rumorWorld();
    w.player.perks = [];
    w.salvage = [wreck('wreck7', { x: 50, y: 30 })];
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });
});

describe('paid truce', () => {
  const askText = TOPICS.buyTruce.ask!.text;

  function hostile(): { w: World; npc: Vehicle } {
    const { w, npc } = withNpc('buggy', 'raiders');
    npc.resources = { fuel: 10, supplies: 10, money: 0, health: 100 };
    w.player.perks = ['paidTruce'];
    return { w, npc };
  }

  it('pays a share of the truck value for peace, with no roll', () => {
    const { w, npc } = hostile();
    const price = Math.round(vehicleValue(npc) * PERK_NUMBERS.paidTruce.share);
    w.player.money = price;
    const rngState = w.rngState;
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    expect(next.player.call?.vars.price).toEqual({ kind: 'money', amount: price });
    next = chooseOption(next, optionIndex(next, 'Deal. Sending it.'));
    const after = next.vehicles.find((v) => v.id === npc.id)!;
    expect(next.player.money).toBe(0);
    expect(after.resources!.money).toBe(price);
    expect(isHostile(next, after, playerVehicle(next))).toBe(false);
    expect(stateOf(next, 'truce', npc.id, next.player.vehicleId)).not.toBeNull();
    expect(next.rngState).toBe(rngState);
  });

  it('is not offered to a player short of the price', () => {
    const { w, npc } = hostile();
    w.player.money = Math.round(vehicleValue(npc) * PERK_NUMBERS.paidTruce.share) - 1;
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });

  it('is not offered without the perk', () => {
    const { w, npc } = hostile();
    w.player.perks = [];
    w.player.money = 1e6;
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });

  it('is not offered to a driver at peace', () => {
    const { w, npc } = withNpc('trader', 'traders');
    w.player.perks = ['paidTruce'];
    w.player.money = 1e6;
    expect(currentOptions(callVehicle(w, npc.id)).map((o) => o.text)).not.toContain(askText);
  });
});

describe('fuel and supply aid', () => {
  const offerText = TOPICS.offerAid.ask!.text;
  const askText = TOPICS.askAid.ask!.text;

  // A driver with full tanks and 500 money beside the player, both at peace.
  function aidWorld(templateId = 'trader', faction: Vehicle['faction'] = 'traders'): { w: World; npc: Vehicle } {
    const { w, npc } = withNpc(templateId, faction);
    npc.resources = { fuel: fuelCap(npc), supplies: suppliesCap(npc), money: 500, health: 100 };
    return { w, npc };
  }

  const lowPlayer = (w: World): void => { w.player.fuel = Math.floor(fuelCap(playerVehicle(w)) * RULES.lowFuelThreshold); };
  const texts = (w: World) => currentOptions(w).map((o) => o.text);
  const npcIn = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

  it('only the drivers that answer tow requests take up asking and offering, and never a raider', () => {
    const helpers = (Object.keys(TRAIT_TALK) as TraitId[]).filter((id) => TRAIT_TALK[id].topics.includes('askAid'));
    const offerers = (Object.keys(TRAIT_TALK) as TraitId[]).filter((id) => TRAIT_TALK[id].topics.includes('aidOffer'));
    expect(helpers.sort()).toEqual(['courier', 'lawman', 'roamer', 'scavenger', 'supplier', 'trader']);
    expect(offerers.sort()).toEqual(helpers);
    expect(Object.values(TRAIT_TALK).every((t) => t.topics.includes('offerAid'))).toBe(true);
  });

  it('a player who is not low cannot ask for aid, and a low one can', () => {
    const { w, npc } = aidWorld();
    expect(texts(callVehicle(w, npc.id))).not.toContain(askText);
    lowPlayer(w);
    expect(texts(callVehicle(w, npc.id))).toContain(askText);
  });

  it('a low player cannot ask a raider for aid', () => {
    const { w, npc } = aidWorld('buggy', 'raiders');
    lowPlayer(w);
    addState(w, 'truce', npc.id, w.player.vehicleId, { kind: 'none' });
    expect(texts(callVehicle(w, npc.id))).not.toContain(askText);
  });

  it('a driver with nothing to spare refuses without a roll, and the same driver cannot be asked again', () => {
    const { w, npc } = aidWorld();
    lowPlayer(w);
    npc.resources!.fuel = fuelCap(npc) * NPC_UPKEEP.tradeReserve;
    npc.resources!.supplies = suppliesCap(npc) * NPC_UPKEEP.tradeReserve;
    const rngState = w.rngState;
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    expect(next.rngState).toBe(rngState);
    next = chooseOption(next, optionIndex(next, 'Whatever you can spare.'));
    expect(next.player.call?.line.text).toBe('Sorry. Cannot spare any.');
    expect(playerAid(next)).toBeNull();
    next = chooseOption(next, optionIndex(next, 'Understood.'));
    next = chooseOption(next, optionIndex(next, askText));
    expect(next.player.call?.topic).toBeNull();
    expect(next.player.call?.line.text).toBe(TRAIT_TALK.trader.voice!.repeatLine);
  });

  it('a driver that gives agrees a free gift of what it named and comes over', () => {
    const { w, npc } = aidWorld();
    lowPlayer(w);
    forceOption('aidAsked', 'give');
    w.rngState = rngStateForForcedRolls(1);
    const spare = spareAid(w, npc);
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, askText));
    next = chooseOption(next, optionIndex(next, 'Whatever you can spare.'));
    expect(next.player.call?.vars.aid).toEqual({ kind: 'aid', ...spare });
    next = chooseOption(next, optionIndex(next, 'Thanks. I will wait.'));
    const deal = stateOf(next, 'aid', npc.id, next.player.vehicleId)!;
    expect(aidData(deal)).toEqual({ kind: 'aid', giver: 'npc', ...spare, price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
    expect(npcIn(next, npc.id).brain!.goals.at(-1)).toMatchObject({ kind: 'meet', targetId: next.player.vehicleId });
    expect(next.player.talked[npc.id]).toEqual({ askAid: 'done' });
  });

  it('hanging up on the question settles it as refused', () => {
    const { w, npc } = aidWorld();
    lowPlayer(w);
    let next = callVehicle(w, npc.id);
    next = hangUp(chooseOption(next, optionIndex(next, askText)));
    expect(next.player.talked[npc.id]).toEqual({ askAid: 'refused' });
    expect(playerAid(next)).toBeNull();
  });

  it('a driver low on fuel names what it wants and its price, and Deal agrees a paid gift at that price', () => {
    const { w, npc } = aidWorld();
    npc.resources!.fuel = 0;
    const wanted = wantedAid(w, npc);
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, offerText));
    expect(next.player.call?.vars).toEqual({ aid: { kind: 'aid', ...wanted }, price: { kind: 'money', amount: aidPrice(w, npc, wanted) } });
    expect(aidPrice(w, npc, wanted)).toBeGreaterThan(0);
    next = chooseOption(next, optionIndex(next, 'Deal.'));
    const deal = aidData(stateOf(next, 'aid', npc.id, next.player.vehicleId)!);
    expect(deal).toEqual({ kind: 'aid', giver: 'player', ...wanted, price: aidPrice(w, npc, wanted), free: false, agreed: true, started: false, work: 1, workLeft: 1 });
    expect(next.player.fuel).toBe(w.player.fuel);
  });

  it('No charge agrees a free gift', () => {
    const { w, npc } = aidWorld();
    npc.resources!.fuel = 0;
    let next = callVehicle(w, npc.id);
    next = chooseOption(next, optionIndex(next, offerText));
    next = chooseOption(next, optionIndex(next, 'No charge.'));
    expect(aidData(stateOf(next, 'aid', npc.id, next.player.vehicleId)!)).toMatchObject({ giver: 'player', price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
  });

  it('the player cannot offer aid to a driver that is not low, or one already in a deal', () => {
    const { w, npc } = aidWorld();
    expect(texts(callVehicle(w, npc.id))).not.toContain(offerText);
    npc.resources!.fuel = fuelCap(npc) * 0.1;
    addState(w, 'aid', npc.id, w.player.vehicleId, { kind: 'aid', giver: 'player', fuel: 1, supplies: 0, price: 0, free: true, agreed: true, started: false, work: 1, workLeft: 1 });
    expect(texts(callVehicle(w, npc.id))).not.toContain(offerText);
  });

  it('a driver with an offer pending calls, and accepting agrees the offer and sends it over', () => {
    const { w, npc } = aidWorld();
    lowPlayer(w);
    offerAid(w, npc);
    const offered = aidData(playerAid(w)!);
    raiseCalls(w);
    expect(w.player.call).toMatchObject({ with: npc.id, topic: 'aidOffer', vars: { aid: { kind: 'aid', fuel: offered.fuel, supplies: offered.supplies } } });
    const next = chooseOption(w, optionIndex(w, 'Thanks. I will wait.'));
    expect(aidData(stateOf(next, 'aid', npc.id, next.player.vehicleId)!)).toEqual({ ...offered, agreed: true, started: false, work: 1, workLeft: 1 });
    expect(npcIn(next, npc.id).brain!.goals.at(-1)).toMatchObject({ kind: 'meet', targetId: next.player.vehicleId });
    raiseCalls(next);
    expect(next.player.call).toBeNull();
  });

  it('hanging up on an offer breaks it', () => {
    const { w, npc } = aidWorld();
    lowPlayer(w);
    offerAid(w, npc);
    raiseCalls(w);
    const next = hangUp(w);
    expect(playerAid(next)).toBeNull();
    expect(next.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'broken' }));
  });
});

describe('trucks on the radio', () => {
  it('lists both trucks of an open call, and none with only the beacon on', () => {
    const { w, npc } = withNpc('trader', 'traders');
    expect(callTrucks(w)).toEqual([]);
    const open = callVehicle(w, npc.id);
    expect(callTrucks(open).sort()).toEqual([open.player.vehicleId, npc.id].sort());
    const beacon = structuredClone(w);
    beacon.player.beacon = true;
    expect(callTrucks(beacon)).toEqual([]);
  });

  it('reads the radio talk events and nothing else', () => {
    const plea = { kind: 'surrender' } as never;
    expect(radioSpeakers([{ t: 'say', speaker: 'a', text: '', vars: {} }], 'p')).toEqual(['a']);
    expect(radioSpeakers([{ t: 'call', with: 'a', outcome: 'opened' }], 'p').sort()).toEqual(['a', 'p']);
    expect(radioSpeakers([{ t: 'plea', from: 'a', to: 'b', plea, accepted: true }], 'p').sort()).toEqual(['a', 'b']);
    expect(radioSpeakers([{ t: 'plea', from: 'a', to: 'p', plea, accepted: null }], 'p')).toEqual(['a']);
    expect(radioSpeakers([{ t: 'escortHired', by: 'a', client: 'b', site: 's', fee: 1 }], 'p').sort()).toEqual(['a', 'b']);
    expect(radioSpeakers([{ t: 'escortRefused', by: 'a', client: 'b' }], 'p').sort()).toEqual(['a', 'b']);
    expect(radioSpeakers([{ t: 'towHitched', by: 'a', client: 'b', site: 's' }], 'p').sort()).toEqual(['a', 'b']);
    expect(radioSpeakers([{ t: 'towOffer', by: 'a', town: 't', fee: 1 }], 'p')).toEqual(['a']);
    expect(radioSpeakers([{ t: 'honk', vehicle: 'a' }, { t: 'aidStarted', giver: 'a', receiver: 'b' }, { t: 'patch', patcher: 'a', client: 'b', outcome: 'started' }], 'p')).toEqual([]);
  });

  it('a real call and hang up put both trucks on the radio', () => {
    const { w, npc } = withNpc('trader', 'traders');
    const open = callVehicle(w, npc.id);
    expect(radioSpeakers(open.events, open.player.vehicleId).sort()).toEqual([npc.id, open.player.vehicleId].sort());
    const done = hangUp(open);
    expect(radioSpeakers(done.events, done.player.vehicleId)).toContain(npc.id);
    expect(radioSpeakers(done.events, done.player.vehicleId)).toContain(done.player.vehicleId);
  });
});

describe('robber truce', () => {
  // A scumbag that opened fire on the player's cargo truck: a robbery feud, and no demand call.
  function holdup(robbery = true): { w: World; robber: Vehicle } {
    const w = emptyWorld({ x: 30, y: 30 });
    for (const id of Object.keys(NPCS)) w.spawnTimer[id] = Number.MAX_SAFE_INTEGER;
    addGoods(w, playerVehicle(w), 'scrap', 2);
    const robber = addVehicle(w, 'scavengers', 'buggy', ['stockEngine', 'mg'], { x: 40, y: 30 }, Math.PI);
    robber.brain = npcBrain('scavenger', robber.pos, ['scavenger', 'scumbag']);
    // Two mates make the robber's group clearly outgun the player, so the perceived danger never tips it to peace.
    for (const y of [28, 32]) addVehicle(w, 'scavengers', 'buggy', ['stockEngine', 'mg'], { x: 40, y }, Math.PI).brain = npcBrain('scavenger', { x: 40, y }, ['scavenger']);
    addState(w, 'feud', robber.id, w.player.vehicleId, { kind: 'feud', robbery });
    addState(w, 'feud', w.player.vehicleId, robber.id, { kind: 'feud', robbery: false });
    refreshVision(w);
    return { w, robber };
  }
  const truceText = TOPICS.truce.ask!.text;
  const askTruce = (w: World, id: string): World => {
    let next = callVehicle(w, id);
    next = chooseOption(next, optionIndex(next, truceText));
    return chooseOption(next, optionIndex(next, 'We both drive away.'));
  };

  it('names its price and grants no truce, even when the roll would accept', () => {
    forceOption('truceOffered', 'accept');
    const { w, robber } = holdup();
    const next = askTruce(w, robber.id);
    expect(next.player.call?.node).toBe('demanded');
    expect(currentOptions(next).map((o) => o.text)).toEqual(['Fine. Take it.', 'Come and get it.', 'Hang up.']);
    expect(isHostile(next, next.vehicles.find((v) => v.id === robber.id)!, playerVehicle(next))).toBe(true);
  });

  it('paying drops the cargo for the robber, makes peace and settles its demand', () => {
    const { w, robber } = holdup();
    const next = chooseOption(askTruce(w, robber.id), 0);
    const me = playerVehicle(next);
    expect(hasCargo(me)).toBe(false);
    expect(next.salvage.some((s) => s.id.startsWith(`cargo-${me.id}`))).toBe(true);
    expect(isHostile(next, next.vehicles.find((v) => v.id === robber.id)!, me)).toBe(false);
    expect(next.player.talked[robber.id]?.demand).toBe('agreed');
  });

  it('refusing keeps the feud, hides the truce and settles the radio demand', () => {
    const { w, robber } = holdup();
    const next = chooseOption(askTruce(w, robber.id), 1);
    expect(isHostile(next, next.vehicles.find((v) => v.id === robber.id)!, playerVehicle(next))).toBe(true);
    expect(next.player.talked[robber.id]?.demand).toBe('refused');
    expect(hasCargo(playerVehicle(next))).toBe(true);
    const again = callVehicle(next, robber.id);
    expect(currentOptions(again).map((o) => o.text)).not.toContain(truceText);
  });

  it('hanging up at the price refuses, and survives a save round trip', () => {
    const { w, robber } = holdup();
    const open = structuredClone(askTruce(w, robber.id));
    const next = hangUp(open);
    expect(next.player.talked[robber.id]?.demand).toBe('refused');
    expect(stateOf(next, 'plea', next.player.vehicleId, robber.id)).not.toBeNull();
    expect(chooseOption(structuredClone(open), 1).player.talked[robber.id]?.demand).toBe('refused');
  });

  it('a defensive feud grants the truce for free', () => {
    forceOption('truceOffered', 'accept');
    const { w, robber } = holdup(false);
    const next = askTruce(w, robber.id);
    expect(next.player.call?.node).toBe('agreed');
    expect(isHostile(next, next.vehicles.find((v) => v.id === robber.id)!, playerVehicle(next))).toBe(false);
  });

  it('a weak robber grants the truce for free', () => {
    forceOption('truceOffered', 'accept');
    const { w, robber } = holdup();
    robber.resources = { fuel: 10, supplies: 10, money: 0, health: 1 };
    const next = askTruce(w, robber.id);
    expect(next.player.call?.node).toBe('agreed');
  });
});
