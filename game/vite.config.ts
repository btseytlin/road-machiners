import { defineConfig } from 'vite'
import { gameVersion } from './src/version'

export default defineConfig({
  base: './',
  server: { hmr: false },
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion(process.cwd())),
    __SAVE_SCOPE__: JSON.stringify(process.env.SAVE_SCOPE ?? ''),
  },
})
