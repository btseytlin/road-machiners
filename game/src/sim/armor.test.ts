import { partDef, type WeaponDef } from '../data/parts';
import { describe, expect, it } from 'vitest';
import { RULES } from '../data/rules';
import { aimWithin, everyGunFires, gunBlockers, gunLayoutScore, gunSpans, laneCount, partLane, planLane, sideToward, spanDegrees, spanSides, spansHold, walkLane, type FireSpan } from './armor';
import { fireBlock, inArc, resolveDestroyed } from './combat';
import { makePart } from './factory';
import { advanceKnockout, checkKnockout } from './defeat';
import { corePart, coreParts, facingOf, gridOf, itemCells, itemSize, mountedItems, mountedParts } from './grid';
import { vehicleStats } from './stats';
import { maxHp } from './wear';
import { leakFuel } from './supplies';
import { addVehicle, emptyWorld, npcBrain, rngStateWhere } from './testkit';
import type { GridItem, Rot, Vehicle, World } from './types';

const partAt = (v: Vehicle, x: number, y: number) =>
  mountedItems(v).find((it) => itemCells(it).some((c) => c.x === x && c.y === y))!.part;
const defOf = (v: Vehicle, defId: string) => mountedParts(v).find((p) => p.defId === defId)!;

// A scout with plates on the nose: a 3x1 plate at (2,0), the engine at (2,1)-(3,2) behind it and the cab behind that.
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
    const round = { damage: 1, pen: 2, blast: false, armorShare: 1 }; // the scout's edge cells are empty, so a round needs to pass one cell
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
    // Large enough that a few percent of armor shows past whole-HP rounding.
    const round = { damage: 100, pen: 20, blast: false, armorShare: 1 };
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
    expect(cab.hp).toBe(Math.max(1, Math.round(maxHp(cab) * RULES.defeatPatch)));
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
  it('a broken cargo box still slows rounds from the rear', () => {
    const w = emptyWorld();
    const v = addVehicle(w, 'raiders', 'hauler', ['trailerBox'], { x: 40, y: 40 });
    const round = { damage: 50, pen: 4, blast: false, armorShare: 1 };
    const lanes = Array.from({ length: laneCount(v, 'rear') }, (_, lane) => lane);
    const working = lanes.map((lane) => planLane(v, 'rear', lane, round));
    mountedParts(v, 'cargo')[0].hp = 0;
    const broken = lanes.map((lane) => planLane(v, 'rear', lane, round).filter((h) => h.part.defId !== 'trailerBox'));
    expect(broken).toEqual(working.map((hits) => hits.filter((h) => h.part.defId !== 'trailerBox')));
  });
});

describe('blast armor', () => {
  // A scout with a rebar cage on the nose in front of its engine.
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

// The longbed's cab fills columns 3 to 5 of rows 3 and 4, with a deck row behind it and a deck pair at (5,1) and (5,2)
// beside the engine. The courier's seat fills (2,5) and (3,5), with deck cells behind it.
function truckWith(w: World, chassisId: string, parts: { defId: string; x: number; y: number; rot?: Rot }[]): Vehicle {
  const v = addVehicle(w, 'player', chassisId, ['stockEngine'], { x: 40, y: 40 });
  for (const [i, p] of parts.entries()) {
    v.items.push({ id: `i-test-${i}`, x: p.x, y: p.y, rot: p.rot ?? 0, kind: 'part', part: makePart(w, p.defId, 0) });
  }
  return v;
}

function itemOf(v: Vehicle, defId: string): GridItem {
  return mountedItems(v).find((it) => it.part.defId === defId)!;
}

// Spans rounded to a tenth of a degree, so angles from corner geometry compare as literals.
function rounded(spans: FireSpan[]): FireSpan[] {
  return spans.map((s) => ({ from: Math.round(s.from * 10) / 10, to: Math.round(s.to * 10) / 10 }));
}

// Degrees off the nose of a grid offset from the gun's center to a cell corner.
function cornerAngle(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

describe('shadows of tall parts', () => {
  it('a gun in the bed cannot fire forward across the cab, however far it stands', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 4, y: 8 }]);
    // The gun's center is (4.5, 9). The cab's near corners are (3, 5) and (6, 5).
    const edge = cornerAngle(1.5, -4);
    expect(gunSpans(v, itemOf(v, 'mg'))).toEqual([{ from: -135, to: -edge }, { from: edge, to: 135 }]);
  });

  it('a heavy machine gun beside the cab loses the angles over the cab and keeps the rest', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'heavyMg', x: 1, y: 4 }]);
    // The gun's center is (1.5, 5). The cab's corner (3, 3) starts its shadow, and its bottom edge at row 5 ends it.
    expect(gunSpans(v, itemOf(v, 'heavyMg'))).toEqual([{ from: -135, to: cornerAngle(1.5, -2) }, { from: 90, to: 135 }]);
  });

  it('a gun beside the hood fires forward and loses only the angles back across the cab', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 5, y: 1 }]);
    expect(rounded(gunSpans(v, itemOf(v, 'mg')))).toEqual([{ from: -111.8, to: 135 }]);
  });

  it('a gun facing away from the hauler cab keeps its whole arc', () => {
    const v = truckWith(emptyWorld(), 'hauler', [{ defId: 'shotgun', x: 2, y: 5, rot: 2 }]);
    expect(gunSpans(v, itemOf(v, 'shotgun'))).toEqual([{ from: 135, to: 225 }]);
  });

  it('a gun behind the hauler cab loses the slice the cab covers, off its own lane', () => {
    const v = truckWith(emptyWorld(), 'hauler', [{ defId: 'mg', x: 2, y: 5 }]);
    // The gun's center is (2.5, 6). The cab fills columns 5 and 6 of rows 1 to 3.
    expect(gunSpans(v, itemOf(v, 'mg'))).toEqual([{ from: -135, to: cornerAngle(2.5, -5) }, { from: cornerAngle(4.5, -2), to: 135 }]);
  });

  it('a cargo box behind a gun blinds it there, and a flat rack does not', () => {
    const w = emptyWorld();
    const boxed = truckWith(w, 'hauler', [{ defId: 'mg', x: 2, y: 3 }, { defId: 'trailerBox', x: 2, y: 5 }]);
    const racked = truckWith(w, 'hauler', [{ defId: 'mg', x: 2, y: 3 }, { defId: 'rack', x: 2, y: 5 }]);
    expect(spansHold(gunSpans(boxed, itemOf(boxed, 'mg')), 130)).toBe(false);
    expect(spansHold(gunSpans(racked, itemOf(racked, 'mg')), 130)).toBe(true);
  });

  it('a driver seat blocks a gun behind it', () => {
    const v = truckWith(emptyWorld(), 'courier', [{ defId: 'mg', x: 2, y: 6 }]);
    expect(spansHold(gunSpans(v, itemOf(v, 'mg')), 0)).toBe(false);
  });

  it('a gun beside the convertible hardtop cab loses the angles toward the cab, off its own lane', () => {
    const v = truckWith(emptyWorld(), 'convertible', [{ defId: 'mg', x: 4, y: 6 }]);
    const spans = gunSpans(v, itemOf(v, 'mg'));
    expect(spansHold(spans, -30)).toBe(false);
    expect(spansHold(spans, 0)).toBe(true);
    expect(spansHold(spans, -80)).toBe(true);
  });

  it('a tall gun never blocks itself', () => {
    const v = truckWith(emptyWorld(), 'hauler', [{ defId: 'cannon', x: 2, y: 5, rot: 2 }]);
    expect(spanDegrees(gunSpans(v, itemOf(v, 'cannon')))).toBe(Math.min((partDef('cannon') as WeaponDef).arc, 360));
  });
});

describe('firing past tall parts', () => {
  it('reports a target ahead of a gun behind the cab as blocked', () => {
    const w = emptyWorld();
    const me = truckWith(w, 'longbed', [{ defId: 'mg', x: 4, y: 8 }]);
    const ahead = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 45, y: 40 });
    const gun = vehicleStats(w, me).weapons[0];
    expect(inArc(me, gun, ahead)).toBe(false);
    expect(fireBlock(w, me, gun, ahead)).toBe('blocked');
  });

  it('lets the same gun fire at a target on its open flank', () => {
    const w = emptyWorld();
    const me = truckWith(w, 'longbed', [{ defId: 'mg', x: 4, y: 8 }]);
    const beside = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 40, y: 45 });
    const gun = vehicleStats(w, me).weapons[0];
    expect(inArc(me, gun, beside)).toBe(true);
  });
});

describe('span sides', () => {
  it('counts a side when the spans reach into its quarter, not when they only touch its edge', () => {
    expect(spanSides([{ from: -180, to: 180 }])).toEqual(['front', 'rear', 'left', 'right']);
    expect(spanSides([{ from: -135, to: 135 }])).toEqual(['front', 'left', 'right']);
    expect(spanSides([{ from: 45, to: 315 }])).toEqual(['rear', 'left', 'right']);
    expect(spanSides([{ from: -30, to: 30 }])).toEqual(['front']);
    expect(spanSides([{ from: 40, to: 50 }])).toEqual(['front', 'right']);
  });
});

describe('gun blockers', () => {
  it('names the cab as what blocks a bed gun', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 4, y: 8 }]);
    expect(gunBlockers(v, itemOf(v, 'mg')).map((b) => b.kind === 'part' && b.part.defId)).toEqual(['cabPickup']);
  });

  it('skips a tall part that stands only in the gun\'s blind spot', () => {
    const v = truckWith(emptyWorld(), 'longbed', [{ defId: 'shotgun', x: 5, y: 1 }]);
    expect(gunBlockers(v, itemOf(v, 'shotgun'))).toEqual([]);
  });
});

describe('gun layout', () => {
  // Score = covered sides * (360 * guns + 1) + open degrees summed.
  it('scores a bed gun turned away from the cab above the same gun facing the cab', () => {
    const facingCab = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 4, y: 8 }]);
    const facingAway = truckWith(emptyWorld(), 'longbed', [{ defId: 'mg', x: 4, y: 8, rot: 2 }]);
    expect(gunLayoutScore(facingAway)).toBe(3 * 361 + 270);
    expect(gunLayoutScore(facingCab)).toBeLessThan(gunLayoutScore(facingAway));
  });

  it('scores a cargo box behind two guns below a flat rack there', () => {
    const guns = [{ defId: 'mg', x: 2, y: 5 }, { defId: 'mg', x: 3, y: 5 }];
    const boxed = truckWith(emptyWorld(), 'hauler', [...guns, { defId: 'trailerBox', x: 2, y: 7 }]);
    const racked = truckWith(emptyWorld(), 'hauler', [...guns, { defId: 'rack', x: 2, y: 7 }]);
    expect(gunLayoutScore(boxed)).toBeLessThan(gunLayoutScore(racked));
  });

  it('a narrow-arc gun boxed in by the cab and a cargo box cannot fire while it faces them, and can once turned to a side or the rear', () => {
    const w = emptyWorld();
    const box = { defId: 'trailerBox', x: 1, y: 3 };
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 2, y: 5 }, box]))).toBe(false);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 2, y: 5, rot: 2 }, box]))).toBe(true);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 3, y: 8, rot: 2 }]))).toBe(true);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 3, y: 5, rot: 1 }]))).toBe(true);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 3, y: 5, rot: 3 }]))).toBe(true);
    expect(everyGunFires(truckWith(w, 'longbed', [{ defId: 'shotgun', x: 2, y: 1 }]))).toBe(true);
  });

});

describe('aimWithin', () => {
  const forward = [{ from: -30, to: 30 }];

  it('keeps a bearing inside the span or on its edge', () => {
    expect(aimWithin(forward, 10)).toBe(10);
    expect(aimWithin(forward, 30)).toBe(30);
    expect(aimWithin(forward, -30)).toBe(-30);
  });

  it('turns an outside bearing to the nearest edge, the first edge on a tie', () => {
    expect(aimWithin(forward, 31)).toBe(30);
    expect(aimWithin(forward, -100)).toBe(-30);
    expect(aimWithin(forward, 180)).toBe(-30);
  });

  it('matches a span through the rear on both sides of 180', () => {
    const rear = [{ from: 135, to: 225 }];
    expect(aimWithin(rear, 170)).toBe(170);
    expect(aimWithin(rear, -170)).toBe(-170);
    expect(aimWithin(rear, 90)).toBe(135);
    expect(aimWithin(rear, -90)).toBe(-135);
  });

  it('picks the nearer of two spans', () => {
    const flanks = [{ from: -135, to: -45 }, { from: 45, to: 135 }];
    expect(aimWithin(flanks, 60)).toBe(60);
    expect(aimWithin(flanks, -60)).toBe(-60);
    expect(aimWithin(flanks, 20)).toBe(45);
    expect(aimWithin(flanks, -20)).toBe(-45);
  });

  it('turns all the way round in a full circle', () => {
    const full = [{ from: -180, to: 180 }];
    for (const rel of [-180, -90, 0, 45, 135, 180]) expect(aimWithin(full, rel)).toBe(rel);
  });

  it('throws on no spans', () => {
    expect(() => aimWithin([], 0)).toThrow();
  });
});

describe('gun facing', () => {
  const gunAt = (defId: string, rot: Rot) => {
    const w = emptyWorld();
    const v = truckWith(w, 'hauler', [{ defId, x: 2, y: 5, rot }]);
    return { w, v, item: itemOf(v, defId) };
  };
  const spot = (v: Vehicle, dx: number, dy: number) => ({ x: v.pos.x + dx, y: v.pos.y + dy });

  it('measures the footprint of a part turned a half or three quarter turns like one turned none or one', () => {
    const part = makePart(emptyWorld(), 'shotgun', 0);
    const [w0, w1, w2, w3] = ([0, 1, 2, 3] as const).map((rot) => itemSize({ kind: 'part', part, rot }));
    expect(w2).toEqual(w0);
    expect(w3).toEqual(w1);
    expect(w1).toEqual({ w: w0.h, h: w0.w });
  });

  it('faces rot quarter turns clockwise from the front', () => {
    expect(([0, 1, 2, 3] as const).map((rot) => facingOf(gunAt('mg', rot).item))).toEqual([0, 90, 180, 270]);
  });

  it('centers the arc on the facing', () => {
    const bare = { ...truckWith(emptyWorld(), 'hauler', []), items: [] };
    const loose = (defId: string, rot: Rot): GridItem => ({ id: 'loose', x: 0, y: 0, rot, kind: 'part', part: makePart(emptyWorld(), defId, 0) });
    expect(gunSpans(bare, loose('shotgun', 2))).toEqual([{ from: 135, to: 225 }]);
    expect(gunSpans(bare, loose('shotgun', 1))).toEqual([{ from: 45, to: 135 }]);
    expect(gunSpans(bare, loose('mg', 2))).toEqual([{ from: 45, to: 315 }]);
    expect(spanSides(gunSpans(bare, loose('mg', 1)))).toEqual(['front', 'rear', 'right']);
    expect(spanSides(gunSpans(bare, loose('shotgun', 3)))).toEqual(['left']);
    expect(spanSides(gunSpans(bare, loose('heavyMg', 3)))).toEqual(['front', 'rear', 'left']);
  });

  it('hits a target behind with a rear-facing gun and misses one in front', () => {
    const { w, v } = gunAt('mg', 2);
    const behind = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], spot(v, -5, 0));
    const ahead = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], spot(v, 5, 0));
    const gun = vehicleStats(w, v).weapons[0];
    expect(inArc(v, gun, behind)).toBe(true);
    expect(inArc(v, gun, ahead)).toBe(false);
    expect(fireBlock(w, v, gun, ahead)).not.toBeNull();
  });

  it('turns the arc with the truck', () => {
    const { w, v } = gunAt('shotgun', 2);
    const east = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], spot(v, 5, 0));
    const gun = vehicleStats(w, v).weapons[0];
    expect(inArc(v, gun, east)).toBe(false);
    v.heading = Math.PI;
    expect(inArc(v, gun, east)).toBe(true);
  });

  it('keeps a 90 degree gun facing the rear from reaching a target ahead or on its flank', () => {
    const { w, v } = gunAt('shotgun', 2);
    const gun = vehicleStats(w, v).weapons[0];
    const flank = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], spot(v, 0, 5));
    const behind = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], spot(v, -5, 0));
    expect(inArc(v, gun, flank)).toBe(false);
    expect(inArc(v, gun, behind)).toBe(true);
  });
});
