import { partDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { everyGunFires, fireSpans, gunLayoutScore, laneCount, openSides, partLane, sideBlockers, sideToward, walkLane } from './armor';
import { fireBlock, inArc, resolveDestroyed } from './combat';
import { makePart } from './factory';
import { advanceKnockout, checkKnockout } from './defeat';
import { corePart, coreParts, gridOf, itemCells, mountedItems, mountedParts } from './grid';
import { vehicleStats } from './stats';
import { maxHp } from './wear';
import { leakFuel } from './supplies';
import { addVehicle, emptyWorld, npcBrain, rngStateWhere } from './testkit';
import type { GridItem, Vehicle, World } from './types';

const partAt = (v: Vehicle, x: number, y: number) =>
  mountedItems(v).find((it) => itemCells(it).some((c) => c.x === x && c.y === y))!.part;
const defOf = (v: Vehicle, defId: string) => mountedParts(v).find((p) => p.defId === defId)!;

function plated() {
  const w = emptyWorld();
  const v = addVehicle(w, 'raiders', 'scout', ['plates', 'stockEngine'], { x: 40, y: 40 });
  return { w, v, plate: defOf(v, 'plates'), engine: defOf(v, 'stockEngine') };
}

describe('sideToward', () => {
  it('picks the side facing the point in the vehicle frame', () => {
    const { v } = plated();
    v.heading = 0;
    expect(sideToward(v, { x: 45, y: 40.5 })).toBe('front');
    expect(sideToward(v, { x: 35, y: 39.5 })).toBe('rear');
    expect(sideToward(v, { x: 40.5, y: 45 })).toBe('right');
    expect(sideToward(v, { x: 40.5, y: 35 })).toBe('left');
    v.heading = Math.PI / 2;
    expect(sideToward(v, { x: 40, y: 45 })).toBe('front');
    expect(sideToward(v, { x: 35, y: 40 })).toBe('right');
  });
});

describe('walkLane', () => {
  it('has one lane per column on the ends and one per row on the flanks', () => {
    const { v } = plated();
    const g = gridOf(v);
    expect(laneCount(v, 'front')).toBe(g.w);
    expect(laneCount(v, 'rear')).toBe(g.w);
    expect(laneCount(v, 'left')).toBe(g.h);
    expect(laneCount(v, 'right')).toBe(g.h);
  });

  it('enters each side from its own edge', () => {
    const { w, v } = plated();
    const last = gridOf(v).h - 1;
    const round = { damage: 1, pen: 2, blast: false, armorShare: 1 };
    expect(walkLane(w, v, 'front', 2, round)[0].part).toBe(partAt(v, 2, 0).id);
    expect(walkLane(w, v, 'left', 1, round)[0].part).toBe(partAt(v, 1, 1).id);
    expect(walkLane(w, v, 'right', 1, round)[0].part).toBe(partAt(v, 5, 1).id);
    expect(walkLane(w, v, 'rear', 1, round)[0].part).toBe(partAt(v, 1, last - 1).id);
  });

  it('a plate absorbs a weak round', () => {
    const { w, v, plate, engine } = plated();
    const hits = walkLane(w, v, 'front', 2, { damage: 10, pen: 3, blast: false, armorShare: 1 });
    expect(hits.map((h) => h.part)).toEqual([plate.id]);
    expect(plate.hp).toBeLessThan(maxHp(plate));
    expect(engine.hp).toBe(maxHp(engine));
  });

  it('a worn plate lets more of a round through to the part behind', () => {
    const fresh = plated();
    const worn = plated();
    worn.plate.wear = 3;
    const round = { damage: 10, pen: 20, blast: false, armorShare: 1 };
    const freshHits = walkLane(fresh.w, fresh.v, 'front', 2, round);
    const wornHits = walkLane(worn.w, worn.v, 'front', 2, round);
    expect(wornHits[1].damage).toBeGreaterThan(freshHits[1].damage);
  });

  it('a strong round passes the plate and hits the part behind', () => {
    const { w, v, plate, engine } = plated();
    const cab = defOf(v, 'cabPickup');
    const hits = walkLane(w, v, 'front', 2, { damage: 10, pen: 20, blast: false, armorShare: 1 });
    expect(hits.map((h) => h.part).slice(0, 3)).toEqual([plate.id, engine.id, cab.id]);
    expect(engine.hp).toBeLessThan(maxHp(engine));
  });

  it('armor share scales damage to armor parts and leaves the part behind alone', () => {
    const plain = plated();
    const chip = plated();
    const base = walkLane(plain.w, plain.v, 'front', 2, { damage: 10, pen: 40, blast: false, armorShare: 1 });
    const scaled = walkLane(chip.w, chip.v, 'front', 2, { damage: 10, pen: 40, blast: false, armorShare: 2 });
    expect(scaled[0].part).toBe(chip.plate.id);
    expect(scaled[0].damage).toBeCloseTo(2 * base[0].damage);
    expect(scaled[1].damage).toBeCloseTo(base[1].damage);
  });

  it('a round loses damage with the pen each part takes from it', () => {
    const { w, v } = plated();
    const hits = walkLane(w, v, 'front', 2, { damage: 20, pen: 40, blast: false, armorShare: 1 });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[1].damage).toBeLessThan(hits[0].damage);
  });

  it('armor scales damage down when pen is below it', () => {
    const { w, v, plate } = plated();
    const weak = walkLane(w, v, 'front', 2, { damage: 12, pen: 6, blast: false, armorShare: 1 })[0].damage;
    plate.hp = maxHp(plate);
    const full = walkLane(w, v, 'front', 2, { damage: 12, pen: 100, blast: false, armorShare: 1 })[0].damage;
    expect(weak).toBeLessThan(full);
    expect(full).toBe(12);
  });

  it('a broken part lets the round pass', () => {
    const { w, v, plate, engine } = plated();
    plate.hp = 0;
    const hits = walkLane(w, v, 'front', 2, { damage: 10, pen: 3, blast: false, armorShare: 1 });
    expect(hits.map((h) => h.part)).toEqual([engine.id]);
    expect(plate.hp).toBe(0);
  });

  it('the round stops at zero pen', () => {
    const { w, v, plate, engine } = plated();
    const hits = walkLane(w, v, 'front', 2, { damage: 10, pen: 12, blast: false, armorShare: 1 });
    expect(hits.map((h) => h.part)).toEqual([plate.id]);
    expect(engine.hp).toBe(maxHp(engine));
  });

  it('a part spanning several cells of the lane is hit once', () => {
    const { w, v, plate, engine } = plated();
    plate.hp = 0;
    const hits = walkLane(w, v, 'front', 2, { damage: 1, pen: 100, blast: false, armorShare: 1 });
    expect(hits.filter((h) => h.part === engine.id)).toHaveLength(1);
  });

  it('cab damage to the player also costs health', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    const lane = mountedItems(me).find((it) => it.part.id === cab.id)!.y;
    const hits = walkLane(w, me, 'right', lane, { damage: 10, pen: 100, blast: false, armorShare: 1 });
    const dealt = hits.find((h) => h.part === cab.id)!.damage;
    expect(dealt).toBeGreaterThan(0);
    expect(w.player.health).toBe(RULES.maxHealth - Math.round(dealt * RULES.cabHealthShare));
  });
});

describe('knockout', () => {
  it('an NPC with a dead cab is knocked out and stays in the world', () => {
    const w = emptyWorld();
    const buggy = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 34, y: 30 });
    buggy.brain = npcBrain('buggy', buggy.pos, ['raider']);
    resolveDestroyed(w);
    expect(buggy.defeat).toBeUndefined();
    corePart(buggy, 'cab').hp = 0;
    w.rngState = rngStateWhere((roll) => roll >= RULES.npcDeathChance);
    resolveDestroyed(w);
    expect(w.vehicles.some((v) => v.id === buggy.id)).toBe(true);
    expect(buggy.defeat?.phase).toBe('out');
  });

  it('player cab death knocks the player out, and waking patches broken core parts', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const cab = corePart(me, 'cab');
    const wheel = coreParts(me, 'wheel')[0];
    cab.hp = 0;
    wheel.hp = 0;
    checkKnockout(w);
    expect(w.events.some((e) => e.t === 'knockout')).toBe(true);
    expect(mountedParts(me, 'engine')).toHaveLength(1);
    advanceKnockout(w);
    expect(w.events.some((e) => e.t === 'wake')).toBe(true);
    expect(cab.hp).toBe(Math.max(1, Math.round(partDef('cab').hp * RULES.defeatPatch)));
    expect(wheel.hp).toBeGreaterThan(0);
  });

  it('a hurt but working cab is no knockout', () => {
    const w = emptyWorld();
    corePart(w.vehicles[0], 'cab').hp = 1;
    checkKnockout(w);
    expect(w.events.some((e) => e.t === 'knockout')).toBe(false);
  });
});

describe('broken core parts', () => {
  it('a broken tank leaks fuel each turn', () => {
    const w = emptyWorld();
    const fuel = w.player.fuel;
    leakFuel(w);
    expect(w.player.fuel).toBe(fuel);
    corePart(w.vehicles[0], 'tank').hp = 0;
    leakFuel(w);
    expect(w.player.fuel).toBeCloseTo(fuel - RULES.tankLeak, 9);
  });

  it('each broken wheel cuts speed and turning', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    const whole = vehicleStats(w, me);
    coreParts(me, 'wheel')[0].hp = 0;
    const one = vehicleStats(w, me);
    expect(one.maxSpeed / whole.maxSpeed).toBeCloseTo(1 - RULES.wheelLoss, 9);
    expect(one.turnSlow / whole.turnSlow).toBeCloseTo(1 - RULES.wheelLoss, 9);
    coreParts(me, 'wheel')[1].hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBeLessThan(one.maxSpeed);
  });

  it('a broken transmission caps speed like a broken engine', () => {
    const w = emptyWorld();
    const me = w.vehicles[0];
    corePart(me, 'transmission').hp = 0;
    expect(vehicleStats(w, me).maxSpeed).toBe(RULES.limpSpeed);
  });
});

describe('lane depth', () => {
  it('a crash-strength hit on the nose fades before the rear wheels', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['stockEngine'], { x: 40, y: 40 });
    for (let lane = 0; lane < laneCount(v, 'front'); lane++) walkLane(w, v, 'front', lane, { damage: 50, pen: RULES.crashPen, blast: false, armorShare: 1 });
    const g = gridOf(v);
    const rear = coreParts(v, 'wheel').filter((p) => mountedItems(v).find((it) => it.part.id === p.id)!.y > g.h / 2);
    expect(rear.length).toBe(2);
    for (const p of rear) expect(p.hp).toBeGreaterThan(0);
  });
});

describe('blast armor', () => {
  function caged() {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'scout', ['cage', 'stockEngine'], { x: 40, y: 40 });
    return { w, v, cage: defOf(v, 'cage'), engine: defOf(v, 'stockEngine') };
  }

  it('a cage stops a blast round that a bullet of the same pen gets through', () => {
    const blast = caged();
    const bullet = caged();
    const lane = partLane(blast.v, blast.cage.id, 'front');
    walkLane(blast.w, blast.v, 'front', lane, { damage: 10, pen: 8, blast: true, armorShare: 1 });
    walkLane(bullet.w, bullet.v, 'front', lane, { damage: 10, pen: 8, blast: false, armorShare: 1 });
    expect(blast.engine.hp).toBe(partDef('stockEngine').hp);
    expect(bullet.engine.hp).toBeLessThan(partDef('stockEngine').hp);
  });

  it('parts other than armor meet blast with their plain armor', () => {
    const { w, v, engine } = plated();
    defOf(v, 'plates').hp = 0;
    const kinetic = walkLane(w, v, 'front', 2, { damage: 10, pen: 3, blast: false, armorShare: 1 }).find((h) => h.part === engine.id)!.damage;
    engine.hp = partDef('stockEngine').hp;
    const blast = walkLane(w, v, 'front', 2, { damage: 10, pen: 3, blast: true, armorShare: 1 }).find((h) => h.part === engine.id)!.damage;
    expect(blast).toBe(kinetic);
  });
});

function truckWith(w: World, chassisId: string, parts: { defId: string; x: number; y: number; rot?: 0 | 1 }[]): Vehicle {
  const v = addVehicle(w, 'player', chassisId, ['stockEngine'], { x: 40, y: 40 });
  for (const [i, p] of parts.entries()) {
    v.items.push({ id: `i-test-${i}`, x: p.x, y: p.y, rot: p.rot ?? 0, kind: 'part', part: makePart(w, p.defId, 0) });
  }
  return v;
}

function itemOf(v: Vehicle, defId: string): GridItem {
  return mountedItems(v).find((it) => it.part.defId === defId)!;
}

describe('open sides', () => {
  it('a gun in the bed cannot fire forward across the cab', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'longbed', [{ defId: 'mg', x: 3, y: 5 }]);
    expect(openSides(v, itemOf(v, 'mg'))).toEqual(['rear', 'left', 'right']);
  });

  it('a gun beside the hood fires forward but not back across the cab', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'longbed', [{ defId: 'mg', x: 5, y: 1 }]);
    expect(openSides(v, itemOf(v, 'mg'))).toEqual(['front', 'left', 'right']);
  });

  it('a gun clear of the hauler cab fires to every side', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'hauler', [{ defId: 'mg', x: 2, y: 5 }]);
    expect(openSides(v, itemOf(v, 'mg'))).toEqual(['front', 'rear', 'left', 'right']);
  });

  it('a cargo box behind a gun blinds its rear, and a flat rack does not', () => {
    const w = emptyWorld();
    const boxed = truckWith(w, 'hauler', [{ defId: 'mg', x: 2, y: 3 }, { defId: 'trailerBox', x: 2, y: 5 }]);
    const racked = truckWith(w, 'hauler', [{ defId: 'mg', x: 2, y: 3 }, { defId: 'rack', x: 2, y: 5 }]);
    expect(openSides(boxed, itemOf(boxed, 'mg'))).not.toContain('rear');
    expect(openSides(racked, itemOf(racked, 'mg'))).toContain('rear');
  });

  it('an open seat blocks nothing', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'courier', [{ defId: 'mg', x: 2, y: 6 }]);
    expect(openSides(v, itemOf(v, 'mg'))).toContain('front');
  });

  it('a gun beside the convertible hardtop cab fires to every side, since the cab lies in the next lane', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'convertible', [{ defId: 'mg', x: 4, y: 6 }]);
    expect(openSides(v, itemOf(v, 'mg'))).toEqual(['front', 'rear', 'left', 'right']);
  });
});

describe('firing past tall parts', () => {
  it('reports a target ahead of a gun behind the cab as blocked', () => {
    const w = emptyWorld();
    const me = truckWith(w, 'longbed', [{ defId: 'mg', x: 3, y: 5 }]);
    const ahead = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 45, y: 40 });
    const gun = vehicleStats(w, me).weapons[0];
    expect(inArc(me, gun, ahead)).toBe(false);
    expect(fireBlock(w, me, gun, ahead)).toBe('blocked');
  });

  it('lets the same gun fire at a target on its open flank', () => {
    const w = emptyWorld();
    const me = truckWith(w, 'longbed', [{ defId: 'mg', x: 3, y: 5 }]);
    const beside = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 40, y: 45 });
    const gun = vehicleStats(w, me).weapons[0];
    expect(inArc(me, gun, beside)).toBe(true);
  });
});

describe('fire spans', () => {
  it('a turret with every side open fires all around', () => {
    expect(fireSpans(360, ['front', 'rear', 'left', 'right'])).toEqual([{ from: -180, to: 180 }]);
  });

  it('a turret blocked in front fires from one flank around the rear to the other', () => {
    expect(fireSpans(360, ['rear', 'left', 'right'])).toEqual([{ from: 45, to: 315 }]);
  });

  it('a turret blocked at the rear fires across the front half and the flanks', () => {
    expect(fireSpans(360, ['front', 'left', 'right'])).toEqual([{ from: -135, to: 135 }]);
  });

  it('a forward gun keeps its own arc when the front is open', () => {
    expect(fireSpans(60, ['front', 'rear'])).toEqual([{ from: -30, to: 30 }]);
  });

  it('a forward gun blocked in front cannot fire at all', () => {
    expect(fireSpans(60, ['rear', 'left', 'right'])).toEqual([]);
  });

  it('a gun open only on both flanks fires in two spans', () => {
    expect(fireSpans(360, ['left', 'right'])).toEqual([{ from: -135, to: -45 }, { from: 45, to: 135 }]);
  });
});

describe('side blockers', () => {
  it('names the cab as what blocks a bed gun in front', () => {
    const w = emptyWorld();
    const v = truckWith(w, 'longbed', [{ defId: 'mg', x: 3, y: 5 }]);
    const blockers = sideBlockers(v, itemOf(v, 'mg'));
    expect(Object.keys(blockers)).toEqual(['front']);
    expect(blockers.front?.kind === 'part' && blockers.front.part.defId).toBe('cabPickup');
  });
});

describe('gun layout', () => {
  it('scores one bed gun behind the cab by its three open sides', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 3, y: 5 }]);
    expect(gunLayoutScore(v)).toBe(3 * 5 + 3);
  });

  it('scores two guns with the rear blocked by three covered sides and six open sides', () => {
    const parts = [{ defId: 'mg', x: 2, y: 5 }, { defId: 'mg', x: 2, y: 4 }, { defId: 'trailerBox', x: 2, y: 7 }];
    const v = truckWith(emptyWorld(), 'hauler', parts);
    expect(gunLayoutScore(v)).toBe(3 * 9 + 6);
  });

  it('a front-arc gun in the bed behind a tall cab cannot fire, and one clear of it can', () => {
    const w = emptyWorld();
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 3, y: 5, rot: 1 }]))).toBe(false);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 2, y: 1 }]))).toBe(true);
  });

  it('a tall part never blocks itself', () => {
    const v = truckWith(emptyWorld(), 'hauler', [{ defId: 'trailerBox', x: 2, y: 5 }]);
    const box = mountedItems(v).find((it) => it.part.defId === 'trailerBox')!;
    expect(sideBlockers(v, box)).toEqual({});
  });
});
