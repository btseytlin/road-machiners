import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { START_KITS } from '../data/start';
import { TIME } from '../data/time';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { townAt } from './sites';
import { vehicleStats } from './stats';
import { sunAt } from './sun';
import { emptyWorld, testDrive } from './testkit';
import type { World } from './types';
import { dist } from './vec';
import { endTurn, newWorld, setHeadlights, startPose, townStart, update } from './world';

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

describe('the headlight switch', () => {
  const duskTurn = Math.ceil(((TIME.sunset - TIME.startHour) * TIME.turnsPerDay) / 24) + 1;
  const playAcrossDusk = (world: World): World[] => {
    const seen: World[] = [];
    let w = update(world, (d) => {
      d.turn = duskTurn - 4;
    });
    for (let k = 0; k < 8; k++) {
      w = endTurn(w, testDrive);
      seen.push(w);
    }
    return seen;
  };

  it('starts off in a new game', () => {
    expect(newWorld(7, START_KITS.standard, TEST_MAP, false).player.headlights).toBe(false);
  });

  it('switches through setHeadlights into a new world', () => {
    const world = emptyWorld();
    const next = setHeadlights(world, true);

    expect(next.player.headlights).toBe(true);
    expect(next).not.toBe(world);
    expect(world.player.headlights).toBe(false);
  });

  it('holds its setting through dusk either way', () => {
    const seen = playAcrossDusk(emptyWorld());
    expect(sunAt(seen[0].turn)).not.toBeNull();
    expect(sunAt(seen.at(-1)!.turn)).toBeNull();

    expect(seen.map((w) => w.player.headlights)).toEqual(seen.map(() => false));
    const lit = playAcrossDusk(setHeadlights(emptyWorld(), true));
    expect(lit.map((w) => w.player.headlights)).toEqual(lit.map(() => true));
  });

  it('changes no sight, detection, fuel or heat rule', () => {
    const world = emptyWorld();
    const dark = endTurn(world, testDrive);
    const lit = endTurn(setHeadlights(world, true), testDrive);

    expect(lit.player.visible).toEqual(dark.player.visible);
    expect(lit.player.contacts).toEqual(dark.player.contacts);
    expect(lit.player.fuel).toBe(dark.player.fuel);
    expect(lit.player.engineHeat).toBe(dark.player.engineHeat);
  });
});
