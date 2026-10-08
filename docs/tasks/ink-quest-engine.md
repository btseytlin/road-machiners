# Ink quest engine core

**Status:** executing
**Branch:** ink-quest-engine (from dev)
**Worktree:** .worktrees/ink-quest-engine
**Goal:** From the terminal, a person or agent plays a sample quest, saves mid-quest, edits the quest script inside the current section, loads, and resumes at the last checkpoint with the variables kept. A second sample quest branches on a variable the first one set. `npm run quests:check` fails on planted script errors and passes on the samples.
**Mode:** hands-off

## Context

- Talk runs on two hand-coded TypeScript systems: radio calls (`game/src/data/dialogue.ts`, `game/src/sim/dialogue-rules.ts`) and the #347 town locals (`game/src/data/locals.ts` on `factory/issue-347`). Neither has variables, styled text or a checker, and neither can host a text quest.
- The radio keeps its own engine. Its topics are 1-3 nodes over about 100 TypeScript rules that live inside the turn, and it needs memory per driver.
- inkjs 2.4.0 (MIT) compiles and runs ink in Node. A file handler resolves `INCLUDE`. Variables can be set before a story starts. Knot and stitch tags are readable from the compiled story with `TagsForContentAtPath()`.
- ink's raw state keys choices and visit counts by position, like `bowl.0.hub.c-0`. In a test, one inserted choice made an old state load with no error, play the wrong answer, and read a labelled choice taken at Bowl as never taken.
- `story.state.currentPathString` is null while choices wait, so the runtime cannot tell from the pointer which section the player is in.
- Saves follow `game/docs/architecture/saves.md`: `MIGRATIONS` steps per minor format, `save-shape.json` guarding the shape, and an autosave after each command in town. Load rebuilds derived state.

## Design

The quest system for issue #347 is built in four stages. This file covers stage 1.

1. Engine core: the quest runner, quest state in saves with migration, the terminal player and the quest checker. No in-game UI.
2. Talk window: the text renderer with styling and reveal effects, wired into the town People tab. The #347 locals and the wagon clue chain move into ink.
3. Radio: radio lines get the same text styling, and a radio topic can hand off to an ink quest. The radio keeps its own engine.
4. First full text quest in the Space Rangers style, with its own numbers and endings.

### Content and build

- Quests are `.ink` files in `game/src/data/quests/`, one compiled story per quest. `world.ink` declares the shared world variables and every `EXTERNAL` function, and every quest includes it. Variables a quest declares itself belong to that quest.
- Saved variables are int, float, bool or string. Lists and divert values are rejected by the checker.
- `npm run quests:build` compiles each quest to checked-in JSON plus a manifest: variables with types and initial values, checkpoints and externals. A test fails when the JSON is stale, as `models:shapes` does.

### State

- `World.quests` holds the saved part: `world` and `local[questId]` variable maps, and `session: { quest, checkpoint, seed } | null`. A variable is stored only while its value differs from its declaration, so a new variable or a changed default reaches old saves the way a new game gets it.
- ink's raw state is derived. It sits in `World.quests.live`, which `saveOf()` skips, as it skips events.
- Commands go through `update()`. `startQuest(world, quest, entry)` builds a story, injects the stored variables, seeds it from the world's random stream and enters the entry. `chooseQuestOption(world, index)` loads `live`, picks, continues and writes `live` and the changed variables back. A query returns the current lines with their tags and the current choices.
- Load with an open session rebuilds the story from the stored variables and seed and enters the saved checkpoint.

### Checkpoints

- A checkpoint is a knot or stitch whose first tag is `# checkpoint: <knot.stitch>`. Every quest entry is a checkpoint.
- The runner records the name from the tag when that line plays. The checker verifies that each tag names its own container.
- ink visit counts and used-up choices reset when a session restarts at a checkpoint. A fact that must last lives in a variable.

### Effects and queries

- `EXTERNAL` functions map to typed TypeScript records in sim, as `CONDITIONS` and `EFFECTS` do in `dialogue-rules.ts`. Queries read the world. Effects change the draft world through the existing owners and are bound with `lookaheadSafe` false.
- Task 1 ships only what the sample quests use. Game state like money is read through queries and never copied into ink variables.

### Saves and migration

- A renamed, removed or retyped saved variable or checkpoint is a save-shape change. `save-shape.json` records every quest's saved variable names and types and its checkpoints, and `npm run save:shape` writes them.
- A `MIGRATIONS` step uses pure helpers in `save-migrations.ts` to rename or drop a quest variable and to move or end a session. A new variable or checkpoint needs no step.
- Load raises a `SaveError` on a stored quest, variable or checkpoint the content does not declare, which leads to the rescue screen.

### Headless tools

- `npm run quest -- <quest> [--entry <checkpoint>] [--picks 0,2,1] [--set name=value]` plays a quest on a new-game world. It prints lines with tags, numbered choices, effects and final variables. It reads picks from stdin when `--picks` is absent.
- `npm run quests:check`, also run as a Vitest test, compiles every quest, checks the manifest rules (types, checkpoints, externals both ways), runs every checkpoint from a fresh state and explores each quest. The explorer does a breadth-first walk over choices up to a step limit and reports ink errors, ran-out-of-content, and choice states with no path to `END`.
- Two sample quests prove shared state: one sets a world variable and the other branches on it.

TDD: yes. The runner, save helpers and checker are deterministic code where a regression should fail a test.

### Invariants

- IV1 — Saves never hold ink's raw state. The saved part of `World.quests` holds only named variables and the session's quest, checkpoint and seed.
- IV2 — A save taken right after a checkpoint loads to the same lines, choices and variables.
- IV3 — Load raises `SaveError` on a stored quest, variable or checkpoint the current content does not declare.
- IV4 — Renaming, removing or retyping a saved variable or checkpoint without a new save format fails a test.
- IV5 — Every checkpoint tag names its own container, and every checkpoint runs from a fresh state without ink errors.
- IV6 — Every `EXTERNAL` has exactly one TypeScript implementation, and every implementation has an `EXTERNAL`.
- IV7 — The same world, quest and picks give the same lines, effects and variables.
- IV8 — Checked-in compiled JSON matches the ink sources.
- IV9 — The explorer fails on any reachable ink error, ran-out-of-content, or choice state with no path to `END`, within its step limit.
- IV10 — A failed quest command leaves the world unchanged.

### Principles

- PC1 — The game, the terminal player and the checker use one runner.
- PC2 — Shared world variables are declared only in `world.ink`.

### Assumptions

- AS1 — Loading and writing ink state on every pick takes under 5 ms for a quest-sized story.
- AS2 — The inkjs runtime has no DOM dependency and bundles under Vite.
- AS3 — Quest-sized stories explore within a step limit that runs in a few seconds.

### Unknowns

- UK1 — Which ink state fields the explorer hashes to detect revisits, and its step limit.
- UK2 — Whether the explorer branches both ways on bool queries or uses a new-game world only.
- UK3 — Where the sample quests live so they never ship as game content.

## Plan

Approach: compile ink in tools only and ship one compiled bundle the sim reads. The sim runner keeps ink's raw state as transient player state and saves only named variables and the session. The terminal player and the checker compile from the `.ink` sources on the fly, so an edit is playable without a build, and they drive the same runner as the game (PC1). Phases run in order, so execution is inline.

UK3 is resolved here: the sample quests are real files in `game/src/data/quests/` named `sample_bowl.ink` and `sample_nose.ink`. No game code starts them. Stage 2 replaces them, and its migration step dropping their variables is the first real use of the migration helpers.

### PH1 — Compiler and bundle
- 1.1 `game/package.json` (modify): add `inkjs` 2.4.0 to dependencies. Add scripts `quests:build`, `quests:check` and `quest`, each `vite-node scripts/<name>.mjs`.
- 1.2 `game/src/data/quests/world.ink` (create): shared world variables and every `EXTERNAL`. `sample_bowl.ink` and `sample_nose.ink` (create): both include `world.ink`. Bowl sets `sample_wagon_heard` and a local `trust` and calls `give_money`. Nose branches on `sample_wagon_heard`. Every knot and stitch they enter carries `# checkpoint: <path>`.
- 1.3 `game/src/quests/compile.ts` (create), a new component for tools only:
  - `compileQuest(id: string, sources: QuestSources) -> { quest: CompiledQuest; errors: string[]; warnings: string[] }`. It compiles with `inkjs/full` and a file handler over `sources`.
  - `compileBundle(sources: QuestSources) -> QuestBundle`. It compiles `world.ink` alone to list world variables and externals, then each quest. It throws on any compile error.
  - `manifestOf(story) -> { vars, checkpoints }`. Variables carry type and initial value. Checkpoints are read from container tags.
  - `readQuestSources(dir: string) -> QuestSources` reads every `.ink` file of a folder.
- 1.4 `game/src/data/quests.ts` (create): the `QuestBundle`, `CompiledQuest` and `QuestVarDecl` types and the typed `QUESTS` import of `quests.json`.
- 1.5 `game/scripts/quests-build.mjs` (create): writes `game/src/data/quests.json` from `game/src/data/quests/`.
- 1.6 `game/src/quests/compile.test.ts` (create): `quests.json` equals a fresh `compileBundle()` (IV8). Covers manifest types, checkpoint names, world and local split, and a compile error naming the file and line.
- Commit: "Quests compile from ink into one checked bundle"

### PH2 — Runner in sim
- 2.1 `game/src/sim/types.ts:293-333` (modify): `Player.quests: QuestState`. `QuestState = { world: QuestVars; local: Record<string, QuestVars>; session: QuestSession | null; live: string | null }`. `QuestSession = { quest: string; checkpoint: string; seed: number }`. `QuestVars = Record<string, string | number | boolean>`.
- 2.2 `game/src/sim/world.ts:67-130` (modify): `newWorld()` sets `quests: { world: {}, local: {}, session: null, live: null }`.
- 2.3 `game/src/sim/quests.ts` (create):
  - `startQuest(world: World, bundle: QuestBundle, quest: string, checkpoint: string) -> World`. It goes through `update()`, throws on an unknown quest or checkpoint or an open session, injects stored variables over the declarations, seeds ink with `hashRandom(world.seed, world.turn, …)` and enters the checkpoint.
  - `chooseQuestOption(world, bundle, index) -> World`. It loads `live`, picks, continues to the next choices or the end, records the checkpoint from the last `checkpoint:` tag played, writes the changed variables back and closes the session at `END`.
  - `resumeQuest(world, bundle) -> World`. It rebuilds `live` from the session's checkpoint, the stored variables and the seed. Load uses it.
  - `questView(world, bundle) -> { lines: { text: string; tags: string[] }[]; choices: string[]; ended: boolean }`, a query.
  - `questProblems(state: QuestState, bundle) -> string[]`, a query listing stored quests, variables, types and checkpoints the bundle does not declare (IV3).
  - The write-back stores a variable only while it differs from its declaration and throws when ink gives it another type.
- 2.4 `game/src/sim/quest-hooks.ts` (create): `QUEST_QUERIES` with `money()` and `QUEST_EFFECTS` with `give_money(amount)`, as typed records keyed by external name. Effects are bound with `lookaheadSafe` false and change the draft world of the running command. `give_money` throws on a negative amount.
- 2.5 `game/src/sim/quests.test.ts` (create), tests first: Bowl sets the world variable and Nose branches on it. The same world and picks give the same lines and variables (IV7). A throwing pick leaves the world unchanged (IV10). A save taken right after a checkpoint, cleared of `live`, resumes to the same view (IV2). The effect pays money.
- Respects: IV1, IV2, IV7, IV10, PC2.
- Commit: "Sim runs ink quests and keeps only their named variables"

### PH3 — Saves and migration
- 3.1 `game/src/three/save.ts:184-191` (modify): `saveOf()` drops `player.quests.live`.
- 3.2 `game/src/three/save.ts:66-89` (modify): `loadWorld()` raises `SaveError` with the list from `questProblems()`, then runs `resumeQuest()` when a session is open.
- 3.3 `game/src/three/save-migrations.ts:522-602` (modify): a new step adds `player.quests` with empty maps and no session. Add pure helpers `renameQuestVar(world, quest: string | null, from, to)`, `dropQuestVar(world, quest | null, name)`, `moveQuestCheckpoint(world, quest, from, to)` and `endQuestSession(world, quest)`. A null quest means a world variable.
- 3.4 `game/src/three/save-fixtures/format-2-33.json` (create), plus tests in `save-migrations.test.ts` for the step and each helper.
- 3.5 `game/src/three/save-shape.json`, `game/scripts/save-shape.mjs`, `game/src/test/save-shape.ts` (modify): record `quests`, the saved variable names and types of every quest and the world, and every checkpoint. The script refuses a removed, renamed or retyped name under the recorded format and accepts additions. `save.test.ts:227` gets the same check (IV4).
- 3.6 `game/src/three/save.test.ts` (modify): a save made mid-quest loads at the last checkpoint with variables kept. An unknown stored variable or checkpoint raises `SaveError` (IV3). The saved envelope holds no `live` (IV1).
- Commit: "Saves keep quest variables and the checkpoint, and migrate them"

### PH4 — Checker and terminal player
- 4.1 `game/src/quests/explore.ts` (create):
  - `checkBundle(bundle, world: World) -> QuestReport[]`. It covers allowed variable types, checkpoint tags naming their own container (IV5), externals matching `QUEST_QUERIES` and `QUEST_EFFECTS` both ways (IV6), and every checkpoint run from a fresh state.
  - `exploreQuest(quest, world, limit: number) -> QuestReport`. It walks choices breadth-first through the sim runner, hashing the ink pointer, the choices, the variables and capped visit counts. It reports ink errors, ran-out-of-content, sections never reached and states with no path to `END` (IV9). Hitting the limit is a failure, not a pass.
- 4.2 `game/scripts/quests-check.mjs` (create): compiles the sources, runs `checkBundle()` and exits non-zero on any report.
- 4.3 `game/scripts/quest.mjs` (create): `npm run quest -- <quest> [--checkpoint c] [--picks 0,2] [--set name=value] [--save file] [--load file]`. It compiles the sources fresh, plays on a new-game world of the test map, prints lines with tags, numbered choices, effects and final variables, and reads picks from stdin without `--picks`. `--save` writes the saved player quest state. `--load` checks it with `questProblems()` and resumes at its checkpoint.
- 4.4 `game/src/quests/explore.test.ts` (create): the real bundle passes. Inline sources with a dead end, a missing divert, a trap loop, a checkpoint tag on the wrong section, a list variable and an unbound external each fail with a report naming the place.
- Commit: "Quest check and terminal player run quests without the game"

### PH5 — Docs
- 5.1 `game/docs/architecture/quests.md` (create): content layout, checkpoints, variables, hooks, saves and the tools. Link it from `game/CLAUDE.md` Docs, add the commands to `game/CLAUDE.md` Commands and `game/docs/tools.md`, and add one line on quest state to `game/docs/architecture/saves.md`.
- Commit: "Docs cover the quest engine"

### Test strategy
- Write tests first in PH2, PH3 and PH4 and run them failing before the code.
- Run only the touched test files, plus `npm run typecheck` and `npm run quality` per phase.
- Smoke the Goal at the end with the terminal player: play Bowl, save, edit inside the current section, load, then play Nose.

### Risks / rollback
- RK1 — #347 also adds the migration step from format 2.33. Whichever branch merges second moves its step to the next index and renames its fixture.
- RK2 — The explorer uses a new-game world only (UK2), so branches gated on game queries are not explored. The checker states this, and covering both answers is left for stage 4.
- RK3 — Visit-count capping can merge states that a script treats differently. The cap and the step limit are set in PH4 from the samples (UK1) and recorded with a reason.
- Rollback: the branch is separate from `dev`, and nothing outside it starts a quest.

## Conclusion

### Hands-off decisions
- make: switched to hands-off after the user approved the plan — the user asked for a hands-off build.
- make: branch `ink-quest-engine` from `dev` in `.worktrees/ink-quest-engine` — the engine does not depend on #347.

### Deviations from plan
- PH1: the compiler lives in `game/src/test/quest-compile.ts`, not a new `game/src/quests/` folder — the quality gate's fragmentation rule rejects a new folder holding one 100-line file, and `src/test/` already holds the other Node-only harnesses that scripts and tests use. The PH4 checker goes there too.
- PH2: the hooks live in `game/src/sim/quests.ts` with the runner, not in `quest-hooks.ts`, and bundle parsing moved from `data/quests.ts` into `sim/quests.ts`, which exports `QUESTS` — `game/src/sim` sat 15 code lines below the gate's 5 files per 1,000 lines, so a second new file failed the gate. Parsing is validation logic, so `data/quests.ts` now holds only types.
- PH2: `resumeQuest(world) -> World` became `restoreQuest(world): void` — load rebuilds derived state in place like `refreshVision()`, without `update()` side effects.
- PH2: IV2 holds for choices and variables. The lines on view after a restore are the lines played since the checkpoint, not the lines before it.
- PH2: the sample guards "Heard any rumors?" with a variable instead of a once-only choice. A used-up once-only choice returns after a restore, since visit counts are not saved.
