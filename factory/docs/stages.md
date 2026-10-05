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

Design runs Opus with up:udesign and up:uplan in hands-off mode. It writes the task file `.factory-tasks/issue-N.md` in the work clone on branch `factory/issue-N`. Git ignores the task file, so design posts it to the issue as a comment, and later stages read it from the clone.

- `.factory/questions.md` sends the card back to Triage with the questions, as unclear triage does.
- `.factory/wont-do.md` closes the issue as wont-do.
- A revision reads the issue comments under "## Committee feedback", "## Review findings" and "## Visual review findings". Comments under "## Committee question" are context only.
- Design drops a patch queued before the card reached it.

## Implementation

Implementation runs Sonnet with up:uexecute on the task file. For a change a player can see, the agent captures real in-game screenshots, compares them with the issue, the plan and `game/docs/DESIGN.md`, and fixes until nothing obvious differs. The screenshots stay out of the commits. The stage fails when the agent made no new commit.

## Testing

Testing is a verify job and a checks job. The diagram in [process.md](process.md#testing-column) shows the order.

Verify first merges the current base into the issue branch, so the build matches what approve will merge. The agent resolves any conflict, and an unfinished merge fails the stage. Then it runs the rounds of the card's mode.

- preview, for a new card, uses `prompts/test.md`. The agent plays the feature, fixes what blocks it, captures the evidence and writes the visual review. It runs no review, so the committee sees the card early.
- harden, for an approved card or a cleanup task, uses `prompts/harden.md`. The agent runs up:uverify and up:ureview, fixes nitpicks and checks the run-time cost. It writes no evidence.
- full, for a hotfix, runs harden and then preview, since its approval ships at once.

After a harden round, a blocking review runs Claude Code's `/code-review` on the design model over the whole branch diff. Its prompt is `prompts/review.md` with `docs/incident-log.md` and `game/docs/architecture/principles.md` from `dev` pasted in. It writes `.factory/review.md` ending in `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`, and a file with no clear verdict fails the stage.

- A FAIL writes `.factory/review-findings.md`, runs one review-fix round with `prompts/test-fix.md` and reviews again.
- A second FAIL comments the review under "## Review findings", drops the approval and moves the card to Design.
- A card that already went back to Design for the review fails the stage instead.

Checks runs no agent. It runs `npm ci`, the tests, the typecheck and the playtest, then builds the branch and publishes it at `/<hash>/`.

- A failure where every error is a timeout reruns the checks, up to 3 runs. Then the stage fails with the phase kept.
- A first real failure writes the end of the log to `.factory/check-failure.md` and hands the card to verify for one check-fix round.
- A failure after that fix fails the stage.
- A pass on an approved card moves it to Approval and queues the merge with no post. A pass on any other card posts it.

The post holds a screenshot, the play link, the pull request link and how to try it, with Approve and Deny buttons. The pull request goes against `dev`, or the base of a release task or hotfix.

## Approval

- Approve on a previewed card records the approver in `approvedResolving` and sends the card back to Testing to harden. The checks after hardening queue the merge.
- The merge takes the branch into `dev` and rebuilds `/dev/`. The issue gets the label `release-candidate` and stays open until its release ships.
- A merge conflict with a newer `dev` sends the card back to Testing with its approver kept. Testing runs a full hardening round again, and its checks queue the merge with no new post.
- Deny labels the issue `wont-do` and closes it and its pull request as not planned.

## Approval replies

A rerun of design, implementation and testing costs hours, so a reply takes the smallest route that does what the member asked.

- A reply that starts with "patch:" or "redesign:" takes that route at once.
- Any other reply goes to Hermes with a header that names the post and the issue. Hermes routes it with the `factory_route_reply` tool.
- answer: Hermes answers in the chat. The card and its post stay, and the question goes on the issue under "## Committee question".
- patch: the card moves to Implementation, and `patching` keeps the commit of the played build. The patch job runs Sonnet with `prompts/patch.md`. It merges the base, applies the reply, checks only the diff since the played build and writes new approval text and evidence. Then the card goes to Testing in phase `checks`. An agent that finds the plan must change writes `.factory/needs-redesign.md`, and the card goes to Design.
- redesign: the card goes to Design.

A patch or a redesign goes on the issue under "## Committee feedback", closes the post and drops a queued approval. Every route adds a line to the ledger.

## Release

Every `FACTORY_RELEASE_DAYS`, the release cut makes `release/<day>` from `dev`. It merges `main` into `dev` first when `dev` lacks any of it. It opens a tracking issue labeled `release` and two cleanup issues, for optimization and code janitor work, labeled `release-task` and `maintenance`. Release tasks run the card stages against the release branch. Cleanup tasks merge with no post.

When no release task is open, the candidate job builds the release at `/rc/`. The release agent writes the changelog, one line `- [#N] what changed` per change, and the job fails when the lines do not name the release's changes exactly. The post has a screenshot, the play link, the pull request, the count of changes and a Ship button. The changelog follows in a message under it.

- `remove #N` reverts feature N in the release and `dev`, reopens its issue and moves it to Design.
- Any other reply opens a new `release-task` issue with the reply as its body.
- A merge into the release drops the Ship button of the current post. A build that finds a new release task is not posted.

## Ship

Ship runs on the current candidate post only, with no release task open. It checks the changelog again, then merges `main` into the release, the release into `main` and `main` into `dev` in one atomic push. A change to `game/` on `main` that the release lacks fails Ship, since the committee did not play it. The factory builds a fresh clone of `main` with an empty save scope and runs `butler push` on the host, the only step that gets `BUTLER_API_KEY`. The public channel and a GitHub release tagged `release-<day>` get the changelog. Each shipped issue loses `release-candidate` and closes.

## Hotfix

A hotfix fixes a bug in the shipped game. Its jobs run before other cards and at the daily cap. Its branch starts from `main`, testing merges `main` into it, and it runs the full testing mode. The post opens with a hotfix warning, and its button reads "Approve and ship to players". Approve merges it into `main`, then `main` into `dev` and the open release, in one atomic push. Then it ships to itch.io. The public channel and a GitHub release tagged `hotfix-<day>-issue-<N>` get a one-line changelog. The open release gets a new candidate.

## Incident

Ship and the hotfix ship queue an incident job for each shipped fix of a `bug` issue and each hotfix, in `pendingIncidents`. The job runs the design model in a clone of `dev`. It reads the issue as untrusted text and the fix commit, and judges the bug against the bar in `docs/incident-log.md`. A bug that meets the bar gets an entry, which the factory merges into `dev`. The job comments the outcome on the issue. A missing or malformed `.factory/incident.json` fails the job.

## Factory change

A committee message starting with `/change`, Hermes's `factory_queue_change` tool or the waste review's button queues a factory change. The job runs the design model in a clone of `main` with the cwd in `factory/`. The agent runs up:make in hands-off mode on the task file `.factory-tasks/change-<id>.md`, through design, plan, execute, verify and review. It writes the pull request title and body from `prompts/change-pr.md`. The factory refuses a diff outside `factory/`, pushes `factory-change/<id>` and opens a pull request against `main`. It never merges it. Once a member merges it, the server deploys it.

## Ad hoc

A member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". Hermes opens an `adhoc` issue in Implementation. The job runs Sonnet in a fresh clone of `dev` with the state and logs mounted read only. It may run any repo harness and pushes nothing. It answers the member's message with `.factory/report.md` and any files, as [evidence.md](evidence.md#ad-hoc-files) says.

## Model routing

The baseline is triage Sonnet, design Opus, implementation Sonnet and testing Sonnet. `FACTORY_DESIGN_MODEL` is the Opus id and `FACTORY_BUILD_MODEL` the Sonnet id. The issue's labels at the moment an agent starts decide its model.

- `design-sonnet` runs design on Sonnet.
- `implementation-opus` runs implementation and every testing round on Opus.
- The review, incident and factory change jobs always run Opus. Triage, patch, ad hoc, waste review and candidate agents always run Sonnet.

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
