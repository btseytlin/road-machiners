# First full text quest: the depot leak

**Status:** done
**Branch:** ink-quests-347
**Worktree:** .worktrees/ink-quests-347
**Goal:** A Space Rangers style text quest runs in the talk window with its own numbers, several endings and real money, and its outcome changes other quests. The checker walks every ending, including branches that depend on what another quest decided, in under a minute. Confirmed by tests, the quest check, a browser check and the playtest.
**Mode:** hands-off

## Context

- Stage 4 of 4 in `docs/tasks/ink-quest-engine.md`.
- The checker read game queries from a new game only, so branches on them and on other quests' outcomes went unwalked.
- Kovac's hub mixes with any story placed inside it, which multiplies the checker's states.

## Design

- `nose_depot_leak.ink` is its own quest. Kovac starts it through a new effect, `begin(quest)`, which opens the next quest once the current one ends.
- Numbers: watches, evidence and alarm as quest variables, and money through `money()` and a new effect, `pay(amount)`.
- Five endings: caught, wrong man, bought, trail lost and too late. The world variable `depot_thief` keeps the outcome for Kovac and Ibo.
- The build rejects flow that reads ink's visit counts, since a load resets them. The checker then merges states without visit counts.
- The checker adds a world for each value a quest assigns to a world variable.

TDD: yes for `pay`, `begin` and the compile rule.

### Invariants
- IV1 — Every ending is reached by the checker.
- IV2 — Effects run only after a choice.
- IV3 — No quest flow depends on ink's visit counts.

## Verify

Result: passed

- CK1 (IV1) — `npm run quests:check` walks 8 quests, the depot quest in thousands of states over 7 worlds, with no problem, in 13 seconds.
- CK2 — the caught path pays 150 M, the bought path 60 M, the trader lead costs 20 M only with the money in hand, and the wrong man pays nothing — held, `src/sim/locals.test.ts`.
- CK3 — after the caught ending Kovac greets differently, drops the job and Ibo talks about Vance — held, test and browser screenshot `game/tmp/depot/5-kovac-after.png`.
- CK4 (IV3) — a `*` choice, a `{knot}` read and `TURNS_SINCE` each fail the build with their line — held, `src/test/quest-compile.test.ts`.
- CK5 — `begin` not followed by the end throws — held, `src/sim/quests.test.ts`.
- CK6 — a branch on another quest's world variable is walked — held, `src/test/quest-check.test.ts`.
- CK7 — a `<pop>` word kept its space, and the status line says "1 watch" — broke at first in the browser, fixed in CSS and ink.

## Conclusion

Outcome: the depot leak plays end to end in the talk window and pays real money, and the checker covers it.

### Deviations from plan
- Dropping obstacles from the check worlds cut a step's clone from 3 ms to 0.3 ms. Without it the check took 81 seconds.

### Hands-off decisions
- udesign: the quest sits at Nose with Kovac, since it needs no travel and fits the Army post.
- udesign: rewards are 150 M for the thief, 60 M for the bribe and 20 M for a lead, near a mid board contract.
- uexecute: once-only choices and visit count reads became build errors. They already broke after a load, and banning them let the checker drop visit counts from its state.
