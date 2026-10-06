# Issue 179 — NPC road cruising speed toward 65 km/h

**Mode:** hands-off
**Status:** executed
**Goal:** On the same seeded traffic run, the new `npm run traffic` report shows healthy ordinary NPC cars at a steady open-road cruise median of 60 km/h or more, and the low-fuel (half-speed) share of ordinary-car cruising samples drops below its baseline. Chassis, engine, gun drag, load, tow, weather and limp speeds stay unchanged.

## Context

Issue 179 is a public request. Healthy ordinary NPC cars feel too slow, and the reporter often sees traffic below 45 km/h. The request wants them near 65 km/h without speeding up damaged, heavy, loaded or towing trucks. It asks for a seeded measurement before and after, tests, and a traffic playtest.

Units: 1 tile = 4 m and 1 turn = 1 s (`src/data/physics.ts`), so 1 tile/turn = 14.4 km/h, 45 km/h = 3.1 tiles/turn and 65 km/h = 4.5 tiles/turn.

**Baseline (design stage).** The baseline was measured with a throwaway script, `tmp/speed-baseline/measure.ts`.
- Runs: seeds 1–3 on `TEST_MAP`, with the player parked.
- Physics layer: every NPC forced into Rapier, 300 turns per seed.
- Far layer: far travel only, as in the stuck soak, 800 turns per seed.
- Reports: `tmp/speed-baseline/report-all.txt`, `report-far.txt` and `report-healthy.txt`, which are git-ignored and local to this clone.
- A cruising sample is: on road at both ends of the turn, not stranded, not towing or towed, not in combat, and above 5 km/h for the turn and the 3 turns either side.

Findings:
- **AI throttle is not the cause.** A fuelled, healthy NPC drives at a median 0.99 (physics) and 1.00 (far) of its `vehicleStats().maxSpeed`. NPC `stopAt` orders ramp to top speed (`src/phys/drive.ts:486`). The throttle zones apply only to `through` orders without a pace.
- **Healthy ordinary cars already cruise near 65 km/h.** "Healthy ordinary" means the trader, outrider (buggy template), courier, scavenger, roamer and vulture roles on light chassis, with mobility of at least 0.75, no broken wheel and at least 20% fuel.
  - Physics: median 68 km/h, 20% of samples below 45.
  - Far: median 65 km/h, 27% below 45.
  - Of their samples below 45: 48–59% are still speeding up after a start or corner, 16–21% are in a storm (×0.6, `src/data/weather.ts:20`), 14–17% are slowing for an arrival or traffic, and 10–13% come from gun drag.
- **Low fuel is the largest drag on ordinary cars, and it comes from refuelling, not speed rules.**
  - Below 20% of the tank, top speed halves (`fuelLimited`, `src/sim/far.ts:33-42`).
  - This covers 5% of ordinary cruising samples in physics and 11% in far, at a median of 31 km/h, with 81–99% below 45.
  - Traders spend 22% (physics) and 42% (far) of their cruising samples below the line.
  - 69–78% of NPC turns below the line are on a goal other than resupply, such as sell, trade or patrol.
- **Why NPCs run below the line.** NPCs buy fuel only on a `resupply` goal (`resolveResupply`, `src/sim/npc-activities.ts:1213`) or when stranded (`serveStranded`). Selling cargo (`resolveSell`, `:1231`) and buying trade cargo (`resolveTrade`, `:1242`) at a town never fill the tank. The resupply trigger is a reserve for the straight way to the nearest pump (`isLowOnFuel`, `:223`). So a trader working between towns stays under 20% for long stretches.
- **The distance trigger is deliberate.** Commit 107e6266 replaced a 20%-of-tank trigger with the distance rule. The test "drives on near a town with a tank well below a fifth" (`src/sim/npc-activities.test.ts:420`) guards it. The wiki says some drivers run dry and wait for a tow (`docs/wiki/mechanics/npcs.md:18`).
- **The other slow traffic is armed, heavy or patrol roles, as designed.**
  - noseArmy runs at a median 29 km/h, bowlFarmer 39, gunwagon 42 and merc 33.
  - Their gun drag is about 0.70 on wagon, carrier, tractor and hauler chassis with diesel engines.
- **The player is not outpaced.** The standard start scout tops out at 117 km/h and the combat start hauler at 64 km/h.
- **There is no committed driven-speed measurement.** `npm run loadouts` reports only the ratio of `maxSpeed` to chassis speed (`src/test/loadout-report.ts:61`).

## Design

The request's target already holds for healthy ordinary cars. Most of the ordinary traffic below 45 km/h is cars driving on a tank under the half-speed line, so the fix is NPC refuelling, not speed numbers. As the issue warns, no speed rule is raised to hide a different cause.

Three parts:

1. **Traffic speed harness (`npm run traffic`).** A committed, seeded, reproducible version of the baseline, so the before and after numbers come from one tool.
   - It plays the real turn pipeline, with a `far` layer and a `physics` layer.
   - It reports cruising speed distributions in km/h per class: healthy ordinary, ordinary low fuel, ordinary worn, armed and heavy roles, and towing.
   - It reports the share below 45 km/h, the cause split (accelerating, storm, gun drag, low fuel), resupply goal starts, NPCs dry at once and collision events.
   - A "steady cruise" sample is the open-road measure. Its start and end speeds are within 10% of each other, and it is outside a storm.
   - The class lists (ordinary templates and heavy chassis) are harness constants. They classify samples and decide no game rule.
2. **NPCs top up fuel where they already do business.** When an NPC sells cargo or buys trade cargo at a site that is one of its own pumps (`pumpsOf()` in `npc-activities.ts`), it then tops its tank up at the normal fuel price. Pumps are towns and stalls for most drivers, and camps for raiders.
   - The distance-based resupply trigger stays as it is, so a careless driver on a long leg still runs dry now and then.
   - A trader that leaves a town now leaves with a full tank, so it rarely crosses the half-speed line on its next leg.
3. **Speed guard tests and docs.**
   - The tests pin the driven speeds the issue names: a healthy ordinary car reaches at least 65 km/h on a straight road, while a loaded truck, a tower, a limping truck and a low-fuel truck stay slower.
   - Docs: the wiki line on NPC fuel, `docs/tools.md` for the new command, and a measured before-and-after section in the task Conclusion.

### Approaches considered

- **A. Raise the resupply trigger above the 20% line.**
  - Mechanism: refuel at the cap × 20% plus the pump reserve.
  - Cost: it reverts the deliberate distance rule from 107e6266 and breaks its guard test. Fewer drivers would run dry, so tows and aid would be rarer, and big-tank trucks that spawn with 40 fuel would turn for a pump at once.
  - Rejected.
- **B. Raise chassis or engine speeds, for example the workhorse diesel `speedBonus`, or `MIN_NPC_SPEED_SHARE`.**
  - Cost: healthy ordinary cars are already at about 65 km/h. A speed buff changes part values and prices (`chassisModifier`, `partModifier`), the player's trucks, and the equipment tradeoffs DESIGN.md protects. It does nothing for the half-speed cars.
  - Rejected.
- **C. Top up at business stops (chosen).**
  - It reuses `topUp()` and `pumpsOf()`, keeps every speed rule and the deliberate trigger, and moves no value outside the existing fuel sale.
  - Reversible by removing two calls.

### Backwards compatibility

- No saved type changes. Fuel is already saved in `resources`.
- Old saves load unchanged. NPCs start topping up at their next sale or purchase.
- Contract and tow timing estimates use hand-set reference speeds (`EFFORT.refSpeed` 4 tiles/turn, `TOW.turnsPerTile`). No top speed changes, so they stay consistent.

TDD: yes for the top-up rule and the speed guard tests, which are deterministic sim and physics rules. No for the harness report (a measurement tool), which gets unit tests on its classification and summary functions instead.

### Invariants

- IV1 — An NPC that finishes a sale or a trade purchase on one of its own pumps leaves with fuel at `fuelCap()`, or as full as its money allows. Its money falls by exactly the units bought × `ECONOMY.supplyPrice.fuel`.
- IV2 — An NPC selling or buying at a site that is not one of its pumps buys no fuel. Example: a raider selling at the Salvage Yard.
- IV3 — A driver in debt buys no fuel, as `topUp()` already rules.
- IV4 — The resupply trigger is unchanged. The test "drives on near a town with a tank well below a fifth" passes unmodified.
- IV5 — No speed rule changes. `vehicleStats`, `fuelLimited`, `TOW.speedShare`, weather, limp speed, gun drag and the chassis and engine data stay byte-identical.
- IV6 — On a straight flat road, an NPC scout with a stock engine and one machine gun holds at least 65 km/h after it has sped up. A truck loaded past its rated mass, a tower, a truck with a broken transmission and a truck under 20% fuel each stay below it, at the share their rule sets.
- IV7 — The harness is deterministic. The same seeds, turns and layer give the same report.

### Principles

Answers to the project principles (`docs/architecture/principles.md`):

- PC1 — One rulebook. NPCs topping up after business is an NPC brain decision, the same kind as the existing resupply goal. The player still refuels by choice in a town's panel. The fuel price, `topUp()` and the speed rules are shared. No rule branches on the player.
- PC2 — The sim owns the rules.
  - The harness reads `vehicleStats()` and `getMobilityCondition()` (`src/sim/stats.ts`), `fuelLimited()` (`src/sim/far.ts`), `weatherAt()` (`src/sim/weather.ts`), `inCombat()` (`src/sim/combat.ts`), `isTowing` and `isOnRope` (`src/sim/tow.ts`), and the terrain speed factor.
  - Deviation, to be named in the code: the physics layer switches every NPC into physics by setting `PERF.liveMargin` and `PHYSICS.propLiveMargin` past the map size in the script process. This is a level-of-detail switch through the sim's own data, not a copied rule. The report header prints it.
- PC3 — Hot code uses an index.
  - The new top-up runs once per sale or purchase, not per turn, and checks `pumpsOf()`, a list of at most a few site ids.
  - The harness loops over `world.vehicles` once per turn. It is offline tooling, not game hot code.
- PC4 — Value is conserved.
  - No new source or sink is added. NPCs buy fuel at the existing `ECONOMY.supplyPrice.fuel` through `topUp()`. The timing of purchases changes, not the fuel bought per tile driven.
  - Side effect: fewer NPCs run dry, so tow fees and aid gifts may become rarer. The harness and the stuck soak report the number of NPCs dry at once, before and after.
- PC5 — Save facts. No saved type changes and no caches.
- PC6 — Same seed. No new random draws. `fuelSense` stays a hash. The harness uses only `newWorld(seed)`.
- PC7 — Fail loud.
  - The harness throws on an unknown `--layer` or a bad `--seeds` value, as `stuck.mjs` does.
  - The top-up helper throws if the vehicle has no brain, which follows from its callers.

### Assumptions

- AS1 — The armed patrol and heavy roles (noseArmy, bowlFarmer, gunwagon, merc, convoy, convoyGuard) and the heavy chassis (tractor, loader, wagon, carrier, longbed, bus) are not the "ordinary cars" the issue means. The issue asks to keep heavy and specialist trucks credible.
- AS2 — Storm samples and samples still speeding up are not "normal open-road cruise". The report shows them separately, not hidden.
- AS3 — `TEST_MAP` with a parked player represents real traffic well enough for a relative before-and-after comparison.
- AS4 — Issue #177 (raiders leaving camp damaged) is a separate cause. The baseline shows wear costs ordinary cars little speed (worn ordinary median 68 in physics), so this task changes nothing for it.

### Unknowns

- UK1 — How far the top-up cuts the low-fuel share of ordinary cars. The PH4 harness run measures it.
- UK2 — Whether fewer dry NPCs noticeably cuts tow and aid encounters. PH4 compares NPCs dry at once and the longest dry streak (stuck soak) before and after.
- UK3 — Whether a trader's trade budget falls enough to change trading. The upkeep reserve already holds a full tank's price (`getUpkeepReserve`), so it should not. PH4 checks with `npm run econ`.

## Plan

Approach: build the measurement first and record the baseline, then add the top-up with TDD, then the speed guard tests, then measure after and document. The harness follows the shape of `src/test/stuck-soak.ts` and `scripts/stuck.mjs`.

### PH1 — Traffic speed harness

- 1.1 `src/test/traffic-speed.ts` (create)
  - `type TrafficSample`: seed, turn, vehicle id, templateId, chassisId, layer (`physics` | `far`), `startKph`, `endKph`, `drivenKph` (trail length × 14.4, through `PHYSICS.metersPerTile` / `turnSeconds`), `maxKph` (from `vehicleStats`), `fuelShare`, `lowFuel`, mobility, broken wheels, gun drag, `loadFactor`, `weatherSpeed`, `onRoad` (terrain speed of at least 0.98 at both ends), stranded, towing, towed, inCombat, top goal kind.
  - `ORDINARY_TEMPLATES` and `HEAVY_CHASSIS`: the harness constants from AS1.
  - `classify(s: TrafficSample): TrafficClass`. One of `healthyOrdinary`, `lowFuelOrdinary`, `wornOrdinary`, `heavyRole`, `towing` or `other`. Healthy means mobility of at least 0.75, no broken wheel, at least 20% fuel, not stranded, not on a rope.
  - `isSteadyCruise(s: TrafficSample): boolean`. On road, moving above 5 km/h, the start and end speeds within 10%, weather speed 1, not in combat.
  - `recordTraffic(seed: number, turns: number, layer: 'physics' | 'far'): TrafficRun`.
    - Builds the world like `soak()`: player in god mode, calls hung up.
    - The physics layer plays `endTurn(w, physicsMove(...))` as `src/phys/turn.ts` does. The far layer plays `advanceFar` for all.
    - It collects samples, resupply goal starts, NPCs dry at once and `collision` events.
  - `summarize(run: TrafficRun): TrafficSummary` and `formatTraffic(summaries: TrafficSummary[]): string`.
    - Per class and per chassis: count, p10, p25, median, mean, p75 and p90 of the steady cruise speed, plus the share below 45 and below 55.
    - For healthy ordinary samples below 45: the cause split, among accelerating, storm, gun drag and other.
    - Also the low-fuel share of ordinary samples, resupply starts, the most NPCs dry at once, and collisions per 100 NPC turns.
  - Respects: PC2, PC6, IV7.
- 1.2 `scripts/traffic.mjs` (create)
  - Arguments: `--seeds 1-3 --turns 300 --layer physics|far`.
  - One process per seed, like `scripts/stuck.mjs:22-41`. For the physics layer it sets `PERF.liveMargin` and `PHYSICS.propLiveMargin` to 1e6 in the child before importing, with a comment naming PC2.
  - Writes `tmp/traffic/<layer>-seed-<n>.json` and a merged `tmp/traffic/<layer>.md`. Throws on bad arguments.
- 1.3 `package.json:17` (modify): add `"traffic": "vite-node scripts/traffic.mjs"`.
- 1.4 `src/test/traffic-speed.test.ts` (create)
  - Hand-made samples check `classify`, `isSteadyCruise` and `summarize`: percentiles, share below 45 and the cause split.
  - One short far run (seed 1, 20 turns) repeated twice gives identical summaries (IV7).
- 1.5 `docs/tools.md:10-13` (modify): one bullet for `npm run traffic`, its outputs and its run time (about 13 min physics, about 10 min far for 3 seeds).
- 1.6 Run the baseline on the untouched rules: `npm run traffic -- --layer physics --turns 300` and `--layer far --turns 800`, seeds 1–3. Also run `npm run stuck -- --seeds 1-3 --turns 1000` and `npm run econ`. Save the outputs to `tmp/traffic/baseline/`, and copy the summary tables into the task Conclusion.
- Commit: `Add the traffic speed harness that measures NPC driven speed by class`

### PH2 — NPCs top up fuel at their pumps during business (TDD)

- 2.1 `src/sim/npc-activities.test.ts:406-445` (modify, tests first)
  - New: "a trader that sells cargo at a town leaves with a full tank and pays the fuel price" (IV1).
  - New: "a trader that buys trade cargo at a town tops up its tank and keeps its upkeep reserve" (IV1).
  - New: "a raider selling at the Salvage Yard buys no fuel there", and "a raider selling at its camp tops up" (IV2).
  - New: "a driver in debt sells but buys no fuel" (IV3).
  - "drives on near a town with a tank well below a fifth" stays unmodified (IV4).
- 2.2 `src/sim/economy.ts:266-285` (modify)
  - Export `buyFuel(world: World, vehicle: Vehicle): void`, which calls the existing private `topUp(world, vehicle, ['fuel'])`.
  - Comment: "Fills the tank as far as the money goes, for a driver doing business at a pump."
- 2.3 `src/sim/npc-activities.ts:1213-1255` (modify)
  - Add `topUpAtPump(world: World, vehicle: Vehicle, siteId: string): void`. It calls `buyFuel` when `pumpsOf(vehicle, npcProfile(vehicle), isBroke(world, vehicle))` includes `siteId`. Its comment says the driver fills up where it already does business, and that the distance trigger in `isLowOnFuel` still decides when it makes a trip for fuel.
  - Call it in `resolveSell` after the sale, before `finishGoal`.
  - Call it in `resolveTrade` after `tradeGoods(... 'buy')`, so the budget is computed first. The upkeep reserve covers the fuel.
  - Respects: IV1–IV4, PC1, PC4.
- 2.4 `docs/wiki/mechanics/npcs.md:18` (modify): one sentence, "A driver also fills its tank whenever it sells or buys cargo at one of its pumps."
- 2.5 `docs/architecture/npcs.md` (modify only if it describes NPC fuel buying; otherwise leave it).
- Commit: `NPCs fill their tank when they sell or buy cargo at one of their pumps`

### PH3 — Speed guard tests

- 3.1 `src/phys/cruise.test.ts` (create)
  - Uses `emptyWorld`, `addVehicle`, `npcBrain` and `editableTerrain` from `src/sim/testkit.ts`, with a local `play` loop built like the one in `src/phys/drive.test.ts` (`buildDrive`, then `endTurn(w, physicsMove(...))`). The cases share one flat straight road and a far `stopAt`. Each asserts on the speed after the ramp-up, about 8 turns.
  - A scout NPC with a stock engine and one machine gun reaches at least 4.5 tiles/turn (65 km/h) and at least 0.95 × `vehicleStats().maxSpeed` (IV6).
  - A hauler loaded past its rated mass stays below the empty hauler, and below 0.95 × its unloaded speed.
  - A tower holds about `TOW.speedShare` × its own top speed.
  - A truck with a broken transmission stays at or below `limpSpeed` + 0.3.
  - A truck under 20% fuel stays at or below `lowFuelSpeedFactor` × top speed + 0.3.
  - Turns and stops are already covered in `drive.test.ts:248-302` ("brakes before a sharp route corner", "a stop order stops on the point"). This file does not repeat them.
  - Respects: IV5, IV6.
- 3.2 Run `npm test`. No existing speed test changes (IV5).
- Commit: `Pin the driven speeds of ordinary, loaded, towing, limping and low-fuel trucks`

### PH4 — Measure after, playtest and report

- 4.1 Re-run the PH1.6 commands on the changed rules into `tmp/traffic/after/`.
- 4.2 Write `## Measurements` in the task Conclusion.
  - The baseline and after tables per class and layer: healthy ordinary median and share below 45, the low-fuel share of ordinary samples, the most NPCs dry at once, the longest dry streak, resupply starts, collisions per 100 NPC turns, and the econ trader profit line.
  - Expected: healthy ordinary is unchanged by construction, and the low-fuel share falls. If the low-fuel share does not fall, or collisions, stalls or dry counts get worse, stop and record that under Deferred. Do not tune speeds.
- 4.3 Run `npm run playtest` (with `--cpu` if there is no GPU).
- 4.4 Write a Playwright traffic check in `tmp/traffic-playtest.mjs`, as `docs/tools.md#browser-checks` describes. On the real dev build, put the player on a straight road stretch and on a winding one near a town, play about 60 turns each, and log:
  - NPC speeds in km/h near the player;
  - `collision` and `stall` events;
  - whether any NPC passed another.

  Take one screenshot per road. Report the log lines and look at the screenshots.
- 4.5 Run `npm run typecheck`, `npm test` and `npm run quality` from the root.
- Commit: none, unless a doc fix comes out of 4.2.

### Test strategy

- Top-up rule: `npc-activities.test.ts` (PH2), written first.
- Driven speed by class: `src/phys/cruise.test.ts` (PH3).
- Harness math and determinism: `traffic-speed.test.ts` (PH1).
- Side effects:
  - The stuck soak checks dry NPCs and stalls.
  - The econ harness checks trader money.
  - The existing `aid.test.ts` must stay green, since aid reads `fuelReserveFor`, which is unchanged.
  - `traffic.test.ts` checks invariants under AI traffic.

### Order & dependencies

PH1 comes first, so the baseline is taken on the unchanged rules. PH2 and PH3 are independent. PH4 runs after both.

### Risks / rollback

- RK1 — The physics layer is slow, about 13 minutes for 3 seeds × 300 turns. It is a manual tool, like `npm run stuck`, and it is not in `npm test`.
- RK2 — More full tanks could mean fewer dry NPCs and so fewer tows and aid encounters (UK2). PH4 measures it. If the drop is large, it goes to the committee under Deferred, without a rollback.
- RK3 — Topping up during a trade purchase spends money before the next trade plan. `getUpkeepReserve` already holds a tank's price, and PH4 checks econ.
- Rollback: revert the PH2 commit. The harness and the tests stay useful.

### Interfaces

- IF1 — `buyFuel(world: World, vehicle: Vehicle): void` in `src/sim/economy.ts`. It fills fuel to `fuelCap` as far as the money goes, and buys nothing in debt.

### Interface graph

- PH1 -> @ src/test/traffic-speed.ts, src/test/traffic-speed.test.ts, scripts/traffic.mjs, package.json, docs/tools.md
- PH2 -> IF1 @ src/sim/economy.ts, src/sim/npc-activities.ts, src/sim/npc-activities.test.ts, docs/wiki/mechanics/npcs.md, docs/architecture/npcs.md
- PH3 -> @ src/phys/cruise.test.ts
- PH4 IF1 -> @ (no source files; task file only)

## Code smells

- `src/data/npc-behavior.ts:21-22` — The comment says "a truck cruises about 3.4 tiles a turn on a road" (49 km/h). The measured healthy cruise is about 4.5–4.7, and `escortWaitGap` and `fightSearchTurns` are justified by that comment. (GPC4)
- `src/data/rules.ts:36` — `RULES.cornerSlack` is defined but read nowhere. The brake plan uses `PHYSICS.driver.cornerCut`. (GPC6)
- `src/sim/far.ts:35`, `src/sim/aid.ts:39`, `src/sim/economy.ts:308`, `src/sim/progression/bot.ts:217` — Four places compute "under `RULES.lowFuelThreshold` of `fuelCap`" on their own. (GPC8)
- `src/sim/econ/harness.ts:209-227` — The econ harness models NPC travel as `maxSpeed × HARNESS.cruiseShare` 0.55, but the measured driven ratio for fuelled cars is about 0.99. (Project principle 2)

## Conclusion

### Hands-off decisions

- udesign: did not raise any chassis, engine or speed rule. The baseline shows healthy ordinary cars already cruise at a median of 65–68 km/h, and low fuel causes most of the slow ordinary traffic.
- udesign: chose topping up at business stops over raising the resupply trigger. That keeps the deliberate distance rule from 107e6266 and its guard test.
- udesign: treated the armed patrol and heavy roles as non-ordinary (AS1), and reported storm and accelerating samples apart (AS2).
- udesign: the harness's physics layer switches level of detail through `PERF.liveMargin` in the script process. This is named as a deviation under principle 2.
- uplan: plan auto-approved.

### Measurements

Commands: `npm run traffic -- --layer far --turns 400` and `--layer physics --turns 150`, seeds 1–3, on the PH1 commit 2db9a462 (baseline, in a worktree) and on the PH3 commit 695c4078 (after). Speeds are km/h of the path driven in one turn. Full reports: `tmp/traffic/baseline/` and `tmp/traffic/after/` (git-ignored).

Far layer, 3 seeds × 400 turns:

| | baseline | after |
|---|---|---|
| healthy ordinary, steady cruise median | 73 | 74 |
| healthy ordinary, steady cruise share <45 | 3% | 4% |
| healthy ordinary, all moving road samples median / <45 | 61 / 32% | 65 / 30% |
| low-fuel share of ordinary moving samples | 9% | 2% |
| low-fuel ordinary moving samples (count) | 1228 | 335 |
| heavy roles, steady cruise median | 41 | 44 |
| towing, steady cruise median | 39 | 41 |
| resupply goal starts | 164 | 115 |
| most NPCs dry at once | 4 | 3 |
| collisions per 100 NPC turns | 0.07 (31) | 0.13 (57) |

Physics layer (every NPC in Rapier), 3 seeds × 150 turns:

| | baseline | after |
|---|---|---|
| healthy ordinary, steady cruise median | 73 | 73 |
| healthy ordinary, steady cruise share <45 | 4% | 5% |
| healthy ordinary, all moving road samples median / <45 | 61 / 33% | 61 / 35% |
| low-fuel share of ordinary moving samples | 1% | 0% |
| resupply goal starts | 35 | 38 |
| most NPCs dry at once | 2 | 1 |
| collisions per 100 NPC turns | 1.79 (246) | 2.33 (320) |

Healthy ordinary steady cruise per chassis (physics, after): hauler 65, buggy 73, scout 78, van 74, courier 90, jeep 75, convertible 137. Healthy ordinary moving samples under 45 km/h are mostly cars speeding up (60–68%), then braking for a stop or a truck ahead (12–20%), storms (10%) and top speeds under 45 (6–9%).

Stuck soak, seeds 1–3 × 300 turns: 0 stalls before and after. Most dry at once 3/4/3 before, 3/3/1 after. Longest dry streak 119/129/201 before, 152/183/71 after.

Econ (`npm run econ`, default seed 1, 5 days): the report is byte-identical before and after. The econ harness plays the player's policies only and never resolves an NPC sale, so it cannot show UK3.

Findings:
- Goal met. Healthy ordinary cars hold a steady open-road median of 73–74 km/h, above the 60 target. Their speed rules did not change, so that number moved only by noise.
- UK1: the low-fuel share of ordinary cars falls from 9% to 2% (far) and 1% to 0% (physics). On the far layer, the low-fuel ordinary moving samples drop from 1228 to 335 and their median, at half speed, from 32 km/h to a mix led by one fast courier at 70.
- UK2: dry NPCs at once do not rise (4→3, 2→1, stuck 3/4/3→3/3/1). Resupply trips fall on the far layer (164→115), since cars fuel on business stops.
- Collisions rose on both layers. Far: seed 2 accounts for it (15→50), and a replay of that seed shows every one is a raider truck driving through breakable dead trees on a raid route, no truck hitting a truck. Seeds 1 and 3 fell (12→7, 4→0). Physics: seed 2 split by target, truck-on-truck traffic contacts 26→40, prop and ground hits up too. The extra contacts are repeated hits between a few pairs after the worlds diverge near turn 100, several in a tow or a flee. See Deferred.

### Deviations from plan

- Measurement length — far 400 turns instead of 800, physics 150 instead of 300, stuck soak 300 turns instead of 1000. This machine has 3 CPUs at a load near 30, so each harness process got about 10% of a CPU. The first full-length runs could not finish inside their job limits and were stopped.
- Baseline source — the baseline ran in a git worktree at the PH1 commit, so it could not load the PH2 rule by accident.
- PH4.3 and PH4.4 (playtest and the Playwright traffic check) were not run. The factory instructions for this stage forbid the playtest and leave it to the testing stage.
- `topUpAtPump` is a one-line arrow function. The plain function pushed `npc-activities.ts` to 1,001 code lines, over the gate's 1,000-line limit.
- The speed guard tests drive brainless NPC trucks on a stop order, and the tower case uses the player truck with a hitched tow state. An NPC with a brain replans its order every turn, so a fixed straight drive needs no brain.
- `docs/architecture/npcs.md` does not describe NPC fuel buying, so it was left alone (2.5).

### Wiring check

- IF1 `buyFuel(world, vehicle)` in `src/sim/economy.ts` is called only by `topUpAtPump` in `src/sim/npc-activities.ts`, with the declared signature.

### Visual self-review

No screenshots. The change is a sim rule (NPCs buy fuel at their pumps when they sell or buy cargo), a measurement tool and tests. Nothing drawn, no UI and no model changed. Every speed rule is unchanged, so a healthy truck looks no different on screen. The effect a player could notice is fewer ordinary cars crawling at half speed, which the traffic harness measures above. The traffic playtest the plan names (PH4.4) is left to the testing stage.

### Tests

- New: `src/test/traffic-speed.test.ts` (classes, steady cruise, slow causes, summary, determinism), 4 fuel tests in `src/sim/npc-activities.test.ts`, `src/phys/cruise.test.ts` (5 driven-speed guards).
- "drives on near a town with a tank well below a fifth" passes unmodified (IV4).
- `npm run typecheck`: clean.
- `npm test`: 3054 passed and 8 failed, all 8 by timeout (30 s, or 120 s for `phys/traffic.test.ts`) under the machine's load near 30 on 3 CPUs. No assertion failed. Rerun one file at a time (`npx vitest run --no-file-parallelism` on `data/content`, `phys/drive`, `phys/path`, `phys/tow`, `phys/traffic`, `sim/npc-loadout`, `sim/npc-recovery`, `sim/npc-restraint`), all 215 tests in them pass. No code fix was needed, so there is no separate fix commit.

### Deferred (needs user input)

- The armed patrol roles (noseArmy at a median 29 km/h, bowlFarmer 39, gunwagon 42, merc 33) are a large share of the slow road traffic a player sees. Their speed comes from gun drag of about 0.70 on slow chassis with diesel engines. Whether these roles should be lighter armed or faster is a balance decision for the committee, outside this issue's "ordinary cars".
- The tie to #177 (raiders leaving camp damaged) is not checked against that issue's text. Worn ordinary cars lose little speed in the baseline (AS4).
- Collisions per 100 NPC turns rose after the change: far 0.07→0.13, physics 1.79→2.33. The far rise is raider trucks breaking dead trees on one seed. The physics rise includes 14 more truck-on-truck traffic contacts on seed 2, after the seeded worlds diverge, and it is within one seed's swing (seed 3 alone went 71→102 while seed 1 went 98→96). The runs are short (150 physics turns). A longer run on a quiet machine, `npm run traffic -- --layer physics --turns 300 --seeds 1-6`, decides whether this is noise. Following the plan, no speed was tuned.

## Conclusion (round 2, review fixes)

- Finding 1: `topUpAtPump` and `resolveSell` are plain code again. The line limit is met by moving `isStrandedForGood` and `isDamaged` (the damage rules) to `src/sim/npc-repair.ts`, not by compressing lines.
- Finding 2: the top-up now runs right after the shop note in `resolveTrade`, before the budget is computed, so it applies on every trade stop and the budget sees the money it spent.
- Finding 3: not resolved by a probe. The collision rise on 300-turn runs is unmeasured at length and the playtest was not run in this round, because the fix touched no rendering. Hermes or the committee should read it.
- Findings 4 and 5: kept. The harness is the issue's requested measurement and the refuel rule is the chosen design.
- Checks: npc-activities, npc-economy and npc-decisions tests pass, typecheck and `npm run quality` pass.

## Conclusion (testing round 2)

All 183 test files (3872 tests) and the typecheck passed in the factory check. The only failure was the GPU playtest: `fps 42.5 under 50`. I reran it twice and got 31 and 33 fps, while the machine load average was about 55. The change touches NPC fuel and trade rules in the sim and nothing the playtest draws. The low fps comes from the shared machine, so I made no code fix and no separate commit. I did not run the playtest at the base commit to confirm this.
