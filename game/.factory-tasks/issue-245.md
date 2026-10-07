# Retreating and limping raiders keep off roads, and stranded trucks make no sound or dust

**Status:** executed
**Branch:** factory/issue-245
**Worktree:** none
**Goal:** In the recorder, a raider that retreats, flees or is stranded drives beside roads and only crosses them, while other raiders and all other drivers keep using roads as today; and a stranded truck of any kind, the player included, raises no new engine-sound contact and no new dust, while a healthy slow truck is still heard.
**Mode:** hands-off

## Reference images

The issue has no reference images, and it asks for no particular look.

## Context

- `isStranded()` (`src/sim/stats.ts:63`) already means "can only crawl": no working engine, a broken transmission or an empty tank. `vehicleStats()` caps such a truck at `limpSpeed`. Wheel damage alone only cuts speed by `RULES.wheelLoss` 0.15 per broken wheel and never brings a truck down to a crawl.
- `soundRange()` (`src/sim/detect.ts:28`) is zero only when the truck is parked, stalled or has no working engine. A truck with an empty tank or a broken transmission that crawls with a working engine is heard at `DETECT.sound.limp` range. This breaks the rule in `docs/wiki/mechanics/defeat.md` that a pushed truck makes no sound.
- `dustRange()` (`src/sim/detect.ts:53`) checks `v.speed <= RULES.limpSpeed`. The player's crawl skill raises a stranded truck's limp speed above `RULES.limpSpeed` (`limpSpeedOf`, `stats.ts:175`), so a skilled stranded player still raises dust.
- Contacts are computed from the current state: `refreshVision()` runs again after fire and damage in `endTurn` (`src/sim/world.ts:263-310`), and NPC decisions call `contactsOf` during `resolveNpcActivities`. A rule that reads `isStranded` at that point leaves no stale emission.
- The player's own engine loop (`Game.playDriveSound`, `src/three/game.ts:792`) plays from frame speeds alone, so a stranded player still hears an engine.
- Every route goes through `route()` (`src/sim/path.ts:24`). Road tiles and ground beside sites cost 1, other ground `offRoadCost` 1.75 (`routeCost`, `nav/layer.ts:101`). A per-driver `Taste` multiplies every step cost in the fine search, the coarse corridor and the shortcuts (`tasted`, `layer.ts:503`). No route option avoids roads.
- `route()` returns a straight line at once when that line runs on road only (`path.ts:33`), before any taste applies.
- Routes are reused: physics keeps `mem.route` and calls `continueRoute()` (`src/phys/drive.ts:483-485`), and far travel keeps the saved `brain.farRoute` while the order's point is unchanged (`src/sim/far.ts:63`). A truck whose state changes on the way to the same point keeps its old route.
- Retreat after a knockout is the `retreat` goal (`retreatHome`, `npc-activities.ts:921`). Flight from a fight or a hostile is the `flee` goal (`fleeFrom`, `npc-activities.ts:605`). A stranded raider heads for its camp by the service goals. Waiting for a tow and the teleport home out of the player's gray vision (`advanceRetreat`, `defeat.ts:208`) do not use a route.
- Raiders have `faction === 'raiders'`. Their patrols and raids use plain routes and stay that way.

## Design

Two rules, each with one owner.

**Stranded trucks are silent.** `isStranded()` is the one "limping" test. `soundRange()` returns 0 for a stranded truck, and `dustRange()` returns 0 for one, on top of today's speed checks. A healthy truck driving at a crawl keeps its engine sound and, as today, raises no dust at or below `RULES.limpSpeed`. Both functions take any vehicle, so the player and NPCs hide and hear alike. Old clouds age and fade as before. Sight, scanner, beacon and spotter marks are not touched: scanner and beacon do not read `soundRange`. The player's engine loop stays silent for a turn that ends with the player's truck stranded, so the player hears the rule.

**Raiders that run or limp keep off roads.** A new owner, `keepsOffRoads(world, v)` in `src/sim/off-road.ts`, is true for a raider whose top goal is `retreat` or `flee`, or that is stranded. `route()` asks it and, when true, plans with an off-road taste: the driver's own taste, with every road tile multiplied by `REGION.navigation.roadShyCost`. Ground beside sites keeps its road price, so camp and town access stays cheap. The penalty is a cost, never a block. A route exists exactly when the plain route exists, a road between the truck and its camp is crossed where it must be, and cliffs and obstacles are avoided as before. The straight all-road shortcut in `route()` is skipped for an off-road taste. A kept route remembers whether it was planned off road, and a route kept under the other style is thrown away and planned again, so a raider that runs dry or loses its engine mid-trip turns off the road on the next plan.

`roadShyCost` is 6. Off-road ground costs at most about 1.3 × 1.75 / 0.9 = 2.5 per tile with the worst taste on hardpan, and a road at least 0.7 × 6 = 4.2, so ground beside a road always beats the road itself, even after the 20% weighted A* slack. Crossing a road a few tiles wide costs a dozen tiles more, so a route goes around a road only where the road ends close by.

Approaches weighed:
- Off-road taste on the existing planner (chosen). It reuses the single planner, its caches and its cliff rules, and it degrades to a crossing where no other way exists.
- Blocking road cells for these drivers. It fails when a road must be crossed or leads into a camp, which the issue forbids.
- A separate safe-spot goal that picks off-road waypoints. It adds a second way to choose where a truck drives and still needs the planner to avoid roads between waypoints.

Scope limits: lawmen, traders and every other faction keep plain routes. Ordinary raider patrols, raids and fights by healthy raiders keep plain routes. Healthy raider ambush tactics are issue #244, which can extend `keepsOffRoads` later. The tow route, the towed truck, waiting for a tower and the teleport home are unchanged, so a truck that cannot move stays where it is or is recovered by the existing rules (#177). The stranded robbery rules of #98 and the heard-contact rules of #226 are unchanged.

TDD: yes. These are deterministic sim rules with clear red tests.

### Invariants

- IV1 — `soundRange(world, v)` and `dustRange(world, v)` are 0 whenever `isStranded(world, v)`, for the player and NPCs.
- IV2 — A healthy, unstalled truck with a working engine moving at or below limp speed has `soundRange > 0`.
- IV3 — `keepsOffRoads(world, v)` is true only for `faction === 'raiders'` with a top goal of `retreat` or `flee`, or stranded. It is false for any truck without a brain.
- IV4 — An off-road route and a plain route between the same points end on the same cell, since only costs differ.
- IV5 — A kept route is reused only when its style matches `keepsOffRoads` now, in both `continueRoute()` and far travel.
- IV6 — The route cache key tells off-road and plain tastes apart.

### Principles

- PC1 — One rulebook (project principle 1): the sound and dust rules read only the truck's state and never branch on the player. Keeping off roads is a driver decision of NPC raiders, like their goals. The player plans its own route, and its auto travel stays a plain route. No rule branches on the player.
- PC2 — The sim owns the rules (project principle 2): the engine loop in `src/three/game.ts` reads `isStranded()`. The recorder snapshot reads `keepsOffRoads()` and `onRouteRoad()`. Neither keeps its own copy.
- PC3 — Hot code uses an index (project principle 3): `keepsOffRoads` reads one vehicle's goal stack and core parts, with no world scan, once per route call. The road test is an O(1) read of a per-terrain `Uint8Array` built once next to `flatCost`, sized by the map tiles. No new loop over `world.vehicles`, `world.roads` or `world.obstacles`.
- PC4 — Value (project principle 4): no source or sink of value changes.
- PC5 — Save facts (project principle 5): `NpcBrain.farRoute` gains `offRoad: boolean`, with one minor migration step that sets `offRoad: false` on every saved far route, since every old route was planned with roads. New caches: the road array keyed by terrain identity, like `flatCost`, and the route cache key gains the taste style.
- PC6 — Same seed (project principle 6): no new random draws.
- PC7 — Fail loud (project principle 7): the off-road taste never blocks a cell, so the existing throws in `search()` still mean a broken grid. Far travel throws on a saved far route without `offRoad`, which the migration makes impossible. A stall from a crawling raider on an off-road route is a bug, caught by `npm run stuck` and the analyzer.

### Assumptions

- AS1 — `isStranded` covers what the issue calls a broken engine or transmission, an empty tank and severely damaged mobility. Broken wheels alone never bring a truck to a crawl, so they do not count.
- AS2 — A crawling truck on off-road ground off a road climbs what the slope cost lets the planner choose. The recorder's stall check confirms this.
- AS3 — A stranded raider pushes and burns no fuel, and a fleeing or retreating raider with fuel judges its reserve as a straight line, so longer off-road routes do not run more raiders dry. The analyzer's dry tanks confirm this.

### Unknowns

- UK1 — Whether a coarse corridor that follows a road valley squeezes an off-road fine search onto the road. Execution checks it with the route test on the real map. If it happens, the coarse search already reads the taste at edge midpoints, and a corridor miss falls back to the full fine search.

## Plan

Approach: add the silence to the two detector functions, add the off-road owner and a taste style to the planner, make both kept routes remember their style, and expose both to the recorder and the docs. Tests first in each phase.

### PH1 — Stranded trucks make no sound or dust
- 1.1 `src/sim/detect.ts:27-58` (modify)
  - `soundRange(world, v)` — return 0 when `isStranded(world, v)`, next to the parked, engine and stall checks. Update its comment.
  - `dustRange(world, v)` — return 0 when `isStranded(world, v)`. Update its comment.
  - Respects: IV1, IV2, PC1.
- 1.2 `src/sim/detect.test.ts` (modify) — tests:
  - A truck moving at limp speed is heard with a working engine and healthy parts, and not heard with an empty tank, a broken transmission or no working engine. Each case also gives `dustRange` 0 on dusty ground in daylight.
  - A stranded player with the crawl skill above `RULES.limpSpeed` raises no dust cloud in `advanceDust`.
  - Transition: the same truck is a sound contact for an NPC observer and for the player's `refreshVision`; the engine breaks or the tank empties; the next `contactsOf` has no sound source and `advanceDust` adds no cloud; an older cloud keeps aging. A repaired engine or refuelled tank gives sound back.
  - Symmetry: an NPC stranded is unheard by the player, and the player stranded is unheard by an NPC.
  - A stranded truck with a beacon on still gives a beacon contact, and a scanner still detects it while it moves.
- 1.3 `src/three/game.ts:792-798` (modify) — `playDriveSound()` returns before the engine glide when `isStranded(this.world, playerVehicle(this.world))`. The air brake cue stays. Respects: PC2.
- Commit: Stranded trucks make no engine sound and raise no dust

### PH2 — Off-road route style in the planner
- 2.1 `src/data/region.ts:212-243` (modify) — `navigation.roadShyCost: 6`, with a comment that states the cost bound from the Design.
- 2.2 `src/sim/nav/layer.ts:23-35,77-92,449-509` (modify)
  - `TerrainNav` gains `roadTile: Uint8Array` (1 for a tile of type road that is not beside a site), built in `terrainEntry()` in the same loop as `flatCost`.
  - `onRouteRoad(nav: TerrainNav, x: number, y: number): boolean` — exported query on that array.
  - `Taste` gains `roads: Uint8Array | null` and `size: number`. `makeTaste()` sets `roads: null`.
  - `offRoadTaste(taste: Taste, nav: TerrainNav): Taste` — the same taste with `roads = nav.roadTile`.
  - `tasted(t, cost, x, y)` multiplies by `REGION.navigation.roadShyCost` when `t.roads` marks the tile.
  - `tasteKey(t)` appends `:off` when `t.roads` is set. Respects: IV6, PC3.
- 2.3 `src/sim/off-road.ts` (create) — `keepsOffRoads(world: World, v: Vehicle): boolean` with the rule of IV3, reading `topGoal()` and `isStranded()`. A header comment names it the one owner, for #244 to extend.
- 2.4 `src/sim/path.ts:22-45,105-130` (modify)
  - `route(world, from, dest, radius, extra, driver?: Vehicle)` — the driver type widens from `Pick<Vehicle, 'id' | 'brain'>` to `Vehicle`. A new local `routeTaste(world, nav, driver)` returns `offRoadTaste(tasteOf(...), nav)` when `keepsOffRoads`, else `tasteOf(...)`. The all-road straight-line return is skipped for an off-road taste.
  - `KeptRoute` gains `offRoad: boolean`. `keepRoute(world, dest, points, extra, driver?: Vehicle)` sets it.
  - `continueRoute(...)` returns null when `kept.offRoad` differs from the driver's current style, and straightens with the same `routeTaste`. Respects: IV4, IV5.
- 2.5 Callers whose driver argument is not a full `Vehicle` today, in `src/` and tests, pass the vehicle. Expected callers: `ai.ts:338-339`, `drive.ts:483-485`, `npc-activities.ts:1089`, `tow.ts:358`, `game.ts:889`. `drive.ts:485` passes `v` to `keepRoute`. `far.ts:63` changes in PH3.
- 2.6 `src/sim/path.test.ts` and `src/sim/off-road.test.ts` (modify/create) — tests:
  - `keepsOffRoads`: true for a raider with top goal `retreat`, top goal `flee`, or stranded with any goal; false for a healthy raider on patrol, raid or fight, for a stranded trader, a fleeing lawman, and the player.
  - On a test terrain with a straight road from the start to a camp-like site and open hardpan beside it: the plain route runs on the road; the off-road route has no run of road tiles longer than a crossing, measured with `onRouteRoad` along the route; both end on the same point.
  - A road lying across the way: the off-road route crosses it once and the crossing is no longer than the road's width plus the truck's reach.
  - A cliff beside the road: the off-road route never touches the cliff, as the plain one.
  - The real map: a raider at a point beside a road toward its camp routes off road to the camp pad, with the road share of the route below that of the plain route and no run of road longer than a crossing outside the site margin. This answers UK1.
  - The route cache returns different points for the same driver, points and blockers with and without the off-road style.
  - `continueRoute` drops a kept route once the driver turns stranded, and keeps it while the style is unchanged.
- Commit: Raiders that retreat, flee or are stranded plan routes off roads

### PH3 — Far travel remembers the route style, with a save step
- 3.1 `src/sim/types.ts:205` (modify) — `farRoute?: { dest: Vec; points: Vec[]; offRoad: boolean }`.
- 3.2 `src/sim/far.ts:61-63,105-120` (modify) — `FarRoute` gains `offRoad`. A stored route is reused only when its dest matches and `stored.offRoad === keepsOffRoads(w, v)`. A new route is kept with that style. The player's headless route stores `offRoad: false`, since the player has no brain.
- 3.3 `src/three/save-migrations.ts:236-303` (modify) — one new step at the end of `MIGRATIONS`, named after its formats like `pooledSkills_9_10`, that sets `offRoad: false` on every `vehicles[].brain.farRoute`. It imports nothing from sim or data.
- 3.4 `src/three/save-migrations.test.ts` (modify) — the step on the newest fixture in `src/three/save-fixtures/`: every far route gains `offRoad: false`, and nothing else changes. Add a fixture for the new format if the existing tests expect one per format.
- 3.5 Run `npm run save:shape` and commit `src/three/save-shape.json`.
- 3.6 `src/sim/far.test.ts` (modify) — a far raider on its way to its camp pad with a kept road route runs dry; the next far step plans a new off-road route to the same pad. A healthy raider keeps its kept route.
- Respects: IV5, PC5, PC7.
- Commit: Far routes remember whether they keep off roads

### PH4 — Behavior tests through the turn pipeline
- 4.1 `src/sim/npc-recovery.test.ts` or `src/sim/defeat.test.ts` (modify) — deterministic tests, each on a fixed seed:
  - A raider knocked out beside a road toward its camp wakes and retreats with an off-road route, and still reaches its camp pad and refits.
  - A raider chasing on a road loses its engine or fuel: its next route keeps off the road. A raider that turns to `flee` when weak routes off road.
  - A stranded raider that can crawl heads to camp off road, as a stranded trader on the same spot keeps the road.
  - A stranded raider waiting for a tower does not move, and one out of the player's gray vision for `RULES.retreatTeleportTurns` still appears at its home pad.
  - A healthy raider on patrol keeps the road.
- Commit: Test raider retreat and stranded travel off roads

### PH5 — Recorder trace, docs and playtests
- 5.1 `src/sim/progression/turn-log.ts:83,98-115` (modify) — `TruckSnap` gains `offRoad: boolean` from `keepsOffRoads` and `onRoad: boolean` from `onRouteRoad`.
- 5.2 `scripts/progression-analyze.mjs` (modify) — a section "raiders keeping off roads": snapshots with `offRoad` true, the share of them with `onRoad`, split by goal, next to the share for healthy raiders.
- 5.3 Docs:
  - `docs/wiki/mechanics/detection.md` — engine sound: a stranded truck makes no sound, even with its engine running; dust: a stranded truck raises none; a healthy truck at a crawl is still heard.
  - `docs/wiki/mechanics/defeat.md:20` — the pushed truck sentence covers every stranded truck.
  - `docs/wiki/mechanics/npcs.md:16` — raiders that retreat, flee or are stranded keep off roads, crossing only where they must.
  - `docs/wiki/mechanics/turns.md:15` — the road preference has this one exception.
  - `docs/architecture/movement.md` — the off-road taste, `keepsOffRoads` as its owner and the kept-route style check.
  - Run `npm run wiki` and commit any table change.
- 5.4 Verification runs, in the background with logs:
  - `npm test`, `npm run typecheck`, `npm run quality` from the root.
  - `npm run stuck`: no stall.
  - `npm run progression:record` with the `hunter` and `trader` bots, seeds 1-3, 5 days, before and after the change into two `--out` directories. Then `progression:report` and `progression:analyze` on both. Pass: the off-road raider share on road is far below the healthy raider share, and no rise in stalls, dry tanks or stranded time from raiders.
  - `npm run perf` against `scripts/perf-budgets.json`: no miss.
  - `npm run playtest` (with `--cpu` on a machine without a GPU).
  - A Playwright script in `tmp/` on the real GPU: clone `__ROAM__.state`, put a stranded raider beside a road a few tiles from its camp and the player within sight, play turns, and take a screenshot each turn. A player checks in the shots that the raider drives beside the road, not on it, crosses it at most once, raises no dust behind it, and that no sound arc points at it once it leaves sight. A second run with a healthy raider on patrol shows it on the road with dust.
- Commit: Trace and document raiders keeping off roads

### Test strategy
- Sim rules first, red then green: detection in PH1, the owner and planner in PH2, far routes and the save step in PH3, the turn pipeline in PH4.
- Side effects checked: healthy slow trucks stay audible, scanner and beacon contacts stay, other factions and healthy raiders keep roads, recovery and the teleport home still work, route endpoints do not change.
- Game behavior: recorder and analyzer in PH5, not the browser. The browser run only shows the look.

### Order & dependencies
- PH1 stands alone. PH2 blocks PH3, PH4 and PH5. PH3 blocks PH4, whose far-travel case needs the style check.

### Risks / rollback
- RK1 — Crawling raiders on off-road ground stall on slopes. Mitigation: `npm run stuck` and the analyzer stalls. A stall is fixed in the planner or the slope cost, never by letting the raider back on the road.
- RK2 — Off-road searches visit more cells and slow turns. Mitigation: `npm run perf`. Few raiders keep off roads at once.
- RK3 — Changing the driver type of `route()` breaks test helpers that pass partial drivers. Mitigation: pass real vehicles from `testkit.ts`.
- RK4 — Seeded tests shift where raiders now drive differently. Mitigation: reseed or adjust only tests whose raider now keeps off roads, and say why in the commit, as #98 did.
- Rollback: each phase is its own commit. The save step stays even if later code is reverted, since a committed step is never edited.

### Interfaces
- IF1 — `keepsOffRoads(world: World, v: Vehicle): boolean` in `src/sim/off-road.ts`. The rule of IV3.
- IF2 — `onRouteRoad(nav: TerrainNav, x: number, y: number): boolean` and `offRoadTaste(taste: Taste, nav: TerrainNav): Taste` in `src/sim/nav/layer.ts`.
- IF3 — `route(..., driver?: Vehicle)`, `keepRoute(world, dest, points, extra, driver?: Vehicle)` and `KeptRoute.offRoad` in `src/sim/path.ts`.

### Interface graph
- PH1 -> @ src/sim/detect.ts, src/sim/detect.test.ts, src/three/game.ts
- PH2 -> IF1, IF2, IF3 @ src/data/region.ts, src/sim/nav/layer.ts, src/sim/off-road.ts, src/sim/off-road.test.ts, src/sim/path.ts, src/sim/path.test.ts, src/sim/ai.ts, src/phys/drive.ts, src/sim/npc-activities.ts, src/sim/tow.ts
- PH3 IF1 -> @ src/sim/types.ts, src/sim/far.ts, src/sim/far.test.ts, src/three/save-migrations.ts, src/three/save-migrations.test.ts, src/three/save-shape.json
- PH4 IF1, IF3 -> @ src/sim/npc-recovery.test.ts, src/sim/defeat.test.ts
- PH5 IF1, IF2 -> @ src/sim/progression/turn-log.ts, scripts/progression-analyze.mjs, docs/

PH1 and PH2 both touch `src/three/game.ts`: PH1 owns it, and PH2 only changes the argument at line 889 if the type needs it, after PH1.

## Conclusion

### Hands-off decisions

- udesign: "limping" is `isStranded()`, the existing crawl-only test, rather than a new predicate — it already owns the meaning, and wheel damage never forces a crawl.
- udesign: off-road is a route cost (`roadShyCost` 6), not a block — the issue requires crossings and camp access and forbids a stuck search.
- udesign: a stranded raider keeps off roads in every goal, its fights too — one rule is simpler, and a stranded raider in a fight only crawls.
- udesign: the player's engine audio goes silent while stranded — the issue asks that a limping car make no engine noise, and the rule docs already say a pushed truck makes none.
- udesign: `farRoute` gets a saved `offRoad` flag with a minor migration, rather than no flag — without it a far raider that runs dry on the way to the same camp keeps its road route.
- uplan: plan auto-approved.

### Execution

Five commits, one per phase: `ba031bec` (PH1), `0fd02b15` (PH2), `2460f644` (PH3, save format 2.14), `fed641e2` (PH4), `956a5cce` (PH5).

- UK1 answered: on the real map, a fleeing raider on the road 70 tiles north east of Kiln Camp routes to the gate with 1.6% of its length on road against 64% for the plain route, with about the same length (67.1 against 66.5 tiles). The coarse corridor does not squeeze it onto the road. The test in `path.test.ts` keeps this.
- Wiring check: `keepsOffRoads` is read by `route()`/`keepRoute()`/`continueRoute()` in `path.ts`, `advanceFar` in `far.ts` and the recorder snapshot. `onRouteRoad` and `offRoadTaste` are used as declared. Every `route()` caller passes a full `Vehicle` (tsc clean).

### Deviations from plan

- PH4 tests live in `src/sim/off-road.test.ts` instead of `npc-recovery.test.ts`/`defeat.test.ts`, and move trucks with the recorder's far rules (`advanceFar` for every truck) instead of physics. Why: the quality gate forbids new `src/sim` imports of `src/phys`, and these trucks are far from the player, so they take the far path in the game too. The physics path is covered by the `continueRoute` style test in `path.test.ts`.
- PH4 has no separate pipeline test for a raider that turns to `flee` when weak, for waiting for a tower, or for the teleport home. Flee routing is covered by the `keepsOffRoads` and route tests. The existing `npc-knockout.test.ts` tests "stays on a tow rope instead of appearing at home" and "appears at a home pad after enough turns beyond the player's gray vision" pass unchanged.
- `continueRoute()` drops a route kept under the other style through a private `plansOffRoad()` helper in `path.ts`. `far.ts` reads `keepsOffRoads()` directly and throws on a stored far route without the flag (`keptOffRoad()`).
- `terrainEntry()` in `nav/layer.ts` builds the per-tile layers in a new `tileLayers()`, and the far route choice moved into `farPoints()` in `far.ts`. Why: the quality gate's complexity limit.
- `playDriveSound()` still computes the glide for a stranded player and plays the air brake. It only skips the engine loop.
- PH5.4 verification was cut to what this slow machine allows (the factory runs the full suite and the playtest after testing): `npm run stuck` ran for seed 1 only (1000 turns, 36 minutes). A seed 1 hunter run took 1500 turns. No baseline batch was recorded before the change. `npm run perf`, `npm test`, `npm run playtest` and the GPU Playwright run were not run here.

### Verification run here

- Focused Vitest: `detect`, `pushing`, `vision`, `npc-activities`, `phys/drive`, `ui/npc-info`, `path`, `nav/layer`, `off-road`, `far`, `npc-knockout`, `defeat`, `npc-recovery`, `ai`, `tow`, `parley`, `save-migrations`, `save`, `save-rescue` and `version` tests all pass.
- `npm run typecheck` passes.
- Recorder, hunter seed 1, 1500 turns (`tmp/offroad`): raiders keeping off roads were on a road in 15/133 flee, 17/129 stranded and 0/10 retreat snapshots, against 513/850 for healthy raiders. No stall events.
- Recorder, trader seed 1, 1000 turns (`tmp/stuck1`, the `stuck` setup): no error and no stall. Off-road raiders were on a road in 7/75 flee and 28/191 stranded snapshots, against 332/470 for healthy raiders. Both runs show a `stateEnded` flap on one truck (`v1626`, `v1147`). With no baseline batch, it is not known whether that is new.

### Known risks

- RK2 (route cost) is unmeasured: `npm run perf` was not run.
- The share of stranded raiders on roads (13 to 15%) includes trucks parked on a camp approach road beyond the site margin and trucks that crawl across. The analyzer counts only moving raiders.

### Visual self-review

Captured with `tmp/offroad-shots.mjs` (headless Chromium, no GPU flags, dev server). The script clones the start world, moves the player beside the north–south road west of Old Orchard, at (154.5, 283.5), and puts a cloned raider buggy with an empty tank on that road's east edge at (154.5, 274.5). Then it plays 5 turns and screenshots each one (`tmp/offroad-stranded-0..5.png`, kept in `tmp/`, not committed).

Views read:
- Frame 1, the start after one turn, at dawn: the raider sits on the dark road band and the player is at lower left. No dust behind the raider.
- Frames 4 and 5, the active state: the raider crawls toward the road's outer edge and is at the edge by frame 5. No dust cloud behind it in any frame. It is in plain sight, so no sound arc is expected.
- A real-map route probe for the same spot confirms what the frames show. The off-road route leaves the road at the east edge for (155.3, 277.3), then heads south-east to Kiln Camp. The plain route follows the road south.

Mismatches found and fixed:
- The first capture run's turn loop did not wait for turns to finish (the busy flag is false while the worker prepares a turn). It now waits for the turn number to advance.
- At zoom 1.4 the raider was off screen. Zoom 0.7, with the player 9 tiles from the road, shows both trucks.

What remains:
- At about 4 minutes per turn in software rendering, the run stopped after 5 turns, while the raider was just leaving the road. No frame shows it well beside the road. The recorder runs and the real-map route test cover the longer stretch.
- No capture was made of a healthy raider on patrol for the dust comparison, or of the player's own stranded engine audio. Healthy driving and dust are unchanged code. The silent engine is a sound change a screenshot cannot show.

### Testing round 2 fixes

- `src/sim/off-road.test.ts`: the retreat test read `farRoute` on the arrival turn, when the route is already cleared, and expected the refit inside 14 turns although the lie-up lasts much longer. It now checks the route only while the truck has an order and stops when the truck lies up (rearm goal) at its pad. Own commit.
- `src/test/combat-harness.test.ts`: the "won fight" test used seed 33. The fleeing foe now routes off road, which changes that chaotic fight into a timeout. It uses seed 38, which is won with 33% of the foe's HP left. Own commit.
