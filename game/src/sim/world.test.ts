import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { townAt } from './sites';
import { vehicleStats } from './stats';
import { RULES } from '../data/rules';
import { dist } from './vec';
import { isAtRest, newWorld, startPose, townStart } from './world';

describe('townStart', () => {
  it('parks every chassis on a town pad with no vehicle on top of it', () => {
    for (const chassis of Object.keys(CHASSIS)) {
      const kit = { ...START_KITS.standard, chassis, parts: [], cargo: {}, storage: [] };
      const world = newWorld(7, kit, TEST_MAP, true, townStart());
      const truck = playerVehicle(world);
      expect(townAt(world), chassis).not.toBeNull();
      for (const v of world.vehicles.filter((o) => o !== truck)) {
        expect(dist(v.pos, truck.pos), `${chassis} and ${v.id}`).toBeGreaterThan(vehicleStats(world, truck).radius);
      }
    }
  });

  it('leaves the default start where the new game puts it', () => {
    const world = newWorld(7, START_KITS.standard, TEST_MAP, false);
    expect(playerVehicle(world).pos).toEqual(startPose().pos);
  });
});

describe('isAtRest', () => {
  const truck = () => playerVehicle(newWorld(7, START_KITS.standard, TEST_MAP, false));
  const slow = RULES.parkedSpeed / 2;
  const fast = RULES.parkedSpeed * 2;

  it('is true when slow with no order or a brake order', () => {
    expect(isAtRest({ ...truck(), speed: slow, order: null })).toBe(true);
    expect(isAtRest({ ...truck(), speed: slow, order: { kind: 'brake' } })).toBe(true);
  });

  it('is false with a move order even at speed 0', () => {
    expect(isAtRest({ ...truck(), speed: 0, order: { kind: 'through', dest: { x: 1, y: 1 } } })).toBe(false);
  });

  it('is false when faster than parked speed even while braking', () => {
    expect(isAtRest({ ...truck(), speed: fast, order: { kind: 'brake' } })).toBe(false);
  });
});
