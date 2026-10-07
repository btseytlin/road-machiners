import { describe, expect, it } from 'vitest';
import { hitOdds } from '../sim/combat';
import { corePart } from '../sim/grid';
import { vehicleStats } from '../sim/stats';
import { addVehicle, emptyWorld } from '../sim/testkit';
import { DEG } from '../sim/vec';
import { refreshVision } from '../sim/vision';
import { hitCardRows } from './hitCard';
import type { Msg } from "../text/msg";
import { resolve } from "../text/resolve";
import { chassisName } from "../text/names";

const en = (msg: Msg): string => resolve(msg, "en");

function createDuel() {
  const world = emptyWorld();
  const me = world.vehicles[0];
  const them = addVehicle(world, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 33, y: 30 }, Math.PI / 2);
  them.speed = 2;
  refreshVision(world);
  return { world, me, them, mine: vehicleStats(world, me).weapons[0], theirs: vehicleStats(world, them).weapons[0] };
}

describe('hover card rows', () => {
  it('shows my weapon odds from hitOdds with every cause', () => {
    const { world, me, them, mine } = createDuel();
    const o = hitOdds(world, me, mine, them, 'body');
    const card = hitCardRows(world, them.id)!;
    expect(en(card.name)).toBe(en(chassisName(them.chassisId)));
    expect(card.mine[0].odds).toEqual(o);
    expect(en(card.mine[0].text)).toBe(`${Math.round(o.damageChance * 100)}%`);
    const deg = (r: number) => (r / DEG).toFixed(1);
    expect(o.causes.crossing).toBeGreaterThan(0);
    expect(o.causes.recoil).toBeGreaterThan(0);
    expect(en(card.mine[0].detail!)).toBe(`${Math.round(o.chance * 100)}% land on aim, ${Math.round(o.distance)} m, shows ${o.width.toFixed(1)} m wide, scatter ${deg(o.causes.weapon)}° weapon +${deg(o.causes.range)}° range +${deg(o.causes.crossing)}° crossing +${deg(o.causes.recoil)}° recoil`);
  });

  it('names the biggest reasons in plain words and keeps at most two', () => {
    const { world, them } = createDuel();
    const cause = en(hitCardRows(world, them.id)!.mine[0].cause!);
    expect(cause).toMatch(/^(far|target crossing fast|you are moving|gun kick|bad weather|loose gun)(, (far|target crossing fast|you are moving|gun kick|bad weather|loose gun))?$/);
  });

  it('names parts in the way of an aimed part they shield', () => {
    const world = emptyWorld();
    const me = world.vehicles[0];
    const them = addVehicle(world, 'raiders', 'courier', ['stockEngine'], { x: 33, y: 30 }, Math.PI);
    refreshVision(world);
    const mine = vehicleStats(world, me).weapons[0];
    me.weaponOrders[mine.part.id] = { targetId: them.id, aim: corePart(them, 'cab').id };
    const row = hitCardRows(world, them.id)!.mine[0];
    expect(row.odds!.damageChance).toBeLessThan(row.odds!.chance);
    expect(en(row.cause!)).toContain('parts in the way');
  });

  it('calls a parked target easy', () => {
    const { world, them } = createDuel();
    them.speed = 0;
    const row = hitCardRows(world, them.id)!.mine[0];
    expect(row.odds!.causes.still).toBeLessThan(0);
    expect(en(row.cause!)).toContain('target is parked: easy');
  });

  it('says clear shot when no cause is a main one', () => {
    const { world, them } = createDuel();
    them.speed = 0;
    world.vehicles[0].speed = 0;
    const row = hitCardRows(world, them.id)!.mine[0];
    expect(en(row.cause!)).not.toContain('you are moving');
  });

  it('shows its weapons against me with the aim of its order at me', () => {
    const { world, me, them, theirs } = createDuel();
    const cab = corePart(me, 'cab');
    them.weaponOrders[theirs.part.id] = { targetId: me.id, aim: cab.id };
    const card = hitCardRows(world, them.id)!;
    expect(card.theirs[0].odds).toEqual(hitOdds(world, them, theirs, me, cab.id));
  });

  it('uses a body shot for its weapons ordered at someone else', () => {
    const { world, me, them, theirs } = createDuel();
    const other = addVehicle(world, 'traders', 'buggy', [], { x: 30, y: 34 });
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
    expect([row.odds, en(row.text), row.cause, row.detail]).toEqual([null, 'disabled', null, null]);
  });

  it('shows perception as a negative scatter cause', () => {
    const { world, me, them, mine } = createDuel();
    world.player.ranks.perception = 3;
    const o = hitOdds(world, me, mine, them, 'body');
    expect(o.causes.skill).toBeLessThan(0);
    expect(en(hitCardRows(world, them.id)!.mine[0].detail!)).toContain(` −${(-o.causes.skill / DEG).toFixed(1)}° perception`);
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
