# Issue 173 — Explain power budget and max-speed effects

**Mode:** hands-off
**Goal:** In the inventory, town shop/garage and trade headers, the player sees the engine's power capacity, the draw of working guns, the spare power or overload, and what the draw costs in top speed. Hovering or keyboard-focusing the HUD max speed opens a breakdown of every current effect on max speed. Its final line equals the HUD number. Driving, physics and saves do not change.

## Reference images
The issue has no reference images. The look follows the existing HUD and chip styles, so no visual match to an image is required. PH4's screenshots still need a person to look at them.

## Context
- `vehicleStats()` in `src/sim/stats.ts:67-117` computes `maxSpeed` inline in this order. A running engine gives chassis + engine `speedBonus` (worn by `wornDef`), then × `loadFactor`, × broken wheels, × `gunDrag`, then the `RULES.minSpeedCap` floor, × overdrive, and a broken transmission caps it at limp speed. With no working engine, or a stalled one, it starts from limp speed (raised by the driving `crawl` skill). Both paths then apply × weather and × `TOW.speedShare` while towing. Nothing exposes these steps.
- `gunDrag(v, capacity)` (`stats.ts:122-125`) sums the draw of working guns inline, so the draw total has no query of its own. Broken guns draw nothing. Engine `capacity` does not wear.
- `getHudReadout()` (`src/ui/hud-readout.ts:268`) shows `kph(vehicleStats(w, me).maxSpeed)`. `hud.ts:412` renders it as a plain `span.speed-max` with `title: "Max speed"`, which cannot take keyboard focus.
- `Hud.renderTop()` (`hud.ts:376-479`) rebuilds every top child with `this.top.replaceChildren(...)` on each `refreshUi()`. A rebuilt node loses focus and its open state. `TruckConditionView` already works around the same problem for its part tooltip (`truck-condition-view.ts:23-25`).
- `fuelLimited()` (`src/sim/far.ts:33-42`) halves top speed under `RULES.lowFuelThreshold` of the tank and drops to limp speed when the fuel cannot cover the turn. The HUD max speed ignores both, so a breakdown that only reconciles with the HUD would hide a real slowdown.
- `truckChips()` (`src/ui/inventory.ts:966-983`) builds the header chips. The town shop (`town.ts:121`) and trade (`town.ts:562`) headers reuse it, and the inventory rebuilds it on every `render()`. `.chips` (`style.css:947`) does not wrap.
- `hitOdds` in the sim returns the causes of scatter, and `src/ui/hitCard.ts` only formats them. That is the existing pattern for "chances are shown with their causes" (DESIGN.md, Combat).
- The gun and engine cards already show draw and capacity (`cards.ts:411,422`). `docs/wiki/mechanics/truck.md:29` documents the drag curve, which caps at 48%.

## Design

**Sim owns the steps.** A new query `maxSpeedSteps(world, v): SpeedStep[]` in `stats.ts` is the only max-speed formula. `vehicleStats().maxSpeed` becomes the last step's `speed`, so the breakdown and the number cannot drift apart. Each step is a discriminated union member carrying its inputs and the running `speed` after it:

- `chassis` (base) and `engine` (`bonus`, `worn: boolean`). These are on the engine path only.
- `load` (`factor`, `mass`, `rated`) and `guns` (`draw`, `capacity`, `factor`, `capped: boolean`). These always appear on the engine path, even at factor 1.
- `wheels` (`broken`, `factor`) when a wheel is broken, `floor` when `minSpeedCap` lifts the speed, `overdrive` (`factor`) when on, and `transmission` when it is broken and caps the speed.
- `limp` (`cause: 'noEngine' | 'brokenEngine' | 'stalled'`, `skill` share). This replaces the engine-path steps.
- `weather` (`factor`) when not 1, and `towing` (`factor`) while towing.

The sim also adds `gunDraw(v)`, the summed draw of working guns that `gunDrag` now uses, and `workingEngineCapacity(v): number | null`, which is null with no working engine. `far.ts` gets `fuelLimit(w, v, s): 'low' | 'empty' | null`, extracted from `fuelLimited()`'s low-tank test and used by it. The breakdown shows it as a note under the total, not as a step. It is not part of `vehicleStats` and the HUD number does not include it.

**UI formats only.** A new `src/ui/speed-breakdown.ts` turns steps into rows and the power facts into chip text.
- Each row shows a label, an effect and the running km/h. The effect is "+8 km/h" for the engine bonus and a signed percent for multipliers. Each label names its cause, like "Load 2,350 / 2,000 kg", "2 broken wheels", "Gun power 6 / 10", "Weather: Dust storm" (the label from `weatherLabel()`), "Towing", "Engine stalled: pushed at crawl speed" or "Broken transmission: crawl".
- The total row is `kph(last.speed)`, the same call and value the HUD shows. Each row's km/h is `kph()` of its running value, so the shown numbers chain exactly, with no separately rounded deltas.
- One note line explains gun power in plain words, with numbers from `RULES`. Guns draw engine power, and the draw is not a mounting limit. As draw nears capacity, top speed and acceleration fall faster. The first guns cost little, and from full capacity on the cost stays at `gunDragMax`. One total, not a cost per gun.
- A second note shows low or empty fuel when `fuelLimit` reports it.

**HUD.** The max speed becomes a persistent `MaxSpeedView` (in `src/ui/max-speed-view.ts`) that the `Hud` owns. Its root is a focusable `span` (`tabindex="0"`, `aria-describedby`) holding the "max N" text and a `role="tooltip"` panel. The panel opens on `:hover` and `:focus-within` through CSS only, and `render()` updates the text in place. `renderTop()` stops detaching it: the top panel keeps persistent slots and refreshes their contents, so hover and focus survive per-frame refreshes. The panel width is `min(300px, calc(100vw - 24px))`, and below 720px it anchors so it stays on screen.

**Header chip.** `truckChips()` gains a power chip with the `power` icon. It reads "6 / 10 power · −8% speed", or "over by 2" with the `bad` class, or "No working engine" when there is none. The speed part comes from the `guns` step's factor and the km/h difference to the step before it. When the engine path is off (stalled), the chip says the guns cost no speed until the engine runs. Its `title` and `aria-label` carry the full sentence: draw, capacity, spare or over, the speed and acceleration cost in % and km/h, and that draw is not a mounting limit. `.chips` gets `flex-wrap: wrap` for narrow screens. Shop, garage and trade get the chip through the shared `truckChips()`.

Rejected: a second `maxSpeedBreakdown()` that mirrors `vehicleStats`. The issue and principle 2 forbid a copied formula. Also rejected: a trace callback threaded into `vehicleStats`. It adds a parameter to 66 call sites to save one small array per call. Its only purpose would be speed, and the perf budget checks that (RK1).

TDD: yes — `maxSpeedSteps` and the formatters are deterministic derivations whose regressions should fail CI. A golden test captures today's `maxSpeed` for every scenario before the refactor.

### Invariants
- IV1 — For every vehicle, `vehicleStats(w, v).maxSpeed` equals the last `maxSpeedSteps(w, v)` step's `speed`, and it equals the pre-change value for the scenario set in PH1.
- IV2 — The HUD breakdown's total string equals `getHudReadout(w).maxSpeed`.
- IV3 — Each step's `speed` equals the previous step's `speed` with that step's rule applied, so a reader can follow the chain.
- IV4 — `maxSpeedSteps` always starts with `chassis` or `limp`. It throws on a vehicle with no chassis def, which `chassisDef` already does. A formatter switch is exhaustive over step kinds, so a new kind fails typecheck.
- IV5 — Broken guns add no draw, and no working engine gives no capacity. The chip never shows power from a broken engine.
- IV6 — The max-speed node stays the same DOM element across `renderTop()` calls, so focus and hover persist.
- IV7 — No change to physics, `vehicleStats` fields other than through IV1, `World` types or save data.

### Principles
Project principles touched:
- P1 One rulebook: `maxSpeedSteps`, `gunDraw` and `workingEngineCapacity` work for any truck. The only player split is the existing `inOverdrive()`, which only the player's truck has. The UI shows only the player's truck because the HUD and inventory are the player's.
- P2 Sim owns the rules: max speed comes from `maxSpeedSteps` (stats.ts), gun draw from `gunDraw`, capacity from `workingEngineCapacity`, gun drag numbers from `RULES.gunDragMax/gunDragCurve`, low fuel from `fuelLimit` (far.ts), km/h from `kph()`, and the weather name from `weatherLabel()`. The UI computes no speed itself.
- P3 Hot code: `vehicleStats` is hot (66 call sites, per truck per substep). The change adds no loop over a world list. It allocates one array of at most 9 steps per call. `gunDraw` keeps today's loop over the truck's own mounted items. `npm run perf` must pass (RK1).
- P4 Value: no source or sink changes.
- P5 Saves: no saved type changes and no new cache.
- P6 Same seed: no random draws.
- P7 Fail loud: IV4. `workingEngineCapacity` returns null only for the real "no working engine" state, and the chip renders that state explicitly instead of as a zero.

### Assumptions
- AS1 — Showing exact speed causes fits DESIGN.md "Information". The HUD shows state, and soft limits are tradeoffs the player decides on. Hit chances already show their causes.
- AS2 — Low and empty fuel belong in the breakdown as notes, even though the issue does not list them, because leaving them out would mislead.
- AS3 — `refreshUi()` runs after every install, remove, swap, break and repair, so the chips update without new wiring. PH4's browser check confirms it.

### Unknowns
- UK1 — Whether moving focus into the HUD (Tab) lets a key handler on the game swallow game hotkeys, or makes Space or Enter act on the focused span. Resolve in PH3 by checking the `game.ts` key handler. A non-button span has no default action.

### Hands-off decisions
- udesign: breakdown is a step list from the sim that `vehicleStats` reads, not a parallel function — principle 2 and the issue forbid a second formula.
- udesign: fuel limits shown as notes, not steps — the HUD number must not change (issue, IV7), yet the slowdown is real.
- udesign: inactive effects are omitted, except load and gun power, which always show — the issue allows omitting, and the two soft limits are always worth seeing.
- udesign: tooltip opens by CSS `:hover`/`:focus-within` on a persistent node — this matches the condition view's fix for rebuild flicker and needs no JS hover state.
- uplan: plan auto-approved.

## Plan

Approach: refactor first, behind a golden test. Add the UI on top of the sim query, then check in the browser.

### PH1 — Sim: max-speed steps and power queries (TDD)
- 1.1 `src/sim/stats.test.ts` (modify) — Write this first, against the current code. It is a golden table of `vehicleStats().maxSpeed` for these cases: bare scout; stock engine with no guns; several guns; one broken gun; overload past capacity; worn engine; two broken wheels; heavy load hitting `minSpeedCap`; overdrive; broken transmission; no engine; broken engine; stalled; storm; towing. Freeze the values with `toBeCloseTo(…, 10)`. After 1.2, add these checks: last step speed equals `maxSpeed` for each case (IV1); the step kinds and order for each case; each step's speed follows from the previous one (IV3); `gunDraw` ignores broken guns and `workingEngineCapacity` is null for missing and broken engines (IV5).
- 1.2 `src/sim/stats.ts:20-125` (modify)
  - `export type SpeedStep = …` — the union in Design. Every member has `speed: number`.
  - `export function maxSpeedSteps(world: World, v: Vehicle): SpeedStep[]` — moves the max-speed lines out of `vehicleStats` in the same order, so floating-point results are bit-identical.
  - `vehicleStats()` — `maxSpeed = steps.at(-1)!.speed`. Accel keeps its own lines, but reads `gunDrag` the same way.
  - `export function gunDraw(v: Vehicle): number` and `export function workingEngineCapacity(v: Vehicle): number | null`. `gunDrag(v, capacity)` uses `gunDraw`.
  - Respects: IV1, IV3, IV4, IV5, IV7.
- 1.3 `src/sim/far.ts:29-42` (modify) — `export function fuelLimit(w: World, v: Vehicle, s: VehicleStats): 'low' | 'empty' | null`. `'empty'` means `s.fuelPerTile > 0 && fuel <= 0`, and `'low'` is the existing `low` test. `fuelLimited()` reuses it for `low`. Add a test in `far.test.ts` (or the existing test file for `far.ts`) for the three results.
- Commit: "Max speed as named steps from the sim; gun draw and engine capacity queries (#173)"

### PH2 — UI formatters
- 2.1 `src/ui/speed-breakdown.ts` (create) — owns the max-speed and power text.
  - `export type SpeedRow = { label: string; effect: string; kph: number }`
  - `export function speedRows(w: World, steps: SpeedStep[]): SpeedRow[]` — exhaustive switch (IV4).
  - `export function speedNotes(w: World, v: Vehicle, steps: SpeedStep[]): string[]` — the gun-power explanation from `RULES` and the fuel note from `fuelLimit`.
  - `export function powerChip(steps: SpeedStep[], v: Vehicle): { text: string; detail: string; over: boolean }`.
  - It reuses `weatherLabel` by exporting it from `hud-readout.ts`.
- 2.2 `src/ui/hud-readout.ts:259-270` (modify) — `getHudReadout` calls `maxSpeedSteps` once. `maxSpeed` is `String(kph(last.speed))`, and it adds `speedRows` and `speedNotes`. Export `weatherLabel`.
- 2.3 `src/ui/speed-breakdown.test.ts` (create) — the total equals `getHudReadout().maxSpeed` for every PH1 scenario (IV2); the row km/h values chain; the chip text for no guns, guns, over capacity, broken gun, no engine, broken engine and stalled; the note never claims a cost per gun.
- Commit: "Format max-speed rows and the power chip (#173)"

### PH3 — HUD tooltip and header chip
- 3.1 `src/ui/max-speed-view.ts` (create) — `class MaxSpeedView { readonly root; render(readout): void }`. It builds the focusable root and the tooltip once, then rewrites rows in place.
- 3.2 `src/ui/hud.ts:92,376-479` (modify) — the `Hud` owns a `MaxSpeedView`. `renderTop()` builds the top panel's slots once (condition, clock, speedometer, readouts, actions). Each refresh replaces slot contents and calls `maxSpeed.render()`, never detaching its root (IV6). Resolve UK1 against the `game.ts` keydown handler.
- 3.3 `src/ui/inventory.ts:966-983` (modify) — `truckChips()` adds the power chip from `powerChip(maxSpeedSteps(w, me), me)`.
- 3.4 `src/ui/style.css:156,947,1327` (modify) — styles for the focus ring and tooltip on `.speed-max`, `flex-wrap: wrap` on `.chips`, and the narrow-screen tooltip anchor.
- 3.5 Vitest runs without a DOM (UI tests cover readouts only), so the chip text is covered by 2.3. The PH4 Playwright script checks IV6: the `.speed-max` element keeps focus and its tooltip stays open across turns played while focused.
- Commit: "HUD max-speed breakdown on hover and focus; power chip in truck headers (#173)"

### PH4 — Docs and browser checks
- 4.1 `docs/wiki/mechanics/truck.md:29` — one sentence: the truck headers show power and its speed cost, and the HUD max speed explains its causes. `docs/architecture/render.md` — one line on `MaxSpeedView` persistence.
- 4.2 `tmp/issue-173.ts` Playwright script on the real GPU (per `docs/tools.md`), driving `window.__ROAM__`:
  - In the inventory and a town garage: no guns → install a gun → several guns → break one → remove one → swap the engine → break the engine. After each step, read the chip and compare it with `workingEngineCapacity` and `gunDraw` from the sim.
  - Hover and Tab-focus the HUD max speed: compare the total with `.speed-max` text. Toggle overdrive, load cargo, break a wheel, stall, break the transmission, add a storm and hitch a tow, and check that the rows change.
  - Screenshots at 1600×900 and 700×900 of the tooltip and of the inventory header. Look at them.
- 4.3 Run `npm test`, `npm run typecheck`, `npm run playtest`, `npm run perf` and `npm run stuck`. `stuck` runs because `vehicleStats` feeds NPC driving.
- Commit: "Docs for power and max-speed readouts (#173)"

### Order & dependencies
- PH1 → PH2 → PH3 → PH4, in sequence. Each phase uses the previous phase's signatures and outputs.

### Risks / rollback
- RK1 — The step array per `vehicleStats` call costs frame time. Mitigation: `npm run perf` in PH4. On a miss, build steps only in `maxSpeedSteps`, and have `vehicleStats` call an allocation-free `maxSpeedOf` that `maxSpeedSteps` also calls step by step, not a copy. Record that as a deviation.
- RK2 — Reordering the multiplications changes float results and nudges NPC behavior. Mitigation: keep the exact operation order, guarded by the PH1 golden test and by `npm run stuck`.
- RK3 — Slotting `renderTop()` breaks the playtest check that each single-control panel fills its box. Mitigation: keep classes and structure inside each slot unchanged, and run `npm run playtest`.
- Rollback: each phase is one commit. Revert in reverse order.

## Code smells
- `src/sim/stats.ts:26` — the `limpSpeed` comment says it applies with "an empty tank", but `vehicleStats` never reads fuel. `far.ts:fuelLimited` does. The comment misleads a reader of `maxSpeed` (GPC4).

## Conclusion

Built as planned. `maxSpeedSteps()` in `stats.ts` is now the only max-speed rule and `vehicleStats().maxSpeed` is its last step (golden test frozen against pre-change values, bit for bit). `gunDraw`, `workingEngineCapacity` and `fuelLimit` were added. The HUD max speed is a persistent focusable node with a CSS hover/focus tooltip, and `truckChips()` has a power chip, so inventory, shop/garage and trade headers all show it.

Deviations from the plan:
- The quality gate's fragmentation limit for `src/ui` blocked new files. The formatters (`speedRows`, `speedNotes`, `powerChip`) live in `hud-readout.ts` and `MaxSpeedView` in `hud.ts`, not in `speed-breakdown.ts` / `max-speed-view.ts`. The test is `src/ui/speed-readout.test.ts`.
- `speedRows(weather, steps)` takes the HUD's weather label instead of `(w, steps)`, to avoid an import cycle. `speedNotes(w, v, stats)` takes the truck's stats.
- PH2 and PH3 are one commit, since the gate rejected PH2 alone for the same fragmentation reason.
- The transmission step is only listed when it lowers the speed.
- Not run (the task says the testing stage and the factory run them): `npm run playtest`, `perf`, `stuck`. The step array is one small allocation per `vehicleStats` call, so `perf` is the open risk RK1.

Verification: `npm test` passed 167 files, 3101 tests. Vitest also printed one worker RPC timeout ("onTaskUpdate") from machine load, with no failing test. `npm run typecheck` is clean. A Playwright check (software GL) confirmed that the `.speed-max` node keeps focus and its open tooltip across a played turn (IV6), at 1600x900 and 700x900.

No test failures existed on `dev`, so there are no separate fix commits.

### Visual self-review
Views read: `tmp/i173-hud-1600.png`, `tmp/i173-hud-700.png` (focused max speed with the tooltip open), `tmp/i173-inv-1600.png` and `tmp/i173-inv-700.png` (inventory header with the power chip).
- Found: the first inventory capture did not open because a turn was still playing. I reordered the script and captured again.
- At 1600 the tooltip sits above the instruments, fully on screen. At 700 it is fixed at the left edge and fits the width. The header chip wraps to a second row at 700 and reads "1 / 7 power · −3% speed".
- Remains: the tooltip covers the condition panel while open. The "Engine +0 km/h" row shows for the stock engine. Only the default truck was captured. The other cases (overload, broken engine, stalled, storm, tow) are covered by unit tests, not by screenshots.
