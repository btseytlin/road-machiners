import { describe, expect, it } from 'vitest';
import { GAME_MODES } from '../data/modes';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { defaultSetup, modeKit, modeRules } from './settings';
import { newWorld } from './world';
import type { World } from './types';

function fingerprint(w: World): object {
  return {
    streams: [w.rngState, w.marketRng.rngState, w.nameRng.rngState, w.searchRng.rngState],
    nextId: w.nextId,
    counts: [w.vehicles.length, w.obstacles.length, w.salvage.length, Object.keys(w.shops).length],
    npcs: w.vehicles.slice(1, 4).map((v) => [v.brain?.templateId, Math.round(v.pos.x * 100) / 100, Math.round(v.pos.y * 100) / 100]),
    bowlStock: w.shops.bowl.stock.map((p) => p.defId),
  };
}

describe('game mode rules', () => {
  it('keeps every Roaming rule on', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    expect(Object.values(modeRules(world)).every((on) => on)).toBe(true);
  });

  it('turns every open-world rule off in a Gauntlet world', () => {
    const world = newWorld(7, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));

    expect(Object.values(modeRules(world)).some((on) => on)).toBe(false);
  });

  it('throws on a mode that is not a game mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    world.setup = { ...world.setup, mode: 'fury' as never };

    expect(() => modeRules(world)).toThrow(/Unknown game mode fury/);
  });

  it('gives Roaming the configured kit and Gauntlet its own', () => {
    expect(modeKit('roaming', 'standard')).toBe('standard');
    expect(modeKit('gauntlet', 'standard')).toBe('gauntlet');
    expect(GAME_MODES.gauntlet.name).toBe('Gauntlet');
  });
});

describe('a new world by mode', () => {
  it('builds a Roaming world exactly as before the Gauntlet mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    expect(world.gauntlet).toBeNull();
    expect(fingerprint(world)).toEqual({
      streams: [440598765, 2109351013, 1468231572, 1936023925],
      nextId: 971,
      counts: [22, 3717, 110, 5],
      npcs: [['buggy', 322.32, 389.12], ['buggy', 115.02, 75.38], ['buggy', 119.05, 80.22]],
      bowlStock: ['harpoon', 'smokeMortar', 'mg', 'smokeMortar', 'recoilless', 'spacedArmor', 'trailerBox', 'heavyFrame', 'rack', 'longRifle', 'sprout', 'patcherCrane'],
    });
  });

  it('starts a Gauntlet world with no traffic, salvage, shops or road wrecks', () => {
    const world = newWorld(7, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));

    expect(world.vehicles.map((v) => v.faction)).toEqual(['player']);
    expect(world.salvage).toEqual([]);
    expect(world.shops).toEqual({});
    expect(world.obstacles.some((o) => /^wreck\d+$/.test(o.id))).toBe(false);
    expect(world.gauntlet?.stretch).toBe(0);
  });

  it('gives the Gauntlet player the Gauntlet kit with no opening', () => {
    const world = newWorld(7, startKit('gauntlet'), TEST_MAP, defaultSetup('gauntlet'));

    expect(world.player.money).toBe(20000);
    expect(world.player.autoRepair).toBe(true);
    expect(world.vehicles[0].items.filter((it) => it.kind === 'good' && it.good === 'parts')).toHaveLength(4);
  });
});
