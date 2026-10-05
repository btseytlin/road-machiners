import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATE_TURNS } from '../data/npcs';
import { wreckVehicle } from './combat';
import { addState, advanceStates, endState, isRobberyFeud, robbing, STATE_KINDS, stateOf, statesHeld, workOf } from './states';
import { addVehicle, emptyWorld, npcBrain } from './testkit';
import type { NpcState, StateKindId, World } from './types';
import { canVehicleSee } from './vision';

const NONE = { kind: 'none' } as const;
const FEUD = { kind: 'feud', robbery: false } as const;

// Two NPCs far enough apart that neither sees the other, so nothing refreshes a feud.
function apart(): { w: World; a: string; b: string } {
  const w = emptyWorld({ x: 30, y: 30 });
  const a = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 100, y: 100 });
  const b = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 400, y: 400 });
  a.brain = npcBrain('trader', a.pos, ['trader']);
  b.brain = npcBrain('buggy', b.pos, ['raider']);
  expect(canVehicleSee(w, a, b.pos) || canVehicleSee(w, b, a.pos)).toBe(false);
  return { w, a: a.id, b: b.id };
}

// One turn of the state step alone, with a fresh event list like update() gives.
function turn(w: World): void {
  w.turn++;
  w.events = [];
  advanceStates(w);
}

const endings = (w: World) => w.events.flatMap((e) => (e.t === 'stateEnded' ? [e.ending] : []));

const feudTurns = (): number => {
  const turns = STATE_TURNS.feud;
  if (turns === null) throw new Error('A feud must have a timer');
  return turns;
};

describe('states', () => {
  const hooks = STATE_KINDS.feud.hooks;
  afterEach(() => {
    STATE_KINDS.feud.hooks = hooks;
  });

  it('a new state of the same kind, holder and other replaces the old one', () => {
    const { w, a, b } = apart();
    const first = addState(w, 'feud', a, b, FEUD);
    const second = addState(w, 'feud', a, b, FEUD);
    expect(w.states).toEqual([second]);
    expect(second.id).not.toBe(first.id);
    addState(w, 'feud', b, a, FEUD);
    addState(w, 'backedOff', a, b, NONE);
    expect(w.states).toHaveLength(3);
    expect(stateOf(w, 'feud', a, b)).toBe(second);
    expect(statesHeld(w, a).map((s) => s.kind).sort()).toEqual(['backedOff', 'feud']);
  });

  it('a new state starts with its kind timer and the current turn', () => {
    const { w, a, b } = apart();
    const s = addState(w, 'feud', a, b, FEUD);
    expect(s).toMatchObject({ kind: 'feud', holder: a, other: b, turnsLeft: STATE_TURNS.feud, born: w.turn, data: FEUD });
    expect(addState(w, 'turnedDown', a, b, NONE).turnsLeft).toBeNull();
  });

  it('an unknown state kind throws', () => {
    const { w, a, b } = apart();
    expect(() => addState(w, 'alliance' as StateKindId, a, b, NONE)).toThrow(/alliance/);
    expect(() => addState(w, 'constructor' as StateKindId, a, b, NONE)).toThrow(/Unknown state kind constructor/);
  });

  it('a state with data of another kind throws', () => {
    const { w, a, b } = apart();
    expect(() => addState(w, 'feud', a, b, NONE)).toThrow(/feud data/);
    expect(() => addState(w, 'backedOff', a, b, FEUD)).toThrow(/none data/);
  });

  it('a state with a missing party ends broken', () => {
    const { w, a } = apart();
    addState(w, 'feud', a, 'v-gone', FEUD);
    turn(w);
    expect(w.states).toEqual([]);
    expect(endings(w)).toEqual(['broken']);
  });

  it('a feud whose other party was destroyed this turn ends fulfilled', () => {
    const { w, a, b } = apart();
    addState(w, 'feud', a, b, FEUD);
    addState(w, 'feud', b, a, FEUD);
    w.turn++;
    w.events = [];
    wreckVehicle(w, w.vehicles.find((v) => v.id === b)!);
    advanceStates(w);
    expect(w.states).toEqual([]);
    const ended = w.events.flatMap((e) => (e.t === 'stateEnded' ? [[e.state.holder, e.ending]] : []));
    expect(ended.sort()).toEqual([[a, 'fulfilled'], [b, 'broken']].sort());
  });

  it('a feud whose other party was knocked out this turn ends fulfilled', () => {
    const { w, a, b } = apart();
    addState(w, 'feud', a, b, FEUD);
    w.turn++;
    w.events = [{ t: 'npcKnockout', vehicle: b, by: a }];
    advanceStates(w);
    expect(w.events.some((e) => e.t === 'stateEnded' && e.state.holder === a && e.ending === 'fulfilled')).toBe(true);
  });

  it('a timer expires once and runs its hook once', () => {
    const { w, a, b } = apart();
    const expired = vi.fn();
    STATE_KINDS.feud.hooks = { expired };
    addState(w, 'feud', a, b, FEUD);
    const all: string[] = [];
    for (let i = 0; i < feudTurns() + 5; i++) {
      turn(w);
      all.push(...endings(w));
    }
    expect(all).toEqual(['expired']);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(w.states).toEqual([]);
  });

  it('a state ends only once', () => {
    const { w, a, b } = apart();
    const s = addState(w, 'feud', a, b, FEUD);
    endState(w, s, 'broken');
    expect(() => endState(w, s, 'broken')).toThrow();
  });

  it('a state added by a hook does not end in the turn it was added', () => {
    const { w, a, b } = apart();
    let added: NpcState | null = null;
    STATE_KINDS.feud.hooks = { broken: (x) => { added = addState(x, 'backedOff', a, 'v-gone', NONE); } };
    addState(w, 'feud', a, b, FEUD);
    turn(w);
    const s = stateOf(w, 'feud', a, b)!;
    endState(w, s, 'broken');
    expect(added).not.toBeNull();
    advanceStates(w);
    expect(w.states).toEqual([added]);
    turn(w);
    expect(w.states).toEqual([]);
    expect(endings(w)).toEqual(['broken']);
  });

  it('a feud refreshed by sight does not expire', () => {
    const w = emptyWorld({ x: 30, y: 30 });
    const a = addVehicle(w, 'traders', 'hauler', ['stockEngine'], { x: 100, y: 100 });
    const b = addVehicle(w, 'raiders', 'buggy', ['stockEngine'], { x: 104, y: 100 });
    expect(canVehicleSee(w, a, b.pos)).toBe(true);
    addState(w, 'feud', a.id, b.id, FEUD);
    for (let i = 0; i < feudTurns() * 2; i++) turn(w);
    expect(stateOf(w, 'feud', a.id, b.id)?.turnsLeft).toBe(STATE_TURNS.feud);
  });

  it('a feud refreshed by a shot does not expire', () => {
    const { w, a, b } = apart();
    addState(w, 'feud', a, b, FEUD);
    for (let i = 0; i < feudTurns() * 2; i++) {
      w.turn++;
      w.events = [{ t: 'shot', shooter: b, weapon: 'x', target: a, aim: 'body', chance: 0.5, damageChance: 0.5, side: 'front', rounds: [] }];
      advanceStates(w);
    }
    expect(stateOf(w, 'feud', a, b)?.turnsLeft).toBe(STATE_TURNS.feud);
  });

  it('a feud counts down while neither party sees or shoots the other', () => {
    const { w, a, b } = apart();
    addState(w, 'feud', a, b, FEUD);
    turn(w);
    turn(w);
    expect(stateOf(w, 'feud', a, b)?.turnsLeft).toBe(feudTurns() - 2);
  });
});

const PATCH_DATA = { kind: 'patch', deal: 'free', parts: 1, price: 0, work: 4, workLeft: 3 } as const;

function parkedPair(gap: number) {
  const world = emptyWorld({ x: 30, y: 30 });
  const me = world.vehicles[0];
  const npc = addVehicle(world, 'traders', 'buggy', ['stockEngine'], { x: 30 + gap, y: 30 });
  me.speed = 0;
  npc.speed = 0;
  return { world, me, npc };
}

describe('work of a truck', () => {
  it('is its parked job first', () => {
    const { world, me } = parkedPair(1);
    me.job = { kind: 'search', stockId: 'wreck-1', turnsLeft: 1, total: 2 };
    expect(workOf(world, me)).toMatchObject({ from: 'job', turnsLeft: 1, total: 2 });
  });

  it('counts a patch under way for both the patcher and the client', () => {
    const { world, me, npc } = parkedPair(1);
    const state = addState(world, 'patch', npc.id, me.id, { ...PATCH_DATA });
    expect(workOf(world, npc)).toEqual({ from: 'state', state, turnsLeft: 3, total: 4 });
    expect(workOf(world, me)).toEqual({ from: 'state', state, turnsLeft: 3, total: 4 });
  });

  it('counts no patch while the trucks are out of reach', () => {
    const { world, me, npc } = parkedPair(8);
    addState(world, 'patch', npc.id, me.id, { ...PATCH_DATA });
    expect(workOf(world, npc)).toBeNull();
  });

  it('counts no state without work', () => {
    const { world, me, npc } = parkedPair(1);
    addState(world, 'truce', npc.id, me.id, { kind: 'none' });
    expect(workOf(world, npc)).toBeNull();
  });

  it('robbing holds only for a robbery feud from the robber on the target', () => {
    const { w, a, b } = apart();
    expect(robbing(w, a, b)).toBe(false);
    addState(w, 'feud', b, a, FEUD);
    expect(robbing(w, b, a)).toBe(false);
    addState(w, 'feud', a, b, { kind: 'feud', robbery: true });
    expect(robbing(w, a, b)).toBe(true);
    expect(robbing(w, b, a)).toBe(false);
  });

  it('a feud state without feud data throws in the robbery test', () => {
    const { w, a, b } = apart();
    const s = addState(w, 'feud', a, b, FEUD);
    expect(isRobberyFeud(s)).toBe(false);
    expect(() => isRobberyFeud({ ...s, data: NONE })).toThrow(/holds no feud/);
    expect(isRobberyFeud({ ...s, kind: 'backedOff', data: NONE })).toBe(false);
  });
});
