import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { gameVersion } from './src/version';

export default defineConfig({ define: { __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())), __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? '') }, assetsInclude: ['**/*.glb'], test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test/yield-setup.ts'], maxWorkers: Math.min(6, availableParallelism()), testTimeout: 30_000 } });
