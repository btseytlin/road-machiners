# Radio text styling and handoff to ink

**Status:** done
**Branch:** ink-quests-347
**Worktree:** .worktrees/ink-quests-347
**Goal:** Radio lines render with the quest text markup and reveal, every radio line passes the markup check, and the Army wagon driver can hand the talk over to an ink quest that opens in the talk window. Confirmed by tests, the quest check, a browser check and the playtest.
**Mode:** hands-off

## Context

- Stage 3 of 4 in `docs/tasks/ink-quest-engine.md`. The radio keeps its own engine in `game/src/sim/dialogue.ts`.
- `DialoguePanel.render()` in `game/src/ui/dialogue.ts` rebuilds the panel on every HUD render and prints the line as plain text.
- Every command clones the world, so object identity of a radio line or a quest's live state changes on any command.
- A radio option's `go` is a node, `hub` or `end`.

## Design

- The radio panel renders the current line through `renderLine()`. It redraws only when the call or its line changes, so the reveal plays once.
- A test runs `markupProblems()` over every radio line, with the call values filled by placeholders.
- A radio option hands off with `go: questGo(id)`. The engine runs the option's effects, ends the call, and starts the quest at its `start` checkpoint in the same command. A test checks that every handoff names a quest with a `start` checkpoint.
- The Army wagon driver gets a handoff: an ink quest, `radio_wagon_driver`, where the player asks the driver more about the wreck and the raiders.
- Lines may carry `# speaker: <name>`. The talk window shows it before the line.
- The talk window compares the live state by content, not identity.

TDD: yes for the handoff and the markup test.

### Invariants
- IV1 — A handoff leaves no open call and an open quest session in one command.
- IV2 — Every radio line passes the markup check.
- IV3 — A radio line reveals once per line, not once per HUD render.

## Verify

Result: passed

- CK1 (IV1) — the wagon driver's handoff ends the call, opens `radio_wagon_driver`, keeps the journal note and settles the topic in one command — held, `src/sim/dialogue.test.ts`, and in the browser with `game/tmp/radio-check.mjs`.
- CK2 (IV2) — every radio line, ask and option passes the markup check — held, `src/ui/dialogue.test.ts` over more than 100 lines.
- CK3 (IV3) — the radio panel keys its drawing on the call and its options, so a HUD render with the same call keeps the reveal — held, screenshots 1 and 2 in `game/tmp/radio/`.
- CK4 — the log shows no markup — held, browser check.
- CK5 — `npm run quests:check` walks the driver quest both ways on `searched()` — held.

## Conclusion

Outcome: radio lines share the quest text, and the wagon driver hands over to an ink quest in the talk window.

### Deviations from plan
- The talk window now compares the live state by its ink text, since every command clones the world.
