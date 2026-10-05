# Factory release

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: Every release period, dev merges to main, npm run itch ships it, and the public channel gets a changelog post.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- Every configured number of days, a changelog is compiled from `dev` against `main`.
- `dev` merges to `main`.
- Stable deploys to itch.io with the existing `npm run itch`. See [Publishing](../publishing.md).
- One screenshot, a short description and the changelog go to the public Telegram channel.
- The release period lives in `.env`.

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
