import { describe, expect, it } from 'vitest';
import { chassisDef, PLAYER_CHASSIS } from '../data/chassis';
import { openSides, reachedSides } from './armor';
import { mountedItems } from './grid';
import { generateNpcLoadout } from './npc-loadout';
import type { WeaponDef } from '../data/parts';
import { partDef } from '../data/parts';
import { REGION } from '../data/region';
import { WEATHER } from '../data/weather';
import { CHEATS, RULES } from '../data/rules';
import { START_KITS } from '../data/start';
import {
  addXp, applyGodMode, CheatError, kitChoices, randomKit, grantPerk, damagePartTo, give, killVehicles, makeHostile, placeSpot, nearbyVehicles,
  repairAll, revealMap, setFuel, setHealth, setMoney, setSupplies, skipToHour, spawnNear,
  noclipMove, startBattle, startWeather, teleport, toggleFullLog, toggleGod,
} from './cheats';
import { playerVehicle } from './damage';
import { maxHealthOf } from './health';
import { corePart, goodsCount, mountedParts } from './grid';
import { removeAllGoods, spareParts } from './inventory';
import { clockOf } from './sun';
import { addState, stateOf } from './states';
import { addVehicle, emptyWorld, npcBrain, testDrive } from './testkit';
import type { World } from './types';
import { dist } from './vec';
import { stormStrength } from './weather';
import { canUseSite, siteGap } from './sites';
import { endTurn, hostileToPlayer, newWorld } from './world';
import { TEST_MAP } from '../test/map';
import { defaultSetup } from './settings';

function withSpawned(w: World, templateId: string, hostile: boolean): { w: World; id: string } {
  const next = spawnNear(w, templateId, hostile);
  const id = next.vehicles[next.vehicles.length - 1].id;
  return { w: next, id };
}

describe('resource cheats', () => {
  it('sets money', () => {
    expect(setMoney(emptyWorld(), 12345).player.money).toBe(12345);
  });

  it('rejects negative, fractional and NaN counts', () => {
    const w = emptyWorld();
    expect(() => setMoney(w, -1)).toThrow(CheatError);
    expect(() => setMoney(w, 1.5)).toThrow(CheatError);
    expect(() => addXp(w, Number.NaN)).toThrow(CheatError);
    expect(() => setHealth(w, 50.5)).toThrow(CheatError);
    expect(() => setFuel(w, Number.NaN)).toThrow(CheatError);
  });

  it('sets fractional fuel and supplies up to their caps', () => {
    const cap = chassisDef(playerVehicle(emptyWorld()).chassisId).fuelCap;
    const w = setSupplies(setFuel(emptyWorld(), cap - 0.5), 2.5);
    expect(w.player.fuel).toBe(cap - 0.5);
    expect(w.player.supplies).toBe(2.5);
  });

  it('rejects values above the fuel, supplies and health caps and names the cap', () => {
    const w = emptyWorld();
    const cap = chassisDef(playerVehicle(w).chassisId).fuelCap;
    expect(() => setFuel(w, cap + 1)).toThrow(new RegExp(`${cap}`));
    expect(() => setSupplies(w, RULES.baseSupplies + 1)).toThrow(new RegExp(`${RULES.baseSupplies}`));
    expect(() => setHealth(w, RULES.maxHealth + 1)).toThrow(new RegExp(`${RULES.maxHealth}`));
    expect(() => setFuel(w, -1)).toThrow(CheatError);
  });

  it('leaves the input world unchanged', () => {
    const w = emptyWorld();
    const next = setMoney(w, 7);
    expect(w.player.money).not.toBe(7);
    expect(next).not.toBe(w);
  });

  it('adds xp to the pool without buying ranks', () => {
    const w = addXp(emptyWorld(), 10_000);
    expect(w.player.xp).toBe(10_000);
    expect(w.player.ranks.social).toBe(0);
    expect(() => addXp(emptyWorld(), 0)).toThrow(CheatError);
  });

  it('grants a perk below its skill rank', () => {
    const w = grantPerk(emptyWorld(), 'bountyTalk');
    expect(w.player.perks).toEqual(['bountyTalk']);
  });

  it('refuses an unknown perk and a second perk from one pair', () => {
    expect(() => grantPerk(emptyWorld(), 'flying')).toThrow(CheatError);
    const w = grantPerk(emptyWorld(), 'bountyTalk');
    expect(() => grantPerk(w, 'paidTruce')).toThrow(CheatError);
    expect(() => grantPerk(w, 'bountyTalk')).toThrow(CheatError);
  });
});

describe('part cheats', () => {
  it('repairs every part to full hit points', () => {
    const w = emptyWorld();
    for (const p of mountedParts(playerVehicle(w))) p.hp = 0;
    const fixed = repairAll(w);
    for (const p of mountedParts(playerVehicle(fixed))) expect(p.hp).toBe(partDef(p.defId).hp);
  });

  it('damages the first mounted part with a def', () => {
    const w = damagePartTo(emptyWorld(), 'mg', 3);
    expect(mountedParts(playerVehicle(w)).find((p) => p.defId === 'mg')!.hp).toBe(3);
  });

  it('rejects an unmounted def and hit points out of range', () => {
    const w = emptyWorld();
    expect(() => damagePartTo(w, 'cannon', 1)).toThrow(/mg/);
    expect(() => damagePartTo(w, 'mg', partDef('mg').hp + 1)).toThrow(CheatError);
    expect(() => damagePartTo(w, 'mg', -1)).toThrow(CheatError);
  });

  it('gives parts as spares and goods as cargo', () => {
    const start = emptyWorld();
    removeAllGoods(playerVehicle(start)); // the start cargo fills most of the panniers row
    const w = give(give(start, 'plates', 1), 'salt', 2);
    const me = playerVehicle(w);
    expect(spareParts(me).map((p) => p.defId)).toContain('plates');
    expect(goodsCount(me).salt).toBe(2);
  });

  it('rejects a give without room and keeps the world unchanged', () => {
    const w = emptyWorld();
    const before = goodsCount(playerVehicle(w));
    expect(() => give(w, 'salt', 500)).toThrow(CheatError);
    expect(goodsCount(playerVehicle(w))).toEqual(before);
  });

  it('rejects unknown ids and bad counts', () => {
    const w = emptyWorld();
    expect(() => give(w, 'unobtainium', 1)).toThrow(/salt/);
    expect(() => give(w, 'salt', 0)).toThrow(CheatError);
  });
});

describe('full log', () => {
  it('toggles on and off', () => {
    const on = toggleFullLog(emptyWorld());
    expect(on.player.fullLog).toBe(true);
    expect(toggleFullLog(on).player.fullLog).toBe(false);
  });
});

describe('god mode', () => {
  it('toggles on and off', () => {
    const on = toggleGod(emptyWorld());
    expect(on.player.god).toBe(true);
    expect(toggleGod(on).player.god).toBe(false);
  });

  it('restores parts, health, fuel and supplies on a draft', () => {
    const w = toggleGod(emptyWorld());
    const me = playerVehicle(w);
    corePart(me, 'cab').hp = 0;
    Object.assign(w.player, { health: 1, fuel: 0, supplies: 0 });
    applyGodMode(w);
    expect(corePart(me, 'cab').hp).toBe(partDef(corePart(me, 'cab').defId).hp);
    expect(w.player).toMatchObject({ health: RULES.maxHealth, fuel: chassisDef(me.chassisId).fuelCap, supplies: RULES.baseSupplies });
  });

  it('does nothing while off', () => {
    const w = emptyWorld();
    w.player.fuel = 1;
    applyGodMode(w);
    expect(w.player.fuel).toBe(1);
  });

  it('keeps the player awake through a turn that would knock them out', () => {
    const broken = (god: boolean): World => {
      const w = god ? toggleGod(emptyWorld()) : emptyWorld();
      corePart(playerVehicle(w), 'cab').hp = 0;
      return w;
    };
    expect(endTurn(broken(false), testDrive).player.state).toBe('knockedOut');
    expect(endTurn(broken(true), testDrive).player.state).toBe('active');
  });
});

describe('noclipMove', () => {
  it('puts the truck on an obstacle, stops it and refreshes vision', () => {
    const w = emptyWorld();
    w.obstacles.push({ id: 'rock-x', pos: { x: 80, y: 90 }, r: 2, kind: 'rock' });
    const me = playerVehicle(w);
    me.speed = 3;
    me.order = { kind: 'through', dest: { x: 50, y: 50 } };
    const next = noclipMove(w, { x: 80, y: 90 });
    expect(playerVehicle(next)).toMatchObject({ pos: { x: 80, y: 90 }, speed: 0, order: null, trail: [] });
    expect(next.player.explored[90 * next.size + 80]).toBe(1);
  });

  it('clamps the truck to the map', () => {
    const w = emptyWorld();
    expect(playerVehicle(noclipMove(w, { x: -5, y: w.size + 5 })).pos).toEqual({ x: 0, y: w.size });
  });

  it('names an open radio call as what blocks the flight', () => {
    const w = emptyWorld();
    w.player.call = { with: 'v9', topic: null, node: 'demand', vars: {}, line: { text: 'Dump your cargo.', vars: {} } };
    expect(() => noclipMove(w, { x: 80, y: 90 })).toThrow('Cannot fly while a radio call is open');
  });
});

describe('teleport', () => {
  it('moves the truck to a free target and stops it', () => {
    const w = emptyWorld();
    const me = playerVehicle(w);
    me.speed = 3;
    me.order = { kind: 'through', dest: { x: 50, y: 50 } };
    const moved = playerVehicle(teleport(w, { x: 80, y: 90 }));
    expect(moved.pos).toEqual({ x: 80, y: 90 });
    expect(moved).toMatchObject({ speed: 0, order: null, trail: [] });
  });

  it('finds the nearest free spot next to an obstacle', () => {
    const w = emptyWorld();
    w.obstacles.push({ id: 'rock-x', pos: { x: 80, y: 90 }, r: 2, kind: 'rock' });
    const moved = playerVehicle(teleport(w, { x: 80, y: 90 }));
    const d = dist(moved.pos, { x: 80, y: 90 });
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThanOrEqual(CHEATS.searchStep * CHEATS.searchRings);
  });

  it('refreshes vision at the new spot', () => {
    const w = teleport(emptyWorld(), { x: 200, y: 200 });
    expect(w.player.explored[200 * w.size + 200]).toBe(1);
  });

  it('rejects a player on a tow rope', () => {
    const w = emptyWorld();
    const tower = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 40, y: 30 });
    addState(w, 'tow', tower.id, w.player.vehicleId, { kind: 'tow', site: REGION.towns[0].id, fee: 10, waived: 0, hitched: true });
    expect(() => teleport(w, { x: 80, y: 90 })).toThrow(/towed/);
  });

  it('rejects a knocked out player and a target off the map', () => {
    const w = emptyWorld();
    expect(() => teleport(w, { x: -500, y: -500 })).toThrow(CheatError);
    expect(() => teleport(w, { x: Number.NaN, y: 10 })).toThrow(CheatError);
    w.player.state = 'knockedOut';
    expect(() => teleport(w, { x: 80, y: 90 })).toThrow(CheatError);
  });
});

describe('places and time', () => {
  it('teleports to a spot where every town and location can be used', () => {
    const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    for (const place of [...REGION.towns, ...REGION.locations.filter((l) => l.kind !== 'territory')]) {
      const next = teleport(w, placeSpot(w, place.id));
      expect(canUseSite(playerVehicle(next).pos, place), place.id).toBe(true);
    }
    expect(() => placeSpot(w, 'atlantis')).toThrow(new RegExp(REGION.towns[0].id));
  });

  it('sends a teleport to a territory to where its road ends', () => {
    const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
    const sun = REGION.locations.find((l) => l.id === 'fallen-sun')!;
    expect(Math.abs(siteGap(sun, placeSpot(w, sun.id)))).toBeLessThan(1e-6);
  });

  it('skips to the first later turn at the hour', () => {
    const w = emptyWorld();
    const next = skipToHour(w, 22);
    expect(next.turn).toBeGreaterThan(w.turn);
    expect(Math.floor(clockOf(next.turn).hour)).toBe(22);
    expect(Math.floor(clockOf(next.turn - 1).hour)).not.toBe(22);
    expect(() => skipToHour(w, 24)).toThrow(CheatError);
    expect(() => skipToHour(w, 1.5)).toThrow(CheatError);
  });

  it('starts one storm at the truck', () => {
    const w = startWeather(startWeather(emptyWorld(), 'storm', null, 0), 'storm', null, 0);
    const storms = w.weather.filter((e) => e.kind === 'storm');
    expect(storms).toHaveLength(1);
    expect(storms[0]).toMatchObject({ pos: playerVehicle(w).pos });
    expect(() => startWeather(w, 'snow', null, 0)).toThrow(CheatError);
  });

  it('starts regional weather', () => {
    expect(startWeather(emptyWorld(), 'heatwave', null, 0).weather.map((e) => e.kind)).toContain('heatwave');
  });

  it('starts a storm for a set number of turns, born this turn', () => {
    const w = startWeather(emptyWorld(), 'storm', 70, 0);
    expect(w.weather.find((e) => e.kind === 'storm')).toMatchObject({ turnsLeft: 70, born: w.turn });
    expect(() => startWeather(w, 'storm', 0, 0)).toThrow(CheatError);
    expect(() => startWeather(w, 'storm', 2.5, 0)).toThrow(CheatError);
  });

  it('starts a still storm at full strength the given tiles east of the truck', () => {
    const w = emptyWorld({ x: 100, y: 100 });
    w.turn = 50;
    const next = startWeather(w, 'storm', 400, 80);
    const storm = next.weather.find((e) => e.kind === 'storm')!;
    expect(storm).toMatchObject({ pos: { x: 180, y: 100 }, vel: { x: 0, y: 0 }, turnsLeft: 400, born: 50 - WEATHER.sim.stormFadeTurns });
    if (storm.kind === 'storm') expect(stormStrength(next, storm)).toBe(1);
    const far = startWeather(w, 'storm', 400, 10 * w.size);
    expect(far.weather.find((e) => e.kind === 'storm')).toMatchObject({ pos: { x: w.size, y: 100 } });
    expect(() => startWeather(w, 'storm', 400, -1)).toThrow(CheatError);
  });

  it('reveals the whole map', () => {
    expect(revealMap(emptyWorld()).player.explored.every((t) => t === 1)).toBe(true);
  });
});

describe('vehicle cheats', () => {
  it('spawns a template at the spawn distance with a spawn event', () => {
    const { w, id } = withSpawned(emptyWorld(), 'trader', false);
    const v = w.vehicles.find((x) => x.id === id)!;
    expect(v.brain?.templateId).toBe('trader');
    expect(dist(v.pos, playerVehicle(w).pos)).toBeCloseTo(CHEATS.spawnDistance);
    expect(w.events).toContainEqual({ t: 'spawn', vehicle: id });
    expect(hostileToPlayer(w, v)).toBe(false);
  });

  it('spawns a hostile vehicle', () => {
    const { w, id } = withSpawned(emptyWorld(), 'trader', true);
    const v = w.vehicles.find((x) => x.id === id)!;
    expect(hostileToPlayer(w, v)).toBe(true);
    expect(stateOf(w, 'feud', id, w.player.vehicleId)).not.toBeNull();
    expect(v.brain!.attackers).toEqual({ [w.player.vehicleId]: false });
  });

  it('starts a battle with one hostile NPC near the truck', () => {
    const w = emptyWorld();
    const next = startBattle(w);
    const added = next.vehicles.filter((v) => !w.vehicles.some((x) => x.id === v.id));
    expect(added).toHaveLength(1);
    expect(hostileToPlayer(next, added[0])).toBe(true);
    expect(dist(added[0].pos, playerVehicle(next).pos)).toBeLessThan(CHEATS.spawnDistance * 2);
  });

  it('picks templates of every kind with the world RNG', () => {
    const factions = new Set<string>();
    let w = emptyWorld();
    for (let i = 0; i < 24; i++) {
      w = startBattle(w);
      factions.add(w.vehicles[w.vehicles.length - 1].faction);
    }
    expect(factions.size).toBeGreaterThan(2);
  });

  it('rejects an unknown template', () => {
    expect(() => spawnNear(emptyWorld(), 'dragon', false)).toThrow(/buggy/);
  });

  it('turns a vehicle hostile', () => {
    const { w, id } = withSpawned(emptyWorld(), 'trader', false);
    const next = makeHostile(makeHostile(w, id), id);
    expect(hostileToPlayer(next, next.vehicles.find((v) => v.id === id)!)).toBe(true);
    expect(next.states.filter((s) => s.kind === 'feud' && s.holder === id)).toHaveLength(1);
    expect(next.vehicles.find((v) => v.id === id)!.brain!.attackers).toEqual({ [w.player.vehicleId]: false });
    expect(() => makeHostile(w, w.player.vehicleId)).toThrow(CheatError);
    expect(() => makeHostile(w, 'v999999')).toThrow(CheatError);
  });

  it('kills a vehicle into a wreck without paying a bounty', () => {
    const { w, id } = withSpawned(emptyWorld(), 'buggy', false);
    w.vehicles.find((v) => v.id === id)!.lastHitBy = w.player.vehicleId;
    const next = killVehicles(w, id);
    expect(next.vehicles.some((v) => v.id === id)).toBe(false);
    expect(next.obstacles.some((o) => o.id === `wreck-${id}`)).toBe(true);
    expect(next.player.money).toBe(w.player.money);
    expect(next.player.xp).toBe(w.player.xp);
    expect(next.player.ranks).toEqual(w.player.ranks);
  });

  it('kills hostiles or all other vehicles', () => {
    const w = emptyWorld();
    const foe = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 40, y: 30 });
    addState(w, 'feud', foe.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 30, y: 40 });
    expect(killVehicles(w, 'hostiles').vehicles).toHaveLength(2);
    expect(killVehicles(w, 'all').vehicles.map((v) => v.id)).toEqual([w.player.vehicleId]);
    expect(killVehicles(emptyWorld(), 'hostiles').vehicles).toHaveLength(1);
  });

  it('rejects the player and unknown ids as kill targets', () => {
    const w = emptyWorld();
    expect(() => killVehicles(w, w.player.vehicleId)).toThrow(CheatError);
    expect(() => killVehicles(w, 'v999999')).toThrow(CheatError);
  });

  it('drops the tow when the tower is killed, so the next turn runs', () => {
    const w = emptyWorld();
    const tower = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 40, y: 30 });
    tower.brain = npcBrain('trader', tower.pos, ['trader']);
    addState(w, 'tow', tower.id, w.player.vehicleId, { kind: 'tow', site: REGION.towns[0].id, fee: 10, waived: 0, hitched: true });
    const next = killVehicles(w, tower.id);
    expect(next.states).toEqual([]);
    expect(next.events).toContainEqual({ t: 'towDropped', by: tower.id, client: next.player.vehicleId, reason: 'gone' });
    expect(() => endTurn(next, testDrive)).not.toThrow();
  });

  it('ends feuds with a killed vehicle, so its enemy drops the fight next turn', () => {
    const w = emptyWorld();
    const hunter = addVehicle(w, 'scavengers', 'scout', ['mg', 'stockEngine'], { x: 40, y: 30 });
    hunter.brain = npcBrain('scavenger', hunter.pos, ['scavenger']);
    const prey = addVehicle(w, 'traders', 'scout', ['stockEngine'], { x: 45, y: 30 });
    addState(w, 'feud', hunter.id, prey.id, { kind: 'feud', robbery: false });
    hunter.brain.goals.push({ kind: 'fight', targetId: prey.id, destination: { ...prey.pos }, phase: 'travel', reason: 'test' });
    const next = killVehicles(w, prey.id);
    expect(next.states).toEqual([]);
    const after = endTurn(next, testDrive).vehicles.find((v) => v.id === hunter.id)!;
    expect(after.brain!.goals.some((g) => g.kind === 'fight')).toBe(false);
  });

  it('lists other vehicles by distance', () => {
    const w = emptyWorld();
    const far = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 50, y: 30 });
    const near = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 35, y: 30 });
    addState(w, 'feud', near.id, w.player.vehicleId, { kind: 'feud', robbery: false });
    expect(nearbyVehicles(w)).toEqual([
      { id: near.id, name: near.name, templateId: null, faction: 'raiders', distance: 5, hostile: true },
      { id: far.id, name: far.name, templateId: null, faction: 'traders', distance: 20, hostile: false },
    ]);
  });
});

describe('cheats and toughness', () => {
  it('lets health reach the raised max health at toughness rank 5', () => {
    const w = emptyWorld();
    w.player.ranks.toughness = 5;
    expect(setHealth(w, maxHealthOf(w)).player.health).toBe(maxHealthOf(w));
    expect(() => setHealth(w, maxHealthOf(w) + 1)).toThrow(new RegExp(`${maxHealthOf(w)}`));
  });

  it('god mode fills health to the raised max health', () => {
    const w = toggleGod(emptyWorld());
    w.player.ranks.toughness = 5;
    w.player.health = 1;
    applyGodMode(w);
    expect(w.player.health).toBe(maxHealthOf(w));
  });
});

describe('randomkit', () => {
  it('gives the player a player chassis with at least one gun, and every gun can fire', () => {
    const chassis = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const w = emptyWorld();
      w.rngState = seed * 7919;
      const before = playerVehicle(w);
      const next = randomKit(w, null);
      const me = playerVehicle(next);
      chassis.add(me.chassisId);
      expect(me.id).toBe(before.id);
      expect(PLAYER_CHASSIS).toContain(me.chassisId);
      const guns = mountedItems(me, 'weapon');
      expect(guns.length).toBeGreaterThan(0);
      for (const item of guns) {
        const reach = reachedSides(partDef(item.part.defId) as WeaponDef);
        expect(openSides(me, item).some((side) => reach.includes(side))).toBe(true);
      }
    }
    expect(chassis.size).toBeGreaterThan(2);
  });

  it('every template and player chassis pair rolls a loadout', () => {
    for (const { tpl, chassisId } of kitChoices()) {
      expect(generateNpcLoadout(emptyWorld(), tpl, chassisId).chassisId).toBe(chassisId);
    }
  });

  it('refuses while the player is knocked out', () => {
    const w = emptyWorld();
    w.player.state = 'knockedOut';
    expect(() => randomKit(w, null)).toThrow(CheatError);
  });

  it('a higher gear level rolls more guns on average', () => {
    const guns = (level: number) => {
      let sum = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const w = emptyWorld();
        w.rngState = seed * 104729;
        sum += mountedItems(playerVehicle(randomKit(w, level)), 'weapon').length;
      }
      return sum;
    };
    expect(guns(5)).toBeGreaterThan(guns(1));
  });

  it('rejects a gear level outside 1 to 5', () => {
    for (const level of [0, 6, 2.5]) expect(() => randomKit(emptyWorld(), level)).toThrow(CheatError);
  });
});
