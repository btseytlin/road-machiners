# Tools

Details of the `npm run` commands and debug tools. Run them from `game/`.

## Commands

- `npm run playtest` boots the game in headless Chromium on the Metal GPU, plays turns, and fails on page errors, the crash screen or low FPS. It needs the dev server running, at `--url` or the default port. Screenshots go to `.playtest/`. `--cpu` draws in software, skips the FPS check, plays 4 turns and gives each turn 60 seconds. Use it on machines without a GPU, like the factory server.
- `npm run econ -- --seeds 1,2,3 --days 30 --policy all` plays the sim economy with bot policies and writes wages, progression and the effort of every item to `tmp/econ/`. Travel and fights are abstract, with assumption numbers in `HARNESS` in `src/data/market.ts`.
- `npm run combat -- --enemies buggy,gunwagon,buggy+buggy --policy all --seeds 1-20` plays fights on flat open ground through the real turn pipeline and physics. The player truck stands, circles, charges or kites with auto fire. A kiting truck closes to near its longest gun range, then backs away nose first toward the foe, and NPCs run their own brains. It writes outcomes, hit rates and damage per lineup and policy to `tmp/combat/`. `--set RULES.leadError=3` changes one balance number for the run, so a tuning idea is measured before any code changes. `--trace` prints every turn.
- `npm run stuck -- --seeds 1-3 --turns 1000` plays a whole world of NPCs on the real map, each seed in its own process, and fails on any error or watchdog stall. It writes `tmp/stuck/seed-<n>.txt`. It takes about a minute.
- `npm run save:shape` records the saved shape of the current save format in `src/three/save-shape.json`.
- `npm run wiki` regenerates the tables in `docs/wiki/` from the code. A test fails when a table is stale or wiki prose names a data path or source file that no longer exists.
- `npm run loadouts -- --rolls 60 [--template merc] [--level heavy]` rolls many NPC loadouts per template and prints the gear level mix, guns, armor cover, cab cover, gear value, mass and cargo value. It writes `tmp/loadouts.md`. A test keeps each template's averages inside the `targets` bands of its loadout table.
- `npm run map:bake` builds the map from `MAPGEN.seed` in `src/data/terrain.ts` and writes `public/maps/icarus.bin`. It also writes a whole-map picture and close-ups to `tmp/map/`. A save made on another map does not load. Boot then offers to carry the player over, as [Saves](architecture/saves.md) describes, so a new map file needs no major save bump.
- `npm run perf -- --url <dev server>` boots the game in Chromium with the Metal GPU and times boot, turns, move previews, frames and the per-frame work of automatic travel. It fails on any miss against `scripts/perf-budgets.json`.
- `npm run sfx:board` opens the dev sound board for auditioning every cue.
- `npm run sfx:import -- <cue> <file...>` imports files as variants of a cue in `src/data/sounds.ts`.
- `npm run sfx:gen -- <cue> <count>` generates variants with ElevenLabs. It costs credits.
- `npm run sfx:reimport` rebuilds every sound file from the raw source path stored in its tags, after an import change.
- `npm run progression:record -- --archetypes trader,scavenger,fighter,mixed --seeds 1,2,3 --turns 2000` plays a bot per archetype and seed and writes each trace to `tmp/progression/`. Runs go in parallel. It is slow: about 75 seconds per 2000 turns per run.
- `npm run progression:report` replays every trace in `tmp/progression/` with the current XP rules. It prints the days to each skill level, the XP per day per archetype and misses against the targets in `src/data/skills.ts`.
- `npm run itch` builds the game and uploads it to itch.io with butler. It builds the last commit in a clean worktree and names the upload after it. [Publishing](publishing.md) has the one-time setup.

## Config

`src/config.ts` holds the world seed, start kit, combat playback times, save interval, automatic turn delay, Space hold delay and travel speed multiplier. The world seed drives sim randomness, like where the first NPCs start, but not the map. A null seed rolls a new one for each new game, and the save keeps it. `.env` holds `ELEVENLABS_API_KEY` and `SFX_MAX_GENERATIONS` for sound generation and `ITCH_TARGET` and `BUTLER_API_KEY` for publishing.

## Browser checks

Drive the game with a Playwright script in `tmp/`. Launch Chromium with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`, so it renders on the real GPU. SwiftShader renders on the CPU at 10 to 20 fps, so its frame rate says nothing about the game. The game is on `window.__ROAM__` in dev. Its world is `__ROAM__.state`. To set up a situation, clone that world, edit it, and pass it to `apply()`. `debugScreenOf(x, y)` gives the screen point of a map point on the ground, for clicks. `node scripts/garage-ui-check.mjs <url>` checks the garage: mouse and keyboard selection drives the shop comparison, the garage header and repair bar labels, and the layout at 1280, 1024 and 800 wide.

## Debugging

- In dev, any uncaught error shows a fullscreen crash screen with the message. Outside dev, errors after boot go to the browser log and the debug console, and the game keeps running. Boot errors always show the crash screen. A failed turn does not play: the log shows it, automatic turns stop, and no save is written until a turn completes without an error.
- The backquote or § key opens the debug console in every build. Type `help` for its cheat commands. `src/ui/console.ts` parses the commands and calls one pure function per cheat in `src/sim/cheats.ts`. Bad input throws `CheatError`, which the console prints. Any other error reaches the crash screen. God mode is a saved player flag. It restores the truck in `endTurn` before the destruction and defeat checks.
- `src/perf.ts` holds named timers for seams, never hot loops, and merges worker measurements into the main counters. The console command `fps` shows them in a panel in the top left.
