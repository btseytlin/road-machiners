# Release playtest in one stage

**Status:** reviewing
**Branch:** playtest-one-stage
**Worktree:** .worktrees/playtest-one-stage
**Goal:** One playtest job takes a release from a fresh head to a passed head, or to a block for a member, with no release task in between. Findings that the release did not cause become bug issues for dev instead of blocking it. Confirming it needs the next real release on the server, since only the server runs the harness on the release.
**Mode:** interactive

## Context

- Release 2026-10-07 spent 6 playtest runs and 5 fix tasks in 19 hours, and only run 3 passed. Each run's report is on issue #352.
- `prompts/release-playtest.md` asks for every bug a player would hit in a 2250-turn run, and a clean verdict needs no important finding at all. Runs 4 to 6 reported old NPC bugs that `main` has too, like an escort to a territory that never ends.
- The review is a sample. Runs 5 and 6 played the same commit `eaa16225` on the same seed and named different important findings.
- Any move of the release drops the pass. Run 3 passed at `367351ff`, then `takeMain` in `src/stages/ship.ts` merged 7 `main` game files into the release, and run 4 hunted from scratch.
- A fix goes through a release task card: design, implementation, hardening, checks, approve. That took 1 to 2 hours per run, and the next run's agent starts with no memory of the earlier scope.
- The release gate in `src/tick.ts` and the job in `src/stages/playtest.ts` read open release tasks from the project board. On the server, run 5 put #371 on the board at 12:21:15, the 12:21:51 tick still did not see it and started run 6, and the 12:22:53 tick saw it. The board lags its writes by up to a minute.
- One playtest job took 41 to 57 minutes: about 20 to 28 minutes of clone, `npm ci` and harness, and 23 to 29 minutes of Opus review. The playtest runs in the verify queue, whose timeout is 240 minutes.

## Design

The playtest job becomes a loop that the factory drives inside one job. One agent session lives through the whole loop, so its scope stays fixed.

1. Take main. The job merges `main` into the release when the release lacks it, with `mergeResolving` for a conflict, as `takeMain` does. Then it reads the release head. Ship keeps `takeMain` as the guard for a `main` that moved after the pass.
2. First play. The factory plays the seed on the release head and on the baseline, side by side. The baseline is the commit the playtest last passed for this release, or `main` when nothing passed yet. The agent gets both logs, both fact files and the list of open bug issues.
3. First review. The agent sorts every finding as `release` or `old`. A `release` finding is caused by a change between the baseline and the release head. An `old` finding shows on the baseline too, or its cause predates that diff. Each finding names its evidence for the sort. The agent then fixes the important `release` findings in the clone and commits.
4. Replay. The factory replays the seed on the clone's head and gives the agent the new log and facts in the same session. The agent checks that each fix holds and that the fixes broke nothing. It does not hunt again: a new finding counts only when its cause is one of the agent's own fixes. It may fix again and commit.
5. Limit. A session plays at most `FACTORY_PLAYTEST_RUNS` times, the first play included. The last play can only pass or block. Blocked keeps today's meaning: a design or taste question, a fix the agent cannot make safe, or findings left at the limit.
6. Land. A clean session with commits goes through `guardedHead`'s diff checks and the check script of `src/stages/checks.ts`: tests, typecheck, the browser playtest and the build. A failed check goes back to the agent as one more round, and it counts against the limit. Then the factory merges the clone head into the release with `ctx.repo.merge`, as the incident job lands its entry. When the release head is still that commit, it is the passed commit. A release that moved meanwhile plays again on the next tick, as today.
7. Old bugs. Each important `old` finding that matches no open bug issue opens one issue with the `bug` label. It enters intake like any other bug and waits for votes. Minor `old` findings stay in the report.
8. Records. Every play keeps its audit folder, numbered by `release.playtest.runs`. The job comments one report on the tracking issue at the end, with the plays, the fixes, the old bugs it opened and the verdict.
9. Race. `state.release.tasks` records every release task the factory creates: the cut's cleanup tasks, a committee reply's task, and a card triage labels `release-task`. The gate counts a recorded task as open until the board shows it in Done, so a task the board has not shown yet holds the playtest.

The playtest no longer opens a release task, so `openFixTask`, `fixTaskBody` and `release.playtest.streak` go away. `factory retry` on the tracking card still lifts a block and keeps the decision in `release.playtest.notes`. The playtest gets its own timeout, `FACTORY_PLAYTEST_TIMEOUT_MINUTES`, since four plays with fixes and checks take about 3.5 hours.

Old state: a saved `release.playtest.streak` is ignored, and a saved release with no `tasks` reads as an empty list. The open release 2026-10-07 has #371 and #372 open, so its playtest waits for them as today and then runs the new loop.

TDD: yes. The loop, the gate and the outcome rules are deterministic factory code with fake containers in the existing tests.

### Invariants

- IV1 — No playtest job opens a `release-task` issue.
- IV2 — The playtest never starts while a release task recorded in `state.release.tasks` is outside Done on the board, including one the board does not list yet.
- IV3 — A job plays at most `FACTORY_PLAYTEST_RUNS` times, and it ends with a pass, a block or no outcome when the release moved.
- IV4 — Agent commits reach the release only after the diff checks and the check script pass on that exact commit.
- IV5 — `release.playtest.passed` is set only to a commit that a play reviewed clean and that is the release head after the landing.
- IV6 — An `old` finding never blocks the release, and a `release` finding left unfixed at the last play blocks it.
- IV7 — The release holds all of `main` before the first play of a job.

### Principles

- PC1 — The factory counts plays, reads facts and lands commits. The agent only reviews and fixes, as in today's stage.
- PC2 — Reuse `mergeResolving`, `guardedHead`'s checks, the checks script and `ctx.repo.merge`. Do not write a second merge or push path.

### Assumptions

- AS1 — `--resume` of one session id across several containers keeps the agent's memory of the earlier rounds, as it does for the other stages.
- AS2 — Two harness runs side by side fit the verify pool's CPUs and memory with the other jobs.
- AS3 — A play, a review round and the checks fit in about 3.5 hours for four plays.

### Unknowns

- UK1 — How the factory lists open bug issues for the agent's duplicate check, since `candidates` may filter by votes.
- UK2 — Whether the agent can tell an `old` finding from a `release` finding well enough on the first play, or the baseline log needs a facts diff from the factory.

## Plan

Approach: keep the job's entry, audit and comment code in `src/stages/playtest.ts`, and replace its single play with a factory-driven round loop. The outcome rules stay pure functions in `src/stages/playtest-review.ts`. The race fix is a separate phase, since it touches the gate and the three places that create release tasks. UK1 is resolved: `ctx.github.candidates(['bug'])` lists open bug issues.

### PH1 — Recorded release tasks
- 1.1 `src/types.ts:146-155` `ReleaseState` gains `tasks: number[]`, the release tasks the factory created or labeled.
- 1.2 `src/state.ts:28-31` `fillRelease()` gives a saved release with no `tasks` an empty list. `src/stages/release.ts:36-41` sets `tasks: []` in the new release.
- 1.3 `src/stages/release-common.ts:40-42`
  - `recordReleaseTask(ctx: Ctx, issue: number): void` adds the issue to `state.release.tasks` under the state lock.
  - `openReleaseTasks(ctx)` returns `openTasks(cards, tasks)`.
  - `openTasks(cards: Card[], tasks: number[]): number[]` lists release-task cards outside Done, plus recorded tasks the board does not show in Done, sorted and unique.
- 1.4 Callers record before `addCard`: the cut's cleanup tasks in `src/stages/release.ts:38-41`, the reply task in `src/inbox.ts:223-230`, and the triage label in `src/stages/triage.ts:62-63`.
- 1.5 `src/tick.ts:123-128` `playtestGate()` takes the tasks and uses `openTasks`. `readReleaseGate` passes `release.tasks`.
- 1.6 `src/position.ts` flags a recorded task that is not on the board, near the release checks at line 121. `src/ctl.ts` `factory release` prints the recorded tasks. `docs/state.md` describes `release.tasks` and the gate rule.
- Tests: `tick.test.ts` gate holds for a recorded task missing from the board and opens once the board shows it Done. `release.test.ts`, `inbox.test.ts`, `triage.test.ts` record the task. `position.test.ts` flags the missing card.
- Respects: IV2.
- Commit: Release tasks the factory creates hold the playtest until the board shows them done

### PH2 — Playtest timeout
- 2.1 `settings.env:56-59` adds `FACTORY_PLAYTEST_TIMEOUT_MINUTES=330` with its reason, and rewrites the `FACTORY_PLAYTEST_RUNS` comment to mean plays per job. `src/config.ts:56-57,87` and `src/types.ts:50-51` add `playtestTimeoutMinutes`.
- 2.2 `src/tick.ts:274-281` `timeoutOf()` returns `cfg.playtestTimeoutMinutes` for the stage `playtest`, and the queue limit for the rest.
- Tests: `tick.test.ts` or `config.test.ts` reads the key and times out a playtest job by it.
- Respects: AS3. Value: four plays at about 45 minutes each with the review, plus checks and fixes, came to about 3.5 hours. 330 is the implement timeout, the longest the factory already allows.
- Commit: The release playtest gets its own time limit

### PH3 — The round loop
- 3.1 `src/stages/playtest-review.ts`
  - `Finding` gains `cause: 'release' | 'old'`, `why: string` and `known: number | null`. `readReview` rejects a finding without a valid cause or why.
  - `Review.verdict` becomes `'clean' | 'fixed' | 'blocked'`. `plan` goes, and `fixes: string[]` lists what the agent committed this round.
  - `judge(facts: LogFacts, review: Review, last: boolean): Outcome` with `Outcome['outcome']` of `'clean' | 'replay' | 'blocked'`. Fixed on the last play blocks. Clean keeps today's clean rules, but only important `release` findings fail it.
- 3.2 `src/stages/playtest.ts`
  - `playtest(ctx, issue)` checks the release, takes main (IV7), clones the release and runs `rounds()`.
  - `takeMain(ctx: Ctx, release: ReleaseState): Promise<void>` merges `main` into the release with `mergeResolving` when `isMerged('main', branch)` is false, then fetches.
  - `firstPlay()` plays the release head and the baseline side by side with `Promise.all`. The baseline is `release.playtest.passed ?? main head`, in clone `work/release-baseline`, checked out at that commit. Its log goes to `.factory/playtest/baseline.jsonl` with its facts, and the agent also gets `.factory/open-bugs.md` from `candidates(['bug'])`.
  - `rounds()` counts each play with `startPlay()` against `FACTORY_PLAYTEST_RUNS` (IV3). It runs the agent in one session from `roundSession(home, issue, 'playtest-<run>', false)` and resumes it after the first call (AS1). Each review keeps its audit folder.
  - A clean review with the clone head at the played commit ends the loop. A clean review with new commits replays. A fixed review with no new commit blocks.
  - `openOldBugs()` opens one `bug` issue per important `old` finding with `known` null, and adds it to `.factory/open-bugs.md`. Never a release task (IV1, IV6).
  - `land()` runs only when the clone head differs from the job's start head. It fails on uncommitted changes. It runs the same checks as `guardedHead`: `untrackFactoryFiles`, `fetchFromWork`, `factoryPaths` and `changesSaveMajor` on the diff from the start head. Then it runs the check script on the clone (IV4). A real failure goes to the agent with `prompts/release-playtest-checks.md`, and a replay follows within the limit. A timeout-only failure reruns the checks, as `checkPatiently` does.
  - The landing pushes the clone head to the release with `ctx.repo.push`, a fast-forward, so the release head is the reviewed commit (IV5). A push rejected because the release moved merges the head with `mergeResolving` and passes nothing, so the next tick plays the new head.
  - `settle()` passes the commit only when the release head equals it after the fetch. Blocked sets `release.playtest.blocked` and throws, as today.
  - `openFixTask`, `fixTaskBody`, `atLimit` and the `streak` counter go. `RunMeta.task` becomes `bugs: number[]`. `comment()` names the plays, the fixes, the bugs and the next step.
- 3.3 `src/stages/checks.ts`: export `checkScript` and `timeoutOnly`, and the patient loop as `checkUntilReal(run: () => Promise<string | null>, onTimeout: (run: number) => void): Promise<string | null>`, which `checkPatiently` then calls. `checkScope` guards the build scope.
- 3.4 `src/types.ts:137-144` and `src/state.ts:25` drop `streak` from `PlaytestState`. `src/ctl.ts:224-227,264-272` drop it from `factory release` and `retry`. `src/dashboard/snapshot.test.ts:26` follows.
- 3.5 Prompts: rewrite `prompts/release-playtest.md` for the first round: two logs, sorting by cause, `open-bugs.md`, fixing release findings with commits, and the new JSON. Add `prompts/release-playtest-replay.md` for a replay: check each fix in the new log and look only for harm from the fixes. Add `prompts/release-playtest-checks.md` for a check failure.
- 3.6 `src/cleanup.ts:25` adds `release-baseline` like `release-playtest`.
- Tests: TDD in `playtest.test.ts` and `playtest-review.test.ts`, listed below.
- Respects: IV1, IV3 to IV7, PC1, PC2.
- Commit: The release playtest fixes its own findings in one job

### PH4 — Docs and diagram
- 4.1 `docs/process.md:116-122`, `docs/stages.md:91-102`, `docs/state.md:63-69,153`, `docs/operations.md:50` and `factory/README.md` if it names the fix task.
- 4.2 `docs/diagrams/release.dot`: the playtest box fixes and replays inside itself, the `findings: fix task` edge goes, old bugs go to dev. Run `npm run diagrams`.
- 4.3 `hermes/SOUL.md:95` needs no change, since `retry` keeps its meaning.
- Commit: Docs: the release playtest is one stage

### Test strategy
- Review rules: cause is required, old important findings pass a clean verdict, release important findings fail it, fixed on the last play blocks.
- Loop: clean on the first play passes the head with no push. Fixed, then clean on the replay, runs the checks, pushes the clone head and passes it. Fixed on every play blocks at the limit, with no push and no release task.
- Baseline: the first play runs two harness commands, the baseline at `passed` when one exists and at main otherwise.
- Old bugs: an important old finding opens one `bug` issue, and a `known` one opens none.
- Landing: a failed check gives one agent round and a replay. A save bump or a factory path in the diff fails the job before any push. A release that moved during the job merges the fixes and passes nothing.
- Main: a release that lacks main gets the merge before the first play.
- Run with targeted files only: `npx vitest run src/stages/playtest.test.ts src/stages/playtest-review.test.ts src/tick.test.ts ...`, then `npm run typecheck` and `npm run quality` at the root.

### Order & dependencies
- PH1 and PH2 are independent. PH3 builds on PH1's `ReleaseState` and PH2's config. PH4 goes last. One agent does all four in order, since they share `src/types.ts` and `src/state.ts`.

### Risks / rollback
- RK1 — An agent sorts real release bugs as old to pass. The prompt asks for evidence per sort, the report lists every sort for the committee, and the committee still plays the candidate.
- RK2 — A long job holds one of the two verify workers for hours. The total time is about what the old runs and fix tasks took, now in one slot.
- RK3 — The release 2026-10-07 is mid-loop with #371 and #372 open. The new code waits for them, then runs one job. Rollback is a revert of the merge on main.

## Verify

Result: passed

Happy-path:
- CK1 — real git: a commit in the work clone, `fetchFromWork`, `headHash` of the full hash, `diff` from the start head and a fast-forward `push` leave the release head at the reviewed short hash — held, probed against a bare origin.
- CK2 — the harness on `main` takes `--sha` and writes a log `logFacts` reads — held: 60 turns, ending complete, 442 events.

Negative:
- CK3 — a push to a release that moved goes through and overwrites it — held: rejected, and the merge path kept both commits.
- CK4 — harness output, factory files, `tmp/`, `dist/` or `node_modules` make the clone look dirty and block every landing — held: `git status --porcelain` stays empty.
- CK5 — a replay that lists an old finding again opens a second bug issue — broke, fixed in 1e0e812f with a per-job title record and a `known` note in the replay prompt.

Invariants / assumptions:
- CK6 (IV1) — any path in `playtest.ts` opens a release task — held: no use of the label, tests check `created`.
- CK7 (IV2) — a recorded task the board does not list lets the playtest start — held by the gate test and the job test.
- CK8 (IV4, IV5) — fixes reach the release without checks, or a moved release gets a pass — held by the job tests for factory paths, failed checks, dirty clones and a moved release.
- CK9 (AS1) — resume of one session id — deferred: only the server's agent image can show it. The tests check the id and the resume flag.
- CK10 (AS2, AS3) — two harness runs side by side and four plays fit the pool and 330 minutes — deferred to the first real job.

Interfaces:
- CK11 — Hermes, the dashboard or other code read `streak`, the fix task or the old `factory release` line — held: no reader outside the changed files.

Smoke: `npm run progression:playthrough -- --seed 20261007 --turns 60 --sha main001` on this branch, then `logFacts` on its log — passed.
Goal: proxy only. The full job needs the server's containers and Opus. The next release playtest on the server confirms it.
