// Runs the time limit cases with the game's real runner, setup and pool, and a 1 s default limit so a case fails in seconds.
import { defineConfig } from 'vitest/config';
import game from '../../../../vitest.config';

export default defineConfig({ ...game, test: { ...game.test, include: ['src/test/fixtures/limits/*.case.ts'], testTimeout: 1_000, hookTimeout: 1_000 } });
