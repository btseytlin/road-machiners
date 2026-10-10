import { describe, expect, it } from 'vitest';
import { huntsOffRoad } from './hunt-style';
import { npcBrain } from './testkit';
import type { TraitId } from '../data/npcs';
import type { NpcActivity, NpcBrain } from './types';

function driver(traits: TraitId[], kinds: NpcActivity['kind'][]): NpcBrain {
  const brain = npcBrain('buggy', { x: 0, y: 0 }, traits);
  brain.goals = kinds.map((kind) => ({ kind, targetId: null, destination: null, phase: 'travel', reason: 'idle' }));
  return brain;
}

describe('huntsOffRoad', () => {
  it('holds for a raider whose top goal is a raid, a patrol or an investigation', () => {
    expect(huntsOffRoad(driver(['raider'], ['raid']))).toBe(true);
    expect(huntsOffRoad(driver(['raider'], ['raid', 'patrol']))).toBe(true);
    expect(huntsOffRoad(driver(['raider', 'scumbag'], ['raid', 'investigate']))).toBe(true);
  });

  it('fails for a raider whose top goal is anything else, even over a raid', () => {
    for (const kind of ['flee', 'retreat', 'resupply', 'sell', 'loot', 'fight'] as const) expect(huntsOffRoad(driver(['raider'], ['raid', kind]))).toBe(false);
    expect(huntsOffRoad(driver(['raider'], []))).toBe(false);
  });

  it('fails for drivers without the raider trait and for the brainless', () => {
    expect(huntsOffRoad(driver(['trader'], ['patrol']))).toBe(false);
    expect(huntsOffRoad(driver(['lawman'], ['investigate']))).toBe(false);
    expect(huntsOffRoad(undefined)).toBe(false);
  });
});
