import { defineConfig } from 'vite'
import { gameVersion } from './src/version'

export default defineConfig({
  base: './',
  server: { hmr: false, ...(process.env.ROAM_NO_WATCH ? { watch: null } : {}) },
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())),
    __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? ''),
    __ERROR_REPORT_URL__: JSON.stringify(process.env.ERROR_REPORT_URL ?? ''),
    __ERROR_REPORT_BUILD__: JSON.stringify(process.env.ERROR_REPORT_BUILD ?? ''),
  },
  build: { sourcemap: 'hidden' },
})
