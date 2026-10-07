# Stages

The rules of each step in [process.md](process.md). Each card stage comments on its issue when it finishes or fails, with the time it took. Every agent stage that ends with an `.factory/needs-committee.md` fails, so Hermes asks the committee.

## Intake

Intake puts an aged `feature-request` or `bug` issue into Triage. It needs `FACTORY_MIN_VOTES` thumbs-up, or one from a committee member. An issue labeled `hotfix` by a collaborator goes straight to Design with no votes.

## Triage

Triage runs Sonnet at `FACTORY_TRIAGE_EFFORT`. It scores the issue on a clear goal, a checkable result, a scope of one task and a fit with `game/docs/DESIGN.md`, and writes `.factory/triage.json`.

- `ready` moves the card to Design and rates its complexity, as Model routing says.
- `wont-do` comments the reason, labels the issue `wont-do`, closes it and moves the card to Done.
- `unclear` comments up to three questions, labels the issue `needs-info` and leaves the card in Triage. The committee chat gets one notice per new question set, with no quotes. The tick removes `needs-info` once someone answers on GitHub, and triage runs again.
- A request for a new authored location needs a reference image. Without one, triage is `unclear` and asks once for an upload.
- Triage can label a bug `hotfix` when it loses saves, crashes the game or blocks play. The committee chat gets a warning.

A `ready` issue may bundle other free Triage cards that touch the same code. Each bundled issue gets a comment and the label `bundled`, and its card moves to Done while the issue stays open. The state records it under `bundles`. Later stages read the bundled issues after the lead, and they close when the lead ships. A denied or refused lead sends each bundled issue back to Triage. A hotfix never bundles.

## Design

Design runs Opus, or Sonnet with `design-sonnet`, at `FACTORY_DESIGN_EFFORT`. It uses up:udesign and up:uplan in hands-off mode. It writes the task file `.factory-tasks/issue-N.md` in the work clone on branch `factory/issue-N`. Git ignores the task file, so design posts it to the issue as a comment, and later stages read it from the clone.

- `.factory/questions.md` sends the card back to Triage with the questions, as unclear triage does.
- `.factory/wont-do.md` closes the issue as wont-do.
- A revision reads the issue comments under "## Committee feedback", "## Review findings" and "## Visual review findings". Comments under "## Committee question" are context only.
- Design drops a patch queued before the card reached it.

## Implementation

Implementation runs Sonnet with up:uexecute on the task file. For a change a player can see, the agent captures real in-game screenshots, compares them with the issue, the plan and `game/docs/DESIGN.md`, and fixes until nothing obvious differs. The screenshots stay out of the commits. The stage fails when the agent made no new commit.

## Testing

[process.md](process.md#testing-column) shows the order of the rounds and their limits. These are the rules behind them.

- Verify first merges the current base into the issue branch, so the committee plays what approve will merge. The agent resolves any conflict, and an unfinished merge fails the stage.
- The preview round uses `prompts/test.md`, and the harden round uses `prompts/harden.md`. A cleanup task only hardens, since it merges with no post.
- The review runs `/code-review` on Sonnet over the whole branch diff, with `prompts/review.md`, `docs/incident-log.md` and `game/docs/architecture/principles.md` pasted in. It must end `.factory/review.md` with `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`, or the stage fails.
- A review FAIL hands the review to the review-fix round in `.factory/review-findings.md`. A second FAIL comments it on the issue under "## Review findings".
- Checks runs `npm ci`, the tests, the typecheck and the playtest with no agent, then publishes the build at `/<hash>/`. A real failure hands the end of the log to the check-fix round in `.factory/check-failure.md`.
- The post holds the screenshot, the play link, the pull request link and how to try it, with Approve and Deny buttons. With no screenshot it is a text post, and the card still goes on.

## Approval

- Approve on a previewed card records the approver in `approvedResolving` and sends the card back to Testing to harden.
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

When no release task is open, the candidate job builds the release at `/rc/`. The release agent writes the changelog, one line `- [#N] what changed` per change, and the job fails when the lines do not name the release's changes exactly. The post has a screenshot, the play link, the pull request, the count of changes and a Ship button. The changelog follows in a message under it, since a caption holds only 1024 characters. Any reply other than `ship` or `remove #N` opens a new `release-task` issue with the reply as its body.

## Ship

Ship runs on the current candidate post only, with no release task open. It checks the changelog again before it merges, as [process.md](process.md#branches) shows. A change to `game/` on `main` that the release lacks fails Ship, since the committee did not play it. The factory builds a fresh clone of `main` with an empty save scope and runs `butler push` on the host, the only step that gets `BUTLER_API_KEY`. The public channel and a GitHub release tagged `release-<day>` get the changelog. Each shipped issue loses `release-candidate` and closes.

## Hotfix

A hotfix fixes a bug in the shipped game. Its jobs run before other cards and at the daily cap. Its branch starts from `main`, and testing merges `main` into it. The post opens with a hotfix warning, and its button reads "Approve and ship to players". Approve merges and ships it like a release. The public channel and a GitHub release tagged `hotfix-<day>-issue-<N>` get a one-line changelog. The open release gets a new candidate.

## Incident

Ship and the hotfix ship queue an incident job for each shipped fix of a `bug` issue and each hotfix, in `pendingIncidents`. The job runs the design model in a clone of `dev`. It reads the issue as untrusted text and the fix commit, and judges the bug against the bar in `docs/incident-log.md`. A bug that meets the bar gets an entry, which the factory merges into `dev`. The job comments the outcome on the issue. A missing or malformed `.factory/incident.json` fails the job.

## Factory change

A committee message starting with `/change`, Hermes's `factory_queue_change` tool or the waste review's button queues a factory change. The job runs the design model in a clone of `main` with the cwd in `factory/`. The agent runs up:make in hands-off mode on the task file `.factory-tasks/change-<id>.md`, through design, plan, execute, verify and review. It writes the pull request title and body from `prompts/change-pr.md`. The change may touch any file in the repo, like the quality gate at the root or game text. The factory pushes `factory-change/<id>` and opens a pull request against `main`. It never merges it. Once a member merges it, the server deploys it.

## Ad hoc

A member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". Hermes opens an `adhoc` issue in Implementation. The job runs Sonnet in a fresh clone of `dev` with the state, the job logs, the ledger and the archived agent transcripts mounted read only. A member can ask it what agents did on an issue, where they got stuck or what cost the most. It may run any repo harness and pushes nothing. It answers the member's message with `.factory/report.md` and any files, as [evidence.md](evidence.md#ad-hoc-files) says.

## Model routing

The baseline is triage Sonnet, design Opus, implementation Sonnet and testing Sonnet. `FACTORY_DESIGN_MODEL` is the Opus id and `FACTORY_BUILD_MODEL` the Sonnet id. The issue's labels at the moment an agent starts decide its model.

- `design-sonnet` runs design on Sonnet.
- `implementation-opus` runs implementation on Opus. Every testing round and the review stay on Sonnet.
- The candidate, incident and factory change agents always run Opus. Triage, patch, ad hoc and waste review agents always run Sonnet.
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
- An image that fails to fetch or decode fails the stage before any agent runs. An image on another host is listed as not seen.
