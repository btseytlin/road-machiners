import { expect, it } from 'vitest';

it('loads the deck module on its own, with no import cycle at module load', async () => {
  const bridge = await import('./bridge');

  expect(bridge.decksOf({ kind: 'highway', seed: 4, window: 1 }).decks.length).toBeGreaterThanOrEqual(0);
  expect(bridge.decksOf({ kind: 'icarus' }).decks.length).toBeGreaterThan(0);
});
