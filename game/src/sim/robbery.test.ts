import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import type { TraitId } from '../data/npcs';
import { addGoods } from './inventory';
import { getResources } from './resources';
import { isStranded } from './stats';
import { thinkNpc } from './npc-activities';
import { chooseOn } from './tracks';
import { canRob, decide, wantsLoot, lootAppeal, npcProfile, optionWeights, judgeDanger } from './npc-decisions';
import { NPC_BEHAVIOR, TRAITS } from '../data/npcs';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { isHostile, resolveDestroyed } from './combat';
import { cargoValue, goodValue } from './market';
import { checkKnockout, knockOutNpc } from './defeat';
import { playerVehicle } from './damage';
import { corePart, hasLoot, mountedParts } from './grid';
import { addState, advanceStates, endState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateForForcedRolls, rngStateWhere, startCombat } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import type { Vec } from './vec';
import { cloneWorld } from './world';
import { REGION } from '../data/region';
import { siteGates } from './sites';
import { startEscort } from './tow';
import { hasCargo } from './salvage';

const BOWL = REGION.towns[0];
const GATE = siteGates(BOWL)[0];
function outFromGate(d: number): Vec {
  const k = d / BOWL.radius;
  return { x: GATE.x + (GATE.x - BOWL.pos.x) * k, y: GATE.y + (GATE.y - BOWL.pos.y) * k };
}
const GUARDED = NPC_BEHAVIOR.lawGateReach / 2;
const UNGUARDED = NPC_BEHAVIOR.lawGateReach + 4;

function addScumbag(w: World, pos: Vec, parts = ['mg', 'stockEngine'], traits: TraitId[] = ['scavenger', 'scumbag']): Vehicle {
  const v = addVehicle(w, 'scavengers', 'wagon', parts, pos);
  v.brain = npcBrain('scavenger', pos, traits);
  return v;
}

const lowest = (w: World, observer: Vehicle, v: Vehicle) => judgeDanger(w, observer, v) * (1 - NPC_BEHAVIOR.dangerSpread);

function addPrey(w: World, pos: Vec, parts: string[] = ['stockEngine'], goods = 2): Vehicle {
  const v = addVehicle(w, 'traders', 'scout', parts, pos);
  v.brain = npcBrain('trader', pos, ['trader']);
  if (goods > 0 && addGoods(w, v, 'scrap', goods) < goods) throw new Error('No room for prey goods');
  if (goods > 0 && addGoods(w, v, 'electronics', 4) < 4) throw new Error('No room for prey cargo');
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function robsTarget(robber: Vehicle, target: string): boolean {
  return robber.brain!.goals.some((g) => isRob(g, target));
}

function isRob(goal: NpcActivity | undefined, target: string): boolean {
  return goal?.kind === 'fight' && goal.targetId === target && goal.reason === 'rob cargo';
}

type Setup = () => { w: World; robber: Vehicle; target: Vehicle };

function escorted() {
  const w = emptyWorld({ x: 200, y: 200 });
  const leader = addScumbag(w, { x: 10, y: 10 });
  const merc = addScumbag(w, { x: 10, y: 12 }, ['mg', 'stockEngine'], ['merc', 'scumbag']);
  startEscort(w, merc, leader, null, 0);
  return { w, leader, merc, target: addPrey(w, { x: 15, y: 10 }) };
}

function forbidden(templateId: string, trait: TraitId): Setup {
  return () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    robber.brain = npcBrain(templateId, robber.pos, [trait, 'scumbag']);
    return { w, robber, target: addPrey(w, { x: 15, y: 10 }) };
  };
}

const UNAVAILABLE: Record<string, Setup> = {
  supplier: forbidden('convoy', 'supplier'),
  guard: forbidden('convoyGuard', 'guard'),
  lawman: forbidden('bowlFarmer', 'lawman'),
  following: () => {
    const { w, merc, target } = escorted();
    return { w, robber: merc, target };
  },
  unseen: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 60, y: 10 }) };
  },
  hostile: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    addState(w, 'feud', target.id, robber.id, { kind: 'feud', robbery: false });
    return { w, robber, target };
  },
  unarmed: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    robber.items = robber.items.filter((it) => it.kind !== 'part' || it.part.defId !== 'mg');
    return { w, robber, target: addPrey(w, { x: 15, y: 10 }) };
  },
  noLoot: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }, [], 0) };
  },
  knockedOut: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const target = addPrey(w, { x: 15, y: 10 });
    target.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target };
  },
  towed: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    const tower = addVehicle(w, 'traders', 'scout', [], { x: 17, y: 10 });
    addState(w, 'tow', tower.id, target.id, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: true });
    return { w, robber, target };
  },
  combatElsewhere: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 60, y: 10 }), target);
    return { w, robber, target };
  },
};

const JUDGED: Record<string, Setup> = {
  strong: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const target = addVehicle(w, 'traders', 'carrier', ['tankGun', 'plates'], { x: 15, y: 10 });
    return { w, robber: addScumbag(w, { x: 10, y: 10 }), target };
  },
  robberAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, outFromGate(GUARDED)), target: addPrey(w, outFromGate(UNGUARDED)) };
  },
  targetAtGate: () => {
    const w = emptyWorld({ x: 200, y: 200 });
    return { w, robber: addScumbag(w, outFromGate(UNGUARDED)), target: addPrey(w, outFromGate(GUARDED)) };
  },
};

function passing() {
  const w = emptyWorld({ x: 200, y: 200 });
  return { w, robber: addScumbag(w, { x: 10, y: 10 }), target: addPrey(w, { x: 15, y: 10 }) };
}

const FULL_ROB = TRAITS.scumbag.weights.preySeen!.rob!.add!;

const robWeight = (w: World, robber: Vehicle, target: Vehicle, danger: number) => optionWeights(w, robber, 'preySeen', target.id, danger).rob;

describe('robbery checks', () => {
  it('a weaker truck with loot in sight away from towns gets the full rob weight', () => {
    const { w, robber, target } = passing();
    expect(robWeight(w, robber, target, judgeDanger(w, robber, target))).toBe(FULL_ROB);
    const far = emptyWorld({ x: 200, y: 200 });
    expect(robWeight(far, addScumbag(far, outFromGate(UNGUARDED)), addPrey(far, outFromGate(UNGUARDED + 5)), 0)).toBe(FULL_ROB);
  });

  it('the leader of an escort still gets the full rob weight', () => {
    const { w, leader, target } = escorted();
    expect(robWeight(w, leader, target, judgeDanger(w, leader, target))).toBe(FULL_ROB);
  });

  for (const [name, make] of Object.entries(UNAVAILABLE)) {
    it(`makes rob unavailable when only ${name} fails`, () => {
      const { w, robber, target } = make();
      expect(optionWeights(w, robber, 'preySeen', target.id, lowest(w, robber, target))).not.toHaveProperty('rob');
    });
  }

  for (const [name, make] of Object.entries(JUDGED)) {
    it(`lowers the rob weight when only ${name} fails`, () => {
      const { w, robber, target } = make();
      const weight = robWeight(w, robber, target, lowest(w, robber, target))!;
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(FULL_ROB * 0.1);
    });
  }

  it('a player truck with loot gets the full rob weight only when its guns are weaker', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    addGoods(w, me, 'electronics', 4);
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    expect(robWeight(w, robber, me, judgeDanger(w, robber, me))).toBe(FULL_ROB);
    const bare = addScumbag(w, { x: 15, y: 25 }, ['stockEngine']);
    expect(optionWeights(w, bare, 'preySeen', me.id, lowest(w, bare, me))).not.toHaveProperty('rob');
  });
});

describe('danger', () => {
  const judge = () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const driver = addVehicle(w, 'traders', 'scout', ['mg', 'stockEngine'], { x: 10, y: 40 });
    return { w, driver };
  };

  it('a tank is a bigger threat than a scout', () => {
    const { w, driver } = judge();
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates', 'stockEngine'], { x: 10, y: 10 });
    const scout = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 60, y: 10 });
    expect(judgeDanger(w, driver, tank)).toBeGreaterThan(judgeDanger(w, driver, scout) * 3);
  });

  it('a tank worn to half HP is less of a threat', () => {
    const { w, driver } = judge();
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates', 'stockEngine'], { x: 10, y: 10 });
    const full = judgeDanger(w, driver, tank);
    for (const part of mountedParts(tank)) part.hp = Math.ceil(part.hp / 2);
    expect(judgeDanger(w, driver, tank)).toBeLessThan(full * 0.6);
  });

  it('a truck with no working gun is no threat', () => {
    const { w, driver } = judge();
    const scout = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
    mountedParts(scout, 'weapon')[0].hp = 0;
    expect(judgeDanger(w, driver, scout)).toBe(0);
  });
});

describe('scumbag robbery', () => {
  it('a scumbag robs an equal truck on some seeds, and rarely a clearly stronger one', () => {
    const count = (make: (w: World) => Vehicle) => {
      const w = emptyWorld({ x: 200, y: 200 });
      const robber = addScumbag(w, { x: 10, y: 10 });
      const target = make(w);
      let robs = 0;
      for (let seed = 0; seed < 200; seed++) {
        const x = cloneWorld(w);
        x.rngState = seed;
        const r = find(x, robber.id);
        thinkNpc(x, r);
        if (robsTarget(r, target.id)) robs++;
      }
      return robs;
    };
    const equal = count((w) => addPrey(w, { x: 15, y: 10 }, ['mg', 'stockEngine']));
    const strong = count((w) => addVehicle(w, 'traders', 'carrier', ['tankGun', 'plates'], { x: 15, y: 10 }));
    expect(equal).toBeGreaterThan(0);
    expect(strong).toBeLessThan(20);
    expect(strong).toBeLessThan(equal);
  });

  it('a scumbag robs a weak loaded truck on some seeds, never when rob is unavailable, and rarely when a judgment fails', () => {
    const { w, robber, target } = passing();
    let robs = 0;
    const seeds = 60;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const r = find(x, robber.id);
      thinkNpc(x, r);
      if (!robsTarget(r, target.id)) continue;
      robs++;
      const paid = r.brain!.goals.some((g) => g.kind === 'loot' && g.reason === 'take the handed-over cargo');
      expect(paid || stateOf(x, 'feud', robber.id, target.id) !== null).toBe(true);
      expect(x.events).toContainEqual({ t: 'hostile', vehicle: robber.id, against: target.id });
    }
    expect(robs).toBeGreaterThan(0);
    expect(robs).toBeLessThan(seeds);
    for (const make of Object.values(UNAVAILABLE)) {
      const bad = make();
      for (let seed = 0; seed < 20; seed++) {
        const x = cloneWorld(bad.w);
        x.rngState = seed;
        const r = find(x, bad.robber.id);
        thinkNpc(x, r);
        expect(robsTarget(r, bad.target.id)).toBe(false);
      }
    }
    for (const make of Object.values(JUDGED)) {
      const judged = make();
      let rare = 0;
      for (let seed = 0; seed < 100; seed++) {
        const x = cloneWorld(judged.w);
        x.rngState = seed;
        const r = find(x, judged.robber.id);
        thinkNpc(x, r);
        if (robsTarget(r, judged.target.id)) rare++;
      }
      expect(rare).toBeLessThan(10);
    }
  });

  it('a scavenger without scumbag robs a weak loaded truck at about 1%', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    const target = addPrey(w, { x: 15, y: 10 });
    expect(robWeight(w, robber, target, judgeDanger(w, robber, target))).toBe(0);
    const seeds = 2000;
    let robs = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const r = find(x, robber.id);
      thinkNpc(x, r);
      if (robsTarget(r, target.id)) robs++;
    }
    expect(robs / seeds).toBeGreaterThan(0.003);
    expect(robs / seeds).toBeLessThan(0.02);
  }, 90_000);

  it('a scumbag scavenger with no prey still scavenges', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    let scavenges = 0;
    for (let seed = 0; seed < 50; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      if (thinkNpc(x, find(x, robber.id)).kind === 'scavenge') scavenges++;
    }
    expect(scavenges).toBeGreaterThanOrEqual(45);
  });

  it('a robbery keeps the scavenge goal below it', () => {
    const { w, robber, target } = passing();
    const scavenge: NpcActivity = { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' };
    robber.brain!.goals = [scavenge];
    forceOption('preySeen', 'rob');
    forceOption('mugging', 'attack');
    w.rngState = rngStateForForcedRolls(8);
    thinkNpc(w, robber);
    expect(robber.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'fight']);
    expect(isRob(robber.brain!.goals[1], target.id)).toBe(true);
    w.vehicles = w.vehicles.filter((v) => v.id !== target.id);
    forceOption('resume', 'resume');
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
  });

  it('a robber keeps its rob goal while its victim stays in sight, with no hostileSeen roll on the victim', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    forceOption('preySeen', 'rob');
    forceOption('hostileSeen', 'flee');
    thinkNpc(w, robber);
    for (let turn = 0; turn < 5; turn++) {
      w.turn++;
      w.events = [];
      thinkNpc(w, robber);
      expect(robsTarget(robber, target.id)).toBe(true);
      expect(w.events.filter((e) => e.t === 'activity')).toEqual([]);
    }
  });

  it('a driver on a tow job robs no one it passes', () => {
    const { w, robber, target } = passing();
    addState(w, 'tow', robber.id, w.player.vehicleId, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: false });
    robber.brain!.goals = [{ kind: 'tow', targetId: w.player.vehicleId, destination: null, phase: 'act', reason: 'wait for an answer to a tow offer' }];
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(robber.brain!.goals.some((g) => isRob(g, target.id))).toBe(false);
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
  });

  it('a driver in a trade meeting does not rob its partner', () => {
    const { w, robber, target } = passing();
    addState(w, 'trade', robber.id, target.id, { kind: 'none' });
    robber.brain!.goals = [{ kind: 'meet', targetId: target.id, destination: { ...target.pos }, phase: 'travel', reason: 'pull over to trade' }];
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(robber.brain!.goals.some((g) => isRob(g, target.id))).toBe(false);
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
  });

  it('a truck escorting another does not rob it, and the leader does not rob its escort', () => {
    const { w, robber, target } = passing();
    addState(w, 'escort', robber.id, target.id, { kind: 'escort', site: null, fee: 0 });
    target.brain = npcBrain('scavenger', target.pos, ['scavenger', 'scumbag']);
    expect(canRob(w, robber, target)).toBe(false);
    expect(canRob(w, target, robber)).toBe(false);
  });

  it('a trade kept to its end leaves both sides backed off from each other', () => {
    const { w, robber, target } = passing();
    target.brain = npcBrain('scavenger', target.pos, ['scavenger']);
    endState(w, addState(w, 'trade', robber.id, target.id, { kind: 'none' }), 'fulfilled');
    expect(stateOf(w, 'backedOff', robber.id, target.id)).not.toBeNull();
    expect(stateOf(w, 'backedOff', target.id, robber.id)).not.toBeNull();
  });

  it('a broken trade leaves no one backed off', () => {
    const { w, robber, target } = passing();
    endState(w, addState(w, 'trade', robber.id, target.id, { kind: 'none' }), 'broken');
    expect(stateOf(w, 'backedOff', robber.id, target.id)).toBeNull();
  });

  it('a robber stops its search to rob', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'act', reason: 'search a known salvage site' }];
    robber.job = { kind: 'search', stockId: 'salvage-yard', turnsLeft: 3, total: 3 };
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(robsTarget(robber, target.id)).toBe(true);
    expect(robber.job).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', vehicle: robber.id, outcome: 'cancelled' }));
  });

  it('a failed robbery lowers the rob weight against the same target', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 80, y: 10 });
    const other = addPrey(w, { x: 10, y: 15 });
    addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
    for (let i = 0; i < STATE_TURNS.feud!; i++) {
      w.turn++;
      w.events = [];
      advanceStates(w);
    }
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'expired' }));
    const backedOff = stateOf(w, 'backedOff', robber.id, target.id);
    expect(backedOff).not.toBeNull();
    w.turn++;
    advanceStates(w);
    expect(stateOf(w, 'backedOff', robber.id, target.id)?.turnsLeft).toBe(STATE_TURNS.backedOff! - 1);
    target.pos = { x: 15, y: 10 };
    const again = robWeight(w, robber, target, judgeDanger(w, robber, target))!;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(robWeight(w, robber, other, judgeDanger(w, robber, other))! * 0.05);
  });
});

describe('hold-ups of NPC prey', () => {
  const holdUp = (answer: 'comply' | 'fightBack' | 'flee') => {
    forceOption('preySeen', 'rob');
    forceOption('mugging', 'demand');
    forceOption('threatened', answer);
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 }, ['heavyMg', 'mg', 'stockEngine']);
    const target = addPrey(w, { x: 15, y: 10 }, ['mg', 'stockEngine']);
    thinkNpc(w, robber);
    return { w, robber, target };
  };

  it('prey that pays drops its cargo for the robber and makes peace', () => {
    const { w, robber, target } = holdUp('comply');
    expect(hasCargo(target)).toBe(false);
    expect(isHostile(w, robber, target)).toBe(false);
    expect(robber.brain!.goals.at(-1)).toMatchObject({ kind: 'loot', reason: 'take the handed-over cargo' });
  });

  it('prey that refuses fights the robber, and the robber asks only once', () => {
    const { robber, target } = holdUp('fightBack');
    expect(target.brain!.goals.at(-1)).toMatchObject({ kind: 'fight', targetId: robber.id });
    expect(robber.brain!.goals.at(-1)).toMatchObject({ kind: 'fight', demands: false });
    expect(hasCargo(target)).toBe(true);
  });

  it('prey that refuses can run instead', () => {
    const { robber, target } = holdUp('flee');
    expect(target.brain!.goals.at(-1)).toMatchObject({ kind: 'flee', targetId: robber.id });
    expect(hasCargo(target)).toBe(true);
  });
});

describe('prey rolls', () => {
  it('a scavenger without scumbag rolls once on a weak loaded truck', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const scav = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    scav.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    const target = addPrey(w, { x: 15, y: 10 });
    const rng = w.rngState;
    thinkNpc(w, scav);
    expect(w.rngState).not.toBe(rng);
    expect(scav.brain!.noticed).toHaveProperty([`preySeen:${target.id}`]);
  });
});

describe('looting', () => {
  const SCAVENGE: NpcActivity = { kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' };

  function killTurn(w: World): void {
    w.turn++;
    w.events = [];
    resolveDestroyed(w);
    advanceStates(w);
  }

  it('a scumbag that knocks out an NPC loots its truck, with its scavenge goal still below', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ ...SCAVENGE }];
    forceOption('preySeen', 'rob');
    forceOption('surrenderOffered', 'refuse');
    thinkNpc(w, robber);
    expect(stateOf(w, 'feud', robber.id, target.id)?.data).toEqual({ kind: 'feud', robbery: true });
    corePart(target, 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => roll >= RULES.npcDeathChance);
    killTurn(w);
    expect(target.defeat?.phase).toBe('out');
    expect(robber.brain!.goals.at(-1)).toMatchObject({ kind: 'loot', targetId: target.id });
    expect(robber.brain!.goals[0]).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'loot', targetId: target.id });
    target.defeat = { ...target.defeat!, phase: 'retreat' };
    forceOption('resume', 'resume');
    forceOption('strandedSeen', 'keep');
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
  });

  it('a scumbag that knocks out the player loots the player truck', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    addGoods(w, me, 'electronics', 4);
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    robber.brain!.goals = [{ ...SCAVENGE }];
    addState(w, 'feud', robber.id, me.id, { kind: 'feud', robbery: true });
    w.turn++;
    corePart(me, 'cab').hp = 0;
    checkKnockout(w);
    expect(w.salvage.some((s) => s.id.startsWith(`wreck-${me.id}`))).toBe(false);
    expect(robber.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'loot']);
    expect(robber.brain!.goals[1].targetId).toBe(me.id);
  });

  it('a provoked feud that is fulfilled pushes no loot goal', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const npc = addScumbag(w, { x: 10, y: 10 });
    npc.brain!.goals = [{ ...SCAVENGE }];
    const foe = addPrey(w, { x: 15, y: 10 });
    foe.brain = npcBrain('trader', foe.pos, ['trader']);
    addState(w, 'feud', npc.id, foe.id, { kind: 'feud', robbery: false });
    corePart(foe, 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => roll >= RULES.npcDeathChance);
    killTurn(w);
    expect(stateOf(w, 'feud', npc.id, foe.id)).toBeNull();
    expect(foe.defeat?.phase).toBe('out');
    expect(npc.brain!.goals.map((g) => g.kind)).toEqual(['scavenge']);
  });
});

describe('social on robbery danger', () => {
  function nearThreshold(robber: Vehicle): number {
    return npcProfile(robber).boldness / (1 + 2.5 * SKILL_EFFECTS.social.robberyDanger);
  }

  it('a scumbag sees a rank 5 player truck as stronger', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    addGoods(w, me, 'electronics', 4);
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    const danger = nearThreshold(robber);
    expect(robWeight(w, robber, me, danger)).toBe(FULL_ROB);
    w.player.ranks.social = 5;
    expect(robWeight(w, robber, me, danger)).toBeLessThanOrEqual(FULL_ROB * 0.1);
  });

  it('leaves robbery of an NPC truck unchanged', () => {
    const { w, robber, target } = passing();
    const danger = nearThreshold(robber);
    w.player.ranks.social = 5;
    expect(robWeight(w, robber, target, danger)).toBe(FULL_ROB);
  });
});


describe('cargo value', () => {
  const chance = (w: World, robber: Vehicle, decision: 'preySeen' | 'hostileSeen', target: Vehicle, option: string): number => {
    const danger = judgeDanger(w, robber, target);
    const draws = 1500;
    let picked = 0;
    for (let seed = 0; seed < draws; seed++) {
      w.rngState = seed;
      if (decide(w, robber, decision, target.id, danger) === option) picked++;
    }
    return picked / draws;
  };

  it('counts goods and spare parts but not mounted parts', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const bare = addPrey(w, { x: 15, y: 10 }, ['stockEngine'], 0);
    expect(cargoValue(bare)).toBe(0);
    addGoods(w, bare, 'scrap', 2);
    expect(cargoValue(bare)).toBe(2 * goodValue('scrap'));
  });

  it('appeal is poorMul at poor, 1 at rich and rising between', () => {
    const curve = NPC_BEHAVIOR.lootAppeal.rob;
    expect(lootAppeal(curve.poor, curve)).toBe(curve.poorMul);
    expect(lootAppeal(0, curve)).toBe(curve.poorMul);
    expect(lootAppeal(curve.rich, curve)).toBe(1);
    expect(lootAppeal(curve.rich * 3, curve)).toBe(1);
    let last = curve.poorMul;
    for (let v = curve.poor + 10; v < curve.rich; v += 10) {
      expect(lootAppeal(v, curve)).toBeGreaterThan(last);
      last = lootAppeal(v, curve);
    }
  });

  it('a scumbag robs start cargo at the floor and a rich load at the full weight', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const poor = addPrey(w, { x: 15, y: 10 }, [], 0);
    addGoods(w, poor, 'scrap', 2);
    addGoods(w, poor, 'parts', 2);
    expect(chance(w, robber, 'preySeen', poor, 'rob')).toBeLessThan(0.025);
    const rich = addPrey(w, { x: 15, y: 12 });
    expect(robWeight(w, robber, rich, judgeDanger(w, robber, rich))).toBe(FULL_ROB);
    addState(w, 'revenge', robber.id, poor.id, { kind: 'none' });
    expect(robWeight(w, robber, poor, judgeDanger(w, robber, poor))).toBeGreaterThanOrEqual(FULL_ROB);
  });

  describe('raiders', () => {
    const fightChance = (goods: [string, number][], setup?: (w: World, raider: Vehicle, target: Vehicle) => void): number => {
      const w = emptyWorld({ x: 200, y: 200 });
      const raider = addVehicle(w, 'raiders', 'wagon', ['mg', 'stockEngine'], { x: 10, y: 10 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      const target = addPrey(w, { x: 15, y: 10 }, [], 0);
      for (const [good, n] of goods) addGoods(w, target, good, n);
      setup?.(w, raider, target);
      return chance(w, raider, 'hostileSeen', target, 'fight');
    };

    it('fights an empty truck rarely, start cargo sometimes and a rich load nearly always', () => {
      expect(fightChance([])).toBeLessThan(0.08);
      const start = fightChance([['scrap', 2], ['parts', 2]]);
      expect(start).toBeGreaterThan(0.06);
      expect(start).toBeLessThan(0.22);
      expect(fightChance([['electronics', 4]])).toBeGreaterThan(0.9);
    });

    it('a feud or revenge ignores cargo', () => {
      expect(fightChance([], (w, r, t) => addState(w, 'feud', r.id, t.id, { kind: 'feud', robbery: false }))).toBeGreaterThan(0.9);
      expect(fightChance([], (w, r, t) => addState(w, 'revenge', r.id, t.id, { kind: 'none' }))).toBeGreaterThan(0.9);
    });
  });

  it('leaves hasLoot, canRob and isHostile as they were for an engine-only truck', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const raider = addVehicle(w, 'raiders', 'wagon', ['mg', 'stockEngine'], { x: 12, y: 10 });
    const bare = addPrey(w, { x: 15, y: 10 }, ['stockEngine'], 0);
    expect(hasLoot(bare)).toBe(true);
    expect(isHostile(w, raider, bare)).toBe(true);
    expect(canRob(w, robber, bare)).toBe(true);
  });
});

describe('stranded robbers', () => {
  const strand = (w: World, v: Vehicle) => { getResources(w, v).fuel = 0; };
  const addRaider = (w: World, pos: Vec) => {
    const raider = addVehicle(w, 'raiders', 'wagon', ['mg', 'stockEngine'], pos);
    raider.brain = npcBrain('buggy', pos, ['raider']);
    return raider;
  };
  const thinkMany = (w: World, id: string, target: string, turns = 40) => {
    for (let seed = 0; seed < turns; seed++) {
      w.rngState = seed;
      const r = find(w, id);
      thinkNpc(w, r);
      expect(r.brain!.goals.some((g) => g.targetId === target && (g.kind === 'fight' || g.kind === 'investigate'))).toBe(false);
    }
  };

  it('a stranded scumbag gets no rob option and starts no robbery', () => {
    const { w, robber, target } = passing();
    strand(w, robber);
    expect(robWeight(w, robber, target, judgeDanger(w, robber, target))).toBeUndefined();
    thinkMany(w, robber.id, target.id);
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
  });

  it('a stranded raider gets no fight or investigate against loot, whether out of fuel or engine', () => {
    for (const strandIt of [strand, (w: World, v: Vehicle) => { for (const part of mountedParts(v, 'engine')) part.hp = 0; }]) {
      const w = emptyWorld({ x: 200, y: 200 });
      const raider = addRaider(w, { x: 10, y: 10 });
      const target = addPrey(w, { x: 15, y: 10 });
      const before = optionWeights(w, raider, 'hostileSeen', target.id, judgeDanger(w, raider, target));
      expect(before.fight).toBeGreaterThan(0);
      strandIt(w, raider);
      if (!isStranded(w, raider)) continue;
      expect(optionWeights(w, raider, 'hostileSeen', target.id, judgeDanger(w, raider, target)).fight).toBeUndefined();
      expect(optionWeights(w, raider, 'contactHeard', target.id, judgeDanger(w, raider, target)).investigate).toBeUndefined();
      thinkMany(w, raider.id, target.id);
    }
  });

  it('a stranded raider that investigates prey it sees gives the robbery up and starts no fight', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const raider = addRaider(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    raider.brain!.goals = [{ kind: 'investigate', targetId: target.id, destination: { x: 15, y: 10 }, phase: 'travel', reason: 'heard a hostile beyond sight' }];
    strand(w, raider);
    thinkNpc(w, raider);
    expect(raider.brain!.goals.some((g) => g.kind === 'investigate' || (g.kind === 'fight' && g.targetId === target.id))).toBe(false);
    expect(w.events.some((e) => JSON.stringify(e).includes('stranded, gave up the robbery'))).toBe(true);
    expect(w.events.some((e) => JSON.stringify(e).includes('spotted the truck it heard'))).toBe(false);
  });

  it('a scumbag stranded mid-robbery gives it up and backs off, unless the prey fights it', () => {
    for (const fights of [false, true]) {
      const { w, robber, target } = passing();
      addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
      robber.brain!.goals.push({ kind: 'fight', targetId: target.id, destination: { ...target.pos }, reason: 'rob cargo', worn: { turn: w.turn, condition: 1 } } as NpcActivity);
      chooseOn(w, robber, target.id, target.pos, 'fight', true);
      strand(w, robber);
      if (fights) startCombat(w, target, robber);
      thinkNpc(w, robber);
      const held = robber.brain!.goals.some((g) => g.kind === 'fight' && g.targetId === target.id);
      expect(held).toBe(fights);
      expect(stateOf(w, 'feud', robber.id, target.id) !== null).toBe(fights);
      expect(stateOf(w, 'backedOff', robber.id, target.id) !== null).toBe(!fights);
    }
  });

  it('a stranded raider drops its fight on a looted trader unless it is attacked, and still fights back', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const raider = addRaider(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 15, y: 10 });
    raider.brain!.goals.push({ kind: 'fight', targetId: target.id, destination: { ...target.pos }, reason: 'raid', worn: { turn: w.turn, condition: 1 } } as NpcActivity);
    chooseOn(w, raider, target.id, target.pos, 'fight', true);
    strand(w, raider);
    thinkNpc(w, raider);
    expect(raider.brain!.goals.some((g) => g.kind === 'fight' && g.targetId === target.id)).toBe(false);
    expect(optionWeights(w, raider, 'attacked', target.id, judgeDanger(w, raider, target)).fightBack).toBeGreaterThan(0);
  });

  it('a stranded robber wants no loot', () => {
    const { w, robber, target } = passing();
    addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
    expect(wantsLoot(w, robber, target)).toBe(true);
    strand(w, robber);
    expect(wantsLoot(w, robber, target)).toBe(false);
  });

  it('mobile robbers still rob', () => {
    const { w, robber, target } = passing();
    expect(robWeight(w, robber, target, judgeDanger(w, robber, target))).toBeGreaterThan(0);
    const w2 = emptyWorld({ x: 200, y: 200 });
    const raider = addRaider(w2, { x: 10, y: 10 });
    const loaded = addPrey(w2, { x: 15, y: 10 });
    expect(optionWeights(w2, raider, 'hostileSeen', loaded.id, judgeDanger(w2, raider, loaded)).fight).toBeGreaterThan(0);
  });
});

describe('a guarded driver', () => {
  function guardedConvoy() {
    const w = emptyWorld({ x: 200, y: 200 });
    const convoy = addVehicle(w, 'convoys', 'hauler', ['mg', 'workhorseDiesel'], { x: 10, y: 10 });
    convoy.brain = npcBrain('convoy', convoy.pos, ['supplier']);
    addGoods(w, convoy, 'electronics', 4);
    const guard = addVehicle(w, 'convoys', 'scout', ['mg', 'stockEngine'], { x: 10, y: 13 });
    guard.brain = npcBrain('convoyGuard', guard.pos, ['guard', 'brave']);
    startEscort(w, guard, convoy, null, 0);
    const raider = addScumbag(w, { x: 16, y: 10 }, ['mg', 'stockEngine'], ['raider']);
    return { w, convoy, guard, raider };
  }
  const comply = (w: World, v: Vehicle, by: Vehicle, decision: 'threatened' | 'warnedOff' = 'threatened') =>
    optionWeights(w, v, decision, by.id, lowest(w, v, by)).comply!;

  it('hands over its cargo a tenth as often while its escort is in sight', () => {
    const { w, convoy, guard, raider } = guardedConvoy();
    const guarded = comply(w, convoy, raider);
    const warned = comply(w, convoy, raider, 'warnedOff');
    endState(w, stateOf(w, 'escort', guard.id, convoy.id)!, 'broken');
    expect(guarded).toBeCloseTo(comply(w, convoy, raider) * NPC_BEHAVIOR.guardedComply);
    expect(warned).toBeCloseTo(comply(w, convoy, raider, 'warnedOff') * NPC_BEHAVIOR.guardedComply);
  });

  it('does not count an escort out of sight or knocked out', () => {
    const unguarded = (w: World, convoy: Vehicle, guard: Vehicle) => {
      const x = cloneWorld(w);
      endState(x, stateOf(x, 'escort', guard.id, convoy.id)!, 'broken');
      return x;
    };
    const far = guardedConvoy();
    far.guard.pos = { x: 150, y: 150 };
    expect(comply(far.w, far.convoy, far.raider)).toBeCloseTo(comply(unguarded(far.w, far.convoy, far.guard), far.convoy, far.raider));
    const down = guardedConvoy();
    knockOutNpc(down.w, down.guard);
    expect(comply(down.w, down.convoy, down.raider)).toBeCloseTo(comply(unguarded(down.w, down.convoy, down.guard), down.convoy, down.raider));
  });

  it('complies with at most a quarter of its threatened weight when the player threatens it with its guard in sight', () => {
    const { w, convoy } = guardedConvoy();
    const me = playerVehicle(w);
    me.pos = { x: 16, y: 10 };
    const weights = optionWeights(w, convoy, 'threatened', me.id, lowest(w, convoy, me));
    const total = Object.values(weights).reduce((sum, n) => sum + (n ?? 0), 0);
    expect(weights.comply! / total).toBeLessThanOrEqual(0.25);
  });

  it('weighs a player threat the same as an NPC threat', () => {
    const { w, convoy, guard } = guardedConvoy();
    const me = playerVehicle(w);
    me.pos = { x: 16, y: 10 };
    const guarded = comply(w, convoy, me);
    endState(w, stateOf(w, 'escort', guard.id, convoy.id)!, 'broken');
    expect(guarded).toBeCloseTo(comply(w, convoy, me) * NPC_BEHAVIOR.guardedComply);
  });
});
