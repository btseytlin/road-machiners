import { describe, expect, it } from 'vitest';
import { DETECT } from '../../data/detect';
import { PHYSICS } from '../../data/physics';
import { flatTerrain } from '../../sim/testkit';
import type { DustCloud, World } from '../../sim/types';
import type { Card, FxCards } from './particles/cards';
import { DUST_LOOK, DustCloudsView, puffsPerCloud } from './dust';

const S = PHYSICS.metersPerTile;

function cloud(id: string, source: string, age = 0): DustCloud {
  return { id, source, pos: { x: 10, y: 10 }, vel: { x: 1, y: 0 }, age, range: 5 };
}

function worldOf(clouds: DustCloud[], seen: string[]): World {
  return { turn: 1, terrain: flatTerrain(32), dustClouds: clouds, player: { vehicleId: 'me', clouds: seen } } as unknown as World;
}

function drawn(view: DustCloudsView): Card[] {
  const out: Card[] = [];
  view.draw({ lit: { push: (c: Card) => out.push(c) } } as unknown as FxCards);
  return out;
}

describe('DustCloudsView', () => {
  it('draws only the clouds the player sees and the player own clouds', () => {
    const view = new DustCloudsView();
    const clouds = [cloud('a', 'npc'), cloud('b', 'npc'), cloud('c', 'me')];
    view.update(worldOf(clouds, ['a']), flatTerrain(32), 0);
    expect(drawn(view)).toHaveLength(2 * DUST_LOOK.puffs);
  });

  it('glides a cloud along its velocity over the glide time', () => {
    const view = new DustCloudsView();
    const world = worldOf([cloud('a', 'npc')], ['a']);
    view.update(world, flatTerrain(32), 0);
    const before = drawn(view).reduce((s, c) => s + c.x, 0) / DUST_LOOK.puffs;
    view.update(world, flatTerrain(32), DUST_LOOK.glideSeconds * 1000);
    const after = drawn(view).reduce((s, c) => s + c.x, 0) / DUST_LOOK.puffs;
    expect(after - before).toBeCloseTo(S, 0);
  });

  it('rises with age and fades out at the end of its life', () => {
    const view = new DustCloudsView();
    view.update(worldOf([cloud('a', 'npc', 1)], ['a']), flatTerrain(32), 0);
    const young = drawn(view);
    view.update(worldOf([cloud('a', 'npc', DETECT.dust.lifetime - 0.1)], ['a']), flatTerrain(32), 0);
    const old = drawn(view);
    expect(Math.max(...old.map((c) => c.y))).toBeGreaterThan(Math.max(...young.map((c) => c.y)));
    expect(Math.max(...old.map((c) => c.alpha))).toBeLessThan(Math.max(...young.map((c) => c.alpha)));
  });

  it('never pushes more cards than the budget', () => {
    const view = new DustCloudsView();
    const many = Array.from({ length: 3000 }, (_, i) => cloud(`c${i}`, 'me'));
    view.update(worldOf(many, []), flatTerrain(32), 0);
    const cards = drawn(view);
    expect(cards.length).toBeLessThanOrEqual(DUST_LOOK.maxCards);
    expect(cards.length).toBeGreaterThan(0);
  });

  it('shrinks puffs per cloud as clouds crowd the budget', () => {
    expect(puffsPerCloud(1)).toBe(DUST_LOOK.puffs);
    expect(puffsPerCloud(DUST_LOOK.maxCards / 2)).toBe(2);
    expect(puffsPerCloud(0)).toBe(0);
  });
});
