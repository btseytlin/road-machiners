# Playtest CPU mode

Status: planning
Branch: game-factory
Worktree: .worktrees/game-factory
Goal: npm run playtest in CPU mode passes on a GPU-less server, and the default mode still checks FPS on the Mac.
Mode: hands-off

## Context

- Part of the [game factory](game-factory.md). Its Design and Plan cover this part, so each contract has one home.
- The CPU server draws in software, at 10 to 20 fps.
- `scripts/playtest.mjs` launches Chromium with Metal flags and fails under `MIN_FPS`.
- The CPU mode skips the FPS check and the Metal flags. It still fails on page errors and the crash screen.
- Perf checks stay a manual job on the user's Mac.

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
