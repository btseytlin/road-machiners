# The full game suite runs once per card, right before its merge

**Status:** done
**Superseded by:** [trusted-agent-flow.md](trusted-agent-flow.md). Its merge checkpoint runs the full suite once on the merged batch and fixes failures within a dollar budget.
**Branch:** none yet
**Worktree:** none
**Goal:** A card runs the full game suite once, on the card merged with its current base, before it merges. A failure loops through fix rounds until it passes or reaches the configured round limit.
**Mode:** interactive

## Context
- From 2026-10-02 to 2026-10-08, cards ran 3 to 4 full suite runs each, up to 13. [suite-reruns.md](suite-reruns.md) has the numbers.
- 45 of 353 suite runs failed on test files that the card's agents had not run, so the suite stays as a gate.
- A clean merge into dev runs no tests today. A conflicted merge reruns the whole suite.
- A check failure gets one fix round, and a second failure makes the card stuck.

## Design
Decided with the user on 2026-10-08:
- The committee preview runs typecheck, playtest and build, with no suite.
- Hardening and patches run no checks of their own.
- The full suite, through the test cache, runs once right before the merge, on the card merged with its current base. It runs as a checks job in the test queue, and approve merges only the commit it passed.
- A failure goes to a fix agent, and the gate runs again. `FACTORY_CHECK_FIX_ROUNDS=5` in `settings.env` sets how many fix rounds a card gets before it goes to Hermes as stuck.
- This task starts after the test cache from [suite-reruns.md](suite-reruns.md) merges.
