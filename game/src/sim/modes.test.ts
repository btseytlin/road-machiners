import { describe, expect, it } from 'vitest';
import { GAME_MODES } from '../data/modes';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { defaultSetup, modeKit, modeRules } from './settings';
import { highwayMap } from './highway';
import { furyRoadWorld } from './testkit';
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

  it('turns every open-world rule off in a Fury Road world', () => {
    const world = furyRoadWorld(7);

    expect(Object.values(modeRules(world)).some((on) => on)).toBe(false);
  });

  it('throws on a mode that is not a game mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    world.setup = { ...world.setup, mode: 'fury' as never };

    expect(() => modeRules(world)).toThrow(/Unknown game mode fury/);
  });

  it('gives Roaming the configured kit and Fury Road its own', () => {
    expect(modeKit('roaming', 'standard')).toBe('standard');
    expect(modeKit('furyRoad', 'standard')).toBe('furyRoad');
    expect(GAME_MODES.furyRoad.name).toBe('Fury Road');
  });
});

describe('a new world by mode', () => {
  it('builds a Roaming world exactly as before the Fury Road mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    expect(world.furyRoad).toBeNull();
    expect(fingerprint(world)).toEqual({
      streams: [1952458593, -794062549, 1468231572, 1936023925],
      nextId: 964,
      counts: [22, 3717, 116, 5],
      npcs: [['buggy', 322.32, 389.12], ['buggy', 115.02, 75.38], ['buggy', 119.05, 80.22]],
      bowlStock: ['ceramicPlates', 'scrapSheet', 'battleRifle', 'plates', 'longRifle', 'caltrops', 'battleRifle', 'steelPlate'],
    });
  });

  it('starts a Fury Road world with no traffic, salvage, shops or road wrecks', () => {
    const world = furyRoadWorld(7);

    expect(world.vehicles.map((v) => v.faction)).toEqual(['player']);
    expect(world.salvage).toEqual([]);
    expect(world.shops).toEqual({});
    expect(world.obstacles.some((o) => /^wreck\d+$/.test(o.id))).toBe(false);
    expect(world.furyRoad?.window).toBe(0);
  });

  it('gives the Fury Road player the Fury Road kit with no opening', () => {
    const world = furyRoadWorld(7);

    expect(world.player.money).toBe(20000);
    expect(world.player.autoRepair).toBe(true);
    expect(world.vehicles[0].items.filter((it) => it.kind === 'good' && it.good === 'parts')).toHaveLength(4);
  });
});

describe('a world and its map', () => {
  it('refuses a Roaming world on a map with no towns', () => {
    expect(() => newWorld(7, startKit('standard'), highwayMap(7, 0), defaultSetup('roaming'))).toThrow(/needs towns/);
  });

  it('refuses a Fury Road world on Icarus', () => {
    expect(() => newWorld(7, startKit('furyRoad'), TEST_MAP, defaultSetup('furyRoad'))).toThrow(/highway window 0/);
  });
});
