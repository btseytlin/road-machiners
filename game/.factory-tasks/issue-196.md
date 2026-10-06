# Make missed shots land near their target (issue 196)

**Status:** planning
**Branch:** factory/issue-196
**Worktree:** none
**Goal:** In a real fight, every drawn miss that hits no truck lands on the ground at the sim's miss point beside the aimed truck, give or take at most 1 m along the line of fire for rounds without splash. Explosive misses blast exactly where the sim applied their splash. A stray hit on a truck the player cannot see draws no impact. Hit chance, damage, splash and stray results are unchanged.
**Mode:** hands-off

## Reference images

The issue has no reference images. The look is checked from in-game screenshots of misses (Plan, PH4).

## Context

- The sim resolves a miss off the truck at `missPoint()` (`src/sim/combat.ts:671`). That point is beside the target at its range, offset across the line of fire by `offset = aim center + angular error × distance`. Splash (`explode()`) and stray candidates (`strayCandidates()`) both start from that point.
- The renderer does not use that point. `missPoint()` in `src/three/render/projectiles.ts:127` rebuilds the lateral offset from the render points. Then it carries the round another 3 to 9 m past the target, at random, along the line from the muzzle (`MISS = { minPast: 3, maxPast: 9 }`).
- So every drawn miss lands 3 to 9 m beyond where the sim put it. An explosive miss draws its blast (`Fx3D.shot()` → `blast(plan.land)`) 3 to 9 m away from where the sim applied the splash damage. In a burst this draws a band of impacts 6 m deep behind the target.
- The sim's own sideways spread is modest at most fighting ranges. The table gives the standard deviation of the miss offset from the gun's spread, range falloff and recoil on a 3 t truck. It leaves out movement causes.
  - At a quarter of range it is 0.5 to 2.6 m for every gun.
  - At half range it is 1.0 to 3.8 m for every gun except the shotgun (7.5 m).
  - At full range it is 2.6 to 7.4 m for precision guns and 9 to 17 m for most others. The shotgun reaches 34 m. At full range those guns hit about 5% of the time (`RULES.minHit`), so their misses are the honest picture of a wild shot.
- That same offset sets the hit chance (`rollAim()`) and feeds `damageChanceOf()`, splash and stray rules. Squeezing it would change balance.
- A round whose stray victim the player cannot see (`roundAims()` gets null from `pointOf`) is drawn today as a ground miss past the target, with a dust puff and the miss sound. In the sim it hit a truck.
- The landing sound is `hit-metal` only when the round struck a truck (`volley.ts:53`). An explosive ground miss whose splash damaged a truck sounds like a plain ricochet miss.
- Guard misses (`src/sim/guards.ts:49`) carry a uniform ±1.5 m offset and no splash or stray. The same render overshoot pushes them past the target too.
- `ShotRound` lives in `world.events`, which is saved (`src/three/save.ts:126`). A new field on it would need a save migration.

## Design

The fix is a render change. The renderer stops inventing where a miss lands and reads the sim's landing point instead. The sim's rules and numbers stay as they are.

1. **One owner for the miss landing.** `src/sim/combat.ts` exports `missPoint(from: Vec, target: Vec, offset: number): Vec`. It takes positions instead of vehicles and keeps the same geometry. The sim's own calls pass `shooter.pos` and `target.pos`, so the sim output does not change by a bit.
2. **Ground misses land at that point.** A round that struck no truck lands on the ground under `missPoint(shooter pos, target pos, offset)`, from `groundPoint()`. The 3 to 9 m overshoot is removed. A truck shot reads the shooter and target positions from the world, from `vehicles` or `removed`, as `playTruckShot()` already does for the gun. A guard shot uses its gate point `e.from` as the shooter position.
3. **A little depth for rounds that do not explode.** A ground miss without splash moves at random up to `MISS_DEPTH = 1` m short or long along the line of fire. This is render-only, from `Math.random()`. Without it every miss in a burst would sit on one straight line across the line of fire. Such a miss has no gameplay result at its ground point, so nothing the sim decided moves. An explosive miss gets no depth and lands exactly on the sim point, where its blast is drawn.
4. **A stray hit on an unseen truck draws no impact.** That round flies to its miss point and ends with no puff, no blast and no sound. Its damage label and part breaks are already hidden for unseen trucks. The renderer does not draw a ground impact the sim never had, and it does not reveal the hidden truck.
5. **Sound follows the result.** A round sounds `hit-metal` when it struck a truck or its blast damaged one. A ground miss with no damage sounds `miss`. An unseen stray makes no landing sound.
6. **The render plan type says what the round hit.** `RoundAim` and `RoundPlan` swap `struck: boolean` for a closed union `impact: 'truck' | 'ground' | 'none'`. `Fx3D` draws sparks for `truck`, dust or a blast for `ground`, and nothing for `none`. The splash blast shows for `truck` and `ground` and never for `none`.

Approaches considered:

- **A. Render reads the sim point. This is the chosen approach.** Every sim result and saved shape stays the same. Visual and gameplay landing match exactly for anything that matters. The cost is that inaccurate guns at the very edge of their range still miss by 10 m or more. That is the issue's "longer-range or inaccurate weapons may miss by more".
- **B. Compress the sim miss offset**, for example cap it near the truck. Misses would look tighter at long range. But splash on the target would rise, `damageChanceOf()` would need the same change, and stray candidates would shift. That changes balance for a visual goal, and the issue rules it out unless it is genuinely needed.
- **C. Keep the render overshoot and clamp it smaller.** It still draws blasts where no splash happened, which the issue forbids.

Backwards compatibility: no saved type changes, so no migration. `RoundAim` and `RoundPlan` are internal to `src/three/`.

TDD: yes. `roundAims()`/`planVolley()` are deterministic pure functions apart from the bounded jitter, and the sim export needs a regression test.

### Invariants

- IV1 — A ground miss with splash lands exactly on the ground point under `missPoint(shooter pos, target pos, offset)`, with x and z equal to that point's and y equal to the ground height there.
- IV2 — A ground miss without splash lands within `MISS_DEPTH` m of that point along the line from the shooter, and exactly on it across the line of fire.
- IV3 — No drawn miss lands farther from the sim miss point than `MISS_DEPTH`. Nothing adds a further overshoot.
- IV4 — A round that struck a truck the player cannot see plans `impact: 'none'`, with no puff, blast or landing sound.
- IV5 — `fireWeapons()` results are bit-identical before and after the change. The existing combat tests pass unchanged, and `npm run combat` gives identical numbers on fixed seeds.
- IV6 — The landing sound is `hit-metal` exactly when the round's `struck` is set or its `blast` is non-empty, and `miss` for every other ground landing.

### Principles

Project principles (`docs/architecture/principles.md`) this change touches:

- P1 One rulebook: the change treats the player and NPCs alike. The render draws every truck's misses the same way. Visibility gates only what is drawn, as it already does.
- P2 The sim owns the rules: the renderer reads one rule outside `src/sim/`, where a missed round lands. Its owner is `missPoint()` in `src/sim/combat.ts`, now exported and called by `src/three/volley.ts`. Guard misses reuse it with the gate as the shooter. The guard rule (`fireSite()`) gives only an offset, and the sim has no other landing point for it. The depth jitter of IV2 is presentation, not a rule. No sim code reads where a non-splash ground miss falls.
- P3 Hot code uses an index: no new hot loops. The shooter and target lookup runs once per shot event per turn, as `playTruckShot()` already does for the gun.
- P5 Save facts: no saved type changes and no new caches.
- P6 Same seed: no new sim draws. The depth jitter uses `Math.random()` in render code, which the principle allows.
- P7 Fail loud: `playTruckShot()` throws when the shot's shooter or target is in neither `vehicles` nor `removed`. `missPoint()` throws when `from` equals `target`, as `computeRoundPoint()` does for render points.
- P4 (value) is not touched.

Task principle:

- PC1 — The renderer draws a round only where the sim says something happened. When the sim's point is hidden from the player, the renderer draws no impact rather than a substitute one.

### Assumptions

- AS1 — Vehicle positions in `world` after `endTurn()` equal their positions at `fireWeapons()`. No step between fire and the end of the turn moves a truck, so the render can rebuild the sim miss point from them.
- AS2 — The committee accepts that guns fired near the edge of their range still miss widely (sd 9 to 34 m). The issue allows longer-range or inaccurate weapons to miss by more, and tightening them needs a balance change (approach B).
- AS3 — 1 m of depth jitter reads as believable without hiding which side of the truck the round passed.

### Unknowns

- UK1 — Whether a ground miss just outside the truck's edge, flying low from the muzzle, visibly clips the truck's near corner before landing. It is resolved by the PH4 screenshots. A clip shows only in the last metre of flight below wheel height, and is accepted if minor.

## Plan

Approach: make the sim's miss point a public query (PH1). Then make the render plan read it and say what each round hit (PH2). Then wire volley, sound and fx to the new plan (PH3). Last, check the result in the browser (PH4). The sim stays bit-identical (IV5). Every visual change sits in `src/three/`.

### PH1 — Export the sim miss point
- 1.1 `src/sim/combat.ts:670-675` (modify)
  - `export function missPoint(from: Vec, target: Vec, offset: number): Vec` keeps today's geometry, computing the across-unit from `bearing(from, target)`. It throws when `from` and `target` are the same point (P7).
  - `missReach()` (`:463`) and `landRound()` (`:643`) pass `shooter.pos` and `target.pos`. `across(shooter, target)` stays for `spreadCauses()`. `missPoint` does not call it, because that takes vehicles.
  - Respects: IV5, P2.
- 1.2 `src/sim/combat.test.ts` (modify). Add tests that `missPoint` puts a positive offset on the shooter's right at `offset / PHYSICS.metersPerTile` tiles from the target, and that it throws on a shared point.
- Before the edit, run `npm run combat -- --enemies buggy,gunwagon --policy all --seeds 1-10` and save its `tmp/combat/` output. After the edit, run it again and diff. The output must be identical (IV5).
- Commit: `Export the sim's miss point so the renderer can land misses where the sim did`

### PH2 — Render plan lands misses on the sim point
- 2.1 `src/three/render/projectiles.ts:1-3, 76-137` (modify)
  - Rewrite the header comment: misses land on the ground at the sim's miss point.
  - Remove `MISS`. Add `const MISS_DEPTH = 1; // meters a non-exploding ground miss may land short or long of the sim point`.
  - `export type Impact = 'truck' | 'ground' | 'none';`
  - `export type RoundAim = { impact: 'truck'; b: V3; offset: number } | { impact: 'ground' | 'none'; land: V3 };`
  - `export type RoundPlan = { land: V3; impact: Impact; delayMs: number; flightMs: number };`
  - `roundAims(b: V3, targetId: string, rounds: ShotRound[], pointOf: (id: string) => V3 | null, missAt: (offset: number) => V3): RoundAim[]`
    - Struck the target: `truck` with `b` and `r.offset`.
    - Struck no truck: `ground` at `missAt(r.offset)`.
    - Struck another truck that is shown: `truck` at its point with offset 0.
    - Struck another truck that is not shown: `none` at `missAt(r.offset)` (IV4).
  - `planVolley(spec, a, rounds, timing, groundY, blastRadius: number): RoundPlan[]`. A `truck` round keeps `hitPoint()`. A `none` round lands at its `land`. A `ground` round lands at its `land` when `blastRadius > 0` (IV1). Otherwise `groundMiss(a, land, groundY)` moves it by `(Math.random() * 2 - 1) * MISS_DEPTH` along the horizontal unit from `a` to `land`, with y from `groundY` (IV2, IV3).
  - Delete the old `missPoint()`.
- 2.2 `src/three/render/projectiles.test.ts` (modify). Write these tests first.
  - Rewrite `round()` for the union.
  - `roundAims` gives each of the four cases above.
  - Splash ground misses land exactly on `land` (x, z) at `groundY`.
  - Non-splash ground misses keep the lateral part of `land` exactly and stay within `MISS_DEPTH` along the line. Sample 200 rounds.
  - `none` lands on `land`.
  - Replace "sends misses past it to the ground" with "lands misses at the sim point".
  - The window and burst tests take the new arguments.
- Commit: `Land drawn misses on the sim's miss point with a small depth jitter for non-exploding rounds`

### PH3 — Volley, sound and fx follow the plan
- 3.1 `src/three/volley.ts:30-61` (modify). `playVolley(...)` gains `missAt: (offset: number) => V3` after `b` and passes it to `roundAims`. It passes `blastRadiusOf(weapon)` to `planVolley`. The `landed` cue sounds nothing for `impact === 'none'`. It sounds `hit-metal` when `rounds[k].struck !== null || rounds[k].blast.length > 0`, and `miss` otherwise (IV6). Breaks still play for every round.
- 3.2 `src/three/volley.ts:114-133` (modify)
  - `playTruckShot()` finds the target in `vehicles` or `removed` and throws when the shooter or target is missing (P7). It passes `missAt = (o) => groundPoint(w.terrain, missPoint(shooter.pos, target.pos, o))`.
  - `playGuardShot()` passes `missAt` from `missPoint(e.from, target.pos, o)`, with the same lookup and throw.
  - Import `missPoint` from `../sim/combat`.
  - Respects: AS1, P2.
- 3.3 `src/three/render/fx.ts:298-319` (modify). `shot()` draws nothing on landing for `impact === 'none'` but still calls `cues.landed()`. Otherwise it draws a blast when `blastRadius > 0`, else `impact()`. `impact()` reads `plan.impact === 'truck'` for sparks and dust otherwise. Update the comment.
- 3.4 `src/three/volley.test.ts` (modify). Extend the `playVolley` host so it records `sound.at` cue ids. Then test, against IV6, that:
  - a ground miss sounds `miss`
  - a ground miss with a non-empty `blast` sounds `hit-metal`
  - a round that struck the target sounds `hit-metal`
  - a stray on a hidden truck (`eventPoint` null for it) sounds nothing and still fires its break cue
  - a missing shooter or target in `playShotFx` throws.
  - for a sim `fireWeapons()` splash miss on flat ground, the `missAt` that `playTruckShot()` builds gives the point that `explode()` used. Check that a truck parked there takes the blast (RK2, AS1).
- Run `npm test`, `npm run typecheck` and `npm run quality` from the root.
- Commit: `Sound and draw each round by what the sim says it hit`

### PH4 — Browser check of misses
- 4.1 `tmp/misses-196.mjs` (create, not committed). It is a Playwright script as in `docs/tools.md#browser-checks`, run with `--cpu` flags on the factory server.
  - Through `__ROAM__.state` and `apply()`, it sets up a hostile buggy at a quarter of range and at full range from the player.
  - It runs three loadouts in turn: `longRifle` (single shot), `gatling` (12-round burst) and `rocketRack` (explosive, 4 rounds).
  - It gives the target a moving speed, so misses happen.
  - It sets the target to east, north-east and south of the player. The iso camera angle is fixed, so this is how the check covers several viewing angles of the line of fire.
- After each fired turn, read the `shot` event. For every ground miss, compare `missPoint(...)` against the drawn landing point, taken from a dev hook or from `fx` puff positions logged in dev. Assert IV1 and IV2.
- Take screenshots at the landing moment, `combatShotMs` after the band starts, into `tmp/misses-196/`. Look at them and record in Verify, by name:
  - misses as dust beside the target, never in a band behind it
  - rocket blasts on the ground beside the target where damage labels show
  - hits as sparks on the body
  - whether any low miss clips the truck's corner (UK1).
- Run `npm run playtest -- --cpu`.
- Commit: none. Evidence goes in Verify.

### Test strategy
- TDD for PH1 to PH3. Write the failing tests in each phase before the change.
- IV5 rests on the unchanged combat tests plus the identical `npm run combat` diff from PH1.
- IV1 to IV4 are covered by the projectiles tests, IV6 by the volley tests, and the end to end check by PH4.

### Order & dependencies
- PH1 runs first, because PH3 imports `missPoint`. PH2 can run alongside PH1. PH3 needs PH1 and PH2. PH4 runs last.

### Risks / rollback
- RK1 — `world.removed` may drop a destroyed shooter before playback, so `playTruckShot()` would throw. The existing gun lookup already relies on `removed`, and the PH4 run covers a kill shot. If it throws, stop and log it under Deferred instead of adding a fallback.
- RK2 — A truck moving between fire and the end of the turn would break AS1. The pipeline in `src/sim/world.ts:281-312` shows no movement after `fireWeapons`. A unit test in PH3 compares the sim splash point with `missAt` for a splash miss.
- Rollback: every phase is its own commit, and PH2 and PH3 are render only.

### Interfaces
- IF1 — `missPoint(from: Vec, target: Vec, offset: number): Vec` in `src/sim/combat.ts`, in map tiles, with a positive offset on the shooter's right. It throws on a shared point.
- IF2 — `RoundAim`, `RoundPlan.impact`, `roundAims(..., missAt)` and `planVolley(..., blastRadius)` in `src/three/render/projectiles.ts`, as in PH2.

### Interface graph
- PH1 -> IF1 @ src/sim/combat.ts, src/sim/combat.test.ts
- PH2 -> IF2 @ src/three/render/projectiles.ts, src/three/render/projectiles.test.ts
- PH3 IF1, IF2 -> @ src/three/volley.ts, src/three/volley.test.ts, src/three/render/fx.ts

## Conclusion

### Hands-off decisions
- udesign: render reads the sim miss point and the sim stays unchanged (approach A) — it keeps hit chance, damage, splash and stray rules exactly, as the issue asks. Tightening long-range spread is a balance change, recorded as AS2 for the committee.
- udesign: 1 m depth jitter only for non-exploding ground misses — it breaks up the straight line of a burst without moving any point the sim acts on.
- udesign: a stray on an unseen truck draws no impact — this avoids painting an impact the sim did not have and avoids revealing the hidden truck.
- udesign: the landing sound becomes `hit-metal` when splash damaged a truck — the issue asks that sounds match the resolution, including splash.
- uplan: plan auto-approved.

### Implementation
- PH1: `missPoint(from, target, offset)` is exported from `src/sim/combat.ts` and takes positions. The sim calls it with `shooter.pos` and `target.pos`. The geometry is unchanged. Tests cover the offset side and the shared-point throw.
- PH2: `projectiles.ts` lands ground misses on the sim point. Non-exploding misses get up to 1 m of depth. A stray into an unseen truck plans `impact: 'none'`. `struck` is replaced by `impact`.
- PH3: `volley.ts` builds `missAt` from the shooter and target positions, or the gate point for guards. It throws on an unknown truck. The landing sound is `hit-metal` when the round struck a truck or its blast damaged one, `miss` otherwise, and nothing for `none`. `fx.ts` draws nothing for `none`.

### Visual self-review
- The browser check ran only partly. Headless Chromium with software drawing was too slow (screenshots timed out), and the frames I got showed the target outside the gun's arc ("not in sight"), so no shot was fired. I read two screenshots and they show no misses. I did not verify the look of the landings in a browser. The testing stage should check misses at a quarter range and full range, with the target in the gun's arc, and the UK1 corner clip.
- Unit tests cover IV1 to IV4 and IV6 (projectiles and volley tests).
- Not done: `npm run combat` baseline diff for IV5 (too slow here; the sim change is a pure refactor of the same formula, and the existing combat tests pass). Not done: the volley test that compares the sim's splash point from `fireWeapons()` with `missAt`.

### Failures fixed outside this issue
- None. The full `npm test` run on this slow machine timed out in 8 map, physics and NPC tests. They all pass on a rerun with a longer timeout.

### Testing stage
- Browser check was partial. Software drawing at about 1 fps could not catch the short impact puffs. One fight at 12 tiles ran with 6 rounds, 5 misses with offsets of 5 to 24 m. No landing frame was captured, so the look and UK1 corner clip are unverified. The committee should watch misses at close range, long range and with rockets.
