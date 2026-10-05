# Factory process

This file is the spec of how the factory works. Each diagram matches the code, and a change to the process updates its diagram in the same commit. The rules behind each step are in [stages.md](stages.md), [evidence.md](evidence.md) and [operations.md](operations.md).

## Overview

The public files and votes on GitHub issues. Agents design, build and test the top ones. The committee plays each result in Telegram and approves it. Approved work collects on `dev`, ships as a weekly release to `main` and itch.io, and Hermes handles every failure.

```mermaid
flowchart LR
  public([Public]) -->|issue + votes| intake[Intake]
  intake --> board[[Card stages<br>Triage → Design → Implementation → Testing]]
  board -->|build + post| committee([Committee in Telegram])
  committee -->|Approve| dev[(dev)]
  dev -->|weekly cut| release[(release/day)]
  release -->|candidate post| committee
  committee -->|Ship| main[(main)]
  main --> itch([itch.io + public channel])
  committee -->|/change| change[Factory change PR] -->|member merges| main
  board -. failure .-> hermes[Hermes]
  hermes -. fix or ask .-> committee
```

## Card lifecycle

A card is one GitHub issue on the Project board. Its column is the state. A card passes Testing twice: a quick preview before the committee plays it, and a full hardening after they approve it.

Black arrows are the normal path. Red dotted arrows are the loops back. Yellow steps wait for people.

```mermaid
flowchart TB
  T[Triage] --> D[Design] --> I[Implementation] --> P[Testing<br>preview] --> A[Approval<br>committee plays] --> H[Testing<br>harden] --> G[Merge into dev] --> M[Done]
  T -.->|unclear| W([Author answers<br>on GitHub])
  D -.->|questions| W
  W -.-> T
  P -.->|rebuild| I
  P -.->|plan wrong| D
  A -.->|patch| I
  A -.->|redesign| D
  H -.->|review fails twice| D
  G -.->|conflict| H
  M -.->|removed from release| D
  A:::human
  W:::human
  classDef human fill:#fde68a,stroke:#b45309
  linkStyle 7,8,9,10,11,12,13,14,15,16 stroke:#dc2626,color:#dc2626
```

- A hotfix skips Triage. It runs preview and harden before its post, and Approve ships it at once.
- A merged issue stays open with the label `release-candidate`. It closes when its release ships.

### The loops

- unclear and questions: the author gets questions and the label `needs-info`. The tick removes the label once someone answers on GitHub, and triage runs again.
- rebuild and plan wrong: the visual review found the look wrong. The card keeps its branch.
- patch: a small committee change. The patch goes straight to the checks, with no testing agent. A patch that finds the plan must change goes to Design.
- redesign: the committee reply changes the plan.
- review fails twice: the code review blocked the change after one fix round. The approval is dropped, so the new build gets a new post.
- conflict: `dev` moved on since testing. The approval is kept, and hardening runs again.
- removed from release: `remove #N` on the release candidate post.

### How a card ends early

- Triage or Design → Done: the request is wont-do, and the issue closes.
- Triage → Done: the issue is bundled into a lead and closes when the lead ships.
- Approval → Done: the committee presses Deny, and the issue closes.

A failed job never moves a card. It labels the issue `factory-stuck`, and the card waits in its column until Hermes removes the label.

## Testing column

Testing is two jobs. Verify runs the testing agent in the verify queue. Checks runs the machine checks with no agent in the test queue. The `testPhase` entry of the card in the state file says which job runs next.

```mermaid
flowchart TD
  enter([Card enters Testing]) --> phase{testPhase}
  phase -->|none| merge[Verify: merge the base into the branch]
  merge --> mode{mode}
  mode -->|preview: not approved yet| test[Test round: play, fix blockers, capture evidence]
  mode -->|harden: approved, or cleanup task| harden[Harden round: up:uverify, up:ureview, nitpicks, cost]
  mode -->|full: hotfix| harden
  harden --> review{/code-review on the design model}
  review -->|PASS| afterReview{mode}
  review -->|FAIL| fix1[Review-fix round] --> review2{/code-review again}
  review2 -->|PASS| afterReview
  review2 -->|FAIL| design([Design, approval dropped])
  afterReview -->|full| test
  afterReview -->|harden| setChecks
  test --> visual{visual review}
  visual -->|pass, or nothing visible| setChecks[testPhase = checks]
  visual -->|rebuild| impl([Implementation])
  visual -->|plan| design
  phase -->|checks or checks-after-fix| checks
  setChecks --> checks[Checks: tests, typecheck, playtest, build]
  checks -->|only timeouts, under 3 runs| checks
  checks -->|pass, approved| queue[Publish build, move to Approval, queue merge]
  checks -->|pass, not approved| post[Publish build, post to committee, move to Approval]
  checks -->|first failure| fixPhase[testPhase = fix]
  fixPhase --> fix2[Verify: check-fix round] --> after[testPhase = checks-after-fix] --> checks
  checks -->|failure after the fix| stuck([factory-stuck])
```

Limits:

- A card gets one review-fix round per hardening, and one trip back to Design for the review. A second review redesign fails the stage.
- A card gets two visual send-backs. A third fails the stage.
- A check failure gets one fix round. A second failure fails the stage.
- Checks that fail only on timeouts run up to 3 times with no agent.

## Committee inputs

Members talk to the bot in the committee chat. The Hermes plugin turns commands into files in `$FACTORY_HOME/inbox`, and the next tick runs them before it starts jobs.

```mermaid
flowchart LR
  subgraph Telegram
    approve[Approve button or 'approve' reply]
    deny[Deny button]
    reply[Other reply to an approval post]
    forced['patch:' or 'redesign:' reply]
    ship[Ship button or 'ship' reply]
    remove['remove #N' reply]
    rtask[Other reply to a candidate post]
    changeCmd['/change' or Queue as change button]
    ask[Message to Hermes]
  end
  approve --> pa[pendingApprovals] --> approveJob[approve job]
  deny --> closed[Issue closed as wont-do]
  reply --> hermes{Hermes routes} -->|answer| answer[Answer in chat, card stays]
  hermes -->|patch| patching[patching] --> patchJob[patch job]
  hermes -->|redesign| toDesign[Card to Design]
  forced --> patching
  forced --> toDesign
  ship --> ps[pendingShip] --> shipJob[ship job]
  remove --> pr[pendingRemovals] --> removeJob[remove job]
  rtask --> newIssue[New release-task issue in Design]
  changeCmd --> pc[pendingChanges] --> changeJob[change job]
  ask -->|factory_queue_task| adhoc[adhoc issue in Implementation] --> adhocJob[adhoc job]
  ask -->|factory_queue_change| pc
```

A reply that gets no route within `FACTORY_REPLY_ROUTE_MINUTES` becomes a failure, so Hermes sees it.

## Branches and releases

Every branch lives on GitHub. Each merge runs in a throwaway worktree and pushes at once. Steps that move several branches push them in one atomic push, so a conflict moves nothing.

```mermaid
flowchart LR
  issueBr[factory/issue-N] -->|approve| dev[(dev)]
  hotfixBr[factory/issue-N from main] -->|hotfix approve| main[(main)]
  dev -->|release cut| rel[(release/day)]
  taskBr[factory/issue-N of a release task] -->|approve| rel
  rel -->|ship| main
  main -->|ship and hotfix| dev
  main -->|hotfix| rel
  changeBr[factory-change/id from main] -->|member merges the PR| main
```

- The release cut merges `main` into `dev` first when `dev` lacks any of it. It opens a tracking issue labeled `release` and two cleanup tasks.
- Ship merges `main` into the release, the release into `main` and `main` into `dev` in one push. Then it builds `main` and pushes it to itch.io.
- A hotfix merges its branch into `main`, and `main` into `dev` and the open release, in one push. Then it ships like a release.
- Remove reverts a feature's merge in both `dev` and the release, and sends its issue back to Design.

## Release

```mermaid
stateDiagram-v2
  [*] --> Open: release cut every FACTORY_RELEASE_DAYS
  Open --> Tasks: cleanup and release tasks run the card stages
  Tasks --> Candidate: no release task open
  Candidate --> Posted: build /rc/, post with Ship button
  Posted --> Candidate: remove #N, new release task or merged work
  Posted --> Shipped: Ship
  Shipped --> [*]
```

Every merge into the release drops the Ship button of the current post. A build that finds a new release task is not posted.

## Side jobs

These jobs run beside the cards.

- change: a factory change from `/change`, Hermes or the waste review. The agent runs up:make in hands-off mode on a clone of `main`, edits only `factory/` and the factory opens a pull request. A member merges it.
- adhoc: one-off work a member asks Hermes for. The agent runs in a clone of `dev`, pushes nothing and replies with a report and files.
- incident: after a shipped fix of a `bug` issue or a hotfix. The agent judges the bug against the bar in `docs/incident-log.md` and may add an entry to `dev`.
- waste: every `FACTORY_WASTE_REVIEW_DAYS`. The agent reads the ledger numbers and posts one bottleneck with a "Queue as change" button.
- dev: rebuilds `/dev/` when `dev` moved past its build.

## Tick and queues

A timer runs one tick at a time. A tick never waits for a job. Each job runs as its own process.

```mermaid
flowchart TD
  start([tick]) --> health[Write health file]
  health --> pausedQ{paused?}
  pausedQ -->|yes| stop([skip])
  pausedQ -->|no| inbox[Run inbox commands]
  inbox --> jobs[Check running jobs: timeout kills, a death resumes once]
  jobs --> intake[Intake marked issues]
  intake --> clean[Clean old builds, clones and logs]
  clean --> disk{free disk ok?}
  disk -->|no| stop
  disk -->|yes| pick[Pick jobs in priority order]
  pick --> spawn[Start each job that fits its queue]
```

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
