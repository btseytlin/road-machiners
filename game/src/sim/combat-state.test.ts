import { describe, expect, it } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import { combatTurnsLeft, inCombat, inCombatWithOther, noteAttack, noteEngagements } from './combat';
import { knockOutNpc } from './defeat';
import { advanceStates, addState, stateOf } from './states';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import { addGoods } from './inventory';

const TURNS = STATE_TURNS.combat!;

function passingRaider() {
  const w = emptyWorld({ x: 30, y: 30 });
  const me = w.vehicles[0];
  addGoods(w, me, 'parts', 5);
  const raider = addVehicle(w, 'raiders', 'buggy', ['stockEngine', 'mg'], { x: 36, y: 30 });
  raider.brain = npcBrain('gunwagon', raider.pos, ['raider']);
  return { w, me, raider };
}

function nextTurn(w: ReturnType<typeof emptyWorld>): void {
  w.turn++;
  advanceStates(w);
}

describe('combat state', () => {
  it('a hostile raider in sight that neither shoots nor hunts leaves the player out of combat', () => {
    const { w, me } = passingRaider();
    noteEngagements(w);
    expect(inCombat(w, me)).toBe(false);
  });

  it('a missed shot puts shooter and target in combat', () => {
    const { w, me, raider } = passingRaider();
    noteAttack(w, raider, me, false);
    expect(inCombat(w, me)).toBe(true);
    expect(inCombat(w, raider)).toBe(true);
  });

  it('a fight goal on a seen target starts combat before any shot', () => {
    const { w, me, raider } = passingRaider();
    raider.brain!.goals.push({ kind: 'fight', targetId: me.id, destination: { ...me.pos }, phase: 'travel', reason: 'tripToSite' });
    noteEngagements(w);
    expect(inCombat(w, me)).toBe(true);
    expect(combatTurnsLeft(w, me)).toBe(TURNS);
  });

  it('expires after the quiet turns, and a refresh keeps the state id and born', () => {
    const { w, me, raider } = passingRaider();
    noteAttack(w, raider, me, false);
    const first = stateOf(w, 'combat', raider.id, me.id)!;
    const { id, born } = first;
    for (let i = 0; i < TURNS - 1; i++) nextTurn(w);
    expect(inCombat(w, me)).toBe(true);
    noteAttack(w, raider, me, false);
    expect(stateOf(w, 'combat', raider.id, me.id)).toMatchObject({ id, born, turnsLeft: TURNS });
    for (let i = 0; i < TURNS; i++) nextTurn(w);
    expect(inCombat(w, me)).toBe(false);
  });

  it('a truce ends it at the next turn', () => {
    const { w, me, raider } = passingRaider();
    noteAttack(w, raider, me, false);
    addState(w, 'truce', me.id, raider.id, { kind: 'none' });
    nextTurn(w);
    expect(inCombat(w, me)).toBe(false);
  });

  it('a knocked-out aggressor ends it at the next turn', () => {
    const { w, me, raider } = passingRaider();
    noteAttack(w, raider, me, false);
    knockOutNpc(w, raider);
    nextTurn(w);
    expect(inCombat(w, me)).toBe(false);
  });

  it('inCombatWithOther ignores the named opponent', () => {
    const { w, me, raider } = passingRaider();
    noteAttack(w, raider, me, false);
    expect(inCombatWithOther(w, me, raider.id)).toBe(false);
    expect(inCombatWithOther(w, me, 'someone-else')).toBe(true);
  });
});
