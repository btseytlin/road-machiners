# Issue 155 — NPC business at sites takes turns and shows a progress bar

**Mode:** hands-off
**Goal:** An NPC that parks on a town, stall, camp or oasis pad to resupply, sell, buy trade cargo or load a haul stays parked for a few turns with a labelled progress bar over its truck, and the service, sale, purchase or load happens only when the bar fills.

## Context
- `resolveResupply`, `resolveSell`, `resolveTrade` and `resolveHaul` in `src/sim/npc-activities.ts:1214-1269` do the whole deal and pop or replace the goal on the first turn `reachSite()` finds the truck on a pad. The NPC never stands at the site for even one turn of business.
- Parked work already has one mechanism: `vehicle.job` (`Job` in `src/sim/types.ts:109-121`), run by `startJob()` / `advanceJobs()` / `cancelJob()` in `src/sim/jobs.ts`. A job is cancelled when the truck ends a turn above parked speed or in combat, and its finished turns are lost.
- `workOf()` in `src/sim/states.ts:310` is the one source the UI reads for timed work. `seenNpcJob()` in `src/ui/weapons.ts:67` already draws a bar with `workLabel()` / `jobLabel()` (`src/ui/format.ts:31,66`) over every seen NPC that has a job, so a new job kind needs a label and nothing else in the view.
- NPC searches already use this path: `resolveSearch` starts a `search` job, `jobBelongs()` (`npc-activities.ts:66`) keeps it while its goal is on top, and `logChange()` cancels a job that no longer belongs.
- `advanceJobs()` runs before `resolveNpcActivities()` in `endTurn()` (`src/sim/world.ts:276,301`), and `world.events` is cleared on every update, so a resolver can see this turn's `job` `done` event.
- `watchStalls()` counts a change of `job.turnsLeft` as progress (`progressKey`, `npc-activities.ts:1040`), and `NPC_BEHAVIOR.stallTurns` is 100.
- The player's town trade, repair and refuel are instant menu commands in `src/sim/economy.ts`. The player spends turns driving to the pad and stopping, but no turns on the deal itself.
- Retreat refits (`resolveRetreat` and the unseen jump home in `src/sim/defeat.ts:235`) belong to the defeat rules and have a second, offscreen path.
- Adding a variant to `Job` changes a type reachable from `World`. The precedent for an additive optional field (pile claims, `1d5754d7`) added no save step. A save step makes an older build reject a newer save cleanly instead of crashing on an unknown job kind.

## Reference images
The issue has no reference images. The bar reuses the existing NPC job mark, so the change needs no visual reference.

## Design

**Mechanism.** Site business becomes a new parked job kind, `business`. The four business resolvers keep their deal code. The job only adds the wait before the deal:

1. The NPC reaches the site (`reachSite()` as today). With no business job running and no `business` job `done` event for this site this turn, it starts `{ kind: 'business', siteId, deal, turnsLeft: N, total: N }` through `startJob()`, unless it is in combat. Then it waits.
2. While its business job runs, the resolver returns. `advanceJobs()` counts the job down. It cancels the job like any other: the truck moved, combat started, or a new top goal took over (`jobBelongs()`).
3. On the turn the job ends `done`, the resolver runs today's deal code unchanged (`serviceAt`, `sellVehicleCargo` / `sellAtCamp`, `tradeGoods` + `replaceBase`, `addGoods` + `replaceBase`) and ends or replaces the goal as today.
4. A cancelled job leaves the goal on the stack. When the NPC is back on the pad and out of combat, step 1 starts a fresh job, so the lost turns are redone, as for every job.

`deal` is the goal kind (`'resupply' | 'sell' | 'trade' | 'haul'`). The label reads it, and `jobBelongs()` matches the top goal's kind and `targetId` against `deal` and `siteId`.

**Duration.** One data number, `NPC_UPKEEP.businessTurns = 3` in `src/data/npc-behavior.ts`, for every deal kind. The issue asks for "a few turns". A fixed count keeps the rule simple and lets the committee tune it. It does not scale with cargo size or skill, since NPCs have no skills.

**In combat at the pad.** No job starts in combat (`startJob()` throws). The resolver waits parked, starts nothing and keeps the goal. Combat lasts `STATE_TURNS.combat` (10) after the last refresh, and danger goals push on top through the usual decisions. Dropping the goal instead, as a search does, would only make `pushService()` push the same resupply goal again next turn.

**Labels.** `jobLabel()` gets a `business` case built from `deal` and the site name: "Refuel and repair at X", "Sell cargo at X", "Buy cargo at X", "Load cargo at X". An oasis resupply reads "Fill water at X". `jobText()` logs only the player's jobs, so NPC business adds no log lines.

**Out of scope.**
- Retreat refits: the defeat rules own them, and the unseen jump home refits without a pad visit. Adding time to only one of the two paths would split one rule.
- `travel` goals, which do no business.
- The player's town menu stays instant. See PC1.

**Save.** `Job` gets the `business` variant. One save step, 9 to 10, is the identity: no old save can hold a business job, since business was instant. The step raises the minor format so an older build refuses a newer save with a business job instead of throwing `Unhandled job kind`. Run `npm run save:shape` afterward.

**Approaches considered.**
- A. A `business` job, as above. It reuses cancel-on-move, cancel-on-combat, the stall watchdog's job progress, `workOf()` and the NPC bar. **Chosen.**
- B. A turn counter on `NpcActivity` and a new branch in `workOf()`. This is a second timed-work mechanism. It would duplicate cancel-on-move and combat rules (GPC8) and miss the watchdog's job key.
- C. A state kind. States are between two vehicles, and a site is not one.

TDD: yes. These are deterministic sim rules with clear before and after behavior.

### Invariants
- IV1 — An NPC's resupply, sell, trade or haul changes no money, goods, fuel, supplies, part HP, shop price or goal until its `business` job for that site ends `done`.
- IV2 — A `business` job ends `done` exactly `NPC_UPKEEP.businessTurns` turns after it starts, if the truck stays parked on the pad, out of combat and on that goal.
- IV3 — A cancelled business job runs no deal. The goal stays on the stack, and the deal runs only after a fresh, full job.
- IV4 — `workOf()` returns the business job for an NPC doing business, so `seenNpcJob()` shows a bar with a non-empty label. `jobLabel()` throws on an unknown `deal`.
- IV5 — A `business` job on the player's truck is an impossible state. `startBusiness` throws for a vehicle without a brain.
- IV6 — No `stall` event comes from business: `npm run stuck` passes.

### Principles
Project principle checks (`docs/architecture/principles.md`):
- PC1 — **One rulebook (1), deviation.** The player's town deals stay instant and NPC deals take `businessTurns`. The player's menu is planning, and DESIGN.md makes planning free ("Planning is free and time runs only while a turn plays"). The issue asks only about NPCs. Making the player wait would change the player's town flow, so it is left to the committee under Deferred. Jobs, cancel rules and the bar are the shared player and NPC rules, unchanged. The near and far split is unaffected: `advanceJobs()` runs for every vehicle.
- PC2 — **Sim owns the rules (2).** The UI reads the business job only through `workOf()` → `workLabel()` / `jobLabel()`. Duration, start, cancel and completion live in `src/sim/`. `npm run econ` and `npm run stuck` drive `endTurn()`, so they measure the slower traders with no harness change.
- PC3 — **Hot code uses an index (3).** No new list scans per pair or per point. Per NPC per turn: `jobBelongs()` is O(1). The completion check scans this turn's `world.events` only for an NPC on the pad with no job, which is the same pattern as `reachedDestination()`'s `arrived` check. The event list holds one turn's events, and the check runs at most once per NPC per turn.
- PC4 — **Value conserved (4).** The change adds no source or sink. Every deal moves the same value through the same functions, a few turns later. Prices are read at completion, as the player's deals read them at the moment of trade. A cancelled job moves nothing (IV3).
- PC5 — **Save facts (5).** `Vehicle.job` gains the `business` variant, with the identity step 9 to 10 and a `format-2-9.json` fixture. The change adds no cache.
- PC6 — **Same seed (6).** The change adds no random draws.
- PC7 — **Fail loud (7).** IV4 and IV5 throw. `jobTurn()` keeps throwing on an unhandled kind. A resolver that sees a `done` business event for a different deal or site throws.

### Assumptions
- AS1 — Three turns read as "a few turns" to the requester and do not starve trader income. `npm run econ` before and after shows the drop in trader trips per day.
- AS2 — Longer stays on pads do not jam them. `siteSpot()` spreads drivers across the pad, and `npm run stuck` confirms it (IV6).
- AS3 — Tests that resolve a site goal in one `resolveNpcActivities()` call need a helper that runs the business turns. Without it, they fail for timing and not for behavior.

### Unknowns
- UK1 — Whether a merc waiting at a town or an escort's leader needs to wait for a partner's business job. Per the NPC wiki, a leader does not wait for an escort on a service stop, so no change is expected. Execution checks it with the stuck soak.

## Plan

Approach: add the `business` job kind to the existing parked-job machinery (Design A). Then split each business resolver into "start or wait" and "deal on done". Then add the label, the save step and the docs.

### PH1 — Business job kind (sim + data), tests first
- 1.1 `src/sim/types.ts:109-121` (modify)
  - `Job` gains `| { kind: 'business'; siteId: string; deal: BusinessDeal; turnsLeft: number; total: number }`.
  - Add `export type BusinessDeal = 'resupply' | 'sell' | 'trade' | 'haul';` with a comment that it names the NPC goal the job serves.
- 1.2 `src/data/npc-behavior.ts:144-160` (modify) — `NPC_UPKEEP.businessTurns: 3`, with a comment: the turns an NPC stays parked on a pad for one resupply, sale, purchase or load.
- 1.3 `src/sim/jobs.ts` (modify)
  - `jobTurn()` (`:221-227`): a `business` case calls a new `businessTurn(job): boolean` that counts down and returns true at 0. The job carries no deal logic.
  - `isStalled()` (`:214-219`): a `business` job stalls when the truck no longer stands where it can use the site (`canUseSite(v.pos, site)` from `src/sim/sites.ts`, with the site looked up by `siteId`). This mirrors `isSearchStalled`.
  - Header comment: business is the NPC's time at a site deal.
- 1.4 `src/sim/npc-activities.ts:66-80` (modify) — `jobBelongs()`: a business job belongs when the top goal's `kind === job.deal` and `targetId === job.siteId`.
- 1.5 Tests in `src/sim/jobs.test.ts` or `src/sim/npc-activities.test.ts`: the countdown reaches `done` after `businessTurns` turns; the job is cancelled by speed above parked, by combat and by leaving the pad; `jobBelongs` keeps it under its goal and drops it when a flee goes on top.
- Respects: IV2, IV3, PC5.
- Commit: "NPC site business is a parked job"

### PH2 — Resolvers wait for the business job
- 2.1 `src/sim/npc-activities.ts:1202-1269` (modify)
  - New `businessDone(world: World, vehicle: Vehicle, activity: NpcActivity): boolean`: true when this turn's events hold a `job` `done` event for this vehicle with a `business` job whose `deal` and `siteId` match the goal. It throws on a done business event for another deal or site (PC7).
  - New `startBusiness(world: World, vehicle: Vehicle, activity: NpcActivity & { kind: BusinessDeal }, siteId: string): void`: throws without a brain (IV5), returns while a job runs or while `inCombat()`, and otherwise calls `startJob()` with `NPC_UPKEEP.businessTurns`.
  - New `awaitBusiness(world, vehicle, activity): Site | null`: wraps `reachSite()`. It returns the site only on the done turn, and otherwise calls `startBusiness` and returns null. Each of `resolveResupply`, `resolveSell`, `resolveTrade` and `resolveHaul` replaces its `reachSite()` call with `awaitBusiness()`. Its deal code stays unchanged.
  - Keep each function to about 10 lines (GPC2).
- 2.2 Tests (`src/sim/npc-activities.test.ts`, `src/sim/camps.test.ts`):
  - A trader on a town pad starts a business job on the arrival turn and buys nothing for `businessTurns - 1` turns. It buys on the done turn, and the goal becomes `sell` (IV1, IV2).
  - The same holds for resupply (fuel, supplies and part HP unchanged until done), for sell (money and cargo unchanged until done), for haul and for camp sell and service.
  - A job cancelled by a drive-off or by combat moves nothing. The deal happens only after a fresh full job (IV3).
  - An NPC in combat on the pad starts no job and keeps its goal.
  - `workOf(npc)` returns the business job (IV4).
- 2.3 `src/sim/testkit.ts` (modify) — add `finishBusiness(w, npc)`. It runs `advanceJobs` + `resolveNpcActivities` until the business job is done. Update the existing tests listed in AS3 to call it where they expect an instant deal. Do not weaken their assertions.
- Respects: IV1, IV3, IV5, PC4, PC7.
- Commit: "NPCs stay parked for their site business before the deal"

### PH3 — Label
- 3.1 `src/ui/format.ts:31-37` (modify) — `jobLabel()` gets a `business` case. A new `businessLabel(job)` reads `deal` (oasis resupply as "Fill water") and the site name through the existing `siteName()` in `format.ts`. It throws on an unknown deal (IV4).
- 3.2 Test in `src/ui/format.test.ts` (or the existing label test file): each deal gives its label.
- Commit: "Label NPC business bars"

### PH4 — Save step, docs, checks
- 4.1 `src/three/save-migrations.ts:206-258` (modify) — append `// 9 to 10: jobs gain the business kind. No old save holds one, since NPC business was instant.` with `(world) => world`.
- 4.2 `src/three/save-fixtures/format-2-9.json` (create) — a trimmed save of format 2.9 with one NPC vehicle that has `job: null`. `src/three/save-migrations.test.ts`: the 9-to-10 step returns the world unchanged.
- 4.3 Run `npm run save:shape`.
- 4.4 Docs:
  - `docs/wiki/mechanics/npcs.md`: one sentence. An NPC stays parked a few turns for each resupply, sale, purchase or load, with a bar over its truck, and the deal happens when the bar fills.
  - `docs/architecture/npcs.md`: one bullet. Site business is a `business` job, and resolvers deal on its done event.
  - `docs/architecture/economy.md`: one line if it describes NPC service timing. Run `npm run wiki` if the data tables change.
- 4.5 Checks: `npm test`, `npm run typecheck`, `npm run stuck` (IV6), `npm run econ` before and after (AS1, record trader wage and trips), `npm run playtest --cpu`, and the root `npm run quality`.
- 4.6 Browser check: a Playwright script in `tmp/` drives the game with `window.__ROAM__` to an NPC on a town pad. It screenshots the bar over the NPC with its label and confirms that the NPC's money or cargo changes only after the bar fills.
- Commit: "Save step 9 to 10 for business jobs; docs"

### Test strategy
- Sim behavior in PH1 and PH2 is written failing-first (TDD: yes). Side effects are checked through money, goods, fuel, supplies, shop prices and the goal stack before and after the done turn.
- `npm run stuck` covers IV6 and AS2. `npm run econ` covers AS1.

### Order & dependencies
- PH1 → PH2 → PH3 → PH4. PH2 consumes the `Job` variant and `businessTurns`. PH3 consumes the variant. PH4's shape recording needs the final types.

### Risks / rollback
- RK1 — Traders lose income from the extra turns, and prices drift. Mitigation: compare `npm run econ` before and after, and report the change. Tuning `businessTurns` is a one-number change.
- RK2 — Many existing tests assume an instant deal. Mitigation: `finishBusiness` in testkit, with assertions kept.
- RK3 — An NPC parked longer on a pad blocks a tow arrival or the player. Mitigation: `npm run stuck` plus the browser check. The pad spots are per driver.
- Rollback: revert the commits. The save step must stay, since a committed step is never edited or removed. A revert would add a new step only if business jobs could be in saves.

### Hands-off decisions
- udesign: business is a parked `Job` kind, not a new mechanism — it reuses cancel rules, the watchdog and the NPC bar.
- udesign: one duration, `businessTurns = 3`, for every deal — the issue says "a few turns". The committee can tune it.
- udesign: retreat refits and travel arrivals are out of scope — the defeat rules own refits on two paths, and travel has no deal.
- udesign: an NPC in combat on the pad waits instead of dropping the goal — dropping it would re-push the same resupply.
- udesign: deals run at completion with the prices of that turn — this matches the player's deals and moves no value early.
- udesign: an identity save step 9 to 10 instead of none — it follows CLAUDE.md for a changed `World` type and makes older builds reject newer saves cleanly.
- uplan: plan auto-approved.

### Deferred (needs user input)
- Whether the player's own town deals should also cost turns, for one rulebook (PC1). It changes the player's town flow, which the issue does not ask for. The committee decides.

## Conclusion

Implemented as planned in one commit ("NPC site business is a parked job, waited out before the deal"), with the plan's four phases folded together because the quality hook checks each commit.

- `business` job kind, `NPC_UPKEEP.businessTurns = 3`, `jobBelongs` and stall rules. The resolver helpers live in `src/sim/npc-business.ts`, since `npc-activities.ts` is already over the max-lines limit.
- Label in `src/ui/format.ts`, save step 9 to 10 with `format-2-9.json` and a test, `npm run save:shape` run, docs updated.
- `finishBusiness` added to testkit. Existing tests that expected an instant deal use it and keep their assertions.
- Checks: `npm run typecheck` passes. `npm test` passed except five timeouts (30 s and 60 s limits) under machine load in `phys/drive`, `phys/path`, `sim/path` and `sim/npc-restraint`. They pass when run alone. `npm run stuck` is clean on 3 seeds (0 stalls).
- Not run: `npm run econ` before and after (AS1), `npm run playtest` (the testing stage runs it), the Playwright bar screenshot (4.6). No fix to a failure that was already broken on `dev` was needed.

### Testing stage
Merged main (save step is now 25 to 26, fixture format-2-25). Resolver helper `dealDue()` replaces `awaitBusiness()`, since resupply moved to npc-service.ts. Updated new main tests to use finishBusiness. Browser check: an NPC on the Bowl pad shows the bar and keeps money and fuel until it fills.

### Hardening round
Verified and reviewed the change. Run-time cost: `dealDue()` scanned this turn's events for every NPC on a pad on each waiting turn, and `isBusinessDone` ran twice per hit. It now returns early while a job runs and finds the event once. No other cost found. Typecheck and the near tests pass. No failures already broken on `dev` were found.
