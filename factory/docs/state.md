# Factory state

This document describes all factory state as one model. It is the reference for Hermes and the spec of the write commands. `src/position.ts` holds the same model in code: `cardPosition`, `cardDrift` and `releaseDrift`.

The commands are the `factory` CLI. Read commands run at once and change nothing. Write commands apply on the next tick, before it picks jobs. Every write command takes `--by` and `--reason`.

## Stores

One card position spans several stores. A position is consistent when every store agrees.

- Project board: the column of each card. Written by every job that moves a card, and by `move`.
- Issue labels and comments: flags, model routing, design and feedback. Written by triage, design, the tick and `retry`.
- GitHub branches: `factory/issue-N`, `dev`, `main` and the release branch. Written by implement, testing, hardening, the merge job, a hotfix approve and ship.
- `state.json`: jobs, queues, card sub-positions, posts, builds, the release and the health records. Written by the tick, every job, and the write commands.
- Work clone: the task file and stage outputs, like `.factory/approval.json` and the screenshot. Written by the agent stages. Its pre-commit hook runs the diff guard.
- Clone backups: `$FACTORY_HOME/clone-backups/issue-N-<time>/` holds a work clone that `repair-clone` replaced, with `repair.json` and `status.txt`. Written only by `repair-clone`. No code reads or deletes it. Hermes deletes it by hand once the card is past the trouble.
- Web root: the published builds. Written by testing, the post-only checks, candidate, a hotfix approve, ship and the dev build.
- Telegram: the posts with buttons. Written by testing, the post-only checks, candidate, approve and ship.
- Source maps: `$FACTORY_HOME/sourcemaps/<commit>/` holds the maps of each release, dev and candidate build, and `published.jsonl` lists those builds. Written by ship, hotfix, the dev build and candidate. Read by the error service.
- Test cache: `$FACTORY_HOME/test-cache/` holds the pass entries of the game test tool. The tool writes and reads them in the check containers of the post and merge checkpoints, the only ones that mount the folder. The tick deletes files older than `FACTORY_TEST_CACHE_DAYS`.
- Error reports: `$FACTORY_HOME/error-reports/` holds `store.json`, which ties each error fingerprint to its issue and counts reports and rejects, and `reports/<fingerprint>/<commit>.json.gz`. Written only by the error service. Agent stages of an `error-report` issue read its reports.

## Card positions

The board column is the position. Only a Testing card has a second one, `post`. Each position lists the column, the state fields, the artifacts it needs and the job the tick runs next. `factory card N` prints a card's position and names each store that disagrees. `factory move N <position>` puts a card in the position and clears the state of the old one.

- `triage`: column Triage. Next job: triage.
- `design`: column Design. Next job: design.
- `implement`: column Implementation. Needs the plan on the issue. Next job: implement.
- `verify`: column Testing. Needs the branch with the build. Next job: verify, which tests, runs the post checkpoint and posts in one job.
- `post`: column Testing, with the issue in `postOnly`. Next job: checks, which builds, publishes and posts with no tests or playtest. `move N approval` puts a card here and drops its approval.
- `approval`: column Approval. Needs a published build in `builds` and an open post in `approvalPosts`, or an approval queued in `pendingApprovals`. Next job: approve, which runs when the committee presses Approve.
- `harden`: column Hardening, with an `approvedResolving` entry, or a cleanup task. Next job: harden, which runs the hardening session and moves the card to Merging. `move N harden` records the mover as approver when none is recorded.
- `merging`: column Merging, with an `approvedResolving` entry, or a cleanup task. Next job: merge, one for every Merging card of a base. `move N merging` and `merge N` record the mover as approver when none is recorded.
- `done`: column Done. Runs nothing.

Fields that belong to one position:

- `postOnly` belongs to Testing only.
- `approvalPosts`, `postCaptions` and `pendingApprovals` belong to Approval only.
- `approvedResolving` marks an approved card in Hardening or Merging. The merge comment names the approver.

Flags hold on any position:

- `factory-stuck`: a job failed twice, spent its budget or asked the committee. The card waits in its column until `retry N` removes the label. A card stage that fails the first time takes no label: its issue stays in `interrupted`, its sessions keep the error, and the next tick resumes the stage.
- Held: `held` in `state.json` holds who held the card, why, when, and the stage of the job the hold stopped. The tick starts no job on the issue, a queued approval included, until `resume-card N` lifts it. A hold is no failure, so the card takes no label and Hermes gets no incident. `move` keeps it but forgets the stopped stage, since the move clears the sessions. `move N done` drops it.
- `needs-info`: the author owes answers. The tick removes it when someone answers, or when `FACTORY_NEEDS_INFO_HOURS` pass since the questions.
- Approved: the card merges after hardening. It shows as `approvedResolving` or a queued approval.
- Routing labels `design-sonnet` and `implementation-opus`, `open-network`, `hotfix`, `adhoc`, `release-task` and `bundled` change how the card runs, never where it stands.
- `release-candidate` marks a merged card that waits for Ship.
- `error-report` marks a bug the error service opened from a game error. Intake takes it with no votes, into Triage.

## Release positions

`factory release` prints the release position.

- None: `release` is null. `cut` makes one.
- Cut with open tasks: `release` is set, and release tasks are not all done. The playtest and the candidate wait. An open task is a `release-task` card outside Done, or an issue in `release.tasks` that the board does not show in Done.
- Playtest: every release task is done, and `release.playtest.passed` is not the release head. The playtest runs.
- Playtest blocked: `release.playtest.blocked` holds the commit and the reason. The tracking card has `factory-stuck`. `retry <tracking> [decision]` lifts it.
- Candidate building: `release.playtest.passed` is the release head and no post is current. The candidate runs.
- Candidate posted: `release.postId` holds the current candidate post, and `release.candidateSha` the commit it plays. Ship runs when a member presses Ship, or on `ship`. A release task merge, a playtest fix or Remove that moves the release drops the post and a queued Ship. Ship refuses a release head other than `candidateSha`.
- Shipped: `ship` merged the release into `main`, closed its cards and set `release` to null.

`release.playtest` holds the playtest of the open release: `seed`, fixed at the cut; `runs`, every play started, which names the audit folders; `passed`, the commit a clean play approved, which is also the next job's baseline; `blocked`; and `notes`, the members' decisions from `retry`. One job plays at most `FACTORY_PLAYTEST_RUNS` times, so the state keeps no count of plays left.

The public post of a shipped release has its own position in `releasePost`, beside the next open release. `factory release` prints it as `public post`.

- None due: `releasePost` is null.
- Waiting for a draft: Ship set `releasePost` with the changelog and the screenshot under `$FACTORY_HOME/release-posts/<day>/`, and `postId` is null. The incident watch shows `release post due`, and Hermes sends a draft.
- Draft posted: `releasePost.postId` holds the draft post in the committee chat, and `releasePost.draft` its text. A reply to it goes to Hermes, who sends a new draft. Publish on the current draft posts it to `FACTORY_PUBLIC_CHANNEL` and sets `releasePost` to null.

`release.tasks` lists every release task the factory created or labeled: the cut's cleanup tasks, a reply's task and a fix triage labeled. Each is written before its card or label goes on the board, since the board lists a write up to a minute late. `factory release` prints them as `recorded tasks`.

`factory audit` and `card N` flag five drifts: an open release whose tracking card is missing, a recorded release task missing from the board, a pending ship with no current candidate post, a candidate post of a commit the playtest did not pass, and a release post with a draft post id but no draft text or the reverse. `factory release` flags nothing.

The release tracking card has the label `release`. It waits in Approval for the whole release, and its post is `release.postId`. It never shows card drift.

## Queues

`factory queues` prints the queues. The tick applies each queue before it picks jobs.

- `pendingApprovals`: approvals the approve job runs. It moves the card to Hardening, or ships a hotfix. Fed by an Approve press. Drop with `drop approval <issue>`.
- `pendingRemovals`: features to take out of the release. Fed by `remove N`. Drop with `drop removal <issue>`.
- `pendingShip`: a Ship press the ship job runs. Fed by `ship`. Drop with `drop ship`.
- `pendingChanges`: factory change requests the change job runs. Drop with `drop change <id>`. `merge-change <id>` merges a finished change PR into `main`, which deploys it.
- `pendingIncidents`: shipped bug issues the incident job runs. Drop with `drop incident <issue>`.

## Health records

- `failures`: failed jobs of the last day. `factory failures` prints them. `retry N` clears a card's failure and its stuck label.
- `lastTickError`: the last tick crash. `factory status` shows it.
- `devFailed`: the short hash of a `dev` whose build failed. The tick skips it until `dev` moves or Hermes clears it. `devError` holds what broke, and the incident watch prints its first line, so Hermes fixes `dev` or reverts the merge that broke it.
- Review pending: `$FACTORY_HOME/review-pending` names the issue of a finished waste review. Hermes's incident watch prints it, and Hermes deletes it once handled.
- Error service alert: `$FACTORY_HOME/error-reports/alert` holds one line per cap the error service hit that day: the daily issue cap, the disk cap or the per-address limit. Hermes's incident watch prints it, and Hermes deletes it once handled.
- Pause: the pause file holds the reason and stops new work. A paused tick only checks the running jobs: it reaps a dead or timed-out job and resumes it once as usual. A second death or timeout fails it. It starts no job, applies no order, runs no cleanup and takes no intake. `pause <reason>` writes it and `resume` removes it when `pause` wrote it.

## Consistency rules

`factory audit` prints one line per drift and prints nothing when the factory is clean. A drift is one of these:

- `postOnly` outside Testing.
- An approved card in Testing, which would get a preview and lose its approval.
- A Hardening or Merging card with no approval that is not a cleanup task.
- An approval post or a queued approval outside Approval.
- An Approval card with no open post that is not approved.
- A running job whose stage differs from the stage the position runs. The stage of `post` is checks, of `approval` is approve, and `done` runs none.
- An open release whose tracking card is missing.
- A pending ship with no current candidate post.
- A candidate post of a commit the playtest did not pass.
- A held card in Done, a held card with a running job, or a held issue off the board. The line names who held it and why.

`factory audit` skips every card with a running job, because the job owns the card mid-step. A stage changes the column and the post before its job leaves `jobs`, so drift shows for seconds. `card N` still prints all drift lines of the card, and adds a line that a job is running.

## Commands

Read: `factory status`, `cards`, `card N`, `jobs`, `queues`, `release`, `failures`, `log N [stage]`, `audit` and `help`.

Write, each with `--by` and `--reason`:

- `move N <triage|design|implement|verify|approval|harden|merging|done>` changes the card's position. It stops the running job, closes the open post, clears the old position's state and sets the new one. `move N verify` and `move N approval` drop the approval, so the card gets a new post.
- `move N done` drops the card the way Deny does. It comments, closes the PR, adds the `wont-do` label, closes the issue as not planned, moves the card to Done and releases the bundled issues.
- `move` and `merge` refuse the release tracking card.
- `merge N` puts a card in Merging. It skips the post and hardening, and the merge checkpoint still runs.
- `ship` ships the open release.
- `cut` cuts a release.
- `remove N` takes a feature out of the release.
- `drop <approval|removal|ship|change|incident> <id>` drops one queued entry.
- `merge-change <id>` merges a factory change PR into `main`.
- `pause-card N` holds a card. It stops the card's job, by its process group and the containers with its job id, and leaves every other job running. The job's work clone and agent sessions stay, the issue goes in `interrupted` with its stage marked to resume, and its card job limit slot frees. Its ledger line has the outcome `held`. A job that ended before the kill keeps its own line. It refuses a card off the board, in Done, already held, the release tracking card, and a card whose approve or remove job runs. It also refuses a Merging card in the `batch` of the running merge job. The merge job writes `batch`, the issue numbers it merges, on its own entry in `jobs` when it takes its cards. A Merging card outside the batch can be held and moved while the merge runs.
- `resume-card N` lifts the hold. The next tick runs the card's stage, and a job of the stopped stage continues its agents' sessions with `--resume`. It needs no board, so it also lifts a hold whose card is gone.

`card N`, `cards` and `status` show each hold with who held it and why. The public dashboard shows only the wait reason `held`.

Each target of `move` and `merge` has preconditions:

- `verify`, `approval`, `harden`, `merging` and `merge` need the branch.
- `implement` needs the task file.

A failed order changes nothing, and the order can be repeated.

Write orders wait while the factory is paused. The CLI still writes the order, says that the factory is paused and why, and the order applies when the pause is lifted.

`--by` is a committee member, by Telegram id, GitHub login or name, or `hermes`. Hermes passes the Telegram id of the member whose message ordered the action. Its `factory_sender` tool returns that id, since a Telegram display name matches no member.

`hermes` may send mechanical orders: `move` to any position except `harden` and `merging`, `merge` and `move` to `harden` or `merging` of a card the committee approved, `cut`, `drop`, `retry`, `pause-card` and `resume-card`. A member must send the product decisions: `ship`, `remove`, `merge-change`, and `merge` or `move` to `harden` or `merging` of a card the committee has not approved. The CLI and the tick both refuse a gated order from `hermes`.

Immediate, with no tick wait: `retry N [decision]`, `pause <reason>`, `resume` and `repair-clone N --by <who> --reason <why> [--backup-merge]`. `retry` of the release tracking card also lifts a playtest block and keeps the decision in `release.playtest.notes`, so a new playtest job runs and reads it. `pause <reason>` writes `Paused with factory pause: <reason>`. `resume` lifts only a pause that starts with that text. It refuses a pause written by hand or by a member. Hermes deletes that file itself once its reason is gone.

`repair-clone N` needs only that no job of the card runs. It holds the card and takes the clone lock `locks/issue-N` while it works, then lifts the hold it placed. It moves the card's work clone whole into a clone backup, checks out GitHub's `factory/issue-N` fresh and copies only the factory folders over. It changes no label, card or `state.json` field. [operations.md](operations.md#repairing-a-work-clone) has the rules.
