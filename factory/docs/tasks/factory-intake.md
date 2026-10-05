# Factory intake

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: A voted, aged issue labeled feature-request or bug appears in the design column of the kanban, and an unvoted one does not.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- Issues with the label `feature-request` or `bug` are candidates.
- A candidate is marked for work once it has aged enough and has either the threshold of thumbs-up from anyone or one thumbs-up from a committee member.
- The threshold, the aging time and the committee GitHub names live in `.env`.
- Marked tasks go into a GitHub Project kanban with columns design, implementation, testing, approval and done.
- Hermes polls GitHub on a cron job.
- Votes can be faked. The user accepts this.

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
