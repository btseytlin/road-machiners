import { describe, expect, it } from 'vitest';
import { FIRST_NAMES, NPCS, SPAWN, SURNAMES } from '../data/npcs';
import { REGION } from '../data/region';
import { START_KITS } from '../data/start';
import { playerVehicle } from './damage';
import { siteGap, siteGates, sitePads } from './sites';
import { isFree, spawnNpcs } from './spawn';
import { territoryPieces } from './territory';
import { emptyWorld, testDrive } from './testkit';
import { dist } from './vec';
import { endTurn, newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { budget } from '../test/budget';
import { defaultSetup } from './settings';

const NEUTRAL_SITES = [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'camp')];
const nearestSite = (pos: { x: number; y: number }) =>
  NEUTRAL_SITES.reduce((best, site) => (siteGap(site, pos) < siteGap(best, pos) ? site : best));

describe('NPC spawns', () => {
  it('names each driver from the pools and keeps the name through turns', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const npcs = w.vehicles.filter((v) => v.brain);
    for (const v of npcs) {
      const [first, last] = v.brain!.driver.split(' ');
      expect(FIRST_NAMES).toContain(first);
      expect(SURNAMES).toContain(last);
    }
    expect(new Set(npcs.map((v) => v.brain!.driver)).size).toBeGreaterThan(1);
    const later = endTurn(endTurn(w, testDrive), testDrive);
    for (const v of npcs) expect(later.vehicles.find((x) => x.id === v.id)?.brain?.driver).toBe(v.brain!.driver);
  }, budget(15_000));

  it('places the first drivers by the world seed', () => {
    const spots = (seed: number) => newWorld(seed, START_KITS.standard, TEST_MAP, defaultSetup('roaming')).vehicles.filter((v) => v.brain).map((v) => v.pos);
    expect(spots(1337)).toEqual(spots(1337));
    expect(spots(1337)).not.toEqual(spots(42));
  }, budget(15_000));

  it('starts the whole roster on every seed, with at most one dealt neutral driver per site', () => {
    const guards = SPAWN.initial.filter((id) => id === 'convoy').map(() => 'convoyGuard');
    const roster = [...SPAWN.initial, ...SPAWN.startTraffic.templates, ...guards].sort();
    for (let seed = 1; seed <= 20; seed++) {
      const npcs = newWorld(seed * 7919, START_KITS.standard, TEST_MAP, defaultSetup('roaming')).vehicles.filter((v) => v.brain);
      expect(npcs.map((v) => v.brain!.templateId).sort()).toEqual(roster);
      const perSite = new Map<string, number>();
      for (const v of npcs.filter((v) => NPCS[v.brain!.templateId].spawn.kind === 'town')) {
        const id = nearestSite(v.pos).id;
        perSite.set(id, (perSite.get(id) ?? 0) + 1);
      }
      for (const [id, count] of perSite) {
        const traffic = id === SPAWN.startTraffic.town ? SPAWN.startTraffic.templates.length : 0;
        expect(count).toBeLessThanOrEqual(1 + traffic);
      }
    }
  }, budget(60_000));

  it('starts traders at the gate of the town the start road leaves', () => {
    const w = newWorld(2, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const town = REGION.towns.find((t) => t.id === SPAWN.startTraffic.town)!;
    const player = w.vehicles.find((v) => v.id === w.player.vehicleId)!;
    const gate = siteGates(town).reduce((a, b) => (dist(player.pos, a) <= dist(player.pos, b) ? a : b));
    const atGate = w.vehicles.filter((v) => v.brain?.templateId === 'trader' && dist(v.pos, gate) <= SPAWN.gateSpread + 3);
    expect(atGate.length).toBeGreaterThanOrEqual(SPAWN.startTraffic.templates.length);
  }, budget(15_000));

  it('starts each driver with its template wallet', () => {
    const w = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const wallets = (templateId: string) => w.vehicles.filter((v) => v.brain?.templateId === templateId).map((v) => v.resources!.money);
    for (const id of ['trader', 'convoy', 'scavenger']) {
      expect(wallets(id).length).toBeGreaterThan(0);
      for (const money of wallets(id)) expect(money).toBe(NPCS[id].money);
    }
    expect(NPCS.trader.money).toBeGreaterThan(NPCS.scavenger.money);
  }, 15_000);

  it('never respawns a driver close to the player', () => {
    const bowl = REGION.towns.find((t) => t.id === 'bowl')!;
    const w = emptyWorld(sitePads(bowl)[0]);
    for (let i = 0; i < 200; i++) {
      w.spawnTimer.trader = 1;
      spawnNpcs(w);
      const spawned = w.vehicles.filter((v) => v.brain);
      for (const v of spawned) expect(dist(v.pos, playerVehicle(w).pos)).toBeGreaterThanOrEqual(SPAWN.minPlayerDist);
      w.vehicles = w.vehicles.filter((v) => !v.brain);
    }
  });
});

describe('free spots', () => {
  const world = newWorld(1337, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  world.vehicles = world.vehicles.filter((v) => v.faction === 'player');
  const fallenSun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
  const cage = territoryPieces(fallenSun as never).find((p) => p.look === 'shipCage')!;
  const hub = territoryPieces(fallenSun as never).find((p) => p.look === 'shipHub')!;

  it('counts the lane inside a hull a truck drives through as free, by its low boxes', () => {
    const lane = { x: cage.pos.x + Math.cos(cage.yaw) * -1.5, y: cage.pos.y + Math.sin(cage.yaw) * -1.5 };
    expect(isFree(world, lane, 0.6, null)).toBe(true);
  });

  it('keeps a solid piece and its walls taken', () => {
    expect(isFree(world, hub.pos, 0.6, null)).toBe(false);
    const wall = { x: cage.pos.x + Math.sin(cage.yaw) * 3.8, y: cage.pos.y - Math.cos(cage.yaw) * 3.8 };
    expect(isFree(world, wall, 0.6, null)).toBe(false);
  });
});
