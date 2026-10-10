import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_MODES } from '../data/modes';
import { startKit } from '../data/start';
import { TEST_MAP } from '../test/map';
import { defaultSetup, modeKit, modeMap, modeRules, modeRulesOf } from './settings';
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
  it('keeps every Roaming rule on and plays no run', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    const { run, ...open } = modeRules(world);

    expect(run).toBe(false);
    expect(Object.values(open).every((on) => on)).toBe(true);
  });

  it('turns every open-world rule but NPC knockouts off in a Fury Road world and plays a run', () => {
    const world = furyRoadWorld(7);
    const { run, npcKnockouts, ...open } = modeRules(world);

    expect(run).toBe(true);
    expect(npcKnockouts).toBe(true);
    expect(Object.values(open).some((on) => on)).toBe(false);
  });

  it('names each mode difference in its row', () => {
    expect(GAME_MODES.roaming).toEqual({
      rules: { traffic: true, looting: true, npcKnockouts: true, playerKnockouts: true, yielding: true, radio: true, rescue: true, roadWrecks: true, run: false },
      kit: null,
      map: 'icarus',
    });
    expect(GAME_MODES.furyRoad).toEqual({
      rules: { traffic: false, looting: false, npcKnockouts: true, playerKnockouts: false, yielding: false, radio: false, rescue: false, roadWrecks: false, run: true },
      kit: 'furyRoad',
      map: 'highway',
    });
  });

  it('reads a mode row before a world exists', () => {
    expect(modeMap('roaming')).toBe('icarus');
    expect(modeMap('furyRoad')).toBe('highway');
    expect(modeRulesOf('furyRoad')).toBe(GAME_MODES.furyRoad.rules);
    expect(() => modeMap('fury' as never)).toThrow(/Unknown game mode fury/);
  });

  it('throws on a mode that is not a game mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));
    world.setup = { ...world.setup, mode: 'fury' as never };

    expect(() => modeRules(world)).toThrow(/Unknown game mode fury/);
  });

  it('gives Roaming the configured kit and Fury Road its own', () => {
    expect(modeKit('roaming', 'standard')).toBe('standard');
    expect(modeKit('furyRoad', 'standard')).toBe('furyRoad');
    expect(GAME_MODES.furyRoad.kit).toBe('furyRoad');
  });
});

describe('a new world by mode', () => {
  it('builds a Roaming world exactly as before the Fury Road mode', () => {
    const world = newWorld(7, startKit('standard'), TEST_MAP, defaultSetup('roaming'));

    expect(world.furyRoad).toBeNull();
    expect(fingerprint(world)).toEqual({
      streams: [-2029205660, -1817121701, 1468231572, 1936023925],
      nextId: 1157,
      counts: [22, 3780, 111, 7],
      npcs: [['buggy', 119.11, 78.81], ['buggy', 323.48, 386.45], ['buggy', 114.69, 75.54]],
      bowlStock: ['slugCannon', 'flareCannon', 'rocketRack', 'reinforcedCage', 'caltrops', 'heavyDiesel', 'shotgun', 'ceramicTile'],
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

const SOURCE = new URL('..', import.meta.url).pathname;
const MODE_LISTS = ['data/modes.ts', 'ui/new-game.ts', 'three/save-migrations.ts'];
const MODE_ID_CHECK = /[!=]==?\s*'(furyRoad|roaming)'|'(furyRoad|roaming)'\s*[!=]==?/;

function sourceFiles(): string[] {
  return readdirSync(SOURCE, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter((file) => !MODE_LISTS.includes(file.split('\\').join('/')));
}

describe('mode differences', () => {
  it('reads every mode difference from the mode table, never from a mode id', () => {
    const checks = sourceFiles().filter((file) => MODE_ID_CHECK.test(readFileSync(join(SOURCE, file), 'utf8')));

    expect(checks).toEqual([]);
  });
});
