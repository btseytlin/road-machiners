import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import type { TraitId } from '../data/npcs';
import { addGoods } from './inventory';
import { getResources } from './resources';
import { isStranded } from './stats';
import { thinkNpc } from './npc-activities';
import { canRob, decide, wantsLoot, lootAppeal, npcProfile, optionWeights, ownDanger, vehicleDanger } from './npc-decisions';
import { NPC_BEHAVIOR, TRAITS } from '../data/npcs';
import { RULES } from '../data/rules';
import { SKILL_EFFECTS } from '../data/skills';
import { isHostile, resolveDestroyed } from './combat';
import { cargoValue, goodValue } from './market';
import { checkKnockout } from './defeat';
import { corePart, hasLoot, mountedParts } from './grid';
import { addState, advanceStates, endState, stateOf } from './states';
import { addVehicle, emptyWorld, forceOption, npcBrain, rngStateWhere , startCombat } from './testkit';
import type { NpcActivity, Vehicle, World } from './types';
import type { Vec } from './vec';
import { cloneWorld } from './world';
import { REGION } from '../data/region';
import { siteGates } from './sites';
import { startEscort } from './tow';

// A gate of Bowl. The robbery spots below lie outside Bowl's wall, north of the gate: one within guard range and one
// past it.
const BOWL = REGION.towns[0];
const GATE = siteGates(BOWL)[0];
// A point d tiles out from the Bowl gate, away from the town.
function outFromGate(d: number): Vec {
  const k = d / BOWL.radius;
  return { x: GATE.x + (GATE.x - BOWL.pos.x) * k, y: GATE.y + (GATE.y - BOWL.pos.y) * k };
}
const GUARDED = RULES.guards.range / 2;
const UNGUARDED = RULES.guards.range + 4;

function addScumbag(w: World, pos: Vec, parts = ['mg', 'stockEngine'], traits: TraitId[] = ['scavenger', 'scumbag']): Vehicle {
  const v = addVehicle(w, 'scavengers', 'wagon', parts, pos);
  v.brain = npcBrain('scavenger', pos, traits);
  return v;
}

// The lowest danger a sighting can perceive.
const lowest = (w: World, v: Vehicle) => vehicleDanger(w, v) * (1 - NPC_BEHAVIOR.dangerSpread);

// A truck with no gun and goods on its grid.
function addPrey(w: World, pos: Vec, parts: string[] = [], goods = 2): Vehicle {
  const v = addVehicle(w, 'traders', 'scout', parts, pos);
  if (goods > 0 && addGoods(w, v, 'scrap', goods) < goods) throw new Error('No room for prey goods');
  // A load worth at least the rob appeal's rich mark, so the rob weight is unscaled.
  if (goods > 0 && addGoods(w, v, 'electronics', 4) < 4) throw new Error('No room for prey cargo');
  return v;
}

const find = (w: World, id: string) => w.vehicles.find((v) => v.id === id)!;

function isRob(goal: NpcActivity | undefined, target: string): boolean {
  return goal?.kind === 'fight' && goal.targetId === target && goal.reason === 'rob cargo';
}

type Setup = () => { w: World; robber: Vehicle; target: Vehicle };

// A scumbag leader with loot in sight away from towns, and a scumbag merc escorting it.
function escorted() {
  const w = emptyWorld({ x: 200, y: 200 });
  const leader = addScumbag(w, { x: 10, y: 10 });
  const merc = addScumbag(w, { x: 10, y: 12 }, ['mg', 'stockEngine'], ['merc', 'scumbag']);
  startEscort(w, merc, leader, null, 0);
  return { w, leader, merc, target: addPrey(w, { x: 15, y: 10 }) };
}

// A scumbag robber of a template whose trait forbids robbing.
function forbidden(templateId: string, trait: TraitId): Setup {
  return () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    robber.brain = npcBrain(templateId, robber.pos, [trait, 'scumbag']);
    return { w, robber, target: addPrey(w, { x: 15, y: 10 }) };
  };
}

// Worlds where rob is unavailable for one reason, and everything else would allow it.
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
    target.brain = npcBrain('trader', target.pos, ['trader']);
    startCombat(w, addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 60, y: 10 }), target);
    return { w, robber, target };
  },
};

// Worlds where one robbery judgment fails and the others pass.
const JUDGED: Record<string, Setup> = {
  // Heavier guns and far more HP than the robber's scout.
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

// The rob weight a scumbag gives the target when every judgment passes.
const FULL_ROB = TRAITS.scumbag.weights.preySeen!.rob!.add!;

const robWeight = (w: World, robber: Vehicle, target: Vehicle, danger: number) => optionWeights(w, robber, 'preySeen', target.id, danger).rob;

describe('robbery checks', () => {
  it('drops a robbery fight when the prey reaches a guarded town instead of waiting to fire forever', () => {
    const { w, robber, target } = passing();
    addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
    robber.brain!.goals = [{ kind: 'fight', targetId: target.id, destination: { ...target.pos }, phase: 'travel', reason: 'rob cargo', perceived: w.turn }];
    target.pos = outFromGate(GUARDED);
    robber.pos = outFromGate(UNGUARDED);

    expect(optionWeights(w, robber, 'hostileSeen', target.id, 0)).not.toHaveProperty('fight');
    thinkNpc(w, robber);

    expect(robber.brain!.goals.some((goal) => goal.kind === 'fight' && goal.targetId === target.id)).toBe(false);
  });

  it('a weaker truck with loot in sight away from towns gets the full rob weight', () => {
    const { w, robber, target } = passing();
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBe(FULL_ROB);
    // Beside the gate, but both past guard range, passes too.
    const far = emptyWorld({ x: 200, y: 200 });
    expect(robWeight(far, addScumbag(far, outFromGate(UNGUARDED)), addPrey(far, outFromGate(UNGUARDED + 5)), 0)).toBe(FULL_ROB);
  });

  it('the leader of an escort still gets the full rob weight', () => {
    const { w, leader, target } = escorted();
    expect(robWeight(w, leader, target, vehicleDanger(w, target))).toBe(FULL_ROB);
  });

  for (const [name, make] of Object.entries(UNAVAILABLE)) {
    it(`makes rob unavailable when only ${name} fails`, () => {
      const { w, robber, target } = make();
      expect(optionWeights(w, robber, 'preySeen', target.id, lowest(w, target))).not.toHaveProperty('rob');
    });
  }

  for (const [name, make] of Object.entries(JUDGED)) {
    it(`lowers the rob weight when only ${name} fails`, () => {
      const { w, robber, target } = make();
      const weight = robWeight(w, robber, target, lowest(w, target))!;
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(FULL_ROB * 0.1);
    });
  }

  it('a player truck with loot gets the full rob weight only when its guns are weaker', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    addGoods(w, me, 'electronics', 4);
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    expect(robWeight(w, robber, me, vehicleDanger(w, me))).toBe(FULL_ROB);
    // Out of the armed scumbag's group, so the bare one judges by its own guns alone. With none, it cannot rob.
    const bare = addScumbag(w, { x: 15, y: 25 }, ['stockEngine']);
    expect(optionWeights(w, bare, 'preySeen', me.id, lowest(w, me))).not.toHaveProperty('rob');
  });
});

describe('danger', () => {
  it('a tank outscores a scout', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates'], { x: 10, y: 10 });
    const scout = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 20, y: 10 });
    expect(vehicleDanger(w, tank)).toBeGreaterThan(vehicleDanger(w, scout) * 3);
  });

  it('a half-HP tank scores about half', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const tank = addVehicle(w, 'raiders', 'carrier', ['tankGun', 'plates'], { x: 10, y: 10 });
    const full = vehicleDanger(w, tank);
    for (const part of [...mountedParts(tank, 'core'), ...mountedParts(tank, 'armor')]) part.hp = Math.ceil(part.hp / 2);
    expect(vehicleDanger(w, tank) / full).toBeGreaterThan(0.45);
    expect(vehicleDanger(w, tank) / full).toBeLessThan(0.55);
  });

  it('a truck with no working gun has no danger', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const scout = addVehicle(w, 'raiders', 'scout', ['mg'], { x: 10, y: 10 });
    mountedParts(scout, 'weapon')[0].hp = 0;
    expect(vehicleDanger(w, scout)).toBe(0);
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
        if (isRob(r.brain!.goals.at(-1), target.id)) robs++;
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
      if (!isRob(r.brain!.goals.at(-1), target.id)) continue;
      robs++;
      expect(stateOf(x, 'feud', robber.id, target.id)).not.toBeNull();
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
        expect(isRob(r.brain!.goals.at(-1), bad.target.id)).toBe(false);
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
        if (isRob(r.brain!.goals.at(-1), judged.target.id)) rare++;
      }
      expect(rare).toBeLessThan(10);
    }
  });

  it('a scavenger without scumbag robs a weak loaded truck at about 1%', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 }, ['mg', 'stockEngine'], ['scavenger']);
    const target = addPrey(w, { x: 15, y: 10 });
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBe(0);
    const seeds = 2000;
    let robs = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const x = cloneWorld(w);
      x.rngState = seed;
      const r = find(x, robber.id);
      thinkNpc(x, r);
      if (isRob(r.brain!.goals.at(-1), target.id)) robs++;
    }
    expect(robs / seeds).toBeGreaterThan(0.003);
    expect(robs / seeds).toBeLessThan(0.02);
  }, 90_000); // takes 10-25s alone and over 30s when the whole suite shares the cores

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
    thinkNpc(w, robber);
    expect(robber.brain!.goals.map((g) => g.kind)).toEqual(['scavenge', 'fight']);
    expect(isRob(robber.brain!.goals[1], target.id)).toBe(true);
    // The target is gone, so the rob goal pops and the scavenge goal is active again.
    w.vehicles = w.vehicles.filter((v) => v.id !== target.id);
    forceOption('resume', 'resume');
    expect(thinkNpc(w, robber)).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
  });

  it('a robber keeps its rob goal while its victim stays in sight, with no hostileSeen roll on the victim', () => {
    const { w, robber, target } = passing();
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    forceOption('preySeen', 'rob');
    // A hostileSeen roll on the victim would almost surely flee.
    forceOption('hostileSeen', 'flee');
    thinkNpc(w, robber);
    for (let turn = 0; turn < 5; turn++) {
      w.turn++;
      w.events = [];
      thinkNpc(w, robber);
      expect(isRob(robber.brain!.goals.at(-1), target.id)).toBe(true);
      expect(w.events.filter((e) => e.t === 'activity')).toEqual([]);
    }
  });

  it('a driver on a tow job robs no one it passes', () => {
    const { w, robber, target } = passing();
    // An open tow offer to the player, waiting for an answer.
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
    expect(isRob(robber.brain!.goals.at(-1), target.id)).toBe(true);
    expect(robber.job).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'job', vehicle: robber.id, outcome: 'cancelled' }));
  });

  it('a failed robbery lowers the rob weight against the same target', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addScumbag(w, { x: 10, y: 10 });
    const target = addPrey(w, { x: 80, y: 10 });
    const other = addPrey(w, { x: 10, y: 15 });
    addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
    // Out of sight and with no shots, the feud runs out.
    for (let i = 0; i < STATE_TURNS.feud!; i++) {
      w.turn++;
      w.events = [];
      advanceStates(w);
    }
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
    expect(w.events).toContainEqual(expect.objectContaining({ t: 'stateEnded', ending: 'expired' }));
    const backedOff = stateOf(w, 'backedOff', robber.id, target.id);
    expect(backedOff).not.toBeNull();
    // A state added by a hook waits a turn before it counts down.
    w.turn++;
    advanceStates(w);
    expect(stateOf(w, 'backedOff', robber.id, target.id)?.turnsLeft).toBe(STATE_TURNS.backedOff! - 1);
    target.pos = { x: 15, y: 10 };
    const again = robWeight(w, robber, target, vehicleDanger(w, target))!;
    expect(again).toBeGreaterThan(0);
    expect(again).toBeLessThan(robWeight(w, robber, other, vehicleDanger(w, other))! * 0.05);
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

  // Runs the part of a turn that ends states after a kill.
  function killTurn(w: World): void {
    w.turn++;
    w.events = [];
    resolveDestroyed(w);
    advanceStates(w);
  }

  it('a scumbag that knocks out an NPC loots its truck, with its scavenge goal still below', () => {
    const { w, robber, target } = passing();
    target.brain = npcBrain('trader', target.pos, ['trader']);
    robber.brain!.goals = [{ ...SCAVENGE }];
    forceOption('preySeen', 'rob');
    // A stranded target offered a way out holds out, so the robbery ends in a knockout.
    forceOption('surrenderOffered', 'refuse');
    thinkNpc(w, robber);
    expect(stateOf(w, 'feud', robber.id, target.id)?.data).toEqual({ kind: 'feud', robbery: true });
    corePart(target, 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => roll >= RULES.npcDeathChance);
    killTurn(w);
    expect(target.defeat?.phase).toBe('out');
    expect(robber.brain!.goals.at(-1)).toMatchObject({ kind: 'loot', targetId: target.id });
    expect(robber.brain!.goals[0]).toMatchObject({ kind: 'scavenge', targetId: 'salvage-yard' });
    // The loot goal drives the robber this turn. Once the truck wakes, the loot goal pops, and the scavenge goal
    // is active again.
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
  // A danger just under what the robber judges stronger than itself, and just over it once raised by rank 5.
  function nearThreshold(w: World, robber: Vehicle): number {
    const threshold = ownDanger(w, robber) * npcProfile(robber).boldness;
    return threshold / (1 + 2.5 * SKILL_EFFECTS.social.robberyDanger);
  }

  it('a scumbag sees a rank 5 player truck as stronger', () => {
    const w = emptyWorld({ x: 15, y: 10 });
    const me = w.vehicles[0];
    addGoods(w, me, 'electronics', 4);
    const robber = addScumbag(w, { x: 10, y: 10 }, ['autocannon', 'stockEngine']);
    const danger = nearThreshold(w, robber);
    expect(robWeight(w, robber, me, danger)).toBe(FULL_ROB);
    w.player.ranks.social = 5;
    expect(robWeight(w, robber, me, danger)).toBeLessThanOrEqual(FULL_ROB * 0.1);
  });

  it('leaves robbery of an NPC truck unchanged', () => {
    const { w, robber, target } = passing();
    const danger = nearThreshold(w, robber);
    w.player.ranks.social = 5;
    expect(robWeight(w, robber, target, danger)).toBe(FULL_ROB);
  });
});


describe('cargo value', () => {
  const chance = (w: World, robber: Vehicle, decision: 'preySeen' | 'hostileSeen', target: Vehicle, option: string): number => {
    const danger = vehicleDanger(w, target);
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
    expect(robWeight(w, robber, rich, vehicleDanger(w, rich))).toBe(FULL_ROB);
    // A grudge ignores cargo.
    addState(w, 'revenge', robber.id, poor.id, { kind: 'none' });
    expect(robWeight(w, robber, poor, vehicleDanger(w, poor))).toBeGreaterThanOrEqual(FULL_ROB);
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
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBeUndefined();
    thinkMany(w, robber.id, target.id);
    expect(stateOf(w, 'feud', robber.id, target.id)).toBeNull();
  });

  it('a stranded raider gets no fight or investigate against loot, whether out of fuel or engine', () => {
    for (const strandIt of [strand, (w: World, v: Vehicle) => { for (const part of mountedParts(v, 'engine')) part.hp = 0; }]) {
      const w = emptyWorld({ x: 200, y: 200 });
      const raider = addRaider(w, { x: 10, y: 10 });
      const target = addPrey(w, { x: 15, y: 10 });
      const before = optionWeights(w, raider, 'hostileSeen', target.id, vehicleDanger(w, target));
      expect(before.fight).toBeGreaterThan(0);
      strandIt(w, raider);
      if (!isStranded(w, raider)) continue;
      expect(optionWeights(w, raider, 'hostileSeen', target.id, vehicleDanger(w, target)).fight).toBeUndefined();
      expect(optionWeights(w, raider, 'contactHeard', target.id, vehicleDanger(w, target)).investigate).toBeUndefined();
      thinkMany(w, raider.id, target.id);
    }
  });

  it('a scumbag stranded mid-robbery gives it up and backs off, unless the prey fights it', () => {
    for (const fights of [false, true]) {
      const { w, robber, target } = passing();
      addState(w, 'feud', robber.id, target.id, { kind: 'feud', robbery: true });
      robber.brain!.goals.push({ kind: 'fight', targetId: target.id, destination: { ...target.pos }, reason: 'rob cargo', perceived: w.turn } as NpcActivity);
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
    raider.brain!.goals.push({ kind: 'fight', targetId: target.id, destination: { ...target.pos }, reason: 'raid', perceived: w.turn } as NpcActivity);
    strand(w, raider);
    thinkNpc(w, raider);
    expect(raider.brain!.goals.some((g) => g.kind === 'fight' && g.targetId === target.id)).toBe(false);
    expect(optionWeights(w, raider, 'attacked', target.id, vehicleDanger(w, target)).fightBack).toBeGreaterThan(0);
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
    expect(robWeight(w, robber, target, vehicleDanger(w, target))).toBeGreaterThan(0);
    const w2 = emptyWorld({ x: 200, y: 200 });
    const raider = addRaider(w2, { x: 10, y: 10 });
    const loaded = addPrey(w2, { x: 15, y: 10 });
    expect(optionWeights(w2, raider, 'hostileSeen', loaded.id, vehicleDanger(w2, loaded)).fight).toBeGreaterThan(0);
  });
});
