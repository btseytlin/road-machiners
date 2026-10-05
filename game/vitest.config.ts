import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { timeoutsOff } from './src/test/timeouts';
import { gameVersion } from './src/version';

// Each 600-tile simulation worker holds terrain and routing grids. Six workers keep their measured combined heap below the machine's budget. A machine with fewer cores gets one worker per core, since more workers starve each other and vitest's worker calls time out.
// The factory pins its containers to their own CPUs, and availableParallelism() counts only those.
// Model files load as assets, so view tests can inline them.
// Where test time limits are off, the default test and hook timeouts are 0, which vitest reads as no limit. `budget()` in src/test/budget.ts does the same for a test's own timeout.
const off = timeoutsOff();
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], maxWorkers: Math.min(6, availableParallelism()), testTimeout: off ? 0 : 30_000, hookTimeout: off ? 0 : 10_000 } });
