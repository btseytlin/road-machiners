import { chooseOption, currentOptions } from './dialogue';
import { describe, expect, it } from 'vitest';
import { XP_TO_REACH } from '../data/skills';
import { RULES } from '../data/rules';
import { SPAWN } from '../data/npcs';
import { REGION } from '../data/region';
import { getResources } from './resources';
import { siteGates } from './sites';
import { autoOrders, beatenBy, fireWeapons, hitOdds, isHostile, laneOfOffset, noteAttack, resolveDestroyed, wreckVehicle } from './combat';
import { knockOutNpc } from './defeat';
import { NPC_BEHAVIOR } from '../data/npc-behavior';
import { thinkNpc, topGoal } from './npc-activities';
import { corePart, mountedItems, mountedParts } from './grid';
import { addState, stateOf } from './states';
import { refreshVision } from './vision';
import { vehicleStats } from './stats';
import { addVehicle, emptyWorld, forceOption, npcBrain, practiceOf, rngStateWhere, testDrive } from './testkit';
import type { GameEvent, Vehicle, World } from './types';
import { dist } from './vec';
import { endTurn, update } from './world';
import { gunFor } from './factory';

function duel(targetPos = { x: 33, y: 30 }) {
  const w = emptyWorld();
  const me = w.vehicles[0];
  const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], targetPos, Math.PI);
  buggy.brain = npcBrain('buggy', targetPos, ['raider']);
  const mg = vehicleStats(w, me).weapons[0];
  return { w, me, buggy, mg };
}

// The player's scout swapped for a hauler with a forward cannon on deck beside its cab, where the cannon can fire forward.
function cannonHauler(w: World): Vehicle {
  const old = w.vehicles[0];
  const v = addVehicle(w, 'player', 'hauler', ['stockEngine', 'cannon'], old.pos, old.heading);
  v.id = old.id;
  w.vehicles = [v, ...w.vehicles.slice(1, -1)];
  return v;
}

function order(me: Vehicle, weaponId: string, targetId: string, aim = 'body') {
  me.weaponOrders[weaponId] = { targetId, aim };
}

describe('combat', () => {
  it('does not fire out of range', () => {
    const { w, me, buggy, mg } = duel({ x: 44, y: 30 }) // 14 tiles: past the gun's 13.5, still in sight;
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.filter((e) => e.t === 'shot')).toHaveLength(0);
  });

  it('fires in range and starts the cooldown', () => {
    const { w, me, buggy, mg } = duel();
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(true);
    expect(mg.part.gun?.cooldown).toBe(mg.def.cooldown - 1);
  });

  it('forward arc blocks shots to the side', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    me.chassisId = 'hauler';
    me.items = [
      { id: 'i1', x: 0, y: 0, rot: 0, kind: 'part', part: { id: 'c1', defId: 'cannon', hp: 30, wear: 0, ...gunFor('cannon') } },
      { id: 'i2', x: 4, y: 0, rot: 0, kind: 'part', part: { id: 'e1', defId: 'stockEngine', hp: 25, wear: 0 } },
    ];
    const side = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 30, y: 35 });
    order(me, 'c1', side.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a gun cooling down holds fire until its cooldown runs out', () => {
    const w = emptyWorld();
    const me = cannonHauler(w);
    const t = addVehicle(w, 'raiders', 'hauler', ['cannon', 'stockEngine', 'plates'], { x: 35, y: 30 }, Math.PI);
    const gun = vehicleStats(w, me).weapons[0];
    order(me, gun.part.id, t.id);
    gun.part.gun = { cooldown: 2, ammo: gun.def.magazine, reloadWork: 0 };
    const fired = Array.from({ length: 3 }, () => {
      w.events = [];
      fireWeapons(w);
      return w.events.filter((e) => e.t === 'shot' && e.shooter === me.id).length;
    });
    expect(fired).toEqual([0, 0, 1]);
  });

  it('aimed shots have lower hit chance', () => {
    const { w, me, buggy, mg } = duel();
    me.speed = 4;
    const body = hitOdds(w, me, mg, buggy, 'body');
    const aimed = hitOdds(w, me, mg, buggy, mountedParts(buggy, 'weapon')[0].id);
    expect(aimed.width).toBeLessThan(body.width);
    expect(aimed.chance).toBeLessThan(body.chance);
  });

  it('aimed hits damage the part and a part at zero is disabled', () => {
    const { w, me, buggy, mg } = duel({ x: 31.5, y: 30 });
    const gun = mountedParts(buggy, 'weapon')[0];
    gun.hp = 1;
    order(me, mg.part.id, buggy.id, gun.id);
    for (let i = 0; i < 40 && gun.hp > 0; i++) {
      Object.assign(mg.part, gunFor(mg.part.defId));
      fireWeapons(w);
    }
    expect(gun.hp).toBe(0);
    expect(w.events.some((e) => e.t === 'partDisabled' && e.part === gun.id)).toBe(true);
  });

  it('a disabled weapon never fires', () => {
    const { w, me, buggy, mg } = duel();
    mg.part.hp = 0;
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a disabled engine caps speed', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    mountedParts(me, 'engine')[0].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBe(RULES.limpSpeed);
  });

  it('a kill leaves a wreck obstacle and pays the player nothing', () => {
    const { w, me, buggy } = duel();
    getResources(w, buggy).health = 0;
    buggy.lastHitBy = me.id;
    const money = w.player.money;
    resolveDestroyed(w);
    expect(w.vehicles.find((v) => v.id === buggy.id)).toBeUndefined();
    expect(w.obstacles.some((o) => o.kind === 'wreck' && dist(o.pos, buggy.pos) === 0)).toBe(true);
    expect(w.player.money).toBe(money);
  });

  it('old kill wrecks are cleared past the cap', () => {
    const { w, me } = duel();
    for (let i = 0; i < RULES.maxKillWrecks + 3; i++) {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + i * 2, y: 10 });
      b.brain = npcBrain('buggy', b.pos, ['raider']);
      getResources(w, b).health = 0;
      b.lastHitBy = me.id;
      resolveDestroyed(w);
    }
    expect(w.obstacles.filter((o) => o.id.startsWith('wreck-'))).toHaveLength(RULES.maxKillWrecks);
  });

  it('clearing an old kill wreck stops a search of it', () => {
    const { w } = duel();
    const kill = () => {
      const b = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 10 + w.obstacles.length * 2, y: 10 });
      b.brain = npcBrain('buggy', b.pos, ['raider']);
      getResources(w, b).health = 0;
      resolveDestroyed(w);
      return b.id;
    };
    const oldest = kill();
    const searcher = addVehicle(w, 'scavengers', 'scout', [], { x: 10, y: 14 });
    searcher.job = { kind: 'search', stockId: `wreck-${oldest}`, turnsLeft: 3, total: 3 };
    for (let i = 0; i < RULES.maxKillWrecks; i++) kill();
    expect(w.salvage.some((s) => s.id === `wreck-${oldest}`)).toBe(false);
    expect(searcher.job).toBeNull();
  });

  it('shooting a neutral makes it and its nearby mates hostile', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const trader = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 33, y: 30 });
    const mate = addVehicle(w, 'traders', 'hauler', ['mg', 'stockEngine', 'plates'], { x: 36, y: 33 });
    order(me, vehicleStats(w, me).weapons[0].part.id, trader.id);
    fireWeapons(w);
    expect(stateOf(w, 'feud', trader.id, me.id)).not.toBeNull();
    expect(stateOf(w, 'feud', mate.id, me.id)).not.toBeNull();
    expect(w.events.filter((e) => e.t === 'hostile')).toEqual([
      { t: 'hostile', vehicle: trader.id, against: me.id },
      { t: 'hostile', vehicle: mate.id, against: me.id },
    ]);
  });

  it('raiders attack the player within aggro range over a few turns', () => {
    const { w, me, buggy } = duel({ x: 38, y: 30 });
    forceOption('hostileSeen', 'fight');
    let world = w;
    let shotAt = false;
    for (let i = 0; i < 6; i++) {
      // A raider radios its demand first. Refusing keeps the fight.
      if (world.player.call) world = chooseOption(world, currentOptions(world).findIndex((o) => o.text === 'Come and get it.'));
      world = endTurn(world, testDrive);
      if (world.events.some((e) => e.t === 'shot' && e.shooter === buggy.id && e.target === me.id)) shotAt = true;
    }
    expect(shotAt).toBe(true);
  });
});

type Shot = Extract<GameEvent, { t: 'shot' }>;
const shotsBy = (events: GameEvent[], id: string) => events.filter((e): e is Shot => e.t === 'shot' && e.shooter === id);

// Player at (30, 30) facing +x, a buggy `d` tiles ahead. Heading PI / 2 shows its left side, PI its nose.
function range(d: number, heading: number, speed = 0) {
  const { w, me, buggy, mg } = duel({ x: 30 + d, y: 30 });
  buggy.heading = heading;
  buggy.speed = speed;
  return { w, me, buggy, mg };
}

// The player on a scout with one gun, and a whole target truck d tiles ahead that never loses HP.
function aimTest(gunId: string, chassisId: string, heading: number, d = 1.2) {
  const w = emptyWorld();
  const old = w.vehicles[0];
  const me = addVehicle(w, 'player', 'wagon', [gunId, 'stockEngine'], old.pos, 0);
  me.id = old.id;
  const target = addVehicle(w, 'scavengers', chassisId, ['stockEngine'], { x: old.pos.x + d, y: old.pos.y }, heading);
  w.vehicles = [me, target];
  for (const p of mountedParts(target)) p.hp = 1e9;
  return { w, me, target, gun: vehicleStats(w, me).weapons[0] };
}

// Fires many shots and checks the share of rounds that damage the aim, directly or by splash, against damageChance.
function expectShownChance(t: ReturnType<typeof aimTest> & { aim: string }) {
  const { w, me, target, gun, aim } = t;
  const shown = hitOdds(w, me, gun, target, aim).damageChance;
  let reached = 0;
  let rounds = 0;
  for (let i = 0; i < 400; i++) {
    w.events = [];
    Object.assign(gun.part, gunFor(gun.part.defId));
    order(me, gun.part.id, target.id, aim);
    fireWeapons(w);
    for (const r of shotsBy(w.events, me.id)[0].rounds) {
      rounds++;
      const hits = [...(r.struck === target.id ? r.hits : []), ...r.blast.filter((b) => b.vehicle === target.id).flatMap((b) => b.hits)];
      if (hits.some((h) => h.damage > 0 && (aim === 'body' || h.part === aim))) reached++;
    }
  }
  expect(Math.abs(reached / rounds - shown)).toBeLessThan(0.03);
}

describe('towed trucks', () => {
  it('a truck on a tow rope is nobody\'s foe, but its tower stays one', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    const tower = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 30, y: 36 });
    addState(w, 'tow', tower.id, me.id, { kind: 'tow', site: REGION.towns[0].id, fee: 10, waived: 0, hitched: false });
    expect(isHostile(w, raider, me)).toBe(true);
    w.states[w.states.length - 1].data = { kind: 'tow', site: REGION.towns[0].id, fee: 10, waived: 0, hitched: true };
    expect(isHostile(w, raider, me)).toBe(false);
    expect(isHostile(w, me, raider)).toBe(false);
    expect(isHostile(w, raider, tower)).toBe(true);
    addState(w, 'feud', raider.id, me.id, { kind: 'feud', robbery: true });
    expect(isHostile(w, raider, me)).toBe(false);
  });
});

describe('hit odds', () => {
  const broadside = Math.PI / 2;

  it('falls with distance', () => {
    const near = range(2, broadside, 3);
    const far = range(5, broadside, 3);
    const a = hitOdds(near.w, near.me, near.mg, near.buggy, 'body');
    const b = hitOdds(far.w, far.me, far.mg, far.buggy, 'body');
    expect(b.halfAngle).toBeLessThan(a.halfAngle);
    expect(b.chance).toBeLessThan(a.chance);
  });

  it('rises when the target shows its side', () => {
    const side = range(5, broadside);
    const nose = range(5, Math.PI);
    side.me.speed = nose.me.speed = 6;
    const a = hitOdds(side.w, side.me, side.mg, side.buggy, 'body');
    const b = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    expect(a.width).toBeGreaterThan(b.width);
    expect(a.chance).toBeGreaterThan(b.chance);
  });

  it('crossing speed lowers chance, and head-on closing does not', () => {
    const still = range(5, broadside, 0);
    still.me.speed = 4;
    const base = hitOdds(still.w, still.me, still.mg, still.buggy, 'body');
    still.buggy.speed = 5;
    const crossing = hitOdds(still.w, still.me, still.mg, still.buggy, 'body');
    expect(crossing.causes.crossing).toBeGreaterThan(0);
    expect(crossing.chance).toBeLessThan(base.chance);
    const nose = range(5, Math.PI, 1);
    nose.me.speed = 4;
    const idle = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    nose.buggy.speed = 5;
    const closing = hitOdds(nose.w, nose.me, nose.mg, nose.buggy, 'body');
    expect(closing.causes.crossing).toBeCloseTo(0, 9);
    expect(closing.chance).toBeCloseTo(idle.chance, 9);
  });

  it('a still target shrinks the whole spread to stillSpread', () => {
    const { w, me, buggy, mg } = range(5, Math.PI, 1);
    me.speed = 2;
    const moving = hitOdds(w, me, mg, buggy, 'body');
    expect(moving.causes.still).toBe(0);
    buggy.speed = 0;
    const still = hitOdds(w, me, mg, buggy, 'body');
    expect(still.spread).toBeCloseTo(moving.spread * RULES.stillSpread, 12);
    expect(still.chance).toBeGreaterThan(moving.chance);
  });

  it('faster rounds and gunnery raise chance, own speed lowers it', () => {
    const { w, me, buggy, mg } = range(5, broadside, 4);
    me.speed = 3;
    const base = hitOdds(w, me, mg, buggy, 'body');
    const fast = { ...mg, def: { ...mg.def, round: { ...mg.def.round, speed: mg.def.round.speed * 2 } } };
    expect(hitOdds(w, me, fast, buggy, 'body').chance).toBeGreaterThan(base.chance);
    w.player.skills.perception = XP_TO_REACH[3];
    const skilled = hitOdds(w, me, mg, buggy, 'body');
    expect(skilled.causes.skill).toBeLessThan(0);
    expect(skilled.chance).toBeGreaterThan(base.chance);
    w.player.skills.perception = 0;
    me.speed = 6;
    const shaky = hitOdds(w, me, mg, buggy, 'body');
    expect(shaky.causes.own).toBeGreaterThan(base.causes.own);
    expect(shaky.chance).toBeLessThan(base.chance);
  });

  it('spread is the sum of its causes', () => {
    const { w, me, buggy, mg } = range(4, broadside, 3);
    me.speed = 2;
    const o = hitOdds(w, me, mg, buggy, 'body');
    expect(o.spread).toBeCloseTo(o.causes.weapon + o.causes.range + o.causes.skill + o.causes.crossing + o.causes.own + o.causes.recoil + o.causes.weather + o.causes.still, 12);
    expect(o.halfAngle).toBeCloseTo(o.width / (2 * o.distance), 12);
  });
});

describe('rounds', () => {
  it('the MG fires `rounds` independent rolls', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    me.speed = 3;
    order(me, mg.part.id, buggy.id);
    let mixed = false;
    for (let i = 0; i < 20; i++) {
      w.events = [];
      Object.assign(mg.part, gunFor(mg.part.defId));
      fireWeapons(w);
      const [shot] = shotsBy(w.events, me.id);
      expect(shot.rounds).toHaveLength(mg.def.rounds);
      const hits = shot.rounds.filter((r) => r.hit).length;
      if (hits > 0 && hits < mg.def.rounds) mixed = true;
    }
    expect(mixed).toBe(true);
  });

  it('a share of hits are crits, which deal more damage than plain hits', () => {
    const { w, me, buggy, mg } = range(3, Math.PI / 2, 5);
    for (const p of mountedParts(buggy)) p.hp = 1e9;
    order(me, mg.part.id, buggy.id);
    let hits = 0;
    let crits = 0;
    let critDamage = 0;
    let plainDamage = 0;
    for (let i = 0; i < 400; i++) {
      w.events = [];
      Object.assign(mg.part, gunFor(mg.part.defId));
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        if (!r.hit) continue;
        hits++;
        const dealt = r.hits.reduce((a, h) => a + h.damage, 0);
        if (r.crit) { crits++; critDamage += dealt; } else plainDamage += dealt;
      }
    }
    expect(Math.abs(crits / hits - RULES.critChance)).toBeLessThan(0.03);
    expect(critDamage / crits).toBeGreaterThan((plainDamage / (hits - crits)) * 1.5);
  });

  it('rounds hit as often as the odds say', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    me.speed = 3;
    for (const p of mountedParts(buggy)) p.hp = 1e9; // keep the target whole, so every round sees the same truck
    order(me, mg.part.id, buggy.id);
    const p = hitOdds(w, me, mg, buggy, 'body').chance;
    let hits = 0;
    let rounds = 0;
    for (let i = 0; i < 300; i++) {
      w.events = [];
      Object.assign(mg.part, gunFor(mg.part.defId));
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        rounds++;
        if (r.hit) hits++;
      }
    }
    expect(Math.abs(hits / rounds - p)).toBeLessThan(0.05);
  });

  it('an aimed miss that lands on the truck hits the lane where it landed', () => {
    const { w, me, buggy, mg } = range(4, Math.PI);
    for (const p of mountedParts(buggy)) p.hp = 1e9; // keep the target whole, so every round sees the same truck
    const wheel = mountedItems(buggy).find((it) => it.x === 1 && it.y === 1)!.part; // front left, lane 1 from the front
    order(me, mg.part.id, buggy.id, wheel.id);
    const odds = hitOdds(w, me, mg, buggy, wheel.id);
    expect(odds.bodyChance).toBeGreaterThan(odds.chance);
    expect(odds.bodyChance).toBeLessThanOrEqual(1);
    let hits = 0;
    let rounds = 0;
    const struck = new Set<string>();
    for (let i = 0; i < 300; i++) {
      w.events = [];
      Object.assign(mg.part, gunFor(mg.part.defId));
      fireWeapons(w);
      for (const r of shotsBy(w.events, me.id)[0].rounds) {
        rounds++;
        if (!r.hit) continue;
        hits++;
        // A round in an empty armor column lane grazes the skin and hits no part.
        if (r.hits.length > 0) struck.add(r.hits[0].part);
      }
    }
    expect([...struck].some((id) => id !== wheel.id)).toBe(true);
    expect(Math.abs(hits / rounds - odds.bodyChance)).toBeLessThan(0.05);
  });

  it('the shown chance counts parts in the way of an aimed shot', () => {
    const cab = (heading: number) => {
      const t = aimTest('shotgun', 'courier', heading);
      return { ...t, aim: corePart(t.target, 'cab').id };
    };
    const front = cab(Math.PI);
    const odds = hitOdds(front.w, front.me, front.gun, front.target, front.aim);
    expect(odds.damageChance).toBeLessThan(odds.chance / 10);
    expectShownChance(front);
    expectShownChance(cab(Math.PI / 2));
  });

  it('the shown chance of a body shot is how often it damages the truck', () => {
    expectShownChance({ ...aimTest('mg', 'buggy', Math.PI / 2), aim: 'body' });
  });

  it('the shown chance of a blast gun counts its splash', () => {
    const t = aimTest('grenadeLauncher', 'jeep', Math.PI, 3);
    expectShownChance({ ...t, aim: corePart(t.target, 'transmission').id });
  });

  it('a body shot hits the truck as often as it hits anything', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    const o = hitOdds(w, me, mg, buggy, 'body');
    expect(o.bodyChance).toBe(o.chance);
  });

  it('the same seed gives the same rounds', () => {
    const { w, me, buggy, mg } = range(5, Math.PI / 2, 5);
    order(me, mg.part.id, buggy.id);
    const copy = structuredClone(w);
    fireWeapons(w);
    fireWeapons(copy);
    expect(shotsBy(copy.events, me.id)).toEqual(shotsBy(w.events, me.id));
  });

  it('a hit lands on the lane under its offset', () => {
    const n = 4;
    // Seen from behind, the shooter's right is the target's right, the high columns.
    expect(laneOfOffset('rear', 1.9, n, 0.9)).toBe(n - 1);
    expect(laneOfOffset('rear', 1.9, n, -0.9)).toBe(0);
    // Seen from the front, the shooter's right is the target's left, column 0.
    expect(laneOfOffset('front', 1.9, n, 0.9)).toBe(0);
    expect(laneOfOffset('front', 1.9, n, -0.9)).toBe(n - 1);
  });

  it('a cannon miss within splash radius damages a part', () => {
    const w = emptyWorld();
    const me = cannonHauler(w);
    const t = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI / 2);
    for (const p of mountedParts(t)) p.hp = 1e9;
    t.speed = 3;
    me.speed = 4;
    order(me, vehicleStats(w, me).weapons[0].part.id, t.id);
    const cannon = vehicleStats(w, me).weapons[0];
    let splashed = false;
    for (let i = 0; i < 60 && !splashed; i++) {
      w.events = [];
      Object.assign(cannon.part, gunFor(cannon.part.defId));
      fireWeapons(w);
      const miss = shotsBy(w.events, me.id)[0].rounds.find((r) => !r.hit);
      if (miss?.blast.some((b) => b.vehicle === t.id)) splashed = true;
    }
    expect(splashed).toBe(true);
  });
});

describe('aims at lost parts', () => {
  function aimedAtEngine() {
    const { w, me, buggy, mg } = duel();
    const engine = mountedParts(buggy, 'engine')[0];
    order(me, mg.part.id, buggy.id, engine.id);
    return { w, me, buggy, mg, engine };
  }

  it('turns the order into a body shot when a turn removes the part', () => {
    const { w, buggy, mg, engine } = aimedAtEngine();
    buggy.items = buggy.items.filter((it) => it.kind !== 'part' || it.part.id !== engine.id);
    const next = endTurn(w, testDrive);
    expect(next.vehicles[0].weaponOrders[mg.part.id]).toMatchObject({ targetId: buggy.id, aim: 'body' });
  });

  it('settles the order after any command', () => {
    const { w, me, buggy, mg, engine } = aimedAtEngine();
    const next = update(w, (d) => {
      const b = d.vehicles.find((v) => v.id === buggy.id)!;
      b.items = b.items.filter((it) => it.kind !== 'part' || it.part.id !== engine.id);
    });
    expect(next.vehicles[0].weaponOrders[mg.part.id]).toEqual({ targetId: buggy.id, aim: 'body' });
    expect(me.weaponOrders[mg.part.id].aim).toBe(engine.id);
  });

  it('drops an order whose target is gone', () => {
    const { w, mg, buggy } = aimedAtEngine();
    w.vehicles = w.vehicles.filter((v) => v.id !== buggy.id);
    const next = update(w, () => {});
    expect(next.vehicles[0].weaponOrders[mg.part.id]).toBeUndefined();
  });
});

describe('player vision', () => {
  it('auto fire and manual orders ignore raiders out of sight', async () => {
    const { setWeaponOrder } = await import('./world');
    const { autoOrders } = await import('./combat');
    const { w, me } = duel({ x: 55, y: 30 });
    w.player.autoFire = true;
    autoOrders(w, me);
    expect(me.weaponOrders).toEqual({});
    const far = w.vehicles.find((v) => v.faction === 'raiders')!;
    expect(() => setWeaponOrder(w, vehicleStats(w, me).weapons[0].part.id, { targetId: far.id, aim: 'body' })).toThrow(/cannot see/);
  });

  it('a rock between you and a raider blocks the shot', () => {
    const { w, me, buggy, mg } = duel({ x: 34, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 32, y: 30 }, r: 0.8, kind: 'rock' }];
    refreshVision(w);
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });

  it('a raider seen behind a rock inside the close radius cannot be shot', async () => {
    const { fireBlock } = await import('./combat');
    const { playerSees } = await import('./vision');
    const { w, me, buggy, mg } = duel({ x: 32.5, y: 30 });
    w.obstacles = [{ id: 'r', pos: { x: 31.2, y: 30 }, r: 0.6, kind: 'rock' }];
    refreshVision(w);
    expect(playerSees(w, buggy.pos)).toBe(true);
    expect(fireBlock(w, me, mg, buggy)).toBe('covered');
    order(me, mg.part.id, buggy.id);
    fireWeapons(w);
    expect(w.events.some((e) => e.t === 'shot' && e.shooter === me.id)).toBe(false);
  });
});

describe('NPC attack records and defensive fire', () => {
  it('records every shot at the driver or a nearby faction mate it sees as an attack, even a miss', () => {
    const w = emptyWorld({ x: 80, y: 80 });
    const npc = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 10, y: 10 });
    npc.brain = npcBrain('scavenger', npc.pos, ['scavenger']);
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg'], { x: 14, y: 10 });
    const mate = addVehicle(w, 'scavengers', 'scout', [], { x: 12, y: 12 });
    const far = addVehicle(w, 'scavengers', 'scout', [], { x: 10 + SPAWN.neighborHelp + 8, y: 10 });
    const shootAt = (target: Vehicle) => {
      w.events = [];
      raider.weaponOrders = { [mountedParts(raider, 'weapon')[0].id]: { targetId: target.id, aim: 'body' } };
      raider.pos = { x: target.pos.x + 4, y: target.pos.y };
      fireWeapons(w);
      expect(w.events.some((e) => e.t === 'shot' && e.target === target.id)).toBe(true);
      getResources(w, target).health = RULES.maxHealth;
      const gun = mountedParts(raider, 'weapon')[0];
      Object.assign(gun, gunFor(gun.defId));
    };
    shootAt(far);
    expect(npc.brain!.attackers).toEqual({});
    shootAt(mate);
    expect(npc.brain!.attackers).toEqual({ [raider.id]: false });
    npc.brain!.attackers[raider.id] = true;
    shootAt(npc);
    expect(npc.brain!.attackers).toEqual({ [raider.id]: false });
  });

  it('an NPC opens fire only on its fight target away from guards, and always on an attacker', () => {
    const w = emptyWorld({ x: 200, y: 200 });
    const npc = addVehicle(w, 'raiders', 'scout', ['mg', 'stockEngine'], { x: 30, y: 30 });
    npc.brain = npcBrain('buggy', npc.pos, ['raider']);
    const prey = addVehicle(w, 'traders', 'scout', ['mg'], { x: 33, y: 30 });
    const aimed = () => Object.values(npc.weaponOrders).map((order) => order.targetId);
    autoOrders(w, npc);
    expect(aimed()).toEqual([]);
    npc.brain.goals = [{ kind: 'fight', targetId: prey.id, destination: { ...prey.pos }, phase: 'travel', reason: 'test fight' }];
    autoOrders(w, npc);
    expect(aimed()).toEqual([prey.id]);
    const gate = siteGates(REGION.towns[0])[0];
    npc.pos = { x: gate.x + 3, y: gate.y };
    prey.pos = { ...gate };
    autoOrders(w, npc);
    expect(aimed()).toEqual([]);
    npc.brain.goals = [{ kind: 'flee', targetId: prey.id, destination: { x: 100, y: 100 }, phase: 'travel', reason: 'test flee' }];
    npc.brain.attackers = { [prey.id]: true };
    autoOrders(w, npc);
    expect(aimed()).toEqual([prey.id]);
  });
});

describe('hit practice', () => {
  it('pays the player per round that hits, harder at a lower chance', () => {
    const { w, me, buggy, mg } = duel();
    let hits = 0;
    for (let i = 0; i < 10; i++) {
      w.events = [];
      Object.assign(mg.part, gunFor(mg.part.defId));
      order(me, mg.part.id, buggy.id);
      fireWeapons(w);
      const shot = w.events.find((e) => e.t === 'shot' && e.shooter === me.id);
      if (shot?.t !== 'shot') throw new Error('The player did not fire');
      for (const event of practiceOf(w, 'hit')) {
        expect(event.difficulty).toBeCloseTo(1 - shot.chance);
        expect(event.amount).toBeLessThanOrEqual(shot.rounds.length);
        hits += event.amount;
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('pays nothing for an NPC hitting the player', () => {
    const { w, me, buggy } = duel();
    const gun = vehicleStats(w, buggy).weapons[0];
    for (let i = 0; i < 10; i++) {
      Object.assign(gun.part, gunFor(gun.part.defId));
      order(buggy, gun.part.id, me.id);
      fireWeapons(w);
    }
    expect(w.events.filter((e) => e.t === 'shot' && e.shooter === buggy.id)).toHaveLength(10);
    expect(practiceOf(w, 'hit')).toEqual([]);
  });
});

describe('aim perks', () => {
  const broadside = Math.PI / 2;

  it('steady aim takes the scatter of own speed away from the player', () => {
    const { w, me, buggy, mg } = range(5, broadside);
    me.speed = 6;
    const shaky = hitOdds(w, me, mg, buggy, 'body');
    w.player.perks.push('steadyAim');
    const steady = hitOdds(w, me, mg, buggy, 'body');
    expect(shaky.causes.own).toBeGreaterThan(0);
    expect(steady.causes.own).toBe(0);
    expect(steady.chance).toBeGreaterThan(shaky.chance);
  });

  it('steady aim leaves an NPC shooter shaking', () => {
    const { w, me, buggy } = range(5, broadside);
    buggy.speed = 6;
    const gun = vehicleStats(w, buggy).weapons[0];
    const before = hitOdds(w, buggy, gun, me, 'body');
    w.player.perks.push('steadyAim');
    expect(hitOdds(w, buggy, gun, me, 'body').causes.own).toBe(before.causes.own);
  });

  // A storm over both trucks.
  const storm = (w: World) => {
    w.weather = [{ id: 'w1', kind: 'storm', pos: { x: 32, y: 30 }, radius: 10, vel: { x: 0, y: 0 }, turnsLeft: 10 }];
  };

  it('storm rider takes the storm scatter away from the player', () => {
    const { w, me, buggy, mg } = range(5, broadside);
    storm(w);
    const blown = hitOdds(w, me, mg, buggy, 'body');
    w.player.perks.push('stormRider');
    expect(blown.causes.weather).toBeGreaterThan(0);
    expect(hitOdds(w, me, mg, buggy, 'body').causes.weather).toBe(0);
  });

  it('storm rider leaves an NPC shooter blown off aim', () => {
    const { w, me, buggy } = range(5, broadside);
    storm(w);
    w.player.perks.push('stormRider');
    const gun = vehicleStats(w, buggy).weapons[0];
    expect(hitOdds(w, buggy, gun, me, 'body').causes.weather).toBeGreaterThan(0);
  });

});

describe('recoil and shake', () => {
  // A tank gun on the given chassis, facing a buggy 5 tiles ahead.
  function tankGunOn(chassisId: string) {
    const w = emptyWorld();
    const shooter = addVehicle(w, 'player', chassisId, ['stockEngine', 'tankGun'], { x: 60, y: 60 });
    const target = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 65, y: 60 }, Math.PI / 2);
    return { w, shooter, target, gun: vehicleStats(w, shooter).weapons[0] };
  }

  it('a heavy gun kicks harder on a light truck', () => {
    const light = tankGunOn('van');
    const heavy = tankGunOn('tractor');
    const a = hitOdds(light.w, light.shooter, light.gun, light.target, 'body');
    const b = hitOdds(heavy.w, heavy.shooter, heavy.gun, heavy.target, 'body');
    expect(a.causes.recoil).toBeGreaterThan(b.causes.recoil);
    expect(a.chance).toBeLessThan(b.chance);
  });

  it('a light gun barely kicks', () => {
    const { w, me, buggy, mg } = duel();
    const odds = hitOdds(w, me, mg, buggy, 'body');
    expect(odds.causes.recoil).toBeLessThan(odds.causes.weapon / 10);
  });

  it('a stabilized gun loses less aim to its own speed than a sniper cannon', () => {
    const w = emptyWorld();
    const shooter = addVehicle(w, 'player', 'tractor', ['stockEngine', 'mg', 'sniperCannon'], { x: 60, y: 60 });
    const target = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 65, y: 60 }, Math.PI / 2);
    shooter.speed = 4;
    const [mg, sniper] = ['mg', 'sniperCannon'].map((id) => vehicleStats(w, shooter).weapons.find((x) => x.def.id === id)!);
    expect(hitOdds(w, shooter, mg, target, 'body').causes.own).toBeLessThan(hitOdds(w, shooter, sniper, target, 'body').causes.own);
  });
});

describe('weapon damage multiplier', () => {
  // A cannon on a hauler fires at a sturdy buggy from the given RNG state. Returns the damage of each part hit.
  function dealt(mult: number, rngState: number): number[] {
    const saved = RULES.weaponDamage;
    (RULES as { weaponDamage: number }).weaponDamage = mult;
    try {
      const w = emptyWorld();
      w.rngState = rngState;
      const me = cannonHauler(w);
      const t = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: me.pos.x + 4, y: me.pos.y }, Math.PI / 2);
      for (const p of mountedParts(t)) p.hp = 1e9;
      order(me, vehicleStats(w, me).weapons[0].part.id, t.id);
      fireWeapons(w);
      return shotsBy(w.events, me.id).flatMap((s) => s.rounds).flatMap((r) => r.hits).map((h) => h.damage);
    } finally {
      (RULES as { weaponDamage: number }).weaponDamage = saved;
    }
  }

  // Each hit rounds to whole HP, so each can differ from the exact half by up to 0.5.
  it('scales every hit by the one multiplier', () => {
    // The first RNG state from 1 whose shot lands, so both multipliers roll the same hits. A shot that
    // misses a sturdy buggy at 4 tiles in a thousand states in a row fails the length check below.
    let state = 1;
    while (state < 1000 && dealt(1, state).length === 0) state++;
    const full = dealt(1, state);
    const half = dealt(0.5, state);
    expect(full.length).toBeGreaterThan(0);
    expect(half).toHaveLength(full.length);
    half.forEach((d, i) => expect(Math.abs(d - full[i] / 2)).toBeLessThanOrEqual(0.5));
  });
});

describe('betrayal', () => {
  function partners() {
    const w = emptyWorld({ x: 80, y: 80 });
    const me = w.vehicles[0];
    const npc = addVehicle(w, 'traders', 'scout', ['mg', 'stockEngine'], { x: me.pos.x + 6, y: me.pos.y });
    npc.brain = npcBrain('trader', npc.pos, ['trader']);
    return { w, me, npc };
  }

  it('a shot at a trade partner gives the partner revenge on the shooter', () => {
    const { w, me, npc } = partners();
    addState(w, 'trade', npc.id, me.id, { kind: 'none' });
    noteAttack(w, me, npc, true);
    expect(stateOf(w, 'revenge', npc.id, me.id)).not.toBeNull();
  });

  it('a shot at a stranger gives no revenge', () => {
    const { w, me, npc } = partners();
    noteAttack(w, me, npc, true);
    expect(stateOf(w, 'revenge', npc.id, me.id)).toBeNull();
  });

  it('a betrayed partner drops the deal and fights back', () => {
    const { w, me, npc } = partners();
    addState(w, 'trade', npc.id, me.id, { kind: 'none' });
    npc.brain!.goals = [{ kind: 'meet', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'pull over to trade' }];
    noteAttack(w, me, npc, true);
    forceOption('attacked', 'fightBack');
    thinkNpc(w, npc);
    expect(stateOf(w, 'trade', npc.id, me.id)).toBeNull();
    expect(topGoal(npc)).toMatchObject({ kind: 'fight', targetId: me.id });
  });
});

describe('who beat a truck', () => {
  // A raider one hit from breaking its cab, with the player and a Bowl Farmers lawman both firing at it.
  function sharedFight(seed: number) {
    const { w, me, buggy, mg } = duel();
    w.rngState = seed;
    const ally = addVehicle(w, 'bowl', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 33 }, -Math.PI / 2);
    ally.brain = npcBrain('bowlFarmer', { x: 33, y: 33 }, ['lawman']);
    for (const it of mountedItems(buggy)) if (it.part.id !== corePart(buggy, 'cab').id && it.part.defId !== 'stockEngine') it.part.hp = 0;
    corePart(buggy, 'cab').hp = 1;
    order(me, mg.part.id, buggy.id, corePart(buggy, 'cab').id);
    order(ally, vehicleStats(w, ally).weapons[0].part.id, buggy.id);
    return { w, me, buggy, ally };
  }

  function damageBy(w: World, targetId: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const e of w.events) {
      if (e.t !== 'shot') continue;
      const dealt = e.rounds.flatMap((r) => (r.struck === targetId ? r.hits : [])).reduce((sum, h) => sum + h.damage, 0);
      out.set(e.shooter, (out.get(e.shooter) ?? 0) + dealt);
    }
    return out;
  }

  function shotAt(shooter: string, target: string, part: string, damage: number): GameEvent {
    return { t: 'shot', shooter, weapon: 'gun', target, aim: 'body', chance: 1, damageChance: 1, side: 'front', rounds: [{ hit: true, crit: false, offset: 0, struck: target, hits: [{ part, damage }], blast: [] }] };
  }

  it('the player who dealt the most damage in the final turn gets the knockout, though a lawman hit last', () => {
    const credited: { by: string; most: string }[] = [];
    for (let seed = 1; seed <= 40 && credited.length < 3; seed++) {
      const { w, me, buggy, ally } = sharedFight(seed * 7919);
      fireWeapons(w);
      const dealt = damageBy(w, buggy.id);
      const mine = dealt.get(me.id) ?? 0;
      const theirs = dealt.get(ally.id) ?? 0;
      if (!(mine > theirs && theirs > 0)) continue;
      expect(buggy.lastHitBy).toBe(ally.id);
      resolveDestroyed(w);
      const fate = w.events.find((e) => e.t === 'npcKnockout' || e.t === 'destroyed');
      if (!fate || (fate.t !== 'npcKnockout' && fate.t !== 'destroyed')) continue;
      credited.push({ by: fate.by, most: me.id });
    }
    expect(credited.length).toBeGreaterThan(0);
    for (const c of credited) expect(c.by).toBe(c.most);
  });

  it('gives the same answer whatever order the trucks sit in', () => {
    const { w, me, buggy } = duel();
    const other = addVehicle(w, 'bowl', 'buggy', ['mg'], { x: 33, y: 33 });
    w.events.push(shotAt(other.id, buggy.id, corePart(buggy, 'cab').id, 4), shotAt(me.id, buggy.id, corePart(buggy, 'cab').id, 9));
    expect(beatenBy(w, buggy)).toBe(me.id);
    w.vehicles = [...w.vehicles].reverse();
    expect(beatenBy(w, buggy)).toBe(me.id);
  });

  it('on a tie, the source that damaged it first wins', () => {
    const { w, me, buggy } = duel();
    const cab = corePart(buggy, 'cab').id;
    w.events.push(shotAt('other', buggy.id, cab, 5), shotAt(me.id, buggy.id, cab, 5));
    expect(beatenBy(w, buggy)).toBe('other');
  });

  it('with no damage this turn, it is the last damage source, then unknown', () => {
    const { w, me, buggy } = duel();
    w.events.push(shotAt('other', buggy.id, corePart(buggy, 'cab').id, 0));
    expect(beatenBy(w, buggy)).toBe('unknown');
    buggy.lastHitBy = me.id;
    expect(beatenBy(w, buggy)).toBe(me.id);
  });

  it('a guard shot counts for its gate, a ram for the other truck, and a crash into a rock for nobody', () => {
    const { w, me, buggy } = duel();
    const cab = corePart(buggy, 'cab').id;
    w.events.push({ t: 'guardShot', site: 'bowl', from: { x: 0, y: 0 }, target: buggy.id, rounds: [{ hit: true, crit: false, offset: 0, struck: buggy.id, hits: [{ part: cab, damage: 6 }], blast: [] }] });
    w.events.push({ t: 'collision', a: me.id, b: buggy.id, hitsA: [], hitsB: [{ part: cab, damage: 4 }] });
    w.events.push({ t: 'collision', a: buggy.id, b: 'rock', hitsA: [{ part: cab, damage: 20 }], hitsB: [] });
    expect(beatenBy(w, buggy)).toBe('guard-bowl');
    w.events.push({ t: 'collision', a: buggy.id, b: me.id, hitsA: [{ part: cab, damage: 3 }], hitsB: [] });
    expect(beatenBy(w, buggy)).toBe(me.id);
  });

  it('draws no RNG and throws for a truck no longer in the world', () => {
    const { w, me, buggy } = duel();
    w.events.push(shotAt(me.id, buggy.id, corePart(buggy, 'cab').id, 3));
    const rng = w.rngState;
    beatenBy(w, buggy);
    expect(w.rngState).toBe(rng);
    w.vehicles = w.vehicles.filter((v) => v.id !== buggy.id);
    expect(() => beatenBy(w, buggy)).toThrow();
  });

  it('the knockout and its revenge roll follow the truck that beat it, not the last hitter', () => {
    const { w, me, buggy } = duel();
    const cab = corePart(buggy, 'cab').id;
    w.events.push(shotAt(me.id, buggy.id, cab, 9), shotAt('other', buggy.id, cab, 2));
    buggy.lastHitBy = 'other';
    w.rngState = rngStateWhere((r) => r < NPC_BEHAVIOR.revengeChance);
    knockOutNpc(w, buggy);
    expect(w.events.find((e) => e.t === 'npcKnockout')).toMatchObject({ by: me.id });
    expect(stateOf(w, 'revenge', buggy.id, me.id)).not.toBeNull();
  });

  it('a wreck is credited to the truck that beat it', () => {
    const { w, me, buggy } = duel();
    w.events.push(shotAt(me.id, buggy.id, corePart(buggy, 'cab').id, 9));
    buggy.lastHitBy = 'other';
    wreckVehicle(w, buggy);
    expect(w.events.find((e) => e.t === 'destroyed')).toMatchObject({ by: me.id });
  });
});
