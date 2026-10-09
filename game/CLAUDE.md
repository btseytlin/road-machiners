# Road Machiners

Turn-based wasteland truck RPG in 3D with an isometric positioned camera.

Read [docs/DESIGN.md](docs/DESIGN.md) before any game change and before answering any question about the game. It is the source of truth for what the game should be. The detailed rules behind each of its sections live in [docs/wiki/mechanics/](docs/wiki/mechanics/). A rule change updates the mechanics page, and DESIGN.md changes only when a principle does.

Every change a player sees in the HTML UI or an overlay goes through [docs/ui.md](docs/ui.md), the UI design system. That covers a new screen, panel, tooltip, notice, button, label or line of UI text. Plan it with the steps in "How to build a screen", build it from the shared formatters and pieces, and check the screenshots against the principle tests. A change that breaks a principle names it and says why, and a new pattern goes into docs/ui.md in the same change.

## Stack

Three.js for drawing, Rapier for vehicle physics, TypeScript, Vite, Vitest. Playwright for browser checks.

## Docs

Read the doc for an area before changing it.

- [Tools](docs/tools.md): command flags, config, browser checks, debug console and perf timers.
- [NPCs, combat and deals](docs/architecture/npcs.md): brains, states, hostility, dialogue, tows, escorts and aid.
- [Economy, jobs and progression](docs/architecture/economy.md): salvage, shops, wear, jobs, sites and XP.
- [Movement](docs/architecture/movement.md): NPC driving, routes, physics turns, far NPCs, auto travel and the camera.
- [Rendering and UI](docs/architecture/render.md): outlines, scope, props, debris, tips and audio.
- [UI design system](docs/ui.md): the principles, patterns, tokens and shared pieces every screen and overlay follows. `npm run dev` serves a live guide at <http://localhost:5173/ui.html>.
- [Map and world](docs/architecture/map.md): the bake layers, the bridge, weather and vision.
- [Saves](docs/architecture/saves.md): slots, boot, versions and rescue.
- [Principles](docs/architecture/principles.md): the project's architecture principles every design answers to, like one rulebook for every truck, no hot full scans and same seed, same game.
- [Art pipeline](docs/art.md): Blender models, the truck grid projection and part model rules.
- [Sound](docs/sound.md), [Publishing](docs/publishing.md), [Wiki](docs/wiki/README.md).

## Commands

Run these from `game/`. The repo-wide quality gate and pre-commit hook run from the repo root. See the root [CLAUDE.md](../CLAUDE.md). [Tools](docs/tools.md) has flags and outputs.

- `npm run dev` starts the game at <http://localhost:5173>.
- `npm test` runs every Vitest test in `src/`. `npm run typecheck` runs tsc.
- `npm run test:cached -- --cache <dir> [test files]` skips every test file whose imports, disk reads and global inputs already passed there, and prints `[test-cache] ran N, skipped M, uncacheable K`. The factory checks use it. The factory's release playtest runs `npm test`.
- `npm run playtest` plays turns in headless Chromium and fails on errors or low FPS. It needs the dev server. Use `--cpu` on machines without a GPU. `--no-fps-gate` keeps the GPU run but only prints the FPS. The factory uses it everywhere but the release candidate, since its host runs many jobs at once.
- `npm run stuck` records a trader bot for 2 seeds of 500 turns and fails on any stall from any truck. Run it after changes to NPC goals, services or tows.
- `npm run progression:record`, `progression:report`, `progression:analyze` and `progression:watch` are the playtest harness. Bots play the real turn pipeline headless with every NPC alive, and each run writes logs of every turn. It covers economy, progression, NPC behavior and fights at the macro level. `progression:playthrough` writes the full activity log of one markov bot run, which the factory's release playtest reads.
- `npm run combat` plays single fights with physics, for hit rates and ram detail the recorder does not model. `npm run loadouts` rolls NPC gear.
- `npm run perf` fails on a miss against `scripts/perf-budgets.json`.
- `npm run map:bake` writes `public/maps/icarus.bin`. Commit it after a change to map rules.
- `npm run models:shapes`, `npm run wiki` and `npm run save:shape` regenerate checked files. A test fails when they are stale.
- `npm run sfx:board`, `sfx:import`, `sfx:reimport`, `sfx:report` and `sfx:gen` manage sounds. `sfx:gen` costs credits, so ask before running it.
- `npm run itch` publishes to itch.io.

Game settings live in `src/config.ts`. Copy `.env.example` to `.env` for sound generation and publishing keys.

## Architecture

- `src/sim/` holds all game state and rules as plain TypeScript. It never imports Three.js or Rapier, so it runs in Node tests.
- Sim functions take state and return new state. Rendering reads state and never changes rules.
- `src/sim/world.ts` runs the turn pipeline. Commands go through `update()`, which clones the world and mutates the draft.
- `src/data/` holds all balance numbers and content. Sim code reads numbers from there, never inline.
- `src/phys/` runs vehicle movement in Rapier and plugs into the turn pipeline. The path preview runs the same physics as the turn.
- `src/three/` holds the 3D game, with `game.ts` wiring input, sim, physics, view and UI. `src/three/render/` holds the 3D views, `src/render/` the palette, painters and part looks, and `src/ui/` the HTML panels.
- `src/mapgen/` bakes the map offline. The game only reads the map file.
- Map coordinates are in tiles. Physics and 3D space are in meters: map x is 3D x, map y is 3D z, height is 3D y. `src/phys/frames.ts` converts.
- The UI shows real units. `src/ui/units.ts` converts from sim units, with display numbers in `src/data/units.ts`.

One owner per concept. Use these and do not decide the same thing elsewhere:

- `inCombat()` and `inCombatWithOther()` in `src/sim/combat.ts` decide combat. A hostile in sight is only a warning.
- `src/sim/stats.ts` gives speed, turning and capacity.
- `src/sim/wear.ts` is the only writer of part HP.
- `workOf()` in `src/sim/states.ts` gives timed work, so new work gets a progress bar.
- `practice()` in `src/sim/progress.ts` is the only way to gain XP.
- `talkOf()` in `src/sim/dialogue.ts` is the one place talk reads traits.
- `propPose()` in `src/sim/mapgen.ts` gives each prop's turn and scale.
- `src/sim/body.ts` is the only conversion between grid cells and meters.
- `src/sim/utility.ts` owns utility charge, orders, the activation step and the emitter shutdown. Each utility effect's world object has one owner: `hazards.ts` for smoke, ground fields and flares, and `claymore.ts`. `harpoon.ts` owns the lines of the harpoon, which is a gun.
- Timed deals between two trucks are states in `src/sim/states.ts`. New group work adds a state kind, not a goal.
- A `stall` event is always a bug.
- Truck meshes own stencil bit `TRUCK_BIT` and props `PROP_BIT`. Other views must not write them.

## Save migrations

Players keep their saves across updates. Migrate old saves whenever possible. [Saves](docs/architecture/saves.md) has the details.

- A change to the saved shape needs a new format. That covers any type in `src/sim/types.ts` reachable from `World`, and any renamed or removed content id in `src/data/`.
- A change that old saves can follow adds one step to `MIGRATIONS` in `src/three/save-migrations.ts`.
- A change that old saves cannot follow bumps `SAVE_MAJOR` and empties `MIGRATIONS`. Ask me before any major bump. A new map file needs no bump.
- A step is a pure function from the saved world JSON of minor format N to N+1. It never imports sim or data code. It holds its own copies of any old ids or values it needs.
- Never edit a committed step. Fix a bad step with a new step.
- Every step gets a Vitest test on a fixture from `src/three/save-fixtures/`.
- Run `npm run save:shape` after the new step or major bump.
- A change to world state gets a test that saves the world, loads it and checks the loaded world. Load must give back the same world and award nothing: no XP, money or events.
- A save holds only what load cannot rebuild. Load rebuilds derived state with the same function the turn uses, so that function must not change anything else. Rewards for what a refresh finds go in a separate call in the turn pipeline, as `practiceContacts()` does for `refreshVision()`.

## Agent practices

Read the project-local skills before related work:

- [Responsibility-driven design](.agents/skills/responsibility-driven-design/SKILL.md) before designing or changing code.
- [Testing practices](.agents/skills/testing-practices/SKILL.md) before testing, debugging, or reviewing changes.
- [TypeScript practices](.agents/skills/typescript-practices/SKILL.md) before JavaScript or TypeScript work.

## Verification

- Before calling a change done, inspect how related systems will be affected by it.
- Find the existing code that does the same kind of thing, and match everything it handles. A new way to end a deal must settle money, states and goals like the old ways.
- Tests check the side effects of a change, not only the behavior you asked for.
- Every sim rule change gets a Vitest test.
- After render or game changes, run `npm run playtest`.
- Playtest game behavior with the progression recorder, not by hand or in the browser. Record the bots that meet the change, then read the report and the analyzer before you draw a conclusion. A 3-seed 5-day batch takes about 10 minutes per bot, so run it in the background with a log. [Tools](docs/tools.md) has the flags.
- Use a Playwright script in `tmp/` on the real GPU only for what the screen shows: UI, rendering and screenshots. [Tools](docs/tools.md#browser-checks) describes it. The game is on `window.__ROAM__` in dev.
- Look at screenshots after visual changes. The user confirms small visual details.

## Art

Props and truck parts are low-poly models built by Blender scripts in `tools/blender/`. Follow [Art pipeline](docs/art.md) to add or change a model. Render a preview, take an in-game screenshot and run `npm run playtest`.
