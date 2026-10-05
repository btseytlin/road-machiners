# Factory build stage

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: A card with an approved plan gets a pushed task branch whose tests and CPU playtest pass, and moves to approval.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- Sonnet 5.5 implements the plan on the task branch, as Claude Code in headless mode.
- It runs `npm test`, `npm run quality` and the playtest in CPU mode, then pushes.
- Implementation and testing are separate kanban columns.
- The quality hook applies. The agent must not bypass it, add suppressions or raise limits.
- A plan that turns out to need a major save bump stops and asks the committee.
- A failed stage posts to the committee chat and stops.

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
