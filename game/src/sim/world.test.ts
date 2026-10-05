import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../data/chassis';
import { START_KITS } from '../data/start';
import { TEST_MAP } from '../test/map';
import { playerVehicle } from './damage';
import { townAt } from './sites';
import { dist } from './vec';
import { endTurn, newWorld, setOverdrive, startPose, townStart, update } from './world';
import { partDef } from '../data/parts';
import { RULES } from '../data/rules';
import { ENGINE_HEAT } from '../data/wear';
import { damagePartTo, repairAll } from './cheats';
import { advanceEngineHeat } from './engine-heat';
import { mountedParts } from './grid';
import { canOverdrive, vehicleStats } from './stats';
import { emptyWorld } from './testkit';
import type { World } from './types';

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

describe('the overdrive cutoff', () => {
  const CUT = 'Overdrive cut out: the engine is too worn.';
  const cutEvents = (w: World) => w.events.filter((e) => e.t === 'info' && e.text === CUT).length;
  const engineOf = (w: World) => mountedParts(playerVehicle(w), 'engine')[0];

  function overdriving(hp: number): World {
    const w = emptyWorld();
    w.player.overdrive = true;
    engineOf(w).hp = hp;
    return w;
  }

  it('switches overdrive off when other damage takes the engine to 15%', () => {
    const w = overdriving(stockHp());
    const engine = engineOf(w);
    const next = damagePartTo(w, engine.defId, Math.floor(RULES.overdriveMinEngineShare * stockHp()));
    expect(next.player.overdrive).toBe(false);
    expect(cutEvents(next)).toBe(1);
    expect(cutEvents(update(next, () => {}))).toBe(0);
  });

  it('switches overdrive off when heat damage takes the engine to 15%, with no boost or overdrive heat after', () => {
    const limit = RULES.overdriveMinEngineShare * stockHp();
    const w = overdriving(Math.floor(limit) + ENGINE_HEAT.overheatDamage);
    w.player.engineHeat = 1;
    const next = endTurn(w, (d) => {
      const me = playerVehicle(d);
      me.speed = vehicleStats(d, me).maxSpeed;
      me.trail = [{ x: me.pos.x - 1, y: me.pos.y, heading: 0 }, { ...me.pos, heading: 0 }];
    });
    expect(engineOf(next).hp).toBeLessThanOrEqual(limit);
    expect(next.player.overdrive).toBe(false);
    expect(cutEvents(next)).toBe(1);

    const me = playerVehicle(next);
    const plain = { ...next, player: { ...next.player, overdrive: false } };
    expect(vehicleStats(next, me).maxSpeed).toBe(vehicleStats(plain, me).maxSpeed);
    const cooler = structuredClone(next);
    cooler.player.engineHeat = 0.5;
    playerVehicle(cooler).speed = vehicleStats(cooler, playerVehicle(cooler)).maxSpeed;
    const flagged = structuredClone(cooler);
    flagged.player.overdrive = true;
    advanceEngineHeat(cooler);
    advanceEngineHeat(flagged);
    expect(flagged.player.engineHeat).toBe(cooler.player.engineHeat);
  });

  it('refuses to switch overdrive on while the engine is too worn', () => {
    const w = emptyWorld();
    engineOf(w).hp = Math.floor(RULES.overdriveMinEngineShare * stockHp());
    expect(() => setOverdrive(w, true)).toThrow(/overdrive/i);
    expect(setOverdrive(w, false).player.overdrive).toBe(false);
  });

  it('leaves overdrive off after a repair, and allows it again by hand', () => {
    const cut = damagePartTo(overdriving(stockHp()), engineOf(emptyWorld()).defId, 1);
    const fixed = repairAll(cut);
    expect(canOverdrive(playerVehicle(fixed))).toBe(true);
    expect(fixed.player.overdrive).toBe(false);
    expect(setOverdrive(fixed, true).player.overdrive).toBe(true);
  });

  it('logs nothing for a worn engine with overdrive already off', () => {
    const w = emptyWorld();
    engineOf(w).hp = 1;
    expect(cutEvents(update(w, () => {}))).toBe(0);
  });
});

function stockHp(): number {
  return partDef('stockEngine').hp;
}
