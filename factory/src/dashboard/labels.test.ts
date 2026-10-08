import { expect, it } from 'vitest';
import { LOOP_STEPS } from './delivery';
import { LABELS } from './labels';

it('labels every loop step and nothing else', () => {
  expect(Object.keys(LABELS.loops).sort()).toEqual([...LOOP_STEPS].sort());
});
