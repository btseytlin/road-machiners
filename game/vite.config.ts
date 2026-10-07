import { defineConfig } from 'vite'
import { gameVersion } from './src/version'

// Agents edit files while the game runs, so the page reloads only by hand.
// A relative base lets the build run from any folder, like an itch.io upload.
export default defineConfig({
  base: './',
  // A headless harness that spawns many vite-node processes sets ROAM_NO_WATCH, so none of them watches the tree.
  server: { hmr: false, ...(process.env.ROAM_NO_WATCH ? { watch: null } : {}) },
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())),
    __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? ''),
    __ERROR_REPORT_URL__: JSON.stringify(process.env.ERROR_REPORT_URL ?? ''),
    __ERROR_REPORT_BUILD__: JSON.stringify(process.env.ERROR_REPORT_BUILD ?? ''),
  },
  // Maps are written without a link from the bundle. The factory moves them off the build before it publishes, and maps report stacks with them.
  build: { sourcemap: 'hidden' },
})
