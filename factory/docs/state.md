# Factory state

This document describes all factory state as one model. It is the reference for Hermes and the spec of the write commands. `src/position.ts` holds the same model in code: `cardPosition`, `cardDrift` and `releaseDrift`.

The commands are the `factory` CLI. Read commands run at once and change nothing. Write commands apply on the next tick, before it picks jobs. Every write command takes `--by` and `--reason`.

## Stores

One card position spans several stores. A position is consistent when every store agrees.

- Project board: the column of each card. Written by every job that moves a card, and by `move`.
- Issue labels and comments: flags, model routing, design and feedback. Written by triage, design, the tick and `retry`.
- GitHub branches: `factory/issue-N`, `dev`, `main` and the release branch. Written by implement, approve, ship and `merge`.
- `state.json`: jobs, queues, card sub-positions, posts, builds, the release and the health records. Written by the tick, every job, and the write commands.
- Work clone: the task file and stage outputs, like `.factory/approval.json`, the screenshot and `check-failure.md`. Written by the agent stages and checks.
- Web root: the published builds. Written by checks, approve, ship and the dev build.
- Telegram: the posts with buttons. Written by checks, candidate, approve and ship.

## Card positions

Each position lists the column, the state fields, the artifacts it needs and the job the tick runs next. `factory card N` prints a card's position and names each store that disagrees. `factory move N <position>` puts a card in the position and clears the state of the old one.

- `triage`: column Triage. Next job: triage.
- `design`: column Design. Next job: design.
- `implement`: column Implementation, with no `patching` entry. Needs the plan on the issue. Next job: implement.
- `patch`: column Implementation, with a `patching` entry that holds the commit of the last posted build. Next job: patch. `move` cannot target it.
- `verify`: column Testing, with no `testPhase` entry. Needs the branch with the build. Next job: verify.
- `fix`: column Testing, `testPhase` is `fix`. The checks failed once. Next job: verify, which runs the fix round. `move` cannot target it.
- `checks`: column Testing, `testPhase` is `checks` or `checks-after-fix`. Next job: checks.
- `post`: column Testing, `testPhase` is `post`. Next job: checks, which builds, publishes and posts with no tests or playtest. Needs `.factory/approval.json` and the screenshot. `move N approval` goes through it.
- `approval`: column Approval. Needs a published build in `builds` and an open post in `approvalPosts`, or an approval queued in `pendingApprovals`. Next job: approve, which runs when the committee presses Approve.
- `done`: column Done. Runs nothing.

Fields that belong to one position:

- `testPhase` belongs to Testing only.
- `patching` belongs to Implementation only.
- `approvalPosts`, `postCaptions` and `pendingApprovals` belong to Approval only.
- `approvedResolving` marks an approved card that is back in Testing to resolve a conflict. It merges after hardening, with no new post.

Flags hold on any position:

- `factory-stuck`: a job failed. The card waits in its column until `retry N` removes the label.
- `needs-info`: the author owes answers. The tick removes it when someone answers.
- Approved: the card merges after hardening. It shows as `approvedResolving` or a queued approval.
- Routing labels `design-sonnet` and `implementation-opus`, `open-network`, `hotfix`, `adhoc`, `release-task` and `bundled` change how the card runs, never where it stands.
- `release-candidate` marks a merged card that waits for Ship.

## Release positions

`factory release` prints the release position.

- None: `release` is null. `cut` makes one.
- Cut with open tasks: `release` is set, and release tasks are not all done. The candidate waits.
- Candidate posted: `release.postId` holds the current candidate post. Ship runs when a member presses Ship, or on `ship`.
- Shipped: `ship` merged the release into `main`, closed its cards and set `release` to null.

`factory release` flags two drifts: an open release whose tracking card is missing, and a pending ship with no current candidate post.

## Queues

`factory queues` prints the queues. The tick applies each queue before it picks jobs.

- `pendingApprovals`: approvals the approve job merges. Fed by an Approve press and by `merge`. Drop with `drop approval <issue>`.
- `pendingRemovals`: features to take out of the release. Fed by `remove N`. Drop with `drop removal <issue>`.
- `pendingShip`: a Ship press the ship job runs. Fed by `ship`. Drop with `drop ship`.
- `pendingChanges`: factory change requests the change job runs. Drop with `drop change <id>`. `merge-change <id>` merges a finished change PR into `main`, which deploys it.
- `pendingIncidents`: shipped bug issues the incident job runs. Drop with `drop incident <issue>`.

## Health records

- `failures`: failed jobs of the last day. `factory failures` prints them. `retry N` clears a card's failure and its stuck label.
- `lastTickError`: the last tick crash. `factory status` shows it.
- `devFailed`: the short hash of a `dev` whose build failed. The tick skips it until `dev` moves or Hermes clears it.
- Pause: the pause file holds the reason and stops the tick. `pause <reason>` writes it and `resume` removes it.

## Consistency rules

`factory audit` prints one line per drift and prints nothing when the factory is clean. A drift is one of these:

- `testPhase` outside Testing.
- `patching` outside Implementation.
- An approval post or a queued approval outside Approval.
- An Approval card with no open post that is not approved.
- A running job whose stage differs from the stage the position runs. The stage of `post` is checks, of `approval` is approve, and `done` runs none.
- An open release whose tracking card is missing.
- A pending ship with no current candidate post.

## Commands

Read: `factory status`, `cards`, `card N`, `jobs`, `queues`, `release`, `failures`, `log N [stage]`, `audit` and `help`.

Write, each with `--by` and `--reason`:

- `move N <triage|design|implement|verify|checks|approval|done>` changes the card's position. It stops the running job, closes the open post, clears the old position's state and sets the new one.
- `merge N` merges a card into its base now. It skips the post and hardening.
- `ship` ships the open release.
- `cut` cuts a release.
- `remove N` takes a feature out of the release.
- `drop <approval|removal|ship|change|incident> <id>` drops one queued entry.
- `merge-change <id>` merges a factory change PR into `main`.

`merge` of a card the committee has not approved, `ship` and `merge-change` need a member as `--by`.

Immediate, with no tick wait: `retry N`, `pause <reason>` and `resume`.
