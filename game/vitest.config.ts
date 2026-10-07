import { defineConfig } from 'vitest/config';
import { timeoutsOff } from './src/test/timeouts';
import { testWorkers } from './src/test/workers';
import { gameVersion } from './src/version';

// `testWorkers()` in src/test/workers.ts sets how many workers run at once.
// Model files load as assets, so view tests can inline them. The settled runner starts each test only after the worker's status messages have their replies, so a long synchronous test cannot time them out.
// Where test time limits are off, the default test and hook timeouts are 0, which vitest reads as no limit. `budget()` in src/test/budget.ts does the same for a test's own timeout.
const off = timeoutsOff();
export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], runner: 'src/test/settled-runner.ts', maxWorkers: testWorkers(), testTimeout: off ? 0 : 30_000, hookTimeout: off ? 0 : 10_000 } });
