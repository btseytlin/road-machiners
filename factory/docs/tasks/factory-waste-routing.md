# Cheap rework, a free test slot and a weekly waste review

**Status:** validating
**Branch:** factory/waste-routing
**Worktree:** .worktrees/waste-routing
**Goal:** A small approval reply reaches the committee again in under 30 minutes, on Sonnet, with every machine check passed. The test slot runs no agent, so a card waits for it at most one machine check run. Once a week the committee gets one named bottleneck with its numbers and one proposed factory change it can queue with a button. Confirming it needs a live week on the server: one answered reply, one patch, one redesign and one weekly review post.
**Mode:** interactive

## Context

The numbers come from the server logs of 2026-09-29 to 2026-10-03.

- Any reply to an approval post except "approve" is feedback. The plugin regex in `hermes/plugin/__init__.py` `_request` decides this, and the Hermes LLM never sees the reply. `feedback()` in `src/stages/approval.ts` moves the card to Design.
- On #131 a reply asked for an atlas the build already had, plus a tentative view preference. It ran design, implementation and testing again. Implementation and testing ran on Opus, since the `implementation-opus` label from triage stays on the issue.
- 73 cards waited 58 hours in total between the end of implementation and the start of testing. The median wait was 19 min, p75 86 min, and #131 waited the longest at 193 min.
- The machine checks are short. The medians are 2.6 min for tests and typecheck, 1.5 min for playtest and 0.1 min for build.
- The testing job holds its slot during agent work. #131's first run held it 87 min: agent 17 min, tests failed, fix agent 47 min on Opus, checks 13 min. 11 of 88 check runs failed.
- Testing now also runs an Opus `/code-review` gate with up to one fix round and a second review, all inside the test slot (`src/stages/review.ts`).
- The server has 4 CPUs. Two test workers timed out the game tests, so `main` went back to one in `31d16a2a`. Agents mostly wait on the model, while the checks load the CPU.
- 23 issues ran testing two or more times. The logs keep no record of why a stage ran again.
- Agent cost and run time sit only in the `result` event at the end of each agent's stream-json output. Queue wait and the reason for a rerun are recorded nowhere.
- The Hermes gateway lets a `pre_gateway_dispatch` hook return `{"action": "rewrite", "text": ...}`, which replaces the text the LLM sees.

## Design

Three parts. Hermes routes every approval reply. The test slot runs only machine checks. A ledger feeds a weekly waste review.

### Reply routing

- The words "approve" and "deny" stay fixed commands. A reply that starts with "patch:" or "redesign:" picks its route itself and skips Hermes.
- Every other reply to an approval post goes to the Hermes LLM. The hook rewrites its text with a header that names the issue and the post, and queues a `reply` command so the factory knows a route is due.
- Hermes calls one new tool, `factory_route_reply`, with the post id, the route and the text. There are three routes.
- answer: no card moves, and the post keeps its buttons. Hermes replies in the chat. It may link files from the posted build, which the build URL already serves.
- patch: the change keeps the plan. Examples are a constant, a copy fix, a look tweak or a missing view in the evidence.
- redesign: the plan changes. This is the current path to Design.
- When a reply holds both a question and a change, Hermes answers the question and asks whether to patch. It does not route a tentative wish like "most likely we want".
- Every route lands on the issue as a comment under the feedback heading with the route, the member and the reply. The post status line names the route.
- A reply with no route after `FACTORY_REPLY_ROUTE_MINUTES` becomes a failure, so Hermes's incident watch sees it.
- After a patch or redesign, the post is closed. A member who wants the other route tells Hermes, who moves the card with its shell as it does for other incidents.

### Patch

- `patch` is a new card stage in the implement queue. Its card sits in Implementation, and `state.patching` marks it.
- One agent run on the build model does all of it. It merges the base, applies the feedback, checks only the diff since the last posted build, updates the task file Conclusion, and writes the approval text and evidence for the changed views.
- The model of a patch ignores `implementation-opus`. That label judged the first build of the whole issue.
- A patch skips the Opus code review. The branch passed it before, and the machine checks still run.
- A patch that finds the plan must change writes `.factory/needs-redesign.md` and stops. The card then goes to Design with that file as feedback. The patch agent never redesigns by itself.
- A patch ends with the card in Testing, ready for checks.

### Checks own the test slot

- Testing splits in two stages. `verify` runs in a new verify queue: base merge, conflict resolution, the test agent, the code review gate and evidence. `checks` runs in the test queue: tests, typecheck, playtest, build, publish and the post.
- `state.testPhase` holds where a Testing card stands. No entry means verify. `checks` and `checks-after-fix` mean checks. `fix` means verify runs only the fix round for a failed check.
- A failed check moves the phase from `checks` to `fix`, so the fix agent runs in the verify queue and frees the test slot. A failure in `checks-after-fix` stops the card, as the second failure does today.
- The board keeps its columns. Verify and checks both show as Testing.
- `FACTORY_VERIFY_WORKERS` starts at 1, so at most one checks run and one verify agent share the CPU.

### Ledger

- Every job adds one line to `$FACTORY_HOME/ledger.jsonl` when it ends: job id, stage, issue, model, started at, ended at, outcome, and agent cost and minutes.
- Each agent run appends its model, cost and minutes from its `result` event to `$FACTORY_HOME/usage/<job id>.jsonl`. The job's ledger line sums them and the file goes.
- A route adds a ledger line too, with the route and no job.
- A job that dies or times out gets its line from the tick, with outcome `died` or `timeout`.
- The review script computes queue wait and reruns from these lines. The ledger holds no derived numbers.

### Weekly waste review

- Every `FACTORY_WASTE_REVIEW_DAYS`, the tick starts a `waste` job in the triage queue. It does not count toward the daily cap.
- `wasteNumbers()` reads the ledger lines of the period. It returns the queue wait per queue, the cost and minutes per stage and model, the reruns per issue, the routes, and the five most expensive issues. Every number in the post comes from it.
- A Sonnet agent in a fresh clone of `main` reads those numbers, the issue histories of the top five, the earlier review issues and the factory code. It names one bottleneck and writes one factory change as a brief.
- The job opens an issue labeled `factory-review` with the numbers and the brief. The committee chat gets a post with the bottleneck, the issue link and a "Queue as change" button.
- The button queues the brief as a `/change` request, so a member still merges the pull request.
- When nothing stands out, the post says so in one line and has no button.

### Approaches considered

- Chosen: Hermes routes, since it already reads the chat, the issue and the state.
- A size label from triage on the whole issue was rejected. #131 shows that the reply decides the size, not the issue.
- Skipping the machine checks for patches was rejected. They are short, and a patch with broken tests must not reach the committee.
- More test workers alone were rejected. Two already timed out the tests on 4 CPUs, and the wait comes from agents holding the slot.

TDD: yes for the plugin routing, the stage flow, the ledger line and the review numbers. No for the prompts and Hermes's judgment, which the live week checks.

### Invariants

- IV1 — Every build posted for approval passed the full machine checks on its final commit.
- IV2 — A test queue job runs no agent.
- IV3 — A reply starting with "patch:" or "redesign:" takes that route without Hermes.
- IV4 — Every route lands on the issue as a comment with the route and the reply text.
- IV5 — Every job that ends, fails, dies or times out writes exactly one ledger line.
- IV6 — Every number in the review post comes from `wasteNumbers()`, never from the agent.
- IV7 — The review never changes the factory itself. Only a member's merge of a `/change` pull request does.
- IV8 — A reply queued for routing either gets a route or becomes a failure.

### Assumptions

- AS1 — Hermes's model can tell a question from a small change from a new plan in a one-line reply. The live week checks it, and IV3 and Hermes's shell bound a miss.
- AS2 — A verify agent beside one checks run does not time out the game tests. The first live days check it, and `FACTORY_VERIFY_WORKERS` or the check timeout is the lever.
- AS3 — The last stream-json line of each agent run is a `result` event with `total_cost_usd`, `duration_ms` and `modelUsage`, as in the transcripts on the server today.

### Unknowns

- UK1 — Whether a patch needs its own time limit below `FACTORY_STAGE_TIMEOUT_MINUTES`. Left to the live week.
- UK2 — Whether the review should also cover release candidate replies, which already route by fixed words. Left to the first review.

## Plan

Approach: four phases on shared files, run in order by one implementer. The ledger comes first so every later stage records itself. The split of testing comes before the patch stage, since a patch ends in the checks phase.

### PH1 — Ledger
- 1.1 `src/ledger.ts` (create)
  - `type LedgerLine = { kind: 'job'; id: string; stage: JobStage; issue: number | null; startedAt: string; endedAt: string; outcome: 'done' | 'failed' | 'died' | 'timeout'; agents: AgentUsage[] } | { kind: 'route'; issue: number; route: Route; by: string; at: string }`
  - `type AgentUsage = { model: string; costUsd: number; minutes: number }`
  - `usageFromOutput(stdout: string) -> AgentUsage` reads the last `result` line. A run that exited 0 with no result line throws, since AS3 failing must be loud. A failed run with no result line records nothing.
  - `appendUsage(home, jobId, usage)`, `takeUsage(home, jobId) -> AgentUsage[]` (reads and deletes the file), `appendLedger(home, line)`, `readLedger(home, since: Date) -> LedgerLine[]`.
  - Appends run under a lock next to the ledger.
- 1.2 `src/container.ts:93-109` (modify): `agent()` parses usage from `result.stdout` before `must()` and appends it under its job id. Runs without a job id, like a hand run, record nothing.
- 1.3 `src/job.ts:49-64` (modify): `runJob` writes the job line in `finally`, with outcome `done` or `failed` and `takeUsage()`.
- 1.4 `src/tick.ts:161-199` (modify): `failJob` writes `timeout` or `died`, and `resumeJob` writes `died`, each with `takeUsage()`.
- Tests: `src/ledger.test.ts` for parsing, sums and the missing result line. `job.test.ts` and `tick.test.ts` check one line per end path (IV5).
- Respects: IV5, AS3
- Commit: "Record every factory job in a ledger with its agent cost and minutes"

### PH2 — Split testing into verify and checks
- 2.1 `src/types.ts:5-81` (modify): `CardStage` swaps `testing` for `verify` and adds `patch`. `JobStage` adds `checks`, `waste`. `Queue` adds `verify`. `QUEUE_OF`: `verify: 'verify'`, `checks: 'test'`, `patch: 'implement'`, `waste: 'triage'`. `AGENT_QUEUES` adds `verify`. `FactoryConfig` adds `verifyWorkers`. `FactoryState` adds `testPhase: Record<string, TestPhase>` with `type TestPhase = 'checks' | 'fix' | 'checks-after-fix'`.
- 2.2 `src/stages/verify.ts` (create from `testing.ts:49-131`): `runStage(ctx, issue)`. Phase `fix` runs only the checks-fix round, with the check failure read from the checks log. Otherwise base merge, test round, `requireBaseMerged`, `reviewGate`. Ends by setting the phase to `checks` or `checks-after-fix`.
- 2.3 `src/stages/checks.ts` (create from `testing.ts:12-45,132-235`): `runStage(ctx, issue)` reads the approval and evidence from the work clone without resetting it, runs `CHECK_SCRIPT`, then publishes, posts or queues the merge, clears the phase and moves the card to Approval. A failure in `checks` sets `fix`. A failure in `checks-after-fix` throws. `post`, `approvalCaption`, `approvalButtons`, `cut`, `CAPTION_LIMIT` move here.
- 2.4 `src/stages/testing.ts` (delete). Importers switch: `post-status.ts`, `candidate.ts` and tests.
- 2.5 `src/tick.ts:22,50-53` (modify): a Testing card maps to `checks` when its phase is `checks` or `checks-after-fix`, else `verify`. `limits()` adds `verify`.
- 2.6 `src/stages/approval.ts:14-25` (modify): `forgetPosts` also drops the issue's `testPhase`.
- 2.7 `src/stages/common.ts:85-89`, `src/stages/review.ts:30` (modify): stage name `verify` for the model and the review round.
- 2.8 `src/job.ts:22-29`, `src/cli.ts:12`, `src/state.ts:6`, `src/config.ts:43-51`, `settings.env:27-30` (modify): handlers, stage names, empty state, `FACTORY_VERIFY_WORKERS=1`.
- 2.9 `src/fail.ts` and `src/sessions.ts` (modify where they name `testing`).
- Tests: `testing.test.ts` splits into `verify.test.ts` and `checks.test.ts`. They cover the phase moves, the second failure and that checks never calls `container.agent` (IV2). `tick.test.ts` covers the Testing pick by phase.
- Respects: IV1, IV2, AS2
- Commit: "Run testing agents in a verify queue and keep the test slot for machine checks"

### PH3 — Reply routing and patch
- 3.1 `hermes/plugin/__init__.py:120-158,332-360` (modify): `_request` returns `approve`, `deny`, `patch`/`redesign` for the prefixes, or `reply` for any other approval reply. For `reply`, the hook writes a `reply` inbox command and returns `{"action": "rewrite", "text": <header + text>}`. A new tool `factory_route_reply(post, route, text)` writes a `route` inbox command with the session's message id.
- 3.2 `src/inbox.ts:10-22,89-102` (modify): kinds `reply` and `route`. `reply` records `state.unroutedReplies[messageId] = { issue, postId, at }`. `route` drops that entry, writes the route ledger line and calls `answerReply`, `patchReply` or `redesignReply`. `patch` and `redesign` prefixes call the same functions directly.
- 3.3 `src/stages/approval.ts:80-88` (modify): `feedback()` becomes `routeFeedback(ctx, issue, by, text, route)`. Answer comments on the issue and changes nothing else. Patch comments, moves the card to Implementation, adds `state.patching` and forgets the posts. Redesign is today's path with the route in the comment.
- 3.4 `src/post-status.ts:9-16` (modify): status lines for patch and redesign. Answer and reply edit no post.
- 3.5 `src/stages/patch.ts` (create): `runStage(ctx, issue)`. Prepares the clone, runs `prompts/patch.md` on the build model, handles `needs-redesign.md`, guards and pushes, sets the phase to `checks`, drops `patching` and moves the card to Testing.
- 3.6 `prompts/patch.md` (create).
- 3.7 `src/tick.ts:58-68` (modify): an Implementation card in `patching` maps to `patch`. Before picks, unrouted replies older than `FACTORY_REPLY_ROUTE_MINUTES` become failures and leave the state (IV8).
- 3.8 `src/stages/common.ts:85-89` (modify): `modelFor('patch')` returns the build model.
- 3.9 `hermes/SOUL.md` (modify): the routing rules and examples, including #131.
- Tests: `hermes/plugin/test_route.py` for prefixes, the rewrite and the tool. `inbox.test.ts`, `approval.test.ts`, `patch.test.ts`, `tick.test.ts` for the routes, the patch flow, needs-redesign and the stale reply.
- Respects: IV3, IV4, IV8, AS1
- Commit: "Let Hermes route approval replies to an answer, a patch or a redesign"

### PH4 — Weekly waste review
- 4.1 `src/waste.ts` (create): `wasteNumbers(lines: LedgerLine[], from: Date, to: Date) -> WasteNumbers` and `formatNumbers(n) -> string`. Queue wait is the gap between a card job's start and the end of the issue's previous job.
- 4.2 `src/stages/waste.ts` (create): `runStage(ctx)` takes a fresh clone of `main`, writes the numbers to `.factory/numbers.md`, runs `prompts/waste.md` with the ledger and logs read only, reads `.factory/brief.md`, opens the `factory-review` issue and posts with the button `factory:waste:<issue>`. It records `lastWasteReview`.
- 4.3 `prompts/waste.md` (create).
- 4.4 `src/tick.ts:80-94` (modify): `wasteJob` when due, in the triage queue, uncapped.
- 4.5 `hermes/plugin/__init__.py:28-33` (modify): the button pattern adds `waste`. `src/inbox.ts` adds kind `waste-change`, which queues a change with the review issue's brief.
- 4.6 `src/types.ts`, `src/state.ts`, `src/config.ts`, `settings.env`, `src/cli.ts`, `src/job.ts` (modify): `lastWasteReview`, `FACTORY_WASTE_REVIEW_DAYS=7`, the `waste` handler.
- Tests: `waste.test.ts` for the numbers from a fixed ledger, `stages/waste.test.ts` for the issue, post and button, `tick.test.ts` for the due check.
- Respects: IV6, IV7
- Commit: "Review factory waste weekly and offer the fix as a change"

### PH5 — Docs
- `README.md` flow steps 5 and 6, the queues and a ledger section. `CLAUDE.md` layout line for the ledger. `hermes/SOUL.md` stages. `settings.env` comments.
- Commit: "Document reply routing, the verify queue and the waste review"

### Test strategy
- Unit tests per phase as listed, failing first for the ledger, the phase moves, the routes and the numbers.
- `npm test`, `npm run typecheck` and `uv run --with pytest pytest hermes` after each phase, plus `npm run quality` at the root.
- The live week confirms AS1, AS2 and the Goal. That needs a merge into `main` by the user.

### Risks / rollback
- RK1 — A verify agent beside a checks run times out the tests (AS2). The levers are the check timeout and starting no verify job while a checks job runs. Each phase is its own commit, so a revert is by commit.
- RK2 — State from before the deploy has Testing cards with no phase. No phase means verify, so they rerun verify once. That costs one agent round per card in Testing at deploy time.
- RK3 — A `testing` job recorded by the old code is still in `state.jobs` after the deploy. `readState` maps a saved job stage `testing` to `verify`, so the tick checks and resumes it under the new name.

### Interfaces
- IF1 — `appendLedger`, `takeUsage`, `LedgerLine` in `src/ledger.ts`.
- IF2 — `state.testPhase` and `TestPhase` in `src/types.ts`.
- IF3 — inbox kinds `reply`, `route`, `patch`, `redesign`, `waste-change` and the `factory_route_reply` tool arguments.

## Verify

Result: passed

Happy-path:
- CK1 (AS3) — the ledger misreads a real agent transcript — held: `usageFromOutput` on a real `result` line from the server gave cost $3.20. The design, implement and testing logs of #131 and #128 each end with a `result` line.
- CK2 — the other Hermes `pre_gateway_dispatch` hook swallows the rewrite — held: `hermes-session-reset-policy` returns None on every path, and the gateway skips non-dict results.

Negative:
- CK3 — a patch for a card with no recorded build leaves a half route behind — broke, fixed: it commented "routed as patch" and wrote a ledger line before it threw. `routeFeedback` now checks the build first. Test: `approval.test.ts` "refuses a patch ... before it comments".
- CK4 (IV8) — a reply still waiting for Hermes outlives its post — broke, fixed: Approve or Deny left it in `unroutedReplies`, so 15 min later it became a false failure. `forgetPosts` now drops it. Test: "drops a reply still waiting for Hermes once the card leaves Approval".
- CK5 — the waste review agent cannot read issue histories — broke, fixed: the prompt told it to run `gh`, and agent containers get no GitHub login. The job now writes `.factory/issues/issue-N.md` for the five most expensive issues and `.factory/earlier-reviews.md` from `$FACTORY_HOME/waste-reviews.md`.

Invariants / assumptions:
- CK6 (IV2) — a checks job starts an agent — held: test "runs no agent in a checks job".
- CK7 (IV1) — a patch reaches the committee without the machine checks — held: the patch ends in phase `checks`, and only checks posts.
- CK8 (IV5) — a job end path skips its ledger line — held: tests cover done, failed, timeout and died.

Interfaces:
- CK9 (IF3) — the plugin's commands and the factory's inbox disagree — held: see Smoke.

Smoke: the real plugin hook and route tool wrote inbox files for a plain reply and a patch route, then the real `drainInbox` ran on them. It produced the issue comment, the move to Implementation, the post status line, `patching: {12: abc1234}`, an empty `unroutedReplies` and a route ledger line. The next `chooseJobs` picked `patch` for #12.
Goal: proxy only. The live week on the server still has to show one answered reply, one patch under 30 minutes, one redesign and one weekly review post, and that a verify agent beside a checks run does not time out the game tests (AS2).
Notes: a `testing` job still running old code at deploy time ends with its entry renamed to `verify` by the new `readState`. The tick then records it as died and marks the issue resumed once. The card has left Testing by then, and a later verify finds no stored session, so it starts fresh.

## Conclusion

Outcome: built, verified and reviewed on `factory/waste-routing`. The Goal still needs the live week on the server after a merge into `main`.

Invariants:
- IV1 — a patch ends in phase `checks`, and only checks posts (`testing-flow.test.ts` patch tests).
- IV2 — "runs no agent in a checks job".
- IV3 — `test_route_prefix_picks_the_route_itself`.
- IV4 — `approval.test.ts` routeFeedback tests check the comment per route.
- IV5 — ledger tests for done, failed, timeout and died.
- IV6 — `formatNumbers` writes the numbers, and the prompt forbids the agent's own.
- IV7 — the review only opens an issue and posts a button. A member's merge of the `/change` pull request is the only path to a factory change.
- IV8 — the stale reply test in `tick.test.ts`, and `forgetPosts` drops replies of a closed post.

### Assumptions check
- AS1 — unverifiable until the live week. A member's prefix and Hermes's shell bound a wrong route.
- AS2 — unverifiable until the live week. `FACTORY_VERIFY_WORKERS=1` keeps at most one verify agent beside one checks run.
- AS3 — held: real transcripts on the server end with a `result` line, and the parser read one.

### Unknowns outcome
- UK1 — still-open: a patch runs under `FACTORY_IMPLEMENT_TIMEOUT_MINUTES`, the limit of its queue, until the live week shows its length.
- UK2 — still-open: release candidate replies still route by fixed words.

Plan adherence: `testing.test.ts` became one `testing-flow.test.ts` that runs verify and checks the way the tick does, not two files. The inbox kind `feedback` is gone, since the plugin no longer writes it. The waste review hands the agent issue histories and earlier reviews as files, since agents have no GitHub login.

Review findings:
- Important: a stale `patching` entry could turn a redesigned card's Implementation into a patch. Fixed: design drops it on entry.
- Important: answer comments sat under the feedback heading, so a later design would treat a question as a requirement. Fixed: answers go under "## Committee question", and the design prompt says applied patches stay.

Verified by: the plugin-to-inbox smoke in Verify, and a parse of a real agent `result` line from the server.

## Code smells

- `factory/README.md` Tests section — `uv run --with pytest pytest hermes` fails to collect `test_config_sync.py` without `--with pyyaml`.
