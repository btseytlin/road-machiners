import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { START_KITS } from '../data/start';
import { TIME } from '../data/time';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { townAt } from './sites';
import { vehicleStats } from './stats';
import { RULES } from '../data/rules';
import { sunAt } from './sun';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import type { World } from './types';
import { dist } from './vec';
import { endTurn, isAtRest, newWorld, setHeadlights, startPose, townStart, update } from './world';

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

  it('keeps the events and removed vehicles of the turn being shown', () => {
    const world = emptyWorld();
    const gone = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 60, y: 30 });
    world.vehicles = world.vehicles.filter((v) => v !== gone);
    world.removed = [gone];
    world.events = [{ t: 'destroyed', vehicle: gone.id, by: world.player.vehicleId }];

    const next = setHeadlights(world, true);

    expect(next.events).toEqual(world.events);
    expect(next.removed).toEqual(world.removed);
  });

  it('changes no turn result at night with NPCs about', () => {
    const night = update(emptyWorld({ x: 100, y: 100 }), (w) => {
      w.turn = duskTurn + 2;
      const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 125, y: 100 });
      raider.brain = npcBrain('buggy', raider.pos, ['raider']);
      const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 100, y: 130 });
      trader.brain = npcBrain('trader', trader.pos, ['trader']);
    });
    expect(sunAt(night.turn)).toBeNull();
    const play = (world: World): World[] => {
      const seen = [world];
      for (let k = 0; k < 4; k++) seen.push(endTurn(seen.at(-1)!, testDrive));
      return seen.slice(1);
    };

    const dark = play(night);
    const lit = play(setHeadlights(night, true));

    expect(dark.at(-1)!.player.contacts.length).toBeGreaterThan(0);
    expect(lit.map((w) => ({ ...w, player: { ...w.player, headlights: false } }))).toEqual(dark);
  });
});
