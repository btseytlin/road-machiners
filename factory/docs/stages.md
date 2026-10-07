# Stages

The rules of each step in [process.md](process.md). Each card stage comments on its issue when it finishes or fails, with the time it took. Agents write `.factory/needs-committee.md` only for a game design fork or a major save bump. A stage that ends with that file fails, so Hermes puts the question to the committee.

## Intake

Intake puts an aged `feature-request` or `bug` issue into Triage. It needs `FACTORY_MIN_VOTES` thumbs-up, or one from a committee member. An issue labeled `hotfix` by a collaborator goes straight to Design with no votes.

Intake runs last in each tick, so a card it adds starts on the next tick. It reads every open candidate issue and its thumbs-up in one GitHub search per 100 issues. GitHub sends no webhook for a new reaction, so intake polls.

## Triage

Triage runs Sonnet at `FACTORY_TRIAGE_EFFORT`. It scores the issue on a clear goal, a checkable result, a scope of one task and a fit with `game/docs/DESIGN.md`, and writes `.factory/triage.json`.

- `ready` moves the card to Design and rates its complexity, as Model routing says.
- `wont-do` comments the reason, labels the issue `wont-do`, closes it and moves the card to Done.
- `unclear` comments up to three questions, labels the issue `needs-info` and leaves the card in Triage. The committee chat gets one notice per new question set, with no quotes. The tick removes `needs-info` once someone answers on GitHub, or once `FACTORY_NEEDS_INFO_HOURS` pass since the questions, and triage runs again. Without an answer, triage and design go on with the most sensible reading, and design writes the assumptions into its comment.
- A request for a new authored location needs a reference image. Without one, triage is `unclear` and asks once for an upload.
- Triage can label a bug `hotfix` when it loses saves, crashes the game or blocks play. The committee chat gets a warning.
- Triage can label a card `release-task` when it fixes a feature of the open release. This works only while the release has no candidate post. New work waits for the next release. The release fix runs on the release branch and merges into it.

A `ready` issue may bundle other free Triage cards that touch the same code. Each bundled issue gets a comment and the label `bundled`, and its card moves to Done while the issue stays open. The state records it under `bundles`. Later stages read the bundled issues after the lead, and they close when the lead ships. A denied or refused lead sends each bundled issue back to Triage. A hotfix never bundles.

## Design

Design runs Opus, or Sonnet with `design-sonnet`, at `FACTORY_DESIGN_EFFORT`. It uses up:udesign and up:uplan in hands-off mode. It writes the task file `.factory-tasks/issue-N.md` in the work clone on branch `factory/issue-N`. Git ignores the task file, so design posts it to the issue as a comment, and later stages read it from the clone.

- `.factory/questions.md` sends the card back to Triage with the questions, as unclear triage does.
- `.factory/wont-do.md` closes the issue as wont-do.
- A revision reads the issue comments under "## Committee feedback", "## Review findings" and "## Visual review findings". Comments under "## Committee question" are context only.
- Design drops a patch queued before the card reached it.

## Implementation

Implementation runs Sonnet with up:uexecute on the task file. Subagents are off, so the agent implements every phase itself at the model triage picked. For a change a player can see, the agent captures real in-game screenshots, compares them with the issue, the plan and `game/docs/DESIGN.md`, and fixes until nothing obvious differs. The screenshots stay out of the commits. The stage fails when the agent made no new commit.

## Testing

[process.md](process.md#testing-column) shows the order of the rounds and their limits. These are the rules behind them.

- Verify first merges the new commits of the issue branch on GitHub, then the current base, so the committee plays what approve will merge. A conflict with the branch goes to a merge agent at once. The round agent resolves a conflict with the base. An unfinished merge fails the stage.
- The preview round uses `prompts/test.md`. A hotfix first runs the harden round and the review, as Hardening does.
- Checks runs `npm ci`, the tests, the typecheck and the playtest with no agent, then publishes the build at `/<hash>/`. The playtest prints the frame rate but does not check it, since the host runs other jobs at the same time. Only the release candidate fails under 50 fps. A real failure hands the end of the log to the check-fix round in `.factory/check-failure.md`.
- The post phase runs `npm ci` and the build only, once, with no tests, playtest or fix round. Hermes starts it with `factory move N approval`. A failed build fails the stage. The post and the issue comment say that no factory checks ran on this build. A card that the committee approved already queues its merge as usual.
- The post holds the screenshot, the play link, the pull request link and how to try it, with Approve and Deny buttons. With no screenshot it is a text post, and the card still goes on.

## Docs changes

A branch whose every changed file since its base is a Markdown file outside `game/docs/wiki/` is a docs change. `docsOnly()` in `src/stages/common.ts` decides it.

- Verify runs no test round. The factory pushes the base merge and writes the approval text itself: the changed files, and to read the diff in the pull request. A conflict with the base still runs the test round, since its agent resolves the conflict.
- A hotfix gets the review with no harden round and no test round.
- Hardening runs the review with no harden round.
- Checks runs `npm ci` and the build only. A failed build gets the check-fix round like a failed check.

## Hardening

[process.md](process.md#hardening-column) shows the order of the rounds. These are the rules behind them.

- Harden merges the new commits of the issue branch on GitHub, but not the base. Approve merges the base, and a conflict there comes back here.
- The harden round uses `prompts/harden.md`. A cleanup task and a docs change skip it and get the review alone.
- The review runs `/code-review` on Sonnet over the whole branch diff, with `prompts/review.md`, `docs/incident-log.md` and `game/docs/architecture/principles.md` pasted in. The factory reads the findings from the last `ReportFindings` call in the run's output. Any finding of category `correctness`, or with no category, fails the review. Other findings are listed and do not block. A run with no `ReportFindings` call fails the stage.
- A review FAIL hands the review to the review-fix round in `.factory/review-findings.md`. A second FAIL comments it on the issue under "## Review findings", drops the approval and sends the card to Design.
- After the review, the branch head is compared with the card's build, the commit Testing checked and the committee played. The same commit moves the card to Approval with its merge queued. Any other commit runs Checks, whose fix round runs in Hardening and leaves no evidence.
- A conflict at approve merges the base, and a merge agent resolves the conflict with `prompts/branch-merge.md`. Checks runs next, with no harden round or review.

## Approval

- Approve on a previewed card records the approver in `approvedResolving` and moves the card to Hardening. The card keeps its build.
- The merge takes the branch into `dev` and rebuilds `/dev/`.
- Deny labels the issue `wont-do` and closes it and its pull request as not planned.

## Approval replies

A rerun of design, implementation and testing costs hours, so a reply takes the smallest route that does what the member asked.

- A reply that starts with "patch:" or "redesign:" takes that route at once.
- Any other reply goes to Hermes with a header that names the post and the issue. Hermes routes it with the `factory_route_reply` tool.
- answer: Hermes answers in the chat. The card and its post stay, and the question goes on the issue under "## Committee question".
- patch: the card moves to Implementation, and `patching` keeps the commit of the played build. The patch job runs Sonnet with `prompts/patch.md`. It merges the base, applies the reply, checks only the diff since the played build and writes new approval text and evidence. Then the card goes to Testing in phase `checks`. An agent that finds the plan must change writes `.factory/needs-redesign.md`, and the card goes to Design.
- redesign: the card goes to Design.

Before a patch or a redesign queues, the plugin checks the issue as [process.md](process.md#committee-inputs) says. A refusal queues nothing and names what to get from the member.

A patch or a redesign goes on the issue under "## Committee feedback", closes the post and drops a queued approval. Every route adds a line to the ledger.

## Release

The release cut opens two cleanup issues, for optimization and code janitor work, labeled `release-task` and `maintenance`. Release tasks run the card stages against the release branch.

## Release playtest

The playtest checks that the merged features hold up together over a long run before the committee sees a candidate. It runs when no release task is open and the release head is not the commit it last passed. It runs on the tracking issue in the verify queue and counts against the daily cap.

- The factory clones the release head and runs the game's `progression:playthrough` with one seed per release, the cut day as `YYYYMMDD`, for `FACTORY_PLAYTEST_TURNS` turns. 2250 turns are 5 in-game days, so the mixed bot plays its trader, scavenger and fighter days among the NPC traffic. The log holds every game event, snapshots of the player and every NPC, how the run ended and a summary.
- Every truck travels in far mode and a scripted bot drives, so physics, close driving and choices the bot never makes do not happen. The log header, the prompt and the report say so.
- The factory reads the facts from the log: its seed, turns and commit, how it ended, and which kinds of activity never happened. A log of another run fails the job.
- An Opus agent reads the whole log and writes `.factory/playtest.json` and the report `.factory/playtest.md`: observations, suspected issues, limitations, findings with severity and evidence, and a fix plan with priorities.
- A clean verdict passes only with no important finding, a run that did not end in an error, and a reason for every death and every kind of missing activity. A clean verdict that misses one blocks.
- A fix verdict opens one `release-task` and `maintenance` issue with the findings and the plan. It asks for the smallest fixes, and it forbids removing or disabling a feature or changing unrelated behavior. The task runs the card stages and merges into the release like a cleanup task. The playtest then replays the same seed on the new head.
- A blocked verdict, or findings on the last of `FACTORY_PLAYTEST_RUNS` runs since the last pass, blocks the release. A pass gives the budget back, so a committee change later plays with a full one. The job fails, so the tracking card takes `factory-stuck` and Hermes sees the failure. `factory retry <tracking> [decision]` lifts the block, gives the runs back and hands the decision to the next review.
- Each run keeps its log, facts, review, report and outcome in `$FACTORY_HOME/playtest/<day>/run-<n>/`, and comments the report on the tracking issue.

## Candidate

When no release task is open and the playtest passed the release head, the candidate job builds that commit at `/rc/`. The release agent writes the changelog, one line `- [#N] what changed` per change, and the job fails when the lines do not name the release's changes exactly. The post has a screenshot, the play link, the pull request, the count of changes and a Ship button. The changelog follows in a message under it, since a caption holds only 1024 characters. Any reply other than `ship` or `remove #N` opens a new `release-task` issue with the reply as its body.

The post records the commit it was built from. The candidate does not post when the release moved during its build. Each tick compares the release head with that commit and drops the post and a queued Ship once the release moved, by any path.

## Ship

Ship runs on the current candidate post only, with no release task open and the release still at the commit of the post. It checks the changelog again before it merges, as [process.md](process.md#branches) shows. A change to `game/` on `main` that the release lacks was never played. Ship merges `main` into the release, with an agent for a conflict, and stops. The release moved, so the tick drops the post and builds a new candidate. The factory builds a fresh clone of `main` with an empty save scope and runs `butler push` on the host, the only step that gets `BUTLER_API_KEY`. A GitHub release tagged `release-<day>` gets the changelog. The public post waits in `releasePost` with the changelog and the screenshot. Hermes drafts it with `factory_release_draft`, the draft goes to the committee chat with a Publish button, and a member's Publish posts it to the public channel. A reply to the draft goes to Hermes, who sends a new one. Each shipped issue loses `release-candidate` and closes.

## Hotfix

A hotfix fixes a bug in the shipped game. Its jobs run before other cards and at the daily cap. Its branch starts from `main`, and testing merges `main` into it. The post opens with a hotfix warning, and its button reads "Approve and ship to players". Approve merges and ships it like a release. The public channel and a GitHub release tagged `hotfix-<day>-issue-<N>` get a one-line changelog. The open release gets a new candidate.

## Incident

Ship and the hotfix ship queue an incident job for each shipped fix of a `bug` issue and each hotfix, in `pendingIncidents`. The job runs the design model in a clone of `dev`. It reads the issue as untrusted text and the fix commit, and judges the bug against the bar in `docs/incident-log.md`. A bug that meets the bar gets an entry, which the factory merges into `dev`. The job comments the outcome on the issue. A missing or malformed `.factory/incident.json` fails the job.

## Factory change

A committee message starting with `/change` or Hermes's `factory_queue_change` tool queues a factory change. The job runs the design model in a clone of `main` with the cwd in `factory/`. The agent runs up:make in hands-off mode on the task file `.factory-tasks/change-<id>.md`, through design, plan, execute, verify and review. It writes the pull request title and body from `prompts/change-pr.md`. The change may touch any file in the repo, like the quality gate at the root or game text. The factory pushes `factory-change/<id>` and opens a pull request against `main`. It never merges it. Once a member merges it, the server deploys it.

## Ad hoc

A member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". Hermes opens an `adhoc` issue in Implementation. The job runs Sonnet in a fresh clone of `dev` with the state and logs mounted read only. It may run any repo harness and pushes nothing. It answers the member's message with `.factory/report.md` and any files, as [evidence.md](evidence.md#ad-hoc-files) says.

## Model routing

The baseline is triage Sonnet, design Opus, implementation Sonnet and testing Sonnet. `FACTORY_DESIGN_MODEL` is the Opus id and `FACTORY_BUILD_MODEL` the Sonnet id. The issue's labels at the moment an agent starts decide its model.

- `design-sonnet` runs design on Sonnet.
- `implementation-opus` runs implementation on Opus. Every testing round and the review stay on Sonnet.
- The release playtest, candidate, incident and factory change agents always run Opus. Triage, patch, ad hoc and waste review agents always run Sonnet.
- The triage prompt aims for about 20% Opus and 80% Sonnet in measured agent tokens. It is a rule of thumb, never a cap.

Triage rates each `ready` issue once and comments the rating under `Model routing from triage:`.

- `trivial` is one file or one small piece of logic, with no new state or cross-system rule. Triage adds `design-sonnet`.
- `hard` is three or more interacting systems, a change to shared state or a data format, a cross-system bug with no known cause, or real tradeoffs. Triage adds `implementation-opus`.
- `intermediate` or in doubt adds no label.

A label already on the issue wins, and triage never changes labels. A later triage run adds nothing once its routing comment exists. A member can add or remove a label at any time, and the next agent run reads it.

## Reference images

Before every agent stage, the host fetches the images of the issue body and every comment into `$FACTORY_HOME/media/issue-N/`. The agent sees them read only at `/work/.factory-media`, and the prompt lists their paths.

- It takes PNG, JPEG, GIF and WebP from GitHub's attachment hosts, and first-party images at `https://roam-game.online/<name>` or `/concepts/<name>`.
- It follows redirects only to GitHub's storage hosts, or from a first-party image to another one.
- Each file is at most 10 MB, and an issue has at most 12.
- An image that fails to fetch or decode is fetched once more. If it still fails, the prompt lists it as not available, and the agent works from the text and notes what it could not see. No stage fails for it. An image on another host is listed as not seen.
- The images a member sent in Telegram with a patch or redesign reply are listed too, from `$FACTORY_HOME/media/issue-N/committee/`. They stay private: the issue gets only their type, size and sha256. [process.md](process.md) says how they arrive.
