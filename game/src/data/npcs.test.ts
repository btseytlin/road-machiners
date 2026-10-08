import { describe, expect, it } from 'vitest';
import { STATE_WEIGHTS, TRAITS, type TraitWeights } from './npcs';

function nonPositiveMuls(tables: Record<string, TraitWeights>): string[] {
  const bad: string[] = [];
  for (const [name, table] of Object.entries(tables)) {
    for (const [decision, options] of Object.entries(table)) {
      for (const [option, change] of Object.entries(options ?? {})) {
        const mul = (change as { mul?: number }).mul;
        if (mul !== undefined && !(mul > 0)) bad.push(`${name}.${decision}.${option}`);
      }
    }
  }
  return bad;
}

describe('decision weight changes', () => {
  it('finds a mul of 0 in a table', () => {
    expect(nonPositiveMuls({ spiteful: { attacked: { flee: { mul: 0 }, keep: { mul: 2 } }, idle: { wait: { add: 1 } } } })).toEqual(['spiteful.attacked.flee']);
  });

  it('every trait and state mul is above 0', () => {
    const traits = Object.fromEntries(Object.entries(TRAITS).map(([id, t]) => [`trait ${id}`, t.weights]));
    const states = Object.fromEntries(Object.entries(STATE_WEIGHTS).map(([id, t]) => [`state ${id}`, t]));
    expect(nonPositiveMuls({ ...traits, ...states })).toEqual([]);
  });
});
