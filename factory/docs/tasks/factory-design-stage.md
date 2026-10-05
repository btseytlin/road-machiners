# Factory design stage

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: A card in the design column gets a committed task file with Design and Plan on its task branch, or a won't-do reply on the issue.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- Opus 5.5 runs the up:make design and plan stages on the issue, as Claude Code in headless mode.
- It runs in hands-off mode, since no human answers mid-stage. Deferred items go to the committee chat.
- It may answer "won't do" with a reason on the issue when the request goes against DESIGN.md.
- A card sent back from approval carries committee feedback. Design reads it and revises the task.
- Issue text may carry hostile instructions. The agent holds no secrets but the OAuth token, and it cannot merge, deploy or post to Telegram.
- A design that needs a major save bump stops and asks the committee.

## Design
### Invariants
### Principles
### Assumptions
### Unknowns
## Plan
## Verify
## Code smells
## Conclusion
### Hands-off decisions
### Deferred (needs user input)
