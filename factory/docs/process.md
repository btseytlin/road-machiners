# Factory process

This file is the spec of how the factory works. Each diagram matches the code, and a change to the process updates its diagram in the same commit. The rules behind each step are in [stages.md](stages.md), [evidence.md](evidence.md) and [operations.md](operations.md). [state.md](state.md) describes the stores, card positions, queues and health records.

The diagrams are Graphviz files in [diagrams/](diagrams/). Agents read the `.dot` source. People see the `.svg` render. After you edit a `.dot` file, run `npm run diagrams` from `factory/`, or a test fails. It needs Graphviz installed. The colors mean the same in every diagram:

- Black arrows are the normal path, from left to right.
- Red dashed arrows are loops back.
- Grey dashed arrows end the flow early or leave it.
- Yellow boxes wait for people.

## Overview

The public files and votes on GitHub issues. Agents design, build and test the top ones. The committee plays each result in Telegram and approves it. Approved work collects on `dev` and ships as a release to `main` and itch.io. Hermes handles every failure.

![Overview](diagrams/overview.svg)

## Card lifecycle

A card is one GitHub issue on the Project board. Its column is the state. A card passes Testing twice: a quick preview before the committee plays it, and a full hardening after they approve it. Hardening is slow, so it runs only on work the committee wants.

![Card lifecycle](diagrams/lifecycle.svg)

- A bug a collaborator labels `hotfix` skips Triage. Triage can also label a bug `hotfix`. Approve ships a hotfix at once.
- A merged issue stays open with the label `release-candidate`. It closes when its release ships.

The loops:

- unclear and questions: the author gets questions and the label `needs-info`. The tick removes the label once someone answers on GitHub, and triage runs again.
- rebuild: the visual review found a shape, state or behavior that needs new code. The card keeps its branch.
- plan wrong: the visual review found the plan contradicts the issue or the game docs. The card keeps its branch.
- patch: a small committee change. The patch goes straight to the checks, with no testing agent. A patch that finds the plan must change goes to Design.
- redesign: the committee reply changes the plan.
- review fails twice: the code review blocked the change after one fix round. The approval is dropped, so the new build gets a new post.
- conflict: `dev` moved on since testing. The approval is kept, and hardening runs again.
- removed from release: `remove #N` on the release candidate post.

The early ends:

- wont-do: triage or design refuses the request, and the issue closes.
- bundled: triage folds the issue into a lead, and it closes when the lead ships.
- Deny: the committee rejects the build, and the issue closes.

Screenshots never block a card. A card with no screenshot still runs verify and the checks, and its approval post is text that says it has no screenshot. [evidence.md](evidence.md) has the rules.

A failed job never moves a card. It labels the issue `factory-stuck`, and the card waits in its column until Hermes removes the label.

Hermes can put a card in any position with `factory move`. The move clears the state of the old position, so every store agrees on the new one. [state.md](state.md) lists the positions.

## Testing column

Testing is two jobs. Verify runs the testing agent. Checks runs the machine checks with no agent. A third phase, post, builds and posts the branch with no tests. Only Hermes starts it, when it moves a card to Approval.

![Testing column](diagrams/testing.svg)

- A hotfix runs the harden line and then the preview test round before its post, since Approve ships it at once.
- A release cleanup task runs only the harden line, since it merges with no post.
- The visual review sends a card back at most twice. A third send-back fails the stage.
- A card that the review already sent to Design once fails the stage on its next second FAIL.

## Committee inputs

Members talk to the bot in the committee chat. The Hermes plugin turns commands into files in `$FACTORY_HOME/inbox`, and the next tick runs them before it starts jobs.

![Committee inputs](diagrams/committee.svg)

A reply that gets no route within `FACTORY_REPLY_ROUTE_MINUTES` becomes a failure, so Hermes sees it.

A patch or a redesign queues when its text has at least `FACTORY_ROUTE_MIN_WORDS` words, so it names what to change. The plugin checks this for Hermes's route and for a member's `patch:` or `redesign:` reply. A shorter text queues nothing, and the plugin tells Hermes or the member why. Images never block a route.

- A member's Telegram images reach the agent best effort. The plugin copies each file of a reply to an approval post from Hermes's cache into `$FACTORY_HOME/inbox/media/post-<post>/`. A file it cannot copy leaves a note with the reason, and the plugin logs it.
- A patch or a redesign route moves the post's files into the issue's media folder. The tick checks each file with the rules of `src/media.ts`. The feedback comment lists each image by type, size and sha256, or as not available with the reason. The pixels never reach GitHub. An answer leaves the files for a later route. Approve, deny and a route delete the files of the closed post.
- An image that is missing, unreadable or on the issue but not downloadable is marked NOT AVAILABLE in the agent's prompt. The agent works from the text and never describes an image it did not get. The patch runs on in that case, and the other stages still stop.
- An image the agent lacks matters only when the text leaves a visual detail open. Hermes then routes answer and asks the member for the detail in words. The patch agent writes `.factory/needs-committee.md`.

A reference that arrives while the card is in Design waits. The running design already read its images, so nothing interrupts it. The next stage reads every image on the issue again, and a member who needs the design to see it replies `redesign:` at the approval post.

## Branches

Every branch lives on GitHub. Each merge runs in a throwaway worktree and pushes at once. Steps that move several branches push them in one atomic push, so a conflict moves nothing.

![Branches](diagrams/branches.svg)

- The release cut merges `main` into `dev` first when `dev` lacks any of it. It opens a tracking issue labeled `release` and two cleanup tasks.
- Ship merges `main` into the release, the release into `main` and `main` into `dev` in one push. Then it builds `main` and pushes it to itch.io.
- A hotfix merges its branch into `main`, and `main` into `dev` and the open release, in one push. Then it ships like a release.
- Remove reverts a feature's merge in both `dev` and the release, and sends its issue back to Design.

## Release

![Release](diagrams/release.svg)

Every merge into the release drops the Ship button of the current post. A reply can open a release task while a candidate builds. That candidate lacks the task, so it is not posted.

## Side jobs

These jobs run beside the cards.

- change: a factory change from `/change`, Hermes or the waste review. The agent runs up:make in hands-off mode on a clone of `main`, may edit any file in the repo and the factory opens a pull request. A member merges it.
- adhoc: one-off work a member asks Hermes for. The agent runs in a clone of `dev`, pushes nothing and replies with a report and files.
- incident: after a shipped fix of a `bug` issue or a hotfix. The agent judges the bug against the bar in `docs/incident-log.md` and may add an entry to `dev`.
- waste: every `FACTORY_WASTE_REVIEW_DAYS`. The agent reads the ledger numbers and posts one bottleneck with a "Queue as change" button.
- dev: rebuilds `/dev/` when `dev` moved past its build.

## Tick and queues

A timer runs one tick at a time. A tick never waits for a job. Each job runs as its own process. Check jobs kills a job past its time limit, and resumes a dead job once.

![One tick](diagrams/tick.svg)

Jobs pick in this order. A job starts when its queue has a free worker and no other job works on its issue.

1. Branch jobs: queued approve, remove, ship, incident, then a stale `/dev/`, the release cut and the candidate.
2. The waste review, when due.
3. Card jobs: hotfixes, ad hoc tasks, factory changes, release tasks, then other cards. Within each, the card furthest along goes first.

Queues:

- triage: triage and the waste review.
- design: design.
- implement: implementation, patch, ad hoc and change.
- verify: the testing agent.
- test: the checks.
- branch: approve, remove, ship, incident, release cut, candidate and dev, one at a time.
