# Factory hosting

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: A pushed task branch plays at /{hash} on the server, dev plays at /dev, and each keeps its own save.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- The server serves `/dev` and `/{hash}` as static files. Stable lives on itch.io.
- The Vite base is already relative, so a build runs from any folder.
- A deploy step builds the branch and copies it to `/{hash}`. It holds its own credentials, apart from the agents.
- After each merge to `dev`, `dev` redeploys to `/dev`.
- All server paths share one browser storage, so each path needs its own save key. Today the save key is `roam.save` in `src/three/save.ts`.
- The itch build keeps `roam.save`, so current players keep their saves.
- Tips and sound settings stay shared across paths.
- The domain is not chosen yet. It lives in `.env`.
- Old `/{hash}` builds need a cleanup rule.

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
