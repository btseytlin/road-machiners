import { HUNT, MIN_CHANCE, NPCS, NPC_BEHAVIOR, TRAITS } from '../data/npcs';
import { partDef, type PartDef } from '../data/parts';
import { REGION } from '../data/region';
import { describe, expect, it, onTestFinished } from 'vitest';
import { TERRAIN } from '../data/terrain';
import { corePart, coreParts, mountedParts } from './grid';
import { maxHp } from './wear';
import { addGoods } from './inventory';
import { decide, fitToHunt, holdsUp, huntingGrounds, isWeak, judgeDanger, lawmanTowns, nearLawGate, raiderGrounds, optionChances, optionWeights } from './npc-decisions';
import { siteLootTable } from './salvage';
import { isTerritory, siteGap, siteGates, sitePads } from './sites';
import { hazardZones, territoryEntries, territoryGrounds } from './territory';
import { noteHurt, thinkNpc, topGoal } from './npc-activities';
import { chooseOn, trackOf } from './tracks';
import { addState, endState, stateOf } from './states';
import { playerVehicle } from './damage';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls } from './testkit';
import type { TraitId } from '../data/npcs';
import type { Faction, Vehicle, World } from './types';
import { dist, polylineDist, type Vec } from './vec';
import { fuelCap } from './stats';
import { getResources } from './resources';
import { RULES } from '../data/rules';
import { refreshVision } from './vision';
import { cloneWorld } from './world';

function addNpc(w: World, faction: Faction, templateId: string, traits: TraitId[], pos: Vec, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, faction, 'wagon', parts, pos);
  v.brain = npcBrain(templateId, pos, traits);
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

describe('decision weights', () => {
  it('gives every available option at least MIN_CHANCE and shares the rest by weight', () => {
    const rare = optionChances({ keep: 1, rob: 0 });
    expect(rare.keep).toBeCloseTo(1 - MIN_CHANCE);
    expect(rare.rob).toBeCloseTo(MIN_CHANCE);
    const shares = optionChances({ keep: 3, flee: 1 });
    expect(shares.keep).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * 0.75);
    expect(shares.flee).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * 0.25);
    for (const share of Object.values(optionChances({ trade: 0, scavenge: 0, wait: 0, raid: 0 }))) expect(share).toBeCloseTo(0.25);
  });

  it('never picks an unavailable option over 500 seeds', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, npc, 'hostileSeen', raider.id, judgeDanger(w, npc, raider))).not.toHaveProperty('fight');
    for (let seed = 0; seed < 500; seed++) {
      w.rngState = seed;
      expect(decide(w, npc, 'hostileSeen', raider.id, judgeDanger(w, npc, raider))).not.toBe('fight');
    }
  });

  it('picks an available option with no weight at about 1%', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const scav = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 60, y: 30 });
    expect(optionWeights(w, scav, 'contactHeard', w.player.vehicleId, null).investigate).toBe(0);
    const draws = 5000;
    let picked = 0;
    for (let i = 0; i < draws; i++) if (decide(w, scav, 'contactHeard', w.player.vehicleId, null) === 'investigate') picked++;
    expect(picked / draws).toBeGreaterThan(0.005);
    expect(picked / draws).toBeLessThan(0.018);
  });

  it('offers a raid only to raiders', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 60, y: 30 });
    const merc = addNpc(w, 'mercs', 'merc', ['merc'], { x: 70, y: 30 });
    expect(optionWeights(w, raider, 'idle', null, null)).toHaveProperty('raid');
    expect(optionWeights(w, merc, 'idle', null, null)).not.toHaveProperty('raid');
  });

  it('keeps with no roll when keep is the only available option', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 60, y: 30 });
    raider.resources!.fuel = 0;
    expect(Object.keys(optionWeights(w, raider, 'contactHeard', w.player.vehicleId, null))).toEqual(['keep']);
    const rng = w.rngState;
    expect(decide(w, raider, 'contactHeard', w.player.vehicleId, null)).toBe('keep');
    expect(w.rngState).toBe(rng);
  });

  it('throws on a situation factor at or below zero', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    const missFlee = NPC_BEHAVIOR.missFlee;
    NPC_BEHAVIOR.missFlee = 0;
    onTestFinished(() => { NPC_BEHAVIOR.missFlee = missFlee; });
    npc.brain!.hurt = 0;
    expect(() => optionWeights(w, npc, 'attacked', raider.id, null)).toThrow(/factor/);
  });

  it('makes fight unavailable without a working weapon', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['stockEngine']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    expect(optionWeights(w, npc, 'hostileSeen', raider.id, judgeDanger(w, npc, raider))).not.toHaveProperty('fight');
  });

  it('raises flee weight when outgunned or damaged', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['mg', 'stockEngine']);
    const weak = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 24, y: 10 });
    const strong = addVehicle(w, 'raiders', 'wagon', ['tankGun', 'stockEngine'], { x: 10, y: 28 });
    const calm = optionWeights(w, npc, 'hostileSeen', weak.id, judgeDanger(w, npc, weak)).flee!;
    expect(optionWeights(w, npc, 'hostileSeen', strong.id, judgeDanger(w, npc, strong)).flee).toBeGreaterThan(calm);
    corePart(npc, 'cab').hp = 1;
    expect(optionWeights(w, npc, 'hostileSeen', weak.id, judgeDanger(w, npc, weak)).flee).toBeGreaterThan(calm);
  });

  it('does not count a truck weak for one broken wheel', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    coreParts(npc, 'wheel')[0].hp = 0;
    expect(isWeak(w, npc)).toBe(false);
  });

  it('counts a truck weak when it cannot drive', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    corePart(npc, 'transmission').hp = 0;
    expect(isWeak(w, npc)).toBe(true);
  });

  it('counts a truck weak when most of it is broken, even with a sound cab', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 }, ['mg', 'stockEngine', 'plates']);
    const cab = corePart(npc, 'cab');
    for (const part of mountedParts(npc)) if (part !== cab) part.hp = Math.floor(maxHp(part) * 0.2);
    expect(isWeak(w, npc)).toBe(true);
  });

  it('a coward flees from an equal truck more often than a plain scavenger', () => {
    const flees = (traits: TraitId[]) => {
      const w = emptyWorld({ x: 80, y: 80 });
      const npc = addNpc(w, 'scavengers', 'scavenger', traits, { x: 10, y: 10 });
      addNpc(w, 'raiders', 'buggy', ['raider'], { x: 24, y: 10 });
      let count = 0;
      for (let seed = 0; seed < 100; seed++) {
        const x = cloneWorld(w);
        x.rngState = seed;
        if (thinkNpc(x, find(x, npc.id)).kind === 'flee') count++;
      }
      return count;
    };
    const plain = flees(['scavenger']);
    expect(flees(['scavenger', 'coward'])).toBeGreaterThan(plain + 20);
  });

  it('adds fight weight only against the feud target', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const a = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const b = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 12 });
    const before = optionWeights(w, npc, 'hostileSeen', a.id, judgeDanger(w, npc, a)).fight!;
    addState(w, 'feud', npc.id, a.id, { kind: 'feud', robbery: false });
    expect(optionWeights(w, npc, 'hostileSeen', a.id, judgeDanger(w, npc, a)).fight).toBeGreaterThan(before);
    expect(optionWeights(w, npc, 'hostileSeen', b.id, judgeDanger(w, npc, b)).fight).toBe(before);
  });

  it('a trader rarely starts a fight', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const seeds = 1000;
    let fights = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, trader.id)).kind === 'fight') fights++;
    }
    expect(fights).toBeGreaterThan(0);
    expect(fights / seeds).toBeLessThan(0.03);
  });

  it('a tower the player turned down offers a tow rarely', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    w.player.fuel = 0;
    const eager = optionChances(optionWeights(w, trader, 'strandedSeen', me, null)).tow!;
    addState(w, 'turnedDown', trader.id, me, { kind: 'none' });
    const turnedDown = optionChances(optionWeights(w, trader, 'strandedSeen', me, null)).tow!;
    expect(turnedDown).toBeGreaterThanOrEqual(MIN_CHANCE);
    expect(turnedDown).toBeLessThan(0.03);
    expect(eager).toBeGreaterThan(0.5);
  });

  it('a turned-down tower that picks tow again gets over it and keeps its tow goal', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 36, y: 30 });
    const me = w.player.vehicleId;
    w.player.fuel = 0;
    addState(w, 'turnedDown', trader.id, me, { kind: 'none' });
    forceOption('strandedSeen', 'tow');
    w.rngState = rngStateForForcedRolls(6);
    expect(thinkNpc(w, trader)).toMatchObject({ kind: 'tow', targetId: me });
    expect(stateOf(w, 'turnedDown', trader.id, me)).toBeNull();
    expect(thinkNpc(w, trader)).toMatchObject({ kind: 'tow', targetId: me });
  });
});

describe('fit to hunt', () => {
  function raider(): { w: World; v: Vehicle } {
    const w = emptyWorld({ x: 80, y: 80 });
    return { w, v: addNpc(w, 'raiders', 'buggy', ['raider'], { x: 10, y: 10 }, ['mg', 'stockEngine', 'plates']) };
  }

  it('holds for a fresh raider', () => {
    const { w, v } = raider();
    expect(fitToHunt(w, v)).toBe(true);
  });

  it('fails with no working gun', () => {
    const { w, v } = raider();
    for (const gun of mountedParts(v, 'weapon')) gun.hp = 0;
    expect(fitToHunt(w, v)).toBe(false);
  });

  it('fails with only junk guns', () => {
    const { w, v } = raider();
    for (const gun of mountedParts(v, 'weapon')) { gun.wear = 5; gun.hp = 0; }
    expect(fitToHunt(w, v)).toBe(false);
  });

  it('fails with no gun at all', () => {
    const { w, v } = raider();
    v.items = v.items.filter((it) => !(it.kind === 'part' && partDef(it.part.defId).kind === 'weapon'));
    expect(fitToHunt(w, v)).toBe(false);
  });

  it('fails with the body at the recover condition', () => {
    const { w, v } = raider();
    const cab = corePart(v, 'cab');
    cab.hp = maxHp(cab) * NPC_BEHAVIOR.recoverCondition;
    expect(fitToHunt(w, v)).toBe(false);
    cab.hp = maxHp(cab) * NPC_BEHAVIOR.recoverCondition + 1;
    expect(fitToHunt(w, v)).toBe(true);
  });

  it('fails with the driver at the recover condition', () => {
    const { w, v } = raider();
    getResources(w, v).health = RULES.maxHealth * NPC_BEHAVIOR.recoverCondition;
    expect(fitToHunt(w, v)).toBe(false);
  });

  it('fails when stranded', () => {
    const { w, v } = raider();
    getResources(w, v).fuel = 0;
    expect(fitToHunt(w, v)).toBe(false);
  });
});

describe('aid decisions', () => {
  function aidChances(traits: TraitId[], decision: 'aidAsked' | 'needySeen'): Record<string, number> {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addNpc(w, 'traders', 'trader', traits, { x: 36, y: 30 });
    npc.resources!.fuel = fuelCap(npc);
    w.player.fuel = 1;
    return optionChances(optionWeights(w, npc, decision, w.player.vehicleId, null)) as Record<string, number>;
  }

  const HELPERS: TraitId[][] = [['trader'], ['scavenger'], ['roamer']];

  it('a trader, scavenger or roamer offers aid unprompted about 3% of the time, others at the floor', () => {
    for (const traits of HELPERS) {
      const aid = aidChances(traits, 'needySeen').aid;
      expect(aid).toBeGreaterThan(0.025);
      expect(aid).toBeLessThan(0.035);
    }
    expect(aidChances(['lawman'], 'needySeen').aid).toBeCloseTo(MIN_CHANCE);
  });

  it('a trader, scavenger or roamer gives when asked about twice as often as others', () => {
    const plain = aidChances(['lawman'], 'aidAsked').give;
    expect(plain).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * (1 / 10));
    for (const traits of HELPERS) expect(aidChances(traits, 'aidAsked').give).toBeCloseTo(MIN_CHANCE + (1 - 2 * MIN_CHANCE) * (2 / 11));
  });

  it('keeps every aid option at MIN_CHANCE or more', () => {
    for (const traits of [...HELPERS, ['lawman'], ['courier'], ['supplier'], ['raider']] as TraitId[][]) {
      for (const decision of ['aidAsked', 'needySeen'] as const) {
        const chances = Object.values(aidChances(traits, decision));
        expect(chances).toHaveLength(2);
        for (const chance of chances) expect(chance).toBeGreaterThanOrEqual(MIN_CHANCE);
      }
    }
  });
});

describe('fight back', () => {
  const round = (struck: string, damage: number) => ({ hit: true, crit: false, offset: 0, struck, hits: [{ part: 'x', damage }], blast: [], burst: null });

  function shotTrader(traits: TraitId[], damage: number) {
    const w = emptyWorld({ x: 80, y: 80 });
    const trader = addNpc(w, 'traders', 'trader', traits, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    trader.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 14, y: 10 });
    w.events = [{ t: 'shot', shooter: raider.id, weapon: 'w', target: trader.id, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [round(trader.id, damage)] }];
    noteHurt(w);
    w.events = [];
    trader.brain!.attackers = { [raider.id]: false };
    return { w, trader, raider };
  }

  it('a trader shot by an NPC sometimes fights back and mostly flees', () => {
    const { w, trader, raider } = shotTrader(['trader'], 18);
    const seeds = 400;
    let back = 0;
    let fled = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const top = thinkNpc(x, find(x, trader.id));
      if (top.kind === 'fight') {
        expect(top).toMatchObject({ targetId: raider.id, reason: 'fight back' });
        back++;
      }
      if (top.kind === 'flee') fled++;
    }
    expect(back / seeds).toBeGreaterThan(0.05);
    expect(fled / seeds).toBeGreaterThan(0.5);
  });

  it('a coward fights back less than a plain trader', () => {
    const plain = shotTrader(['trader'], 18);
    const coward = shotTrader(['trader', 'coward'], 18);
    const back = (s: { w: World; trader: Vehicle; raider: Vehicle }) => optionChances(optionWeights(s.w, s.trader, 'attacked', s.raider.id, judgeDanger(s.w, s.trader, s.raider))).fightBack!;
    expect(back(coward)).toBeLessThan(back(plain));
  });

  it('a brave trader almost never runs from a shot or begs', () => {
    const brave = shotTrader(['trader', 'brave'], 18);
    const chances = (decision: 'attacked' | 'parley') => optionChances(optionWeights(brave.w, brave.trader, decision, brave.raider.id, judgeDanger(brave.w, brave.trader, brave.raider)));
    expect(chances('attacked').flee!).toBeLessThan(0.1);
    expect(chances('parley').beg!).toBeLessThan(0.02);
  });

});

describe('decision points', () => {
  it('the same hostile in sight fires one roll', () => {
    const w = emptyWorld({ x: 50, y: 50 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    const chosen = () => trackOf(npc, raider.id)?.choice ?? null;
    npc.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    const keeps = (seed: number) => {
      const x = cloneWorld(w);
      x.rngState = seed;
      thinkNpc(x, find(x, npc.id));
      return topGoal(find(x, npc.id))?.kind === 'scavenge';
    };
    const seed = Array.from({ length: 100 }, (_, i) => i).find(keeps);
    if (seed === undefined) throw new Error('No seed in 100 keeps');
    w.rngState = seed;
    thinkNpc(w, npc);
    expect(w.rngState).not.toBe(seed);
    expect(chosen()).toBe('keep');
    expect(topGoal(npc)?.kind).toBe('scavenge');
    const rng = w.rngState;
    thinkNpc(w, npc);
    thinkNpc(w, npc);
    expect(w.rngState).toBe(rng);
    w.obstacles.push({ id: 'cover', kind: 'rock', pos: { x: 12, y: 10 }, r: 1 });
    w.turn += NPC_BEHAVIOR.noticeMemory;
    thinkNpc(w, npc);
    expect(chosen()).toBe('keep');
    w.turn += 1;
    thinkNpc(w, npc);
    expect(trackOf(npc, raider.id)).toBeUndefined();
    w.obstacles = [];
    const hidden = w.rngState;
    thinkNpc(w, npc);
    expect(w.rngState).not.toBe(hidden);
    expect(chosen()).toBe('keep');
  });

  it('a truck a goal targets stays tracked while out of perception', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.player.vehicleId;
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: 70, y: 30 });
    raider.brain!.goals = [{ kind: 'investigate', targetId: me, destination: { x: 30, y: 30 }, phase: 'travel', reason: 'heard a hostile beyond sight' }];
    chooseOn(w, raider, me, { x: 30, y: 30 }, 'investigate', false);
    w.turn += NPC_BEHAVIOR.noticeMemory + 1;
    thinkNpc(w, raider);
    expect(raider.brain!.goals.at(-1)).toMatchObject({ kind: 'investigate', targetId: me });
    expect(trackOf(raider, me)?.choice).toBe('investigate');
  });

  it('knows a truck it drove past and now only hears as the same truck', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const me = w.vehicles[0];
    const trader = addNpc(w, 'traders', 'trader', ['trader'], { x: 34, y: 30 });
    trader.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    thinkNpc(w, trader);
    expect(trackOf(trader, me.id)).toMatchObject({ sighted: true, choice: null, at: me.pos });
    me.pos = { x: 34 + TERRAIN.vision.radius + 5, y: 30 };
    me.speed = 4;
    w.turn += NPC_BEHAVIOR.noticeMemory + 2;
    thinkNpc(w, trader);
    expect(trackOf(trader, me.id)).toMatchObject({ sighted: true, turn: w.turn });
  });

  it('a raider investigates a contact, and a scavenger rarely does', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    w.vehicles[0].speed = 4;
    const beyond = 30 + TERRAIN.vision.radius + 5;
    const raider = addNpc(w, 'raiders', 'buggy', ['raider'], { x: beyond, y: 30 });
    const scav = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 60 - beyond, y: 30 });
    addState(w, 'feud', scav.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(optionWeights(w, raider, 'contactHeard', w.player.vehicleId, null).investigate).toBeGreaterThan(0);
    expect(optionWeights(w, scav, 'contactHeard', w.player.vehicleId, null).investigate).toBe(0);
    let investigated = 0;
    let scavInvestigated = 0;
    for (let seed = 0; seed < 200; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, raider.id)).kind === 'investigate') investigated++;
      if (thinkNpc(x, find(x, scav.id)).kind === 'investigate') scavInvestigated++;
    }
    expect(investigated).toBeGreaterThan(100);
    expect(scavInvestigated).toBeLessThan(10);
  });

  it('fires attacked once per new shot, even a miss', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'buggy', [], { x: 14, y: 10 });
    chooseOn(w, npc, raider.id, raider.pos, 'keep', true);
    npc.brain!.goals = [{ kind: 'wait', targetId: null, destination: null, phase: 'act', reason: 'test base goal' }];
    forceOption('attacked', 'flee');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.some((g) => g.kind === 'flee')).toBe(false);
    npc.brain!.attackers = { [raider.id]: false };
    const rolls = (seed: number) => {
      const x = cloneWorld(w);
      x.rngState = seed;
      return thinkNpc(x, find(x, npc.id)).kind === 'flee' ? x : null;
    };
    const fled = Array.from({ length: 20 }, (_, i) => rolls(i)).find((x) => x !== null);
    if (!fled) throw new Error('No seed in 20 flees');
    const me = find(fled, npc.id);
    expect(me.brain!.goals.at(-1)).toMatchObject({ kind: 'flee', targetId: raider.id });
    expect(me.brain!.attackers).toEqual({ [raider.id]: true });
    const rng = fled.rngState;
    thinkNpc(fled, me);
    expect(fled.rngState).toBe(rng);
  });
});


describe('truce answers', () => {
  const setup = (robbery: boolean) => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = w.player.vehicleId;
    const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    addState(w, 'feud', robber.id, me, { kind: 'feud', robbery });
    const accept = () => optionChances(optionWeights(w, robber, 'truceOffered', me, judgeDanger(w, robber, find(w, me)))).accept!;
    return { robber, accept };
  };

  it('a confident robber rarely takes a truce from its prey', () => {
    expect(setup(false).accept()).toBeGreaterThan(0.5);
    expect(setup(true).accept()).toBeLessThan(0.15);
  });

  it('a weak robber takes a truce as readily as any driver', () => {
    const { robber, accept } = setup(true);
    corePart(robber, 'cab').hp = 1;
    expect(accept()).toBeGreaterThan(0.5);
  });

  it('a confident raider rarely takes a truce from prey with loot', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = find(w, w.player.vehicleId);
    const raider = addNpc(w, 'raiders', 'raider', ['raider'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    const accept = () => optionChances(optionWeights(w, raider, 'truceOffered', me.id, judgeDanger(w, raider, me))).accept!;
    addGoods(w, me, 'scrap', 2);
    expect(accept()).toBeLessThan(0.1);
    corePart(raider, 'cab').hp = 1;
    expect(accept()).toBeGreaterThan(0.5);
  });
});

function brokenInRam(def: PartDef): boolean {
  return def.kind === 'weapon' || def.kind === 'engine' || (def.kind === 'core' && def.role === 'wheel');
}

describe('truce offers', () => {
  function duel(playerBroken: boolean, raiderCab: number | null) {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = find(w, w.player.vehicleId);
    if (playerBroken) for (const p of mountedParts(me)) if (brokenInRam(partDef(p.defId))) p.hp = 0;
    const raider = addNpc(w, 'raiders', 'gunwagon', ['raider'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    addState(w, 'feud', raider.id, me.id, { kind: 'feud', robbery: false });
    if (raiderCab !== null) corePart(raider, 'cab').hp = raiderCab;
    return optionChances(optionWeights(w, raider, 'parley', me.id, judgeDanger(w, raider, me)));
  }

  it('a driver that is winning offers a truce at about the floor chance', () => {
    expect(duel(true, null).truce!).toBeLessThan(2 * MIN_CHANCE);
  });

  it('a weak driver pleads far more often than a winning one', () => {
    const pleads = (c: ReturnType<typeof duel>) => c.truce! + c.beg!;
    expect(pleads(duel(true, 1))).toBeGreaterThan(pleads(duel(true, null)) * 5);
  });
});

describe('robbery after a truce', () => {
  it('a robber rarely robs a truck it holds a truce with', () => {
    const w = emptyWorld({ x: 10, y: 10 });
    const me = find(w, w.player.vehicleId);
    addGoods(w, me, 'scrap', 2);
    const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    refreshVision(w);
    const rob = () => optionWeights(w, robber, 'preySeen', me.id, judgeDanger(w, robber, me)).rob!;
    const before = rob();
    addState(w, 'truce', robber.id, me.id, { kind: 'none' });
    expect(rob()).toBeLessThan(before / 100);
  });
});

describe('hunting grounds', () => {
  it('belong to the camps every raider template knows, so a raider camp owns its grounds', () => {
    const camps = REGION.locations.filter((l) => l.kind === 'camp').map((l) => l.id).sort();
    for (const t of Object.values(NPCS).filter((t) => t.traits.includes('raider'))) expect([...TRAITS.raider.bases].sort(), t.id).toEqual(camps);
  });

  const grounds = huntingGrounds();
  const territories = REGION.locations.filter(isTerritory);
  const lootPads = [...REGION.locations.filter((l) => l.kind !== 'camp' && siteLootTable(l)).flatMap((l) => sitePads(l)), ...territories.flatMap(territoryGrounds)];
  const isPad = (p: Vec) => lootPads.some((pad) => dist(p, pad) < 0.01);
  const onRoad = (p: Vec) => !isPad(p) && REGION.roads.some((road) => polylineDist(p, road) < 0.01);

  it('lie on lonely road stretches and at the pads of salvage sites', () => {
    expect(lootPads.length).toBeGreaterThan(0);
    for (const pad of lootPads) expect(grounds).toContainEqual(pad);
    expect(grounds.filter(onRoad).length).toBeGreaterThanOrEqual(5);
  });

  it('wait at every road into the Fallen Sun', () => {
    const entries = territoryEntries(territories.find((t) => t.id === 'fallen-sun')!);
    expect(entries).toHaveLength(3);
    for (const p of entries) expect(grounds).toContainEqual(p);
  });

  it('reach into each territory, outside every hazard', () => {
    for (const t of territories) for (const p of territoryGrounds(t)) expect(grounds).toContainEqual(p);
    for (const p of grounds) for (const z of hazardZones()) expect(dist(p, z.pos)).toBeGreaterThan(z.radius);
  });

  describe('in Old Orchard', () => {
    const orchard = territories.find((t) => t.id === 'orchard')!;
    const orchardGrounds = territoryGrounds(orchard);
    const isOrchardGround = (p: Vec) => orchardGrounds.some((q) => q.x === p.x && q.y === p.y);

    it('hold every orchard ground', () => {
      expect(orchardGrounds.length).toBeGreaterThan(0);
      for (const p of orchardGrounds) expect(grounds).toContainEqual(p);
    });

    it('send a prowling vulture to an orchard ground', () => {
      const w = emptyWorld({ x: 30, y: 30 });
      const npc = addNpc(w, 'vultures', 'vulture', ['vulture'], { x: 30, y: 30 }, ['longRifle', 'stockEngine']);
      forceOption('idle', 'prowl');
      const goals = Array.from({ length: 40 }, (_, seed) => {
        const x = cloneWorld(w);
        x.rngState = Math.imul(seed + 1, 2654435761);
        return thinkNpc(x, find(x, npc.id));
      }).filter((g) => g.kind === 'prowl');
      expect(goals.filter((g) => isOrchardGround(g.destination!)).length).toBeGreaterThan(0);
    });

    it('are shared by the raiders of Scrapjaw and Kiln', () => {
      const camps = REGION.locations.filter((l) => l.kind === 'camp');
      const covering = Object.fromEntries(camps.map((c): [string, number] => [c.id, raiderGrounds(c).filter(isOrchardGround).length]).filter(([, n]) => n > 0));
      expect(covering).toEqual({ kiln: 3, scrapjaw: 6 });
    });
  });

  it('keeps road grounds far from every site, and none at a town or camp', () => {
    const sites = [...REGION.towns, ...REGION.locations];
    for (const p of grounds.filter(onRoad)) for (const site of sites) expect(siteGap(site, p)).toBeGreaterThanOrEqual(HUNT.siteDistance);
    const guarded = [...REGION.towns, ...REGION.locations.filter((l) => l.kind === 'camp')];
    for (const p of grounds) for (const site of guarded) expect(dist(p, site.pos)).toBeGreaterThan(site.radius + REGION.sites.pad.length);
  });
});

describe('raider grounds', () => {
  const camps = REGION.locations.filter((l) => l.kind === 'camp');
  const scrapjaw = camps.find((c) => c.id === 'scrapjaw')!;
  const kiln = camps.find((c) => c.id === 'kiln')!;
  const lawGates = () => lawmanTowns().flatMap((town) => siteGates(town));

  it('are hunting grounds outside lawman reach, for each camp', () => {
    expect(lawmanTowns().map((t) => t.id).sort()).toEqual(['bowl', 'nose']);
    for (const camp of [scrapjaw, kiln]) {
      expect(raiderGrounds(camp).length).toBeGreaterThanOrEqual(2);
      for (const p of raiderGrounds(camp)) {
        expect(huntingGrounds()).toContainEqual(p);
        for (const gate of lawGates()) expect(dist(gate, p)).toBeGreaterThan(HUNT.lawReach);
      }
    }
  });

  it('lie past the lawmen gate reach of a lawman town, which no raider camp gate has', () => {
    const gate = lawGates()[0];
    const town = lawmanTowns().find((t) => siteGates(t).some((g) => g.x === gate.x && g.y === gate.y))!;
    const out = (d: number) => ({ x: gate.x + ((gate.x - town.pos.x) / town.radius) * d, y: gate.y + ((gate.y - town.pos.y) / town.radius) * d });
    expect(nearLawGate(out(NPC_BEHAVIOR.lawGateReach - 1))).toBe(true);
    expect(nearLawGate(out(NPC_BEHAVIOR.lawGateReach + 1))).toBe(false);
    for (const camp of [scrapjaw, kiln]) for (const g of siteGates(camp)) expect(nearLawGate(g)).toBe(false);
  });

  it('belong to the nearest camp alone', () => {
    for (const [camp, other] of [[scrapjaw, kiln], [kiln, scrapjaw]]) {
      for (const p of raiderGrounds(camp)) {
        expect(dist(p, camp.pos)).toBeLessThanOrEqual(dist(p, other.pos));
        expect(raiderGrounds(other)).not.toContainEqual(p);
      }
    }
  });
});

describe('a driver that gave its word', () => {
  function meeting() {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = w.vehicles[0];
    const npc = addNpc(w, 'traders', 'trader', ['trader', 'scumbag'], { x: 40, y: 30 });
    const passer = addVehicle(w, 'traders', 'scout', [], { x: 44, y: 34 });
    if (addGoods(w, passer, 'scrap', 2) < 2) throw new Error('No room for the passer goods');
    addState(w, 'trade', npc.id, me.id, { kind: 'none' });
    npc.brain!.goals = [{ kind: 'meet', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'pull over to trade' }];
    return { w, me, npc, passer };
  }

  it('starts nothing of its own until the deal ends, then decides', () => {
    const { w, me, npc, passer } = meeting();
    forceOption('preySeen', 'rob');
    thinkNpc(w, npc);
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['meet']);
    expect(npc.brain!.noticed).not.toHaveProperty([`preySeen:${passer.id}`]);
    endState(w, stateOf(w, 'trade', npc.id, me.id)!, 'fulfilled');
    thinkNpc(w, npc);
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: passer.id });
  });

  it('still reacts to a hostile in sight', () => {
    const { w, npc } = meeting();
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 46, y: 30 });
    forceOption('hostileSeen', 'fight');
    thinkNpc(w, npc);
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: raider.id });
  });
});

describe('warn-off decisions', () => {
  function warnChances(traits: TraitId[], parts = ['mg', 'stockEngine']): Record<string, number> {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addNpc(w, 'scavengers', 'scavenger', traits, { x: 36, y: 30 }, parts);
    return optionChances(optionWeights(w, npc, 'warnedOff', w.player.vehicleId, judgeDanger(w, npc, playerVehicle(w)))) as Record<string, number>;
  }

  const plain = () => warnChances(['scavenger']);

  it('a raider or lawman fights back more and backs off less than a plain driver', () => {
    for (const traits of [['raider'], ['lawman']] as TraitId[][]) {
      expect(warnChances(traits).fightBack).toBeGreaterThan(plain().fightBack);
      expect(warnChances(traits).comply).toBeLessThan(plain().comply);
    }
  });

  it('a coward or trader backs off more and a trader fights back less than a plain driver', () => {
    for (const traits of [['coward'], ['trader']] as TraitId[][]) expect(warnChances(traits).comply).toBeGreaterThan(plain().comply);
    expect(warnChances(['trader']).fightBack).toBeLessThan(plain().fightBack);
  });

  it('a driver with revenge on the player fights back more', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const npc = addNpc(w, 'scavengers', 'scavenger', ['scavenger'], { x: 36, y: 30 });
    const danger = judgeDanger(w, npc, playerVehicle(w));
    const calm = optionWeights(w, npc, 'warnedOff', w.player.vehicleId, danger).fightBack!;
    addState(w, 'revenge', npc.id, w.player.vehicleId, { kind: 'none' });
    expect(optionWeights(w, npc, 'warnedOff', w.player.vehicleId, danger).fightBack).toBeGreaterThan(calm);
  });

  it('keeps every option at MIN_CHANCE or more for every trait', () => {
    for (const trait of Object.keys(TRAITS) as TraitId[]) {
      const chances = warnChances([trait]);
      expect(Object.keys(chances).sort(), trait).toEqual(['comply', 'fightBack', 'refuse']);
      for (const chance of Object.values(chances)) expect(chance, trait).toBeGreaterThanOrEqual(MIN_CHANCE);
    }
  });

  it('never fights back without a working gun, and can always back off or refuse', () => {
    expect(Object.keys(warnChances(['raider'], ['stockEngine'])).sort()).toEqual(['comply', 'refuse']);
  });
});

describe('holdsUp', () => {
  const setup = (robbery: boolean) => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = find(w, w.player.vehicleId);
    const robber = addNpc(w, 'scavengers', 'scavenger', ['scavenger', 'scumbag'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    addState(w, 'feud', robber.id, me.id, { kind: 'feud', robbery });
    addGoods(w, me, 'scrap', 2);
    return { w, me, robber, up: () => holdsUp(w, robber, me, judgeDanger(w, robber, me)) };
  };

  it('a confident robber holds up prey with cargo', () => {
    expect(setup(true).up()).toBe(true);
  });

  it('a raider holds up a non-raider with cargo', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = find(w, w.player.vehicleId);
    const raider = addNpc(w, 'raiders', 'raider', ['raider'], { x: 14, y: 10 }, ['autocannon', 'stockEngine']);
    addGoods(w, me, 'scrap', 2);
    expect(holdsUp(w, raider, me, judgeDanger(w, raider, me))).toBe(true);
  });

  it('a weak robber, a defensive feud and prey without cargo are no hold-up', () => {
    const weak = setup(true);
    corePart(weak.robber, 'cab').hp = 1;
    expect(weak.up()).toBe(false);
    expect(setup(false).up()).toBe(false);
    const bare = setup(true);
    bare.me.items = bare.me.items.filter((i) => i.kind !== 'good');
    expect(bare.up()).toBe(false);
  });

  it('a robber that follows a leader holds up nobody', () => {
    const { robber, up } = setup(true);
    robber.brain!.goals.push({ kind: 'follow', leader: 'x' } as never);
    expect(up()).toBe(false);
  });
});
