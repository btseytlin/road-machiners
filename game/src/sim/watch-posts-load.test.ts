// The turn worker loads src/sim/path.ts before any NPC module. The nav layer
// then reaches watch-posts.ts through an import cycle, while the layer's own bindings are not yet set. Posts loaded in
// that order must still be found. A browser throws on such a read, and Node reads it as undefined.
import { expect, it } from 'vitest';

it('finds raider posts when loaded in the turn worker order', async () => {
  await import('./path');
  const { raiderGrounds, homeCamp } = await import('./npc-decisions');
  const { newWorld } = await import('./world');
  const { defaultSetup } = await import('./settings');
  const { START_KITS } = await import('../data/start');
  const { TEST_MAP } = await import('../test/map');
  const w = newWorld(1, START_KITS.standard, TEST_MAP, defaultSetup('roaming'));
  const raider = w.vehicles.find((v) => v.faction === 'raiders');
  if (!raider) throw new Error('the real map spawns no raider');
  const posts = raiderGrounds(w, homeCamp(raider));
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
});
