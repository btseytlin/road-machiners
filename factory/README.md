# Game factory

The public files and votes on GitHub issues. Agents design and build the top ones. A human committee approves each result by playing it.

Run every command in this file from `factory/`, unless it says otherwise. The factory reads its settings from two files. Git tracks `settings.env`, with the limits, the models and the timeouts. `.env` holds the secrets, the committee ids and the host paths, and never leaves its host. Copy `.env.example` to `.env` first. A key in both files stops the factory.

The design and its reasons are in [the factory task](docs/tasks/game-factory.md).

## Flow

1. Intake marks an aged `feature-request` or `bug` issue with enough thumbs-up, or one from a committee member. It goes to the Triage column of the GitHub Project.
2. Triage runs Sonnet in the agent container. It stays on Sonnet whatever it rates. It scores the issue on a clear goal, a checkable result, a scope of one task and a fit with DESIGN.md. For a `ready` issue it also rates complexity by checkable criteria, as [Model routing](#model-routing) says. It writes `.factory/triage.json`. `ready` moves the card to Design. A `ready` issue may bundle other cards that wait in Triage and touch the same code or feature, so one design and one build serve them all. The factory offers only free Triage cards: not stuck, not waiting for an answer, not a hotfix, not a lead of its own bundle and not busy in a job. Each bundled issue gets a comment and the label `bundled`, and its card moves to Done while the issue stays open. The state file records the bundle under `bundles`. Every later stage reads the bundled issues after the lead, the pull request closes them all, the release changelog sums up the bundle in the lead's one line, and they close when the lead ships. A denied or refused lead sends each bundled issue back to Triage on its own. A hotfix never bundles. `wont-do` comments the reason, labels the issue `wont-do`, closes it and moves the card to Done. `unclear` comments up to three questions for the author, labels the issue `needs-info` and leaves the card in Triage. The committee chat gets one brief notice per new question set, with the stage and the issue link, telling members to answer on the GitHub issue, since chat replies do not reach the stage. The notice never quotes the questions. A set asked while an earlier one is still unanswered, like a retry, adds no notice. The tick skips a `needs-info` issue until someone answers on GitHub. Then triage runs again with the answers. A request for a new authored location or landmark needs a usable reference image from the issue body or a comment. Without one, or when the image failed to fetch, triage is `unclear` and asks once for an upload. Repairs of existing locations, biome or procedural-system changes and unrelated requests skip this gate, and a missing image alone never means `wont-do`.
3. Design runs Opus, unless the issue has `design-sonnet`, with the up design and plan skills. It writes `docs/tasks/issue-N.md` on branch `factory/issue-N`, or refuses the issue as "won't do". For a real blocker it writes `.factory/questions.md` instead, and the card goes back to Triage with those questions. The chat hears of them as in step 2.
4. Implementation runs Sonnet, unless the issue has `implementation-opus`, with the up execute skill.
5. Testing first merges the current `dev` into the issue branch, so the build matches what approve will merge. On a conflict the agent resolves it, and a merge left unfinished fails the stage. Then testing runs Sonnet, or Opus with `implementation-opus`, with the up verify skill. Then a blocking review runs the built-in `/code-review` skill once over the whole branch diff against its base, on the design model. The prompt starts with `/code-review`, since Claude runs a skill only from the first line. Its instructions are `prompts/review.md` with `docs/incident-log.md` and `game/docs/architecture/principles.md` from `dev` pasted in, so a hotfix branch from `main` gets them too. It writes the whole review to `.factory/review.md`, ending with one verdict line, `REVIEW_VERDICT: PASS` or `REVIEW_VERDICT: FAIL`. A FAIL writes the review to `.factory/review-findings.md` and runs one `test-fix` round, then one more review. A second FAIL comments the review under "## Review findings" and moves the card back to Design. The design agent treats them as a core design flaw and revises the design to remove the root cause. A card that already went back to Design once for the review fails the stage instead, so it lands in `factory-stuck` for Hermes. A missing `review.md`, or one without a clear verdict line at its end, fails the stage. Then the factory runs the tests and the CPU playtest itself, builds the branch and copies it to `/<hash>/`. The state file records the build of each issue.
6. Testing opens a pull request against `dev`, or reuses the open one. The committee chat gets a screenshot, the play link, the pull request link and how to try it. The post has Approve and Deny buttons. Testing agents capture views that together show every visible change, as [Visual evidence](#visual-evidence) says. Approve merges the branch into `dev`, which redeploys to `/dev/`. The issue stays open with the label `release-candidate` until its release ships. Deny labels the issue `wont-do` and closes it and the pull request as not planned. A reply to the post sends the task back to design with the reply as feedback. When the branch conflicts with `dev` at approval, since parallel work moved `dev` on, the card goes back to Testing with its approver kept. Testing merges `dev`, the agent resolves the conflict and the checks run again. Then the merge is queued with no new post, and the chat sees nothing of it.
7. Every `FACTORY_RELEASE_DAYS`, the factory cuts branch `release/<day>` from `dev`. When `dev` lacks commits of `main`, like a merge made by hand, it merges `main` into `dev` first. So the release holds all of `main`, and its merge into `main` at Ship cannot conflict. It opens a tracking issue with the label `release` and two cleanup issues, one for optimization and one for code janitor work. They carry the labels `release-task` and `maintenance`. Release tasks run the normal stages against the release branch. Cleanup tasks merge into it without a committee post.
8. When no release task is open, the factory builds the release candidate at `/rc/`. The release agent writes the changelog, one line `- [#N] what changed` per change, and the candidate fails when the lines do not name the release's changes exactly. The committee chat gets a screenshot, the play link, the pull request and the count of changes, with a Ship button. The whole changelog follows in a message under that post, since a caption holds only 1024 characters. Commands go to the post itself. A reply `remove #N` takes feature N out of the release and `dev`, and reopens its issue. Any other reply opens a new `release-task` issue with the reply as its body. Both make a new candidate later. Every merge into the release branch drops the current post's Ship, and a build that finds a release task opened while it ran is not posted.
9. `ship`, as a reply or the Ship button, merges the release branch into `main` and ships to itch.io. It works only on the current candidate post and only when no release task is open. Before it merges anything, it checks the changelog against the release and brings the release up to `main`. Factory work lands on `main` directly, so Ship merges `main` into the release first, and a conflict stops it there. A change to `game/` on `main` that the release lacks fails Ship instead, since the committee did not play it. The factory builds a fresh clone of `main` in the agent container with an empty save scope, then runs `butler push` on the host. Only that call gets `BUTLER_API_KEY`. The merge of `main` into the release, the release into `main` and the new `main` into `dev` go to GitHub in one atomic push, before the build. So a conflict or a rejected push stops Ship with no branch moved. The public channel gets the changelog, and so does a GitHub release tagged `release-<day>` on `main`. Each shipped issue loses `release-candidate` and closes.
10. A committee message starting with `/change`, or Hermes's `factory_queue_change` tool, asks for a change to the factory itself. The factory works on a clone of `main` and opens a pull request against `main` that touches only `factory/`. It never merges it. Once a member merges it, the server deploys it, as [Deploying the factory](#deploying-the-factory) says.
11. A committee member can ask Hermes for one-off work, like "simulate 10 battles and tell me if the MG is too weak". The factory opens an `adhoc` issue and runs Sonnet in a fresh clone of `dev`. It may run any repo harness, pushes nothing, and answers the member's message with a report. A file it makes goes to that chat as a Telegram document and nowhere else, as [Ad hoc files](#ad-hoc-files) says.
12. A hotfix fixes a bug in the shipped game, like broken saves. It is an issue with the label `hotfix`. A collaborator can set the label, and then intake puts the issue into Design with no votes. Triage can set it too, for a bug that loses saves, crashes the game or blocks play. Then the committee chat gets a warning. Hotfix jobs run before other cards, at the cap too. Its branch starts from `main`, and testing merges `main` into it. The approval post opens with a hotfix warning, and its button reads "Approve and ship to players". Approve merges it into `main`, merges the new `main` into `dev` and into an open release branch, and pushes all of them in one atomic push. Then it ships to itch.io, like a release. The public channel and a GitHub release tagged `hotfix-<day>-issue-<N>` get a one-line changelog. The issue closes. The open release gets a new candidate, since the played one lacks the fix. A conflict or a rejected push stops the hotfix before anything is public, with no branch moved.
13. An incident job follows each shipped fix of an issue labeled `bug`, and each shipped hotfix. Ship and the hotfix ship queue it in `pendingIncidents` in the state file. The job runs the design model in a fresh clone of `dev`. It reads the issue as untrusted text and the fix commit, then judges the bug against the bar in `docs/incident-log.md`. A bug that meets the bar gets an entry in that file, and the factory merges the entry into `dev` and pushes it. Either way the job comments the outcome on the issue. The agent output is `.factory/incident.json`, and a missing or malformed file fails the job.

Before every agent stage, the host fetches the reference images of the issue body and every comment, feedback included. It takes only PNG, JPEG, GIF and WebP from GitHub's attachment hosts and from first-party images at `https://roam-game.online/<name>.jpg|png|webp` or `/concepts/<name>.jpg|png|webp` (plain names, no query, no credentials sent). It follows redirects only to GitHub's own storage hosts, or for a first-party image only to another allowed first-party image, and caps each file at 10 MB and the count at 12. Files land in `$FACTORY_HOME/media/issue-N/`, which the agent sees read only at `/work/.factory-media`, and never in a commit. Each stage prompt ends with the absolute paths and the list of images, and tells the agent to open each with the Read tool. An image that fails to fetch or decode fails the stage before any agent runs, so no agent goes on as if it had seen it. A first-party image that is missing or not an image fails the stage too. An image on another host, or a GitHub file that is not an image, is listed as not seen. Hermes therefore puts a committee image on an issue with `factory-issue-image attach`, which keeps the original bytes as a `user-attachments` link and fails visibly, with the image-dependent work held, when upload or read-back fails. Testing compares a screenshot of the game with the reference when the issue wants a look, and corrects and compares again for up to three rounds.

Each stage runs as its own job process, and jobs run in parallel in five queues.

- The triage queue runs triage, up to `FACTORY_TRIAGE_WORKERS` at once. Triage runs at the reasoning effort `FACTORY_TRIAGE_EFFORT`, so a new issue never waits behind a long build.
- The design queue runs design, up to `FACTORY_DESIGN_WORKERS` at once.
- The implement queue runs implementation and ad hoc jobs, up to `FACTORY_IMPLEMENT_WORKERS` at once.
- The test queue runs testing, up to `FACTORY_TEST_WORKERS` at once. Testing builds the game and plays it in a browser, so it needs the most memory.
- The branch queue runs approve, remove, ship, incident, the release cut, the candidate, `/dev/` rebuilds and `/change`, one at a time. These move `dev`, `main` or the release.

Every tick checks the running jobs in `jobs` in the state file, then starts each job that fits. Within a queue the order is as follows: hotfix cards, ad hoc tasks, release tasks, then the card furthest along. An issue has at most one job at a time. Each job's containers carry its id as a label, so a timeout kills only that job. Jobs share the host clone and the state file, so each git step and each state update runs under a lock in `$FACTORY_HOME/locks` or next to the state file. A lock of a dead process is taken over.

GitHub holds every branch. The host clone `$FACTORY_HOME/repo` keeps GitHub's branches as `origin/*` refs, and each fetch deletes any local branch. A merge or a revert runs in a throwaway worktree and pushes its result at once. A conflict or a rejected push leaves GitHub as it was and nothing behind on the host, so a retry starts from GitHub. An agent's work reaches GitHub only after the factory checked its diff.

Every tick, after intake, the factory deletes each folder in the web root except `dev`, the reserved `concepts` folder of first-party images and the builds of cards now in Approval. It skips this while a testing or branch job runs, since those deploy builds.

When `dev` on GitHub moves past the commit `/dev/` serves, the next free tick rebuilds `/dev/`. So a merge made outside the factory also reaches the dev link. A failed build records its commit in `devFailed` in the state file. The tick skips that commit until `dev` moves again, and Hermes gets the incident.

The factory starts at most `FACTORY_MAX_JOBS_PER_DAY` public-driven jobs in any 24 hours. Triage, design, implementation, testing and the release cut count. Approve, change and ad hoc jobs do not. Hotfix jobs count, but they run at the cap too. The first time the cap blocks work, the committee chat gets one notice with the count and the time the next slot frees.

When a member acts on an approval or candidate post, by button or reply, the factory adds a status line under its caption, like "✅ Approved by Ann", and drops its buttons. The state keeps each open post's caption for this, since Telegram cannot read one back. Each command gets one answer in the chat. A command on a post answers with that status line alone, and a reply comes only when the edit fails. `/change` gets one reply from the tick. An ad hoc task gets Hermes's reply, then the report, then any files the agent made. Errors always get a reply.

Triage, design, implementation and testing each comment on their issue when they finish or fail, with the time they took.

A failed or timed-out stage labels its issue `factory-stuck` and records the failure in `failures` in the state file for a day. The factory posts nothing about it, and neither about a tick crash. Hermes's incident watch sees both. Hermes fixes what it can and comments on the issue. It posts in the chat only when the committee must act or decide. A stuck release step labels the tracking issue. Removing the label lets the factory try again.

Hermes manages the factory. A watch job wakes it when an issue gets stuck or the tick crashes. It reads the logs, the state and the chat, then fixes the incident or asks the committee. It has a shell with `gh`, `git` and `jq` as the bot account, and it can edit the factory home. While it edits state, it pauses the factory with the file `$FACTORY_HOME/paused`, and every tick skips.

A job whose process dies resumes once. This covers a crash, a memory kill or a reboot. Each issue keeps its agents' Claude Code sessions in `$FACTORY_HOME/sessions/issue-N`, mounted at the agent's `~/.claude/projects`. The tick removes the dead job's containers, puts its issue in `interrupted` in the state file and frees its daily cap slot. The next tick starts the same stage. Each agent round with a saved session continues it with `--resume` and a short note, and `.factory/` outputs stay. Merges, checks and publishing run again. A second death or a timeout fails the job as usual. A dead branch job, like approve or ship, always fails. A job's end clears the sessions and the mark.

## Visual evidence

The testing agent writes `.factory/screenshot.png`, the primary, and optionally `.factory/evidence.json`, an ordered manifest of up to 10 images with the primary first. The manifest lists the visible `features` of the change and, per image, a short description and the features it `covers`. Rules the factory checks:

- Every feature has an image. A `location` has at least three views. A `system` has an image marked `sheet`, a labeled contact sheet of real screenshots.
- Each file is a plain relative name inside `.factory/`, a real PNG, JPEG or WebP under 10 MB with no link out of the folder, and no two images are equal.
- `commit` is the final head of the branch. A test-fix round that changed code must capture again, or the stage fails.
- With no manifest, the one screenshot posts as before. A manifest that breaks a rule fails the testing stage.

Telegram gives a media group no buttons. So the primary approval post stays one photo with its caption, buttons and registered id, and the other images follow as a reply photo (one) or a reply album (2 to 9). Commands and status edits act on the primary alone. Replies to the album do nothing. When the album fails, the factory unregisters the primary, replaces its caption with a superseded note and drops its buttons, and the stage fails with the card still in Testing. A retry posts one new primary and one album. The release candidate works the same way, with the changelog message under the Ship post. Its manifest is optional, and one that breaks a rule is logged and ignored.

## Ad hoc files

The invariant: the factory never publishes an ad hoc artifact. It never copies one into the web root or another served folder, puts one or a link to one in a GitHub comment or a log, or turns one into a URL, even when the request asks for a web link. Only `/dev/`, `/rc/` and the approval builds are public.

- The agent writes each file into `.factory/files/` of its work clone. `report.md` stays a short text answer, with no pasted file contents.
- The factory checks the folder first. Only plain files directly in it pass, so links, folders, odd names and paths out of the clone fail. The extension must be html, htm, pdf, csv, tsv, json, txt, md, log, png, jpg, jpeg, gif, webp, svg or zip. A file must not be empty or over 50 MB, the Bot API's limit. There are at most 10 files and 100 MB in all.
- The checked files are copied to `$FACTORY_HOME/adhoc-artifacts/issue-N/`, which only the factory user can read and which is no served folder. Then the report goes as a reply to the member's message, and each file follows as an upload with `sendDocument` and `reply_parameters` to that message.
- A bad file or a failed upload fails the stage and the chat gets a message with the reason. The issue stays open, with `factory-stuck`, and no public link replaces the file. The copy stays in `adhoc-artifacts` until a delivery works, which deletes it. A retry runs the task again and replaces the copy.

## Model routing

The baseline is triage Sonnet, design Opus, implementation Sonnet and testing Sonnet. `FACTORY_DESIGN_MODEL` in `settings.env` is the Opus id and `FACTORY_BUILD_MODEL` the Sonnet id. No stage hard-codes a model name.

Two labels route an issue, and the issue's labels at the moment an agent starts decide the model:

- `design-sonnet`: design, including a feedback revision, runs on Sonnet.
- `implementation-opus`: implementation and every testing agent run run on Opus. That covers the conflict merge, the first test round and the check-fix round.

Triage, ad hoc, `/change` and release candidate agents always run on Sonnet. Triage keeps its Sonnet model for classification too.

Triage rates each `ready` issue and writes `complexity` and a one-sentence `complexityReason` to `triage.json`:

- `trivial`: one file or one small local piece of logic, no new state, save data or cross-system rule, one visible behavior. Triage adds `design-sonnet`, so design, implementation and testing all run on Sonnet.
- `hard`: three or more interacting systems, or a change to shared state or a data format, or a bug with no known cause across systems, or real tradeoffs between approaches. Triage adds `implementation-opus`, so design, implementation and testing all run on Opus.
- `intermediate` or in doubt: no label, so Opus designs and Sonnet implements and tests.

Triage posts the rating and reason in a comment that starts with `Model routing from triage:`. That comment is the audit trail.

Precedence:

1. A label on the issue wins. Triage never changes labels that are already there, and it only logs its rating.
2. Triage decides once. When its routing comment exists, a later triage run, such as after a `needs-info` answer or a design question, adds nothing. A label a member removed stays removed.
3. A member adds or removes a label on GitHub any time. The next agent run reads it, so nothing is cached and nothing overwrites it. A run already in progress keeps its model.

The labels are the persisted decision, so a selection survives every job, retry and restart. Both labels together give Sonnet design and Opus implementation and testing.

Cost: Opus costs several times Sonnet per token. A `hard` issue runs three stages on Opus instead of one, and a testing run holds up to two agent rounds plus the conflict merge. A `trivial` issue saves the design stage's Opus run. Limits: the rating is one Sonnet judgment from the issue text and the code it reads, so it can misjudge. A member fixes that with the labels. There is no label for Opus testing alone, nor for Sonnet implementation with Opus testing.

## Parts

- `src/` holds the Node CLI. `npm run factory -- tick` is the entry point. Run `npm ci` in `factory/` first. A timer runs it.
- `prompts/` holds the prompt of each agent stage.
- `docker/` holds the agent image with Blender and ffmpeg, and the vendored `blender-image-to-3d` skill (MIT, pinned commit, see `docker/skills/blender-image-to-3d/SOURCE.md`). `FACTORY_SMOKE_IMAGE=<image> npx vitest run agent-image` also checks in the built image that Claude reads a mounted image's pixels. Agents get their work clone, `CLAUDE_CODE_OAUTH_TOKEN` and `ELEVENLABS_API_KEY` with `SFX_MAX_GENERATIONS`, so they can generate sounds.
- `hermes/` holds the Hermes compose file, its config template, its identity in `SOUL.md`, the idle session reset plugin `hermes-session-reset-policy` (cloned at a pinned commit in the Dockerfile), the incident watch script, the pinned official `gh` (the Dockerfile checks its release checksum) with the `factory-issue-image` command that uploads a committee image to an issue as a native GitHub attachment and reads it back, the `factory-host` ssh command for the server and the plugin that queues committee replies into `$FACTORY_HOME/inbox` and edits the committee file.
- `infra/` deploys the server with pyinfra. See [infra/README.md](infra/README.md).
- `mac/` runs the factory on a Mac. See [mac/README.md](mac/README.md).

## Deploying the factory

The server runs the factory from GitHub's `main`, and only from there. To change factory code or `settings.env`, merge it into `main`. Every 2 minutes, `factory-update` on the server checks `main`. When `main` moved, it pauses the factory, waits for the running tick and jobs, checks out `main` and rebuilds what changed. It records the commit in `$FACTORY_HOME/deployed`. It refuses a code dir with local edits, so a hand edit on the server never gets lost without a word. Hermes changes the factory the same way, with a `/change` pull request. The pyinfra deploy sets up the server and pushes `.env`, and never sends code. See [infra/README.md](infra/README.md).

## Committee

- The committee is a whitelist in `$FACTORY_HOME/committee/committee.json`. Each member has a Telegram id, a GitHub login and a name.
- Until that file exists, the committee is one member from `FACTORY_COMMITTEE_BOOTSTRAP` and `FACTORY_COMMITTEE_BOOTSTRAP_GITHUB` in `factory/.env`.
- Members manage the list in the chat with `/committee list`, `/committee add`, `/committee remove` and `/committee github`. The Hermes plugin writes the file. The factory reads it on every tick and every command.
- The bot answers committee members only.

## GitHub setup

- The host needs `gh` logged in with the `repo`, `project` and `read:org` scopes. `gh project` needs `read:org` even for a user's Project. Run `gh auth setup-git` so git pushes with it.
- The host needs a git identity, since approvals make merge commits.
- Make a GitHub Project for the repo. Its Status field needs the options Triage, Design, Implementation, Testing, Approval and Done. Put its owner and number in `factory/settings.env`.
- The repo needs a `dev` branch.

## Tests

- `npm test` runs the CLI tests.
- `FACTORY_SMOKE_GH=1 npx vitest run hermes-issue-image` also runs the real `gh` on the host and checks that it has `issue edit --attach`.
- `uv run --with pytest --with pyyaml pytest hermes` runs the plugin tests.
- `cd infra && uv run pytest` runs the infra helper tests.
