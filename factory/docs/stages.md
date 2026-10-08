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
- A revision reads the issue comments under "## Committee feedback". Comments under "## Committee question" are context only.

## Implementation

Implementation runs Sonnet with up:uexecute on the task file. Subagents are off, so the agent implements every phase itself at the model triage picked. For a change a player can see, the agent captures real in-game screenshots, compares them with the issue, the plan and `game/docs/DESIGN.md`, and fixes until nothing obvious differs. The screenshots stay out of the commits. The stage fails when the agent made no new commit.

## Testing

[process.md](process.md#testing-column) shows the flow. These are the rules behind it.

- The job first merges the new commits of the issue branch on GitHub, then the current base, so the committee plays what the merge will take. A conflict with the branch goes to a merge agent at once. The testing session resolves a conflict with the base. An unfinished merge fails the stage.
- The session runs `prompts/test.md`. It plays the build, fixes every problem it finds, and writes `.factory/approval.json`, the screenshots and the optional `.factory/evidence.json`. A patch reply after the last post is the whole task of the round. A hotfix session runs `prompts/harden.md` first.
- The session writes `.factory/needs-redesign.md` only when the plan itself contradicts the issue or the game docs. The reason goes on the issue under "## Committee feedback", and the card goes to Design.
- The post checkpoint pushes the branch and runs `npm ci`, the typecheck, the playtest against the dev server and the build in a fresh clone. A hotfix also runs the full suite through `npm run test:cached -- --cache /test-cache`. A missing `.factory/approval.json` counts as a failure. The playtest prints the frame rate but does not check it, since the host runs other jobs at the same time. Only the release candidate fails under 50 fps.
- A failure goes back into the testing session as its next message, with the end of the log. Timeouts alone rerun the checks with no agent, up to 3 runs. The loop ends when the checks pass, or when the session's runs cost `FACTORY_TESTING_BUDGET_USD`, which fails the stage for Hermes.
- A passing run publishes the build at `/<hash>/` and posts it. The post holds the screenshot, the play link, the pull request link and how to try it, with Approve and Deny buttons. With no screenshot it is a text post, and the card still goes on.
- `factory move N approval` marks the card `postOnly`. A checks job then runs `npm ci` and the build only, once, with no agent. A failed build fails the stage. With no `.factory/approval.json` the post text points to the pull request. The post and the issue comment say that no factory checks ran on this build.

## Docs changes

A branch whose every changed file since its base is a Markdown file outside `game/docs/wiki/` is a docs change. `docsOnly()` in `src/stages/common.ts` decides it.

- Testing runs no session. The factory pushes the base merge and writes the approval text itself: the changed files, and to read the diff in the pull request. Its post checkpoint only builds. A conflict with the base still runs the session, since its agent resolves the conflict.
- Hardening runs no session unless the base merge conflicts.
- The merge checkpoint checks it like any card.

## Hardening

[process.md](process.md#hardening-and-merging-columns) shows the flow. These are the rules behind it.

- The job merges the new commits of the issue branch on GitHub and the current base, so the merge queue meets only the conflicts of cards that harden at the same time.
- The session runs `prompts/harden.md`, with `docs/incident-log.md` and `game/docs/architecture/principles.md` pasted in from `dev`. It runs up:uverify, then `/code-review`, and fixes every correctness finding and the cleanups that make the code shorter. No review gate follows it.
- No checks run in Hardening. The card moves to Merging.

## Merging

- A merge job runs in the branch queue when Merging holds a card that is not stuck or held. It takes every such card whose base is the base of the first one, in board order.
- It clones the base into `$FACTORY_HOME/work/merge-queue` and merges each card's branch. A conflict goes to the merge session with `prompts/merge-branches.md`. An unfinished merge fails the job.
- The merge checkpoint runs the full suite through the test cache, the typecheck, the playtest and the build on the result. A failure goes to the same session with `prompts/merge-fix.md`, which keeps the behavior the committee approved for each card. The loop ends on a pass, or when the session cost `FACTORY_MERGING_BUDGET_USD`.
- The diff guard runs on everything the base takes. Then the job pushes the base. When GitHub rejects the push because the base moved, the job merges the new base in and checks again.
- Each card gets `release-candidate`, a comment that names the cards merged with it, and moves to Done. A `dev` batch rebuilds `/dev/`. A release batch drops the current candidate post, so a new candidate follows.
- A failed job labels every card of the batch `factory-stuck`.

## Approval

- Approve on a previewed card records the approver in `approvedResolving` and moves the card to Hardening.
- Approve on a hotfix ships it at once. A hotfix that conflicts with `main` goes back to Testing.
- Deny labels the issue `wont-do` and closes it and its pull request as not planned.

## Approval replies

A rerun of design, implementation and testing costs hours, so a reply takes the smallest route that does what the member asked.

- A reply that starts with "patch:" or "redesign:" takes that route at once.
- Any other reply goes to Hermes with a header that names the post and the issue. Hermes routes it with the `factory_route_reply` tool.
- answer: Hermes answers in the chat. The card and its post stay, and the question goes on the issue under "## Committee question".
- patch: the card moves to Testing. The testing session takes the reply as its whole task, applies it, writes new approval text and screenshots, and the post checkpoint runs as usual. A session that finds the plan must change writes `.factory/needs-redesign.md`, and the card goes to Design.
- redesign: the card goes to Design.

Before a patch or a redesign queues, the plugin checks the issue as [process.md](process.md#committee-inputs) says. A refusal queues nothing and names what to get from the member.

A patch or a redesign goes on the issue under "## Committee feedback", closes the post and drops a queued approval. Every route adds a line to the ledger.

## Release

The release cut opens two cleanup issues, for optimization and code janitor work, labeled `release-task` and `maintenance`. Release tasks run the card stages against the release branch.

## Release playtest

The playtest checks that the merged features hold up together over a long run before the committee sees a candidate. It finds what the release broke, fixes it and confirms the fix in one job. It runs when no release task is open and the release head is not the commit it last passed. It runs on the tracking issue in the verify queue, counts against the daily cap and has its own time limit, `FACTORY_PLAYTEST_TIMEOUT_MINUTES`.

- The job merges `main` into the release when the release lacks it, with an agent for a conflict. So the release holds all of `main` before it plays, and a later Ship has no unplayed game change to bring in.
- The factory clones the release head and runs the full game suite with no cache, so the checks' test cache cannot hide a broken release. A failing suite fails the job before the first play, so it spends no play.
- Then it runs the game's `progression:playthrough` with one seed per release, the cut day as `YYYYMMDD`, for `FACTORY_PLAYTEST_TURNS` turns. 2250 turns are 5 in-game days, so the markov bot plays several of the other bot archetypes among the NPC traffic. The log holds every game event, snapshots of the player and every NPC, how the run ended and a summary.
- The first play also runs the seed on the baseline, side by side: the last commit this release passed, or `main` before any pass. So a replay after a pass judges only what changed since that pass.
- Every truck travels in far mode and a scripted bot drives, so physics, close driving and choices the bot never makes do not happen. The log header, the prompt and the report say so.
- The factory reads the facts from each log: its seed, turns and commit, how it ended, and which kinds of activity never happened. A log of another run fails the job.
- An Opus agent reads the whole release log and writes `.factory/playtest.json` and the report `.factory/playtest.md`: observations, suspected issues, limitations, findings with severity and evidence, and the fixes it committed. Each finding is `release`, caused by a change since the baseline, or `old`, when the baseline has it too, with the evidence for the sort.
- The agent fixes each important `release` finding in its clone with the smallest change and commits it. It never removes or disables a feature or changes unrelated behavior to silence a finding. The factory replays the seed on the new head and resumes the same agent session. A replay checks that each fix holds and broke nothing, and does not hunt again.
- An important `old` finding that no open bug issue names opens a `bug` issue for `dev`, which waits for votes like any other. It never blocks the release.
- A clean verdict passes only with no important `release` finding, no commit since the play, a run that did not end in an error, and a reason for every death and every kind of missing activity. A clean verdict that misses one blocks.
- A clean end with fixes runs the diff checks and the full checks of the merge checkpoint in the clone first. A failed check goes to the same agent, and its fix plays again. Then the factory pushes the reviewed commit to the release, so the release head is the commit the last play passed. A release that moved meanwhile gets the fixes as a merge, and its new head plays next.
- A job plays at most `FACTORY_PLAYTEST_RUNS` times, the first play included. A blocked verdict, fixes left on the last play, or a failed check on the last play blocks the release. The job fails, so the tracking card takes `factory-stuck` and Hermes sees the failure. `factory retry <tracking> [decision]` lifts the block and hands the decision to the next job's review.
- Each play keeps its logs, facts, review, report and outcome in `$FACTORY_HOME/playtest/<day>/run-<n>/`. The job comments one report on the tracking issue at its end.

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

A member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". Hermes opens an `adhoc` issue in Implementation. The job runs Sonnet in a fresh clone of `dev` with the state, the job logs, the ledger and the archived agent transcripts mounted read only. A member can ask it what agents did on an issue, where they got stuck or what cost the most. It may run any repo harness and pushes nothing. It answers the member's message with `.factory/report.md` and any files, as [evidence.md](evidence.md#ad-hoc-files) says.

## Model routing

The baseline is triage Sonnet, design Opus, implementation Sonnet and testing Sonnet. `FACTORY_DESIGN_MODEL` is the Opus id and `FACTORY_BUILD_MODEL` the Sonnet id. The issue's labels at the moment an agent starts decide its model.

- `design-sonnet` runs design on Sonnet.
- `implementation-opus` runs implementation on Opus. Testing and hardening stay on Sonnet.
- The release playtest, candidate, incident and factory change agents always run Opus. Triage, merge, ad hoc and waste review agents always run Sonnet.
- The triage prompt aims for about 20% Opus and 80% Sonnet in measured agent tokens. It is a rule of thumb, never a cap.

Triage rates each `ready` issue once and comments the rating under `Model routing from triage:`.

- `trivial` is one file or one small piece of logic, with no new state or cross-system rule. Triage adds `design-sonnet`.
- `hard` is a cross-system bug with no known cause, or a change to a save format or to shared data that many systems read. Triage adds `implementation-opus`. A change that only spans several systems is `intermediate`.
- `intermediate` or in doubt adds no label.

A label already on the issue wins, and triage never changes labels. A later triage run adds nothing once its routing comment exists. A member can add or remove a label at any time, and the next agent run reads it.

## Reference images

Before every agent stage, the host fetches the images of the issue body and every comment into `$FACTORY_HOME/media/issue-N/`. The agent sees them read only at `/work/.factory-media`, and the prompt lists their paths.

- It takes PNG, JPEG, GIF and WebP from GitHub's attachment hosts, and first-party images at `https://roam-game.online/<name>` or `/concepts/<name>`.
- It follows redirects only to GitHub's storage hosts, or from a first-party image to another one.
- Each file is at most 10 MB, and an issue has at most 12.
- An image that fails to fetch or decode is fetched once more. If it still fails, the prompt lists it as not available, and the agent works from the text and notes what it could not see. No stage fails for it. An image on another host is listed as not seen.
- The images a member sent in Telegram with a patch or redesign reply are listed too, from `$FACTORY_HOME/media/issue-N/committee/`. They stay private: the issue gets only their type, size and sha256. [process.md](process.md) says how they arrive.
