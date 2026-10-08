# Trusted agent flow

**Status:** validating
**Branch:** trusted-agent-flow
**Worktree:** .worktrees/trusted-agent-flow
**Goal:** Each card stage runs as one agent session that fixes its own failures. Hard checks run only at four checkpoints. Approved cards reach `dev` through a merge queue that keeps `dev` working. Each fact about a card lives in one store.
**Mode:** interactive

## Context

- The factory treats each agent run as a black box that hands back a file. It parses the file and routes the card on the result, so every outcome needs its own route. Today that means 14 card positions, 5 test phases and 6 loops back.
- Fix rounds are separate jobs with fresh agents. Examples are the check fix in Testing, the review fix in Hardening and the visual review repairs. Each handoff loses the context of the session that did the work.
- Round caps decide when a card stops: `VISUAL_SEND_BACKS`, `VISUAL_REPAIR_ROUNDS`, `CHECK_RUNS`, "review fails twice" and `FACTORY_MAX_JOBS_PER_CARD`. A card that hits one goes stuck or back to Design. That costs hours even when one more try would have fixed it.
- Agents return results through fixed-name files with strict parsers: triage, approval, evidence, visual review, incident, playtest, changelog and waste brief. One bad field fails the job.
- A card's position lives in two places. The board holds the column, and `state.json` holds `testPhase`, `patching` and `approvedResolving`. `factory audit` and Hermes exist partly to fix the drift between them.
- Every failure adds `factory-stuck` and waits for Hermes, including crashes and GitHub outages that a plain retry would fix.
- Approve merges each card into `dev` alone. Checks run on the branch before the merge, not on the merged result, so two cards that pass alone can break `dev` together.
- The full test suite runs up to three times per card: in the testing agent's round, in Checks, and in Checks again after Hardening.
- In 1,780 issue comments since 2026-10-03, about 59 mention evidence or manifest rules and 72 the frame-rate gate. Both were then loosened.

## Design

The stage list stays as it is, plus one new stage, Merging, after Hardening. The change is how each stage runs.

One session per stage. Each stage is one agent session with one goal. The agent runs every check itself as a tool: tests, typecheck, build, playtest and screenshots. When the stage reaches its checkpoint and the check fails, the failure log goes back into the same session with `--resume`, and the agent keeps working. Fix rounds stop being separate jobs. The test phases `fix`, `checks-after-fix` and `resolve` disappear.

Budgets. Each stage has a budget of money and wall time in `settings.env`. A stage ends when its checkpoint passes or its budget runs out. The budget replaces every round count, send-back cap, "fails twice" rule and the per-card job cap.

Four checkpoints. Only these block a card:

1. The diff guard. It blocks protected paths and a major save bump. It runs as a pre-commit hook in the agent's clone, so the agent sees a failure at once. The factory runs the same check before every push, since an agent can skip a hook.
2. Before a committee post, the factory builds a fresh clone and runs the typecheck, the playtest and the build, with no suite, as [check-gates.md](check-gates.md) decided. A hotfix ships on approval, so its post checkpoint also runs the full suite.
3. Merging. The factory merges into `dev` in a work clone, runs the checks on the merged result, and pushes only after they pass. `dev` never receives untested code.
4. Before a ship, the release playtest and the build run.

Everything else an agent writes goes to the post or the issue as written. This covers screenshots, approval text and review notes.

Merging. Hardening ends by moving its card to the Merging column. A merge job starts when Merging holds cards and no merge job runs. It takes every card waiting at that moment, merges them into a work clone of `dev`, and runs checkpoint 3 on the result. A Sonnet session resolves conflicts and fixes failures in that clone. Its prompt tells it to keep the behavior the committee approved for each card. Merge jobs run one at a time. If `dev` moved during the checks, the job merges the new `dev` and checks again.

Failures. A crash, a GitHub outage or a timeout under load resumes the same session on the next tick. Only an empty budget makes a card stuck and wakes Hermes.

State. Each fact has one home.

- The board holds where each card is. A hand drag on the board is a real move.
- `state.json` holds only what the board cannot: running jobs, session ids, post ids, builds and spent budgets. It never records a position.

Nothing is stored twice, so `factory audit` has no drift to find.

### Invariants

- IV1 — Every push to GitHub passes the diff guard on the host.
- IV2 — `dev` only receives a commit whose merged result passed checkpoint 3.
- IV3 — A card's position is read only from the board.
- IV4 — A checkpoint failure resumes the session that owns the stage. It never starts a new fix job.

### Principles

- PC1 — An agent's output blocks a card only at a checkpoint. Everything else is shown as written.
- PC2 — Budgets bound work. Counts of rounds do not.

### Assumptions

- AS1 — A resumed session keeps enough context after compaction to fix a checkpoint failure in a long stage.
- AS2 — Hardening's merge of `dev` into each branch keeps merge queue conflicts small enough for Sonnet.
- AS3 — Adding a Merging option to the Project's Status field is a one-time change by hand.

### Unknowns

- UK1 — The starting budgets. Only the two stages with a checkpoint loop need one: Testing and Merging. On the dashboard day to 2026-10-08, verify spent $26.80 in 705 worker minutes, about $2.30 an hour. Testing starts at $10 and Merging at $5, about four and two hours of that.
- UK2 — Resolved. A patch reply moves the card to Testing. The Testing session starts new with the test prompt and the reply, since a job's sessions end with the job. The patch stage and its `patching` commit go away.
- UK3 — Resolved. `approval.json` stays as the post text. The screenshot and the evidence manifest are shown as written. The visual review file goes. The testing agent fixes what looks wrong itself, and writes `.factory/needs-redesign.md` only when the plan contradicts the issue.
- UK4 — Resolved. A docs-only branch keeps its short path. A cleanup task goes from Implementation to Hardening to Merging. A hotfix runs the harden prompt and the test prompt in Testing, and Approve ships it as today.
- UK5 — Deferred. The release side gets its own task.

## Plan

Approach: rebuild the four card stages after Design on one helper that runs a session, checks it, and resumes the same session with the failure until it passes or the budget runs out. Then collapse the state and positions that the old rounds needed.

### PH1 — Session loop and budgets

- `src/stages/common.ts`: `AgentExtras.continue` resumes the round's stored session with the given prompt. `untilPasses(ctx, issue, stage, budgetUsd, check, fix)` runs `check`, and on a failure calls `fix(failure)` while the job's spend is under the budget. An empty budget throws `BudgetError` with the last failure.
- `src/sessions.ts`: `roundSession` takes a `continue` mode that reuses the stored id.
- `src/ledger.ts`: `jobSpend(home, jobId)` sums the job's recorded runs without taking them.
- `settings.env`, `src/config.ts`, `src/types.ts`: `FACTORY_TESTING_BUDGET_USD`, `FACTORY_MERGING_BUDGET_USD`.
- Respects: IV4, PC2.

### PH2 — Testing in one job

- `src/stages/verify.ts`: one session `test`. The agent tests, fixes and writes the approval. The factory pushes, runs checkpoint 2 inline, resumes the session on a failure, then publishes, posts and moves the card to Approval.
- A hotfix runs the harden prompt, then the test prompt, in the same session, and its checkpoint runs the full suite.
- `.factory/needs-redesign.md` sends the card to Design. This is the only send-back.
- A queued patch reply goes into the prompt of a fresh session.
- Delete `src/stages/visual.ts`, `src/visual-review.ts`, `src/stages/patch.ts`, `prompts/visual-review.md`, `prompts/test-fix.md`, `prompts/test-fix-evidence.md` and `prompts/patch.md`. `src/stages/checks.ts` keeps the scripts, the post and the post-only phase.
- `src/stages/approval.ts`: a patch route moves the card to Testing with the reply in `patches`.
- Respects: IV1, IV4, PC1.

### PH3 — Hardening in one session

- `src/stages/harden.ts`: merge the base, run one session with `prompts/harden.md`, push, move the card to Merging. No checks and no review gate.
- `prompts/harden.md`: the agent attacks the change, runs `/code-review` with the incident log and the principles, and fixes every finding.
- Delete the review gate in `src/stages/review.ts` and `prompts/review.md`. The review text moves into the harden prompt.
- Respects: PC1.

### PH4 — Merging stage

- `src/types.ts`: column `Merging`. Job stage `merge` in the branch queue.
- `src/stages/merge.ts` (create): takes every Merging card of one base, merges each into a work clone of the base, resolves conflicts with `prompts/merge-branches.md`, runs the full checks with the test cache, fixes failures with `prompts/merge-fix.md` in one session under the budget, guards the diff and pushes. A moved base merges again and checks again. Each card goes to Done, gets `release-candidate` and a comment. Then `/dev/` rebuilds.
- `src/stages/approval.ts`: Approve moves a previewed card to Hardening, or ships a hotfix. The merge and the `resolve` path go.
- `src/tick.ts`: picks a merge job when Merging holds cards.
- Respects: IV1, IV2.

### PH5 — One store per fact

- `src/position.ts`: positions `triage`, `design`, `implement`, `verify`, `post`, `approval`, `harden`, `merging`, `done`. The drift checks for test phases and patching go.
- `src/types.ts`: `testPhase` holds only `post`. `patching`, `visualSendBacks` and the merge use of `pendingApprovals` go.
- `src/control.ts`, `src/ctl.ts`: move targets match. `move N approval` writes the approval text from the pull request when the clone has none.
- Respects: IV3.

### PH6 — Failures retry by themselves

- `src/job.ts`, `src/fail.ts`: a failed card stage that is not a `BudgetError` and not an agent stop resumes once on the next tick, with no stuck label. A second failure labels it.

### PH7 — Diff guard in the agent's clone

- `src/agent-check-bin.ts`: a `guard` round runs `guardDiff` on the clone's diff from its base. The work clone gets it as a pre-commit hook.
- Respects: IV1.

### PH8 — Docs

- `docs/process.md`, `docs/stages.md`, `docs/state.md`, `docs/evidence.md`, `docs/diagrams/*.dot`, `hermes/SOUL.md` match the new flow.

### Risks / rollback

- RK1 — The Project's Status field needs a Merging option before deploy, or every move to Merging fails. It is added by hand.
- RK2 — Cards in flight with old test phases. The new stages ignore any phase but `post`, so such a card runs its stage again from the start.
- RK3 — A merge batch fix could change an approved card's behavior. The merge-fix prompt forbids it, and each card's comment names the batch.

## Verify

- `npm run typecheck` passes. `npm test` passes 1001 tests with 1 skipped. The Hermes plugin tests pass 174.
- No real card has run the new flow yet. The first Testing, Hardening and Merging runs on the host confirm the Goal.

## Conclusion

- A sweep for leftovers after the build found five wrong behaviors and fixed them. The merge batch took stuck and held cards. Moves and holds did not see the issueless merge job. Build cleanup could delete a fresh Testing preview. The merge job ran the full suite on the 1-CPU light pool, under the 60-minute branch limit. It now takes the test pool and `FACTORY_MERGE_TIMEOUT_MINUTES`. The waste review counted the committee's wait after a Testing post as a queue wait.
- Stale prompts, settings comments, dashboard labels and docs from the old testing, review and patch flow were removed or corrected. [check-gates.md](check-gates.md) is superseded.
- RK1 holds: add the Merging option to the Project's Status field by hand before deploy.
- Older ledger steps `patched`, `patch-replan`, `rebuild` and `review-failed` stay readable for the dashboard. No stage writes them.
