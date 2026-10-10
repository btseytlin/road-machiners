import { describe, expect, it } from 'vitest';
import { partDef, type WeaponDef } from '../data/parts';
import { fireBlock, hitOdds } from '../sim/combat';
import { makePart } from '../sim/factory';
import { mountPart } from '../sim/inventory';
import { corePart } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import type { Vehicle, World } from '../sim/types';
import { addVehicle, emptyWorld } from '../sim/testkit';
import { refreshVision } from '../sim/vision';
import { hitCardRows } from './hitCard';
import { ammoText } from './weapons';
import type { Msg } from "../text/msg";
import { resolve } from "../text/resolve";
import { partName, vehicleTitle } from "../text/names";

const en = (msg: Msg): string => resolve(msg, "en");

function turnToFire(world: World, shooter: Vehicle, target: Vehicle, pick: (v: Vehicle) => ReturnType<typeof vehicleStats>['weapons'][number]): void {
  for (let quarter = 0; quarter < 4; quarter++) {
    shooter.heading = (quarter * Math.PI) / 2;
    if (fireBlock(world, shooter, pick(shooter), target) === null) return;
  }
  throw new Error('No heading lets the gun fire');
}

function createDuel() {
  const world = emptyWorld();
  const me = world.vehicles[0];
  const them = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI / 2);
  them.speed = 2;
  turnToFire(world, them, me, (v) => vehicleStats(world, v).weapons[0]);
  refreshVision(world);
  return { world, me, them, mine: vehicleStats(world, me).weapons[0], theirs: vehicleStats(world, them).weapons[0] };
}

describe('hover card rows', () => {
  it('shows my guns as shut down while I am', () => {
    const { world, me, them } = createDuel();
    me.shutDown = { from: world.turn, until: world.turn + 1 };
    const row = hitCardRows(world, them.id)!.mine[0];
    expect([row.odds, en(row.text), row.tip]).toEqual([null, 'shut down', null]);
  });

  it('shows my weapon odds from hitOdds, with my key and the gun name and ammo', () => {
    const { world, me, them, mine } = createDuel();
    const o = hitOdds(world, me, mine, them, 'body');
    const card = hitCardRows(world, them.id)!;
    expect(en(card.name)).toBe(en(vehicleTitle(world, them)));
    expect(card.mine[0]).toMatchObject({ key: 1, odds: o });
    expect(en(card.mine[0].name)).toBe(en(partName(mine.def.id)));
    expect(en(card.mine[0].ammo)).toBe(en(ammoText(mine)));
    expect(en(card.mine[0].text)).toBe(`${Math.round(o.damageChance * 100)}%`);
  });

  it('shows its weapons without a key', () => {
    const { world, them, theirs } = createDuel();
    expect(hitCardRows(world, them.id)!.theirs[0]).toMatchObject({ key: null });
    expect(en(hitCardRows(world, them.id)!.theirs[0].name)).toBe(en(partName(theirs.def.id)));
  });

  it('makes the base and the cause rows add up to the chance on the card', () => {
    const { world, them } = createDuel();
    const card = hitCardRows(world, them.id)!;
    for (const r of [...card.mine, ...card.theirs]) {
      const tip = r.tip!;
      expect(tip.rows.length).toBeGreaterThan(0);
      expect(tip.rows.every((x) => x.delta !== 0)).toBe(true);
      expect(`${tip.base + tip.rows.reduce((sum, x) => sum + x.delta, 0)}%`).toBe(en(r.text));
    }
  });

  it('names causes from the shooter point of view', () => {
    const { world, me, them } = createDuel();
    them.speed = 0;
    me.speed = 0;
    const card = hitCardRows(world, them.id)!;
    const mineNames = card.mine[0].tip!.rows.map((x) => en(x.name));
    const theirNames = card.theirs[0].tip!.rows.map((x) => en(x.name));
    expect(mineNames).toContain('Target is parked');
    expect(theirNames).toContain('You are parked');
    expect(mineNames).not.toContain('You are parked');
  });

  it('names a moving shooter and a crossing target', () => {
    const { world, me, them } = createDuel();
    me.speed = 3;
    them.speed = 3;
    const card = hitCardRows(world, them.id)!;
    expect(card.mine[0].tip!.rows.map((x) => en(x.name))).toEqual(expect.arrayContaining(['You are moving', 'Gun kick']));
    expect(card.theirs[0].tip!.rows.map((x) => en(x.name))).toContain('It is moving');
  });

  it('shows perception as a chance gain', () => {
    const { world, them } = createDuel();
    world.player.ranks.perception = 3;
    const row = hitCardRows(world, them.id)!.mine[0].tip!.rows.find((x) => en(x.name) === 'Driver perception');
    expect(row!.delta).toBeGreaterThan(0);
  });

  it('shows smoke between us as a chance loss', () => {
    const { world, me, them } = createDuel();
    world.smoke = [{ id: 's1', source: me.id, pos: { x: 31.5, y: 30 }, r: 1, turnsLeft: 3 }];
    const row = hitCardRows(world, them.id)!.mine[0].tip!.rows.find((x) => en(x.name) === 'Smoke');
    expect(row!.delta).toBeLessThan(0);
  });

  it('names no smoke on a clear shot', () => {
    const { world, them } = createDuel();
    expect(hitCardRows(world, them.id)!.mine[0].tip!.rows.map((x) => en(x.name))).not.toContain('Smoke');
  });

  it('builds the tip for the part my order aims at', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const them = addVehicle(world, 'raiders', 'courier', ['stockEngine'], { x: 33, y: 30 }, Math.PI);
    refreshVision(world);
    const mine = vehicleStats(world, me).weapons[0];
    me.weaponOrders[mine.part.id] = { targetId: them.id, aim: corePart(them, 'cab').id };
    const row = hitCardRows(world, them.id)!.mine[0];
    expect(row.odds!.damageChance).toBeLessThan(row.odds!.chance);
    expect(row.tip!.base + row.tip!.rows.reduce((sum, x) => sum + x.delta, 0)).toBe(Math.round(row.odds!.damageChance * 100));
  });

  it('shows its weapons against me with the aim of its order at me', () => {
    const { world, me, them, theirs } = createDuel();
    turnToFire(world, them, me, (v) => vehicleStats(world, v).weapons[0]);
    const cab = corePart(me, 'cab');
    them.weaponOrders[theirs.part.id] = { targetId: me.id, aim: cab.id };
    const card = hitCardRows(world, them.id)!;
    expect(card.theirs[0].odds).toEqual(hitOdds(world, them, theirs, me, cab.id));
  });

  it('uses a body shot for its weapons ordered at someone else', () => {
    const { world, me, them, theirs } = createDuel();
    const other = addVehicle(world, 'traders', 'buggy', [], { x: 30, y: 34 });
    turnToFire(world, them, me, (v) => vehicleStats(world, v).weapons[0]);
    them.weaponOrders[theirs.part.id] = { targetId: other.id, aim: 'body' };
    expect(hitCardRows(world, them.id)!.theirs[0].odds).toEqual(hitOdds(world, them, theirs, me, 'body'));
  });

  it('shows a knocked-out driver firing nothing at me', () => {
    const { world, them } = createDuel();
    them.defeat = { phase: 'out', turns: 0, unseen: 0, foes: [], gaveUp: true };
    const row = hitCardRows(world, them.id)!.theirs[0];
    expect([row.odds, en(row.text)]).toEqual([null, 'driver knocked out']);
  });

  it('shows the block reason instead of a chance', () => {
    const { world, them, mine } = createDuel();
    mine.part.hp = 0;
    const row = hitCardRows(world, them.id)!.mine[0];
    expect([row.odds, en(row.text), row.tip]).toEqual([null, 'disabled', null]);
  });

  it('shows no card for my own truck', () => {
    const { world, me } = createDuel();
    expect(hitCardRows(world, me.id)).toBeNull();
  });

  it('throws for an unknown truck', () => {
    const { world } = createDuel();
    expect(() => hitCardRows(world, 'nobody')).toThrow();
  });
});

describe('hover card harpoon row', () => {
  function harpoonDuel() {
    const world = emptyWorld();
    const me = world.vehicles[0];
    me.heading = 0;
    const harpoon = makePart(world, 'harpoon', 0);
    if (!mountPart(world, me, harpoon)) throw new Error('No deck room for the harpoon');
    const them = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 35, y: 30 }, Math.PI / 2);
    turnToFire(world, me, them, (v) => vehicleStats(world, v).weapons.find((w) => w.def.line)!);
    refreshVision(world);
    return { world, me, harpoon, them };
  }

  it('shows the harpoon as a gun row with its round and its chance from hitOdds', () => {
    const { world, me, them } = harpoonDuel();
    const odds = hitOdds(world, me, { def: partDef('harpoon') as WeaponDef }, them, 'body');

    const row = hitCardRows(world, them.id)!.mine.find((r) => en(r.name) === 'Harpoon' && en(r.ammo) === '1/1');

    expect(row).toMatchObject({ odds });
    expect(en(row!.text)).toBe(`${Math.round(odds.damageChance * 100)}%`);
  });

  it('shows a reloading harpoon with no odds', () => {
    const { world, harpoon, them } = harpoonDuel();
    harpoon.gun = { cooldown: 0, ammo: 0, reloadWork: 2 };

    const row = hitCardRows(world, them.id)!.mine.find((r) => en(r.name) === 'Harpoon' && en(r.ammo) === '0/1');

    expect(row).toMatchObject({ odds: null });
    expect(en(row!.text)).toBe('reloading 3 turns');
  });
});
