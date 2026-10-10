import { describe, expect, it } from 'vitest';
import { XP_SOURCES } from '../data/skills';
import { isHostile } from './combat';
import { noteEscape } from './escape';
import { fightOdds } from './fight-odds';
import { addVehicle, emptyWorld, npcBrain, practiceOf, testDrive } from './testkit';
import type { Vehicle, World } from './types';
import { addState } from './states';
import { refreshVision } from './vision';
import { endTurn } from './world';

function raiderInSight(fights = true): { w: World; raider: Vehicle } {
  const w = emptyWorld({ x: 30, y: 30 });
  const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 30 }, Math.PI);
  raider.brain = npcBrain('buggy', raider.pos, ['raider']);
  expect(isHostile(w, raider, w.vehicles[0])).toBe(true);
  if (fights) addState(w, 'combat', raider.id, w.vehicles[0].id, { kind: 'none' });
  refreshVision(w);
  noteEscape(w);
  return { w, raider };
}

describe('escape practice', () => {
  it('remembers the hostile trucks in sight', () => {
    const { w, raider } = raiderInSight();
    expect(w.player.hostilesSeen).toEqual([raider.id]);
    expect(practiceOf(w, 'escape')).toEqual([]);
  });

  it('pays the player once every hostile seen last turn is out of sight, harder against a stronger truck', () => {
    const { w, raider } = raiderInSight();
    raider.pos = { x: 80, y: 30 };
    refreshVision(w);
    noteEscape(w);
    const theirOdds = 1 - fightOdds(w, [w.vehicles[0]], [raider]).win;
    expect(practiceOf(w, 'escape')).toMatchObject([{ amount: 1 }]);
    expect(practiceOf(w, 'escape')[0].difficulty).toBeCloseTo(theirOdds);
    expect(w.player.hostilesSeen).toEqual([]);
  });

  it('pays less for each time the player slips in and out of sight of the same truck', () => {
    const { w, raider } = raiderInSight();
    const flicker = () => {
      raider.pos = { x: 36, y: 30 };
      refreshVision(w);
      noteEscape(w);
      raider.pos = { x: 80, y: 30 };
      refreshVision(w);
      noteEscape(w);
    };
    flicker();
    flicker();
    const [first, second] = practiceOf(w, 'escape');
    expect(first.target).toBe(raider.id);
    expect(second.xp / first.xp).toBeCloseTo(XP_SOURCES.escape.repeat);
  });

  it('pays nothing for a hostile that never fought or hunted the player', () => {
    const { w, raider } = raiderInSight(false);
    raider.pos = { x: 80, y: 30 };
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toEqual([]);
    expect(w.player.hostilesSeen).toEqual([]);
  });

  it('pays for a hostile that hunts the player on a fight goal without a combat state', () => {
    const { w, raider } = raiderInSight(false);
    raider.brain!.goals.push({ kind: 'fight', targetId: w.vehicles[0].id, destination: { ...w.vehicles[0].pos }, phase: 'travel', reason: 'fightHostile' });
    raider.pos = { x: 80, y: 30 };
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toMatchObject([{ amount: 1, target: raider.id }]);
  });

  it('targets the engaged truck when an idle hostile left sight with it', () => {
    const { w, raider } = raiderInSight();
    const idle = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 36, y: 34 }, Math.PI);
    refreshVision(w);
    noteEscape(w);
    expect(w.player.hostilesSeen).toHaveLength(2);
    raider.pos = { x: 80, y: 30 };
    idle.pos = { x: 80, y: 34 };
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toMatchObject([{ target: raider.id }]);
  });

  it('pays nothing while a hostile is still in sight', () => {
    const { w } = raiderInSight();
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toEqual([]);
  });

  it('pays nothing when a hostile seen last turn was destroyed', () => {
    const { w, raider } = raiderInSight();
    w.vehicles = w.vehicles.filter((v) => v.id !== raider.id);
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toEqual([]);
  });

  it('pays nothing and forgets the hostiles while the player is knocked out', () => {
    const { w, raider } = raiderInSight();
    w.player.state = 'knockedOut';
    raider.pos = { x: 80, y: 30 };
    refreshVision(w);
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toEqual([]);
    expect(w.player.hostilesSeen).toEqual([]);
  });

  it('pays nothing for an NPC getting away from a raider', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const raider = addVehicle(w, 'raiders', 'buggy', ['mg', 'stockEngine'], { x: 150, y: 30 });
    const trader = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 156, y: 30 });
    expect(isHostile(w, raider, trader)).toBe(true);
    noteEscape(w);
    trader.pos = { x: 250, y: 30 };
    noteEscape(w);
    expect(practiceOf(w, 'escape')).toEqual([]);
  });

  it('runs at the end of every turn', () => {
    const { w } = raiderInSight();
    w.player.hostilesSeen = [];
    const next = endTurn(w, testDrive);
    expect(next.player.hostilesSeen).toHaveLength(1);
  });
});
