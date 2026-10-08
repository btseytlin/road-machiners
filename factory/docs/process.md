# Factory process

This file is the spec of how the factory works. Each diagram matches the code, and a change to the process updates its diagram in the same commit. The rules behind each step are in [stages.md](stages.md), [evidence.md](evidence.md) and [operations.md](operations.md). [state.md](state.md) describes the stores, card positions, queues and health records.

The diagrams are Graphviz files in [diagrams/](diagrams/). Agents read the `.dot` source. People see the `.svg` render. After you edit a `.dot` file, run `npm run diagrams` from `factory/`, or a test fails. It needs Graphviz installed. The colors mean the same in every diagram:

- Black arrows are the normal path, from left to right.
- Red dashed arrows are loops back.
- Grey dashed arrows end the flow early or leave it.
- Yellow boxes wait for people.

## Overview

The public files and votes on GitHub issues. The game's release, dev and candidate builds also report their errors, and each new error becomes a bug issue that needs no votes. Agents design, build and test the top ones. The committee plays each result in Telegram and approves it. Approved work collects on `dev` and ships as a release to `main` and itch.io. Hermes handles every failure.

![Overview](diagrams/overview.svg)

## Card lifecycle

A card is one GitHub issue on the Project board. Its column is the state. Every card runs the same stages. Testing gets a build ready for the committee to play. Hardening runs after they approve it, with the deep verification and the review. Hardening is slow, so it runs only on work the committee wants. Merging checks the approved cards merged together before the base takes them.

Each agent stage is one agent session that owns its stage. The agent runs the checks itself and fixes what it finds. Hard checks run only at five checkpoints: the diff guard on every commit and every push, the post checkpoint before a committee post, the merge checkpoint before the base takes a card, the release playtest before the candidate, and the ship checkpoint before `main` takes the release. A checkpoint failure goes back into the session that did the work, until the checks pass or the stage spent its budget, `FACTORY_TESTING_BUDGET_USD` or `FACTORY_MERGING_BUDGET_USD`. Everything else an agent writes, like the post text and its screenshots, is shown as written.

![Card lifecycle](diagrams/lifecycle.svg)

- A bug a collaborator labels `hotfix` skips Triage. Triage can also label a bug `hotfix`. Approve ships a hotfix at once.
- The error service opens an `error-report` bug for each new game error, at most `FACTORY_ERROR_DAILY_ISSUES` a day. Intake takes it into Triage with no votes. A later report of the same error from a new build comments on its issue, and reopens a fixed one when the build came after the fix. [operations.md](operations.md#error-reports) has the details.
- Triage labels a fix of an open release's feature `release-task`, until the release's candidate is posted. It runs on the release branch and ships with that release. New work stays on `dev` for the next release.
- A merged issue stays open with the label `release-candidate`. It closes when its release ships.

The loops:

- unclear and questions: the author gets questions and the label `needs-info`. The tick removes the label once someone answers on GitHub, or once `FACTORY_NEEDS_INFO_HOURS` pass with no answer. Triage then runs again. With no answer it picks the most sensible reading, and design writes each open question and its reading into the design comment as an assumption.
- plan wrong: the testing agent found that the plan itself contradicts the issue or the game docs, so no fix of the build can satisfy both. The card keeps its branch.
- patch: a small committee change. The card goes back to Testing, whose session takes the reply as its whole task.
- redesign: the committee reply changes the plan.
- removed from release: `remove #N` on the release candidate post.

Every other problem is fixed inside the stage that found it: a bug, a wrong look, a failed check, a review finding or a merge conflict.

The early ends:

- wont-do: triage or design refuses the request, and the issue closes.
- bundled: triage folds the issue into a lead, and it closes when the lead ships.
- Deny: the committee rejects the build, and the issue closes.

A branch that changes only Markdown docs cannot change the game, so it runs no testing or hardening session, and its post checkpoint only builds it. The merge checkpoint still checks it. A wiki page in `game/docs/wiki/` does not count as docs, since the game tests check its tables. [stages.md](stages.md#docs-changes) has the rules.

Screenshots never block a card. A card with no screenshot still runs the post checkpoint, and its approval post is text that says it has no screenshot. [evidence.md](evidence.md) has the rules.

A failed job never moves a card. A card stage that fails resumes once on the next tick in its own sessions, and its agent gets the error. A second failure labels the issue `factory-stuck`, and the card waits in its column until Hermes removes the label. An empty budget or a question for the committee labels it at once. A run that hits the Claude weekly usage limit pauses the factory instead, and its card takes no label.

A member or Hermes can hold one card with `factory pause-card N`, so its worker goes to other work, like release tasks. The hold stops the card's job and keeps its work clone and agent sessions. The card waits in its column with no label until `factory resume-card N`, and then the stopped stage continues where it stopped. [state.md](state.md) has the rules.

Every column change writes a card line to the ledger, named by its arrow in the diagram. The public dashboard reads these lines for its delivery numbers. [operations.md](operations.md#ledger-and-waste-review) lists the names.

Hermes can put a card in any position with `factory move`. The board column is the position, so a move changes the column and clears what the old position kept in the state. [state.md](state.md) lists the positions.

## Testing column

Testing is one job. The testing session merges the base, plays the build, fixes what it finds and writes the post text and its screenshots. Then the factory pushes the branch and runs the post checkpoint in a fresh clone: the typecheck, the playtest and the build. The full suite runs once, at the merge checkpoint. A failure goes back into the same session. A passing build is published and posted to the committee.

![Testing column](diagrams/testing.svg)

- A hotfix ships on approval, so its session first runs the hardening prompt, and its post checkpoint also runs the full suite. It never enters Hardening.
- Hermes can move a card to Approval with no testing. A checks job then builds the branch and posts it with no tests, and the post says so.

## Hardening and Merging columns

Approve moves a card to Hardening. The hardening session merges the base, attacks the change, runs `/code-review` and fixes every finding. No checks run there. Then the card moves to Merging.

A merge job takes every Merging card of one base at that moment. It merges them into a clone of the base, and the merge session resolves any conflict. The merge checkpoint runs the full suite, the typecheck, the playtest and the build on the result. A failure goes back into the merge session. The base takes only a result that passed. If the base moved during the checks, the job merges it in and checks again. A failed batch labels each of its cards `factory-stuck`.

![Hardening and Merging columns](diagrams/hardening.svg)

- A release cleanup task goes from Implementation straight to Hardening, since it merges with no post.
- `factory merge N` sends a card to Merging with no post and no hardening.

## Committee inputs

Members talk to the bot in the committee chat. The Hermes plugin turns commands into files in `$FACTORY_HOME/inbox`, and the next tick runs them before it starts jobs.

![Committee inputs](diagrams/committee.svg)

Hermes acts for a member with the member's Telegram id. A route or a task that Hermes gives on its own reading, like an incident task from the incident watch, carries `by` `hermes` and answers no chat message. The tick accepts `hermes` for a task and a route. Approve, deny, Ship, Remove and a change request need a member, and so do the button presses. The plugin still drops every message from a user outside the committee.

A reply that gets no route within `FACTORY_REPLY_ROUTE_MINUTES` becomes a failure with no issue, so Hermes sees it. Its text names the issue and tells Hermes to route the reply on its best reading. The card gets no stuck label.

A patch or a redesign queues when its text has at least `FACTORY_ROUTE_MIN_WORDS` words, so it names what to change. The plugin checks this for Hermes's route and for a member's `patch:` or `redesign:` reply. A shorter text queues nothing, and the plugin tells Hermes or the member why. Images never block a route.

- A member's Telegram images reach the agent best effort. The plugin copies each file of a reply to an approval post from Hermes's cache into `$FACTORY_HOME/inbox/media/post-<post>/`. A file it cannot copy leaves a note with the reason, and the plugin logs it.
- A patch or a redesign route moves the post's files into the issue's media folder. The tick checks each file with the rules of `src/media.ts`. The feedback comment lists each image by type, size and sha256, or as not available with the reason. The pixels never reach GitHub. An answer leaves the files for a later route. Approve, deny and a route delete the files of the closed post.
- An image that is missing, unreadable or on the issue but not downloadable is fetched once more. If it still fails, it is marked NOT AVAILABLE in the agent's prompt. The agent works from the text, writes down what it could not see and never describes an image it did not get. No stage stops for it.
- An image the agent lacks matters only when the text leaves a visual detail open. The agent then takes the most sensible reading of the text and writes it into the task file.
- `.factory/needs-committee.md` is for a game design fork or a major save bump only. An unclear plan, a missing image or a failing tool never justify it. The agent picks the most sensible reading and writes the assumption into the task file.

A reference that arrives while the card is in Design waits. The running design already read its images, so nothing interrupts it. The next stage reads every image on the issue again, and a member who needs the design to see it replies `redesign:` at the approval post.

## Branches

Every branch lives on GitHub. Each merge runs in a throwaway worktree and pushes at once. Steps that move several branches push them in one atomic push, so a failed push moves nothing.

Members, other jobs and releases push all the time, so any branch may move while a job runs. A moved branch never fails a job.

- An agent stage merges the new commits of its issue branch into the work before each push. When GitHub rejects the push because the branch moved again, it merges again and pushes again.
- A conflict with those commits goes to an agent in the same job. The agent keeps both sides, and the stage goes on. An unfinished merge fails the stage.
- Testing and Hardening also merge those commits and the base before their agent starts, so the session works on them. They take the base the way Design does, except that their own agent resolves a conflict. A retry gives an unfinished merge of the base or of the issue branch back to the agent. If the agent ends with the base merge unfinished, Testing counts it as a failed checkpoint and the same session finishes it within the stage budget. Hardening sends it back to the same session once, and fails the stage if the merge is still unfinished.
- Design does the same on the host before its agent starts, since the agent cannot fetch. A clean clone takes the base: a fast-forward, or a merge that keeps its own commits and its task files. It needs no issue branch on GitHub. A clone with uncommitted changes stays as it is, and the agent is told it may lack recent base work. A conflict goes to an agent in the same job, never to the author, and a retry gives that unfinished merge to an agent again. Any other unfinished merge fails the stage for `factory repair-clone`.
- The merge queue moves `dev` or the release only with a result its checks passed. A base that moved meanwhile is merged in and checked again.
- A merge into `main` or the release that GitHub rejects because a target moved runs again on the new tips.
- A conflict between whole branches never stops the factory. It covers the release cut, the hotfix fan-out and the reverts of Remove. Ship resolves its own conflict in its session. The step keeps the conflicted merge in a work clone of the target, and an agent resolves it with `prompts/merge-branches.md`, or `prompts/revert-merge.md` for a revert. The factory checks that the commit finished the merge and that the agent's own changes pass the diff checks. Then the step pushes as before. A target that moved meanwhile gets the merge again, and a new agent round only if that conflicts too. A hotfix that conflicts with `main` at approve goes back to Testing.

![Branches](diagrams/branches.svg)

- The release cut merges `main` into `dev` first when `dev` lacks any of it. It opens a tracking issue labeled `release` and two cleanup tasks. `lastRelease` changes only when the cut succeeds or finds nothing new, so a failed cut runs again on the next tick.
- Ship merges the release into a work clone of `main` once, and the ship session resolves any conflict. The ship checkpoint runs the full suite, the typecheck, the playtest and the build on the result. A failure goes back into the ship session, until the checks pass or it spent `FACTORY_MERGING_BUDGET_USD`. A spent budget fails Ship, and Hermes asks a member. Then Ship pushes `main`, merges `main` into `dev`, builds `main` and pushes it to itch.io.
- A hotfix merges its branch into `main`, and `main` into `dev`, in one push. Then it ships like a release. The open release stays as it is and meets the fix at its Ship.
- Remove reverts a feature's merge in both `dev` and the release, and sends its issue back to Design.

## Release

![Release](diagrams/release.svg)

The playtest is one job, after every release task merged and before the candidate. It plays one seed of the progression harness on the release head and on a baseline: the last commit the release passed, or `main` where the release branched off it. An Opus agent reviews the logs and sorts each finding as caused by the release or old. It fixes the release's important findings in its clone, and the factory replays the seed on the fixes in the same agent session. A clean play passes its commit, after the factory checks for any fixes, which then land on the release. An important old finding opens a bug issue for `dev` and does not block. A blocked verdict or the play limit blocks the release for a member. [stages.md](stages.md#release-playtest) has the rules.

The release stays put after its cut. Only its release tasks, the playtest fixes and Remove change it, and nothing from `main` enters it until Ship. Each of these moves drops the Ship button of the current post, and the playtest plays the new head in full. The candidate builds only the commit the playtest passed, and its post records it. A reply can open a release task while a candidate builds. That candidate lacks the task, so it is not posted.

## Side jobs

These jobs run beside the cards.

- change: a factory change from `/change`, Hermes or the waste review. The agent runs up:make in hands-off mode on a clone of `main`, may edit any file in the repo and the factory opens a pull request. A member merges it.
- adhoc: one-off work a member asks Hermes for. The agent runs in a clone of `dev`, pushes nothing and replies with a report and files.
- incident: after a shipped fix of a `bug` issue or a hotfix. The agent judges the bug against the bar in `docs/incident-log.md` and may add an entry to `dev`.
- waste: every `FACTORY_WASTE_REVIEW_DAYS`. The agent reads the ledger numbers beside the period before and names one bottleneck. Hermes gets it and tells the committee only what matters.
- dev: rebuilds `/dev/` when `dev` moved past its build.

## Tick and queues

A timer runs one tick at a time. A tick never waits for a job. Each job runs as its own process. Check jobs kills a job past its time limit, and resumes a dead job once.

![One tick](diagrams/tick.svg)

Jobs pick in this order. A job starts when its queue has a free worker and no other job works on its issue.

1. Branch jobs: every queued approve, remove, ship and incident, then the merge queue, a stale `/dev/`, the release cut, and the release playtest or the candidate. The playtest runs in the verify queue.
2. The waste review, when due.
3. Card jobs: hotfixes, ad hoc tasks, factory changes, release tasks, then other cards. Within each, the card furthest along goes first.

A held card gets no job of any kind, and its queued approval waits while the next one runs.

Queues:

- triage: triage and the waste review.
- design: design.
- implement: implementation, ad hoc and change.
- verify: testing, hardening and the release playtest.
- test: the post with no checks.
- branch: approve, merge, remove, ship, incident, release cut, candidate and dev, side by side. A job never runs twice at once, and Ship and Remove never run together, since both change the release.
