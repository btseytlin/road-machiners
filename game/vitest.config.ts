import { defineConfig } from 'vitest/config';
import { testLimits } from './src/test/timeouts';
import { testWorkers } from './src/test/workers';
import { gameVersion } from './src/version';

export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? ''), __ERROR_REPORT_URL__: JSON.stringify(''), __ERROR_REPORT_BUILD__: JSON.stringify('') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], runner: 'src/test/settled-runner.ts', pool: 'forks', maxWorkers: testWorkers(), ...testLimits() } });
