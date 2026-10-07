import { describe, expect, it } from 'vitest';
import type { TraitId } from '../data/npcs';
import { NPC_BEHAVIOR } from '../data/npcs';
import { fireWeapons, isHostile, noteAttack } from './combat';
import { addGoods } from './inventory';
import { thinkNpc } from './npc-activities';
import { optionWeights } from './npc-decisions';
import { REGION } from '../data/region';
import { siteGates } from './sites';
import { stateOf } from './states';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain } from './testkit';
import type { Faction, GameEvent, Vehicle, World } from './types';
import type { Vec } from './vec';
import { gunFor } from './factory';

function addNpc(w: World, faction: Faction, traits: TraitId[], pos: Vec, parts = ['mg', 'stockEngine']): Vehicle {
  const v = addVehicle(w, faction, 'scout', parts, pos);
  v.brain = npcBrain(traits[0], pos, traits);
  return v;
}

function addLawman(w: World, pos: Vec, parts = ['mg', 'stockEngine']): Vehicle {
  return addNpc(w, 'bowl', ['lawman'], pos, parts);
}

function shoot(w: World, shooter: Vehicle, target: Vehicle): void {
  shooter.weaponOrders[vehicleStats(w, shooter).weapons[0].part.id] = { targetId: target.id, aim: 'body' };
  fireWeapons(w);
  expect(w.events.some((e) => e.t === 'shot' && e.shooter === shooter.id)).toBe(true);
}

// A point d tiles out from the Bowl gate, away from the town.
const BOWL = REGION.towns[0];
const GATE = siteGates(BOWL)[0];
function outFromGate(d: number): Vec {
  const k = d / BOWL.radius;
  return { x: GATE.x + (GATE.x - BOWL.pos.x) * k, y: GATE.y + (GATE.y - BOWL.pos.y) * k };
}

const hostileEvents = (w: World, against: string) => w.events.filter((e): e is Extract<GameEvent, { t: 'hostile' }> => e.t === 'hostile' && e.against === against);

describe('lawmen', () => {
  // Mounted guns and engines count as loot, so a truck with nothing to take has only core parts.
  it('a lawman and a raider with nothing to take are hostile both ways', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const lawman = addLawman(w, { x: 10, y: 10 }, []);
    const raider = addNpc(w, 'raiders', ['raider'], { x: 15, y: 10 }, []);
    expect(isHostile(w, lawman, raider)).toBe(true);
    expect(isHostile(w, raider, lawman)).toBe(true);
  });

  it('a trader and a raider with nothing to take stay at peace', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const trader = addNpc(w, 'traders', ['trader'], { x: 10, y: 10 }, []);
    const raider = addNpc(w, 'raiders', ['raider'], { x: 15, y: 10 }, []);
    expect(isHostile(w, trader, raider)).toBe(false);
    expect(isHostile(w, raider, trader)).toBe(false);
  });

  it('a first shot at a trader makes a lawman in sight feud with the shooter', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const shooter = addNpc(w, 'scavengers', ['scavenger', 'scumbag'], { x: 10, y: 10 });
    const trader = addNpc(w, 'traders', ['trader'], { x: 13, y: 10 });
    const lawman = addLawman(w, { x: 16, y: 14 });
    shoot(w, shooter, trader);
    expect(stateOf(w, 'feud', lawman.id, shooter.id)).not.toBeNull();
    expect(hostileEvents(w, shooter.id).map((e) => e.vehicle)).toEqual([trader.id, lawman.id]);
  });

  it('a lawman out of sight of the shot stays out of it', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const shooter = addNpc(w, 'scavengers', ['scavenger', 'scumbag'], { x: 10, y: 10 });
    const trader = addNpc(w, 'traders', ['trader'], { x: 13, y: 10 });
    const lawman = addLawman(w, { x: 80, y: 80 });
    shoot(w, shooter, trader);
    expect(stateOf(w, 'feud', lawman.id, shooter.id)).toBeNull();
  });

  it('a second shot in an ongoing feud calls nobody', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const shooter = addNpc(w, 'scavengers', ['scavenger', 'scumbag'], { x: 10, y: 10 });
    const trader = addNpc(w, 'traders', ['trader'], { x: 13, y: 10 });
    shoot(w, shooter, trader);
    const lawman = addLawman(w, { x: 16, y: 14 });
    for (const p of vehicleStats(w, shooter).weapons) Object.assign(p.part, gunFor(p.part.defId));
    w.events = [];
    shoot(w, shooter, trader);
    expect(stateOf(w, 'feud', lawman.id, shooter.id)).toBeNull();
    expect(hostileEvents(w, shooter.id)).toEqual([]);
  });

  it('a player first shot at a trader makes a lawman feud with the player', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addNpc(w, 'traders', ['trader'], { x: 33, y: 30 });
    const lawman = addLawman(w, { x: 36, y: 34 });
    shoot(w, me, trader);
    expect(stateOf(w, 'feud', lawman.id, me.id)).not.toBeNull();
  });

  it('a robbery start calls lawmen', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const robber = addNpc(w, 'scavengers', ['scavenger', 'scumbag'], { x: 10, y: 10 });
    robber.brain!.goals = [{ kind: 'scavenge', targetId: 'salvage-yard', destination: { x: 100, y: 100 }, phase: 'travel', reason: 'search a known salvage site' }];
    const prey = addVehicle(w, 'traders', 'scout', [], { x: 15, y: 10 });
    prey.brain = npcBrain('trader', prey.pos, ['trader']);
    if (addGoods(w, prey, 'scrap', 2) < 2) throw new Error('No room for prey goods');
    const lawman = addLawman(w, { x: 14, y: 16 });
    forceOption('preySeen', 'rob');
    thinkNpc(w, robber);
    expect(stateOf(w, 'feud', robber.id, prey.id)).not.toBeNull();
    expect(stateOf(w, 'feud', lawman.id, robber.id)).not.toBeNull();
  });

  // Lawmen protect neutral NPCs only. The attack is noted as calm, so only the victim rule keeps lawmen out.
  it('a raider attack on the player calls nobody', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addNpc(w, 'raiders', ['raider'], { x: 33, y: 30 });
    const lawman = addLawman(w, { x: 36, y: 34 });
    noteAttack(w, raider, me, true);
    expect(stateOf(w, 'feud', lawman.id, raider.id)).toBeNull();
  });

  it('a lawman picks a fight at a town gate as freely as away from towns', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const atGate = addLawman(w, outFromGate(NPC_BEHAVIOR.lawGateReach / 2));
    const raider = addNpc(w, 'raiders', ['raider'], outFromGate(NPC_BEHAVIOR.lawGateReach / 2 + 3));
    const far = emptyWorld({ x: 200, y: 200 });
    const away = addLawman(far, { x: 10, y: 10 });
    const farRaider = addNpc(far, 'raiders', ['raider'], { x: 13, y: 10 });
    const fightAt = (world: World, v: Vehicle, other: Vehicle) => optionWeights(world, v, 'hostileSeen', other.id, null).fight;
    expect(fightAt(w, atGate, raider)).toBe(fightAt(far, away, farRaider));
  });
});
