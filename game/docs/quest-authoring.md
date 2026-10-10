# Writing quests

This guide covers how to add a quest, change one safely and keep all quests healthy. Quests are ink scripts in `src/data/quests/`. [Quests](architecture/quests.md) is the reference for every tag, game function and save rule, and this guide links there instead of repeating it. The ink language itself is in [Writing with ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md).

## The loop

1. Edit or add a `.ink` file in `src/data/quests/`.
2. Play it in the terminal: `npm run quest -- <quest>`. It compiles fresh from the sources, so no build is needed. `--picks 1,2,1` plays fixed choices, `--checkpoint <name>` starts elsewhere, and `--set name=value` sets a variable first.
3. Run `npm run quests:check`. It fails on compile errors, broken tags, dead ends, sections never reached and effects that a load would repeat. It names the picks that lead to each problem.
4. Run `npm run quests:build` to write `src/data/quests.json`. The game reads only this bundle, and a test fails when it is stale.
5. Run the touched tests: `npx vitest run src/test/quest-voice.test.ts src/test/quest-compile.test.ts src/sim/locals.test.ts`.
6. See it in the game with `npm run dev`. Open the console with backquote and type `tp nose` or `tp bowl`, then open the town's People tab.

## A new quest

A quest is one file named by its id, such as `bowl_mira.ink`. Its first section must be a checkpoint named `start`, because every way into a quest opens it there.

```ink
INCLUDE world.ink

VAR asked_seed = false

=== start ===
# checkpoint: start
Mira wipes flour off her hands. # speaker: Mira
-> hub

= hub
# checkpoint: start.hub
+ {not asked_seed} [Where does the seed come from?]
  ~ asked_seed = true
  From the vault under the granary. Nobody outside Bowl sees it. # speaker: Mira
  -> hub
+ [Goodbye.]
  -> END
```

Every quest needs a way in. The voice test fails on a quest that nothing starts.

- A town local: add an entry to `LOCALS` in `src/data/locals.ts` with the quest id. The People tab lists them.
- A radio call: give a radio option `go: questGo('<quest>')` in `src/data/dialogue.ts`. The call ends and the quest opens.
- Another quest: call `~ begin("<quest>")` right before `-> END`. Kovac opens the depot quest this way.

## Transcript or pages

A quest without top tags is a transcript: each answer stacks under the last one, like a chat. Use it for short talk, such as asking a local about rumors.

A scene that needs full attention, like an investigation or an intro sequence, uses pages. The top tags go above `INCLUDE`. ink ignores them anywhere else, so the build fails on one placed lower:

```ink
# view: page
# stat: watches Watches
# stat: money Money
# fact: saw_cut_seal Dispatch: a fuel can on Kovac's desk, its Army seal cut clean.
INCLUDE world.ink
```

- Give each scene a `# place:` on its first line. The heading stays until another place.
- Put `# page` on the first line of a hub that follows an outcome. The outcome then shows on its own page with Next, and the hub opens fresh.
- Write documents as tables with `# head` and `# row` lines, cells split by `;`. Use them for ledgers, logs and price boards.
- `# img: <key>` shows a picture. To add one, put the file in `public/quest-art/` and add the key to `QUEST_ART` in `src/data/quest-art.ts`.
- A paid choice carries `# cost: <M>` inside its brackets. The runner charges it on the pick and greys the choice out when the player holds less.

[Quests](architecture/quests.md#top-tags) lists every tag and its exact rules.

## Writing rules

- Show, do not tell. Give the player what their character sees and let them draw the conclusion. Write "Pell's name is on every line of the ledger" and never "the ledger points at Pell". A fact in the right column records an observation, never a verdict.
- Stay in character. The voice test rejects game words such as quest, map, click and player, and any count other than days and hours. Write "a pair of soldiers", not "two soldiers". Numbers are fine inside `# row` tables, which are documents.
- Keep each local's voice. Bowl talks warm and slow, Nose talks short. `docs/lore.md` keeps the voices.
- Use markup sparingly: `<b>` for a name or sum that matters, `<shake>` and `<pop>` once per scene at most.
- A rumor goes into the journal with `~ note("<id>")`. Add the note to `NOTES` in `src/data/locals.ts` first.

## Rules the build enforces

A save keeps only the variables and the last checkpoint. Load replays the quest from that checkpoint, so ink's own memory is gone after a load. The build and the checker hold quests to that.

- Use sticky `+` choices with a variable guard. A once-only `*` choice fails the build, because it would come back after a load.
- Keep facts in variables. Reading a visit count, such as `{knot}`, `READ_COUNT` or `TURNS_SINCE`, fails the build.
- A checkpoint's opening, up to its first choice, may change no variable and call no effect. A load plays it again. Put `~ x = ...`, `pay()` and `note()` after a choice.
- A checkpoint must run from a fresh story. It may not rely on temporary variables or tunnels from before it.
- `begin()` must come right before `-> END`.
- Check `money()` before `pay()`, or use `# cost:`. `pay()` throws when the player holds less.

## Keeping the checker fast

`npm run quests:check` walks every reachable state of every quest in a new game and in a veteran game. It stops and fails at 5,000 states per world. Each variable multiplies the states, so:

- Prefer one choice over a sequence of picks that can come in any order. Picking facts one by one at an accusation multiplied the depot quest past 35,000 states. One pick of a name followed by a fixed review keeps it near 10,000 in total.
- Reset short-lived variables as soon as they stop mattering. Use `~ temp` for a value that only one passage needs, as the depot quest's review does.
- Derive values with an ink function, like `facts_held()`, instead of keeping a counter in sync.
- Assign world variables only literal values, like `~ depot_thief = "vance"`. The checker builds one extra world per literal value, so branches on another quest's outcome get walked.

## Changing a shipped quest

Players' saves hold quest variables by name and the checkpoint by name. `src/three/save-shape.json` records both, and `npm run save:shape` refuses a change that would break an old save.

- Adding a variable, a checkpoint, a section or a line is safe. Old saves get the new variable's initial value.
- Renaming or removing a variable or a checkpoint, or changing a variable's type, needs a save migration step. Add one step to `MIGRATIONS` in `src/three/save-migrations.ts` with the quest helpers: `renameQuestVar()`, `dropQuestVar()`, `moveQuestCheckpoint()`, `endQuestSession()` and `dropQuest()`. Pass `null` as the quest for a world variable.
- Give the step a test on a small fixture in `src/three/save-fixtures/`, then run `npm run save:shape`. Never edit a step that is already committed.
- Changing the text before a checkpoint changes nothing in saves. A player who loads sees the new text from the checkpoint on.

## A new game function

A quest can only ask the game through functions in `world.ink`.

1. Declare it in `world.ink` as `EXTERNAL name(args)`.
2. Add it to `QUEST_QUERIES` in `src/sim/quests.ts` if it only reads the world, or to `QUEST_EFFECTS` if it changes it. Validate every argument and throw on a bad one.
3. The checker fails when a function is missing on either side.
4. If the answer can differ between a new game and a veteran, `gameScenes()` in `src/test/quest-check.ts` must set it up so both branches get walked.

## When something fails

- "Expected end of line but saw `|`": a bare `|` is ink syntax. Split table cells with `;`.
- "A view, stat or fact tag sits below other content": move the top tags above `INCLUDE world.ink`.
- "Effect ran while loading checkpoint": move the effect after the checkpoint's first choice.
- "Loading checkpoint changed its variables": move the `~` line after the first choice.
- "no choice leads to an end from here": a loop has no exit. Give it one, or cost each lap something, such as a watch.
- "section is never reached": a condition can never hold in either check world, or the section is dead. Fix the condition or delete it.
- "stopped after 5000 states": see [Keeping the checker fast](#keeping-the-checker-fast).
- The voice test names a line with a number or a game word: reword it in character.
