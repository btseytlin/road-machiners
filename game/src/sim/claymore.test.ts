import { describe, expect, it } from 'vitest';
import { CLAYMORE } from '../data/utilities';
import type { Side } from './armor';
import { settleClaymores } from './claymore';
import { isHostile, turnPartHits } from './combat';
import { applyContactCrash, type CrashGeometry } from './crash-contact';
import { mountedParts, sideOf } from './grid';
import { stowSpot } from './inventory';
import { addState } from './states';
import { makePart } from './factory';
import { addVehicle, emptyWorld } from './testkit';
import type { PartInstance, Vehicle, World } from './types';
import { activateUtilities, tickCharges, utilityOrderError } from './utility';

const SIDE: Record<string, Side> = { F: 'front', B: 'rear', L: 'left', R: 'right' };

// A trader truck with a claymore ram, and a second trader truck it can crash into. Neither is hostile to the other.
function setup(): { w: World; user: Vehicle; other: Vehicle; claymore: PartInstance; side: Side } {
  const w = emptyWorld();
  const user = addVehicle(w, 'traders', 'hauler', ['stockEngine', 'claymoreRam'], { x: 40, y: 30 });
  const other = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 43, y: 30 });
  const claymore = mountedParts(user).find((p) => p.defId === 'claymoreRam');
  if (!claymore) throw new Error('The claymore ram did not mount');
  const letter = sideOf(user, claymore);
  if (!letter) throw new Error('The claymore ram covers no side');
  return { w, user, other, claymore, side: SIDE[letter] };
}

function arm(w: World, user: Vehicle, claymore: PartInstance): void {
  user.utilityOrders[claymore.id] = { kind: 'self' };
  activateUtilities(w);
}

// The user's side touches the other truck's left side.
function hit(side: Side): CrashGeometry {
  return { a: { side, lanes: [0, 1] }, b: { side: 'left', lanes: [0, 1] } };
}

const blasts = (w: World) => w.events.filter((e) => e.t === 'claymore');
const hpOf = (v: Vehicle) => mountedParts(v).reduce((sum, p) => sum + p.hp, 0);

describe('arming a claymore ram', () => {
  it('arms on a self order, without starting the reload or any hostility', () => {
    const { w, user, other, claymore } = setup();

    arm(w, user, claymore);

    expect(claymore.charge).toEqual({ reload: 0, armed: true });
    expect(isHostile(w, other, user)).toBe(false);
  });

  it('stays armed across turns', () => {
    const { w, user, claymore } = setup();
    arm(w, user, claymore);

    tickCharges(w);
    settleClaymores(w);

    expect(claymore.charge).toEqual({ reload: 0, armed: true });
  });

  it('refuses to arm an armed, broken or recharging claymore, with a reason', () => {
    const { w, user, claymore } = setup();
    arm(w, user, claymore);

    expect(utilityOrderError(w, user, claymore.id, { kind: 'self' })).toMatch(/armed/);
    claymore.charge = { reload: 0 };
    claymore.hp = 0;
    expect(utilityOrderError(w, user, claymore.id, { kind: 'self' })).toMatch(/disabled/);
    claymore.hp = 80;
    claymore.charge = { reload: 3 };
    expect(utilityOrderError(w, user, claymore.id, { kind: 'self' })).toMatch(/cooldown/);
  });
});

describe('claymore detonation', () => {
  it('needs arming', () => {
    const { w, user, other, claymore, side } = setup();

    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0 });
  });

  it('does not detonate in a crash below the threshold and keeps the charge', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, 2.9, hit(side));

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0, armed: true });
  });

  it('detonates in a crash at the threshold on its side, hurts both trucks past the crash and starts the reload', () => {
    const plain = setup();
    applyContactCrash(plain.w, plain.user, plain.other, plain.other.id, CLAYMORE.minImpact, hit(plain.side));
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    const [blast] = blasts(w);
    expect(blast).toMatchObject({ vehicle: user.id, other: other.id });
    expect(hpOf(other)).toBeLessThan(hpOf(plain.other));
    expect(hpOf(user)).toBeLessThan(hpOf(plain.user));
    expect(claymore.charge).toEqual({ reload: CLAYMORE.reload });
  });

  it("counts the blast in each truck's part hits of the turn", () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    const [blast] = blasts(w);
    if (blast?.t !== 'claymore') throw new Error('No blast');
    expect(blast.hits.length).toBeGreaterThan(0);
    expect(blast.selfHits.length).toBeGreaterThan(0);
    expect(turnPartHits(w).get(other.id)).toEqual(expect.arrayContaining(blast.hits));
    expect(turnPartHits(w).get(user.id)).toEqual(expect.arrayContaining(blast.selfHits));
  });

  it('logs the blast after the crash it came from', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    expect(w.events.map((e) => e.t).filter((t) => t === 'collision' || t === 'claymore')).toEqual(['collision', 'claymore']);
  });

  it('detonates on its side when the other truck drove into it', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, other, user, user.id, 4, { a: { side: 'left', lanes: [0, 1] }, b: { side, lanes: [0, 1] } });

    expect(blasts(w)).toHaveLength(1);
  });

  it('keeps the charge in a crash on another side', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, 6, hit(side === 'rear' ? 'front' : 'rear'));

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0, armed: true });
  });

  it('blows against an obstacle on its side, hurting only its own truck, and starts the reload', () => {
    const { w, user, claymore, side } = setup();
    w.obstacles = [{ id: 'rock1', pos: { x: 42, y: 30 }, r: 0.8, kind: 'rock' }];
    arm(w, user, claymore);
    const hp = hpOf(user);

    applyContactCrash(w, user, null, 'rock1', CLAYMORE.minImpact, { a: { side, lanes: [0, 1] }, b: null });

    expect(blasts(w)).toMatchObject([{ vehicle: user.id, other: 'rock1', hits: [] }]);
    expect(blasts(w)[0]).toHaveProperty('selfHits', expect.arrayContaining([expect.objectContaining({ part: expect.any(String) })]));
    expect(hpOf(user)).toBeLessThan(hp);
    expect(claymore.charge?.armed).toBeUndefined();
    expect(claymore.charge?.reload).toBeGreaterThan(0);
    expect(w.obstacles.map((o) => o.id)).toEqual(['rock1']);
  });

  it('keeps the charge against an obstacle below the threshold, on another side, or at a rail or the map edge', () => {
    const { w, user, claymore, side } = setup();
    w.obstacles = [{ id: 'rock1', pos: { x: 42, y: 30 }, r: 0.8, kind: 'rock' }];
    arm(w, user, claymore);

    applyContactCrash(w, user, null, 'rock1', 2.9, { a: { side, lanes: [0, 1] }, b: null });
    applyContactCrash(w, user, null, 'rock1', 6, { a: { side: side === 'rear' ? 'front' : 'rear', lanes: [0, 1] }, b: null });
    applyContactCrash(w, user, null, 'rail', 6, { a: { side, lanes: [0, 1] }, b: null });
    applyContactCrash(w, user, null, 'edge', 6, { a: { side, lanes: [0, 1] }, b: null });

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0, armed: true });
  });

  it('never detonates in a crash between a tower and the truck it tows', () => {
    const { w, user, other, claymore, side } = setup();
    addState(w, 'tow', user.id, other.id, { kind: 'tow', site: 'bowl', fee: 10, waived: 0, hitched: false });
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, 6, hit(side));

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0, armed: true });
  });

  it('detonates at most once per arming', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, 5, hit(side));
    applyContactCrash(w, user, other, other.id, 5, hit(side));

    expect(blasts(w)).toHaveLength(1);
  });

  it('gives the user kill credit and makes the blast a hostile act, while the self damage is owned by nobody', () => {
    const { w, user, other, claymore, side } = setup();
    other.lastHitBy = 'someone';
    arm(w, user, claymore);

    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    expect(other.lastHitBy).toBe(user.id);
    expect(isHostile(w, other, user)).toBe(true);
    expect(user.lastHitBy).not.toBe(user.id);
  });

  it('re-arms only after the reload has counted down', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);
    applyContactCrash(w, user, other, other.id, CLAYMORE.minImpact, hit(side));

    for (let i = 0; i < CLAYMORE.reload - 1; i++) tickCharges(w);
    expect(utilityOrderError(w, user, claymore.id, { kind: 'self' })).toMatch(/cooldown/);
    tickCharges(w);
    expect(utilityOrderError(w, user, claymore.id, { kind: 'self' })).toBeNull();
  });
});

describe('disarming a claymore ram', () => {
  it('disarms a broken claymore, which then never detonates', () => {
    const { w, user, other, claymore, side } = setup();
    arm(w, user, claymore);
    claymore.hp = 0;

    applyContactCrash(w, user, other, other.id, 5, hit(side));
    settleClaymores(w);

    expect(blasts(w)).toEqual([]);
    expect(claymore.charge).toEqual({ reload: 0 });
  });

  it('disarms a claymore taken off its mount', () => {
    const { w, user, claymore } = setup();
    arm(w, user, claymore);
    const item = user.items.find((it) => it.kind === 'part' && it.part.id === claymore.id);
    if (!item) throw new Error('No claymore item');
    const spot = stowSpot(user, item);
    if (!spot) throw new Error('No storage room');
    Object.assign(item, spot);

    settleClaymores(w);

    expect(claymore.charge).toEqual({ reload: 0 });
  });

  it('disarms a claymore that left the truck for storage or a salvage stock', () => {
    const { w } = setup();
    const stored = makePart(w, 'claymoreRam', 0);
    const looted = makePart(w, 'claymoreRam', 0);
    stored.charge = { reload: 0, armed: true };
    looted.charge = { reload: 0, armed: true };
    w.player.storage.push(stored);
    w.salvage.push({ id: 'pile-1', pos: { x: 50, y: 30 }, radius: 1, goods: {}, parts: [looted], hidden: { goods: {}, parts: [], fuel: 0, supplies: 0 } });

    settleClaymores(w);

    expect([stored.charge, looted.charge]).toEqual([{ reload: 0 }, { reload: 0 }]);
  });
});
