import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { GOOD_IDS } from '../data/goods';
import { PARTS, type PartKind } from '../data/parts';
import type { PartInstance } from '../sim/types';
import { maxHp } from '../sim/wear';
import {
  BODY_PARTS, itemTone, JAG_MAX, JAG_THIN, PART_MODELS, WEAPON_POOLS, WEAR_LOOK_STEPS, WORN_GRAY, baseModel, breakSignature, grayShare, grayed, jagOffset, partModel,
  weaponLook, wearLookStep, type ItemTone,
} from './partLooks';

const weaponIds = Object.values(PARTS).filter((d) => d.kind === 'weapon').map((d) => d.id);
const otherIds = Object.values(PARTS).filter((d) => d.kind !== 'weapon' && !BODY_PARTS.has(d.id)).map((d) => d.id);

describe('part looks', () => {
  it('gives every non-weapon part def and every good a model, except parts the body draws', () => {
    for (const id of [...otherIds, ...GOOD_IDS]) expect(() => partModel(id), id).not.toThrow();
    expect(Object.keys(PART_MODELS).sort()).toEqual([...otherIds, ...GOOD_IDS].sort());
  });

  it('gives every weapon def a pool with a model in each required slot', () => {
    expect(Object.keys(WEAPON_POOLS).sort()).toEqual([...weaponIds].sort());
    for (const id of weaponIds) {
      const pool = WEAPON_POOLS[id];
      expect(pool.mount.length, id).toBeGreaterThan(0);
      expect(pool.receiver.length, id).toBeGreaterThan(0);
      expect(pool.barrel.length, id).toBeGreaterThan(0);
    }
  });

  it('gives every chassis a base model', () => {
    for (const id of Object.keys(CHASSIS)) expect(baseModel(id), id).toBe(`base_${id}`);
    expect(() => baseModel('nope')).toThrow();
  });

  it('throws on an unknown id', () => {
    expect(() => partModel('nope')).toThrow();
    expect(() => partModel('mg')).toThrow();
    expect(() => partModel('cab')).toThrow();
    expect(() => weaponLook('p1', 'nope')).toThrow();
  });

  it('gives one part id the same weapon look every time', () => {
    for (const id of weaponIds) expect(weaponLook('part-17', id)).toEqual(weaponLook('part-17', id));
  });

  it('picks every slot from the def pool', () => {
    for (const id of weaponIds) {
      const pool = WEAPON_POOLS[id];
      for (let i = 0; i < 20; i++) {
        const look = weaponLook(`p${i}`, id);
        expect(pool.mount).toContain(look.mount);
        expect(pool.receiver).toContain(look.receiver);
        expect(pool.barrel).toContain(look.barrel);
        if (pool.extra.length === 0) expect(look.extra).toBeNull();
        else expect(pool.extra).toContain(look.extra);
      }
    }
  });

  it('gives 50 ids more than one look for a weapon with larger pools', () => {
    const looks = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(weaponLook(`p${i}`, 'mg'))));
    expect(looks.size).toBeGreaterThan(1);
  });
});

function part(hp: number, wear = 0): PartInstance {
  return { id: 'p1', defId: 'wheel', hp, wear };
}

describe('wearLookStep', () => {
  it('is 0 at full HP and the last step only at 0 HP', () => {
    const p = part(0);
    p.hp = maxHp(p);
    expect(wearLookStep(p)).toBe(0);
    p.hp = 1;
    expect(wearLookStep(p)).toBe(WEAR_LOOK_STEPS - 1);
    p.hp = 0;
    expect(wearLookStep(p)).toBe(WEAR_LOOK_STEPS);
  });

  it('never drops as HP drops, against a worn max HP', () => {
    for (const wear of [0, 1, 2]) {
      const p = part(0, wear);
      const max = maxHp(p);
      let last = -1;
      for (let hp = max; hp >= 0; hp--) {
        p.hp = hp;
        const step = wearLookStep(p);
        expect(step).toBeGreaterThanOrEqual(last);
        last = step;
      }
      p.hp = max;
      expect(wearLookStep(p)).toBe(0);
    }
  });

  it('throws on a zero max HP', () => {
    expect(() => wearLookStep({ ...part(0), defId: 'wheel', wear: 1000 })).toThrow();
  });
});

describe('grayed', () => {
  const dist = (hex: number): number =>
    [16, 8, 0].reduce((sum, sh) => sum + Math.abs(((hex >> sh) & 255) - ((WORN_GRAY >> sh) & 255)), 0);
  it('returns the color at share 0 and WORN_GRAY at share 1', () => {
    for (const hex of [0xff0000, 0x000000, 0xffffff]) {
      expect(grayed(hex, 0)).toBe(hex);
      expect(grayed(hex, 1)).toBe(WORN_GRAY);
    }
  });
  it('never moves away from WORN_GRAY as the share grows', () => {
    for (const hex of [0xff0000, 0x000000, 0xffffff]) {
      let last = Infinity;
      for (const share of [0, 0.25, 0.5, 0.75, 1]) {
        const d = dist(grayed(hex, share));
        expect(d).toBeLessThanOrEqual(last);
        last = d;
      }
    }
    expect(grayShare(0)).toBe(0);
    expect(grayShare(WEAR_LOOK_STEPS)).toBeGreaterThan(grayShare(1));
  });
});

describe('jagOffset', () => {
  const thick = 1;
  it('is zero at step 0 and deterministic', () => {
    expect(jagOffset('a', 1, 2, 3, 0, thick)).toEqual({ x: 0, y: 0, z: 0 });
    expect(jagOffset('a', 1, 2, 3, 2, thick)).toEqual(jagOffset('a', 1, 2, 3, 2, thick));
  });
  it('is equal for points within the weld distance', () => {
    expect(jagOffset('a', 1, 2, 3, 2, thick)).toEqual(jagOffset('a', 1.0001, 2.0001, 3.0001, 2, thick));
  });
  it('grows with the step and stays within the max', () => {
    const lo = jagOffset('a', 1, 2, 3, 1, thick);
    const hi = jagOffset('a', 1, 2, 3, WEAR_LOOK_STEPS, thick);
    expect(Math.abs(hi.x)).toBeCloseTo(Math.abs(lo.x) * WEAR_LOOK_STEPS, 6);
    expect(Math.abs(hi.x)).toBeLessThanOrEqual(JAG_MAX);
    expect(jagOffset('b', 1, 2, 3, 2, thick)).not.toEqual(jagOffset('a', 1, 2, 3, 2, thick));
  });
  it('gives a thin model a smaller offset that still grows with the step', () => {
    const thin = 0.02;
    const bound = (step: number): number => (Math.min(JAG_MAX, JAG_THIN * thin) * step) / WEAR_LOOK_STEPS;
    for (let step = 1; step <= WEAR_LOOK_STEPS; step++) {
      const d = jagOffset('a', 1, 2, 3, step, thin);
      for (const v of [d.x, d.y, d.z]) expect(Math.abs(v)).toBeLessThanOrEqual(bound(step) + 1e-12);
    }
    const thinHi = jagOffset('a', 1, 2, 3, WEAR_LOOK_STEPS, thin);
    const thickHi = jagOffset('a', 1, 2, 3, WEAR_LOOK_STEPS, thick);
    expect(Math.abs(thinHi.x)).toBeLessThan(Math.abs(thickHi.x));
    expect(Math.abs(jagOffset('a', 1, 2, 3, WEAR_LOOK_STEPS, thin).x)).toBeGreaterThan(
      Math.abs(jagOffset('a', 1, 2, 3, 1, thin).x),
    );
  });
});

describe('breakSignature', () => {
  it('follows the part kind', () => {
    for (const def of Object.values(PARTS)) {
      const sig = breakSignature(def);
      if (def.kind === 'weapon') expect(sig).toBe('ammo');
      else if (def.kind === 'core' && def.role === 'wheel') expect(sig).toBe('air');
      else if (def.kind === 'core' && def.role === 'tank') expect(sig).toBe('fire');
      else if (def.kind === 'store' && def.holds === 'fuel') expect(sig).toBe('fire');
      else expect(sig).toBeNull();
    }
    expect(breakSignature(PARTS.jerrycans)).toBe('fire');
  });
});

const KIND_TONES: Record<PartKind, ItemTone> = {
  weapon: 'weapon',
  armor: 'armor',
  cargo: 'cargo',
  engine: 'other',
  core: 'other',
  scanner: 'other',
  store: 'other',
};

describe('item tones', () => {
  it.each(Object.values(PARTS).map((d) => [d.id, d.kind] as const))('give part %s (%s) its kind tone', (id, kind) => {
    expect(itemTone(id)).toBe(KIND_TONES[kind]);
  });

  it('give every good the cargo tone', () => {
    expect(GOOD_IDS.map(itemTone)).toEqual(GOOD_IDS.map(() => 'cargo'));
  });

  it('give built-in body parts the other tone', () => {
    expect([...BODY_PARTS].map(itemTone)).toEqual([...BODY_PARTS].map(() => 'other'));
  });

  it('fail on an id that is neither a part nor a good', () => {
    expect(() => itemTone('noSuchThing')).toThrow(/noSuchThing/);
  });
});
