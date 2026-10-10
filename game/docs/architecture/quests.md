# Quests

Quests are scripts written in [ink](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md), run by inkjs. They serve town talk and full text quests. Each local of Bowl and Nose is one quest, named in `LOCALS` in `src/data/locals.ts`. Radio calls keep their own engine in `src/sim/dialogue.ts`, and share only the text markup and the handoff below. [Writing quests](../quest-authoring.md) walks through adding and changing a quest.

## Radio handoff

- A radio option with `go: questGo('<quest>')` in `src/data/dialogue.ts` runs its effects, ends the call and opens the quest at `start`, all in one command. A test checks that every handoff names a quest with a `start` checkpoint.
- The quest cannot read who was on the radio. Its lines name the speaker with `# speaker:`.
- Radio lines use the same markup and reveal as quest lines. The log prints them without markup.

## Content

- Each quest is one `.ink` file in `src/data/quests/`, named by its quest id. Every quest includes `world.ink`.
- `world.ink` declares the shared world variables and every `EXTERNAL` game function. A variable a quest declares itself belongs to that quest, and two quests may use the same name.
- Saved variables are int, float, bool or string. A `LIST` or a divert held in a variable fails the build, since a save cannot hold it.
- `npm run quests:build` compiles every quest into `src/data/quests.json`, which the game reads. A test fails when the bundle is stale. The bundle holds each quest's story, its variables with their types and initial values, and its checkpoints.

## Checkpoints

- A checkpoint is a knot or stitch whose first tag is `# checkpoint: <knot>` or `# checkpoint: <knot.stitch>`. The tag must name its own section, or the build fails.
- A quest starts at one of its checkpoints. While it runs, the session remembers the last checkpoint whose line played.
- A save keeps the last checkpoint, not ink's position. Load starts the quest again there, so the player sees the lines from that checkpoint on.
- Load restarts ink's own counts. So a once-only `*` choice, a `{knot}` visit count, `READ_COUNT` and `TURNS_SINCE` fail the build. A fact that must last past a load or into another quest lives in a variable, and a choice offered once is a sticky `+` choice with a variable guard.
- Every checkpoint must run on its own from a fresh story, so it may not rely on temporary variables or tunnels from before it.
- A load plays a checkpoint's opening again, up to its first choices. So that opening may call no effect and change no variable, or each load would pay or count again. Put them after a choice. `restoreQuest()` throws on either, and `npm run quests:check` tries a load at every state it walks.

## State

`player.quests` in `src/sim/types.ts` holds the quest state.

- `world` and `local[quest]` hold variables whose value differs from their declaration. A new variable, or a new initial value, reaches old saves the way it reaches a new game.
- `session` is the open quest: its id, last checkpoint and the seed of ink's random numbers. One quest is open at a time.
- `live` holds ink's own state and the lines and choices on view. Saves skip it, and load rebuilds it from the session with `restoreQuest()`.

`src/sim/quests.ts` owns the runner. `startQuest()` and `chooseQuestOption()` are commands through `update()`, so a failed pick leaves the world unchanged. `questView()` gives the view kind, the lines with their tags, the choices with their costs and locks, the stats, the facts on view and whether the quest ended. A quest at its end closes its session and keeps its last lines on view.

## Game functions

- Each `EXTERNAL` in `world.ink` has one function in `src/sim/quests.ts`: a query in `QUEST_QUERIES` or an effect in `QUEST_EFFECTS`.
- A query only reads the world. An effect changes the world of the running command, and ink never runs it ahead of a pick.
- Money crosses in whole M: `money()` reads it, `give_money(amount)` pays the player and `pay(amount)` takes from the player. `pay()` throws when the player holds less, so the quest checks `money()` first.
- `begin(quest)` opens another quest at its `start` once this one ends. It must come right before `-> END`, or the pick throws. Kovac starts the depot quest this way.
- `note(id)` writes a journal note and `has_note(id)` reads one. `found(site)` reads whether a town or location is found, and `searched(wreck)` whether a story wreck is searched. Each throws on an id the game does not know.
- `has_work()`, `has_offers()` and `board_full()` read the board of the town the truck is parked at, and `take_work()` takes its best offer as the Contracts tab does. They throw away from a town. The offer is the best-paying open contract the truck can take, from `townWork()` in `src/sim/dialogue-rules.ts`. `has_offers()` tells a board with open contracts the truck cannot take from an empty one.
- Game state such as money is read through a query, never copied into an ink variable.

## Top tags

Tags at the very top of a quest file, before `INCLUDE world.ink`, describe the whole quest. The build reads them into the bundle and fails on an unknown one.

- `# view: page` shows the quest as pages. Without it the quest is a transcript.
- `# stat: <variable> <Label>` shows a number variable in the page's right column. `# stat: money Money` shows the player's money. `# stat: alarm Talk: quiet, talking, loud` shows a word for the value instead, and a value past the list shows the last word.
- `# fact: <variable> <text>` shows the text in the right column while the true or false variable is true. Facts are what the player found, written as raw observations, so the player draws the conclusion.

## Text and the talk window

- Inline markup is `<b>`, `<i>`, `<shake>`, `<pop>` and `<color=rust>`, closed by `</name>`. Square brackets would break ink choices, so markup uses angle brackets.
- A line tag sets how the line reveals: `# reveal: all`, `word` or `char`, and `# speed: slow`, `normal` or `fast`. Words is the default. `# speaker: <name>` puts the name before the line. `# work_offer` shows the town's best offer under the line.
- `# row` and `# head` make a line a table row, its cells split by `;`. Lines in a row form one table, for ledgers, logs and price boards. The voice test reads no numbers in them.
- `# place: <name>` names where the page is and heads it until another place. `# page` starts a new page, behind a Next button. A page tag on the first line of a pick's output starts no new page, so a load opens on it directly.
- `# img: <key>` shows a picture. The keys and their files under `public/quest-art/` are in `QUEST_ART` in `src/data/quest-art.ts`. A page shows the latest picture in its art column until another replaces it, and a transcript shows it in the log. A key not in the list fails the check.
- A choice tagged `# cost: <M>` takes that money when picked. The window shows it greyed with the player's money when they hold less, and a pick of it throws. The tag may hold an ink value: `+ [Pay her {price} M. # cost: {price}]`. A choice takes no other tag.
- `MARKS` and `LINE_TAGS` in `src/ui/quest-text.ts` list them. A new effect is one entry there and its CSS in `style.css`. Unknown or unclosed markup and unknown tags fail `npm run quests:check`.
- `src/ui/quest-screen.ts` is the talk window. It shows whenever `player.quests.live` is set, so a start, a pick and a load all show it. It lies over every other screen. Digits pick, a click, Space or Enter shows the rest of the reveal at once, and Escape leaves the quest.
- A transcript keeps the exchanges of this talk above the newest one. It suits short talk, like asking around town.
- A page shows art on the left, one page of text with its choices in the middle, and the stats and facts on the right. A fact found in the last pick stands out. Space or Enter after the reveal turns to the next page. It suits scenes that need full attention. `src/ui/quest-lines.ts` draws lines for both views.

## Saves

- A save holds `player.quests` without `live`, so it holds no ink state.
- Load raises a `SaveError` on a stored quest, variable, type or checkpoint the current bundle does not declare.
- The rescue screen then carries every variable the bundle still declares with the same type, lists the rest as lost, and closes the open quest. `fittingQuestVars()` decides.
- `src/three/save-shape.json` records every saved variable name with its type and every checkpoint. Removing, renaming or retyping one needs a migration step, and `npm run save:shape` refuses it under the recorded format. Additions need no step.
- `src/three/save-migrations.ts` has pure helpers for those steps: `renameQuestVar()`, `dropQuestVar()`, `moveQuestCheckpoint()`, `endQuestSession()` and `dropQuest()`. A null quest means a world variable.

## Tools

- `npm run quest -- <quest>` plays a quest in the terminal on a new game, compiled fresh from the sources, so an edit plays without a build. Choices are numbered from 1. `--checkpoint <name>` starts at another checkpoint than the first. `--picks 1,2` plays those choices, and without it the player types picks. `--set name=value` sets a world or quest variable before the start. `--save <file>` writes the quest state as a save holds it. `--load <file>` checks that state against the sources. With an open session of the quest it resumes at its checkpoint, and with no open session it starts the quest with the saved variables, so one quest's outcome carries into the next.
- `npm run quests:check` fails on compile errors and warnings, broken checkpoint tags, saved types it cannot hold, game functions missing on either side and a stale bundle. It then walks every choice from every checkpoint through the runner and fails on ink errors, on states from which no choice leads to an end, and on sections never reached. It names the picks that lead to each problem. A Vitest test runs the same check.
- The walk merges states by ink's position, variables, money, notes and held contracts. Visit counts play no part, since the build bans flow that reads them. The walk stops at 5,000 states per world and fails, since an unchecked quest must not pass. A pick that begins another quest ends the walk there, and the other quest is walked on its own.
- `gameScenes()` in `src/test/quest-check.ts` gives the worlds each quest is walked in: a new game, and a veteran who holds every note, has found every place, has searched every story wreck and holds a full board. A local's quest is walked parked at their town. So a branch on a game query is walked both ways when the two worlds answer it differently.
- Each value a quest assigns to a world variable with `~ name = value` adds one more world: the new game with that value set. So a branch on what another quest decided is walked too. Only literal assignments count, one variable at a time, so set world variables to literal values.
- The check worlds hold no obstacles, which no game function reads. That keeps a step cheap to clone.

## The depot leak

`nose_depot_leak.ink` is the first full text quest, shown as pages. Kovac at Nose starts it with "Anything off the books?". Fuel walks out of the Nose depot, and the player has 5 watches to find the seller. Each lead costs a watch and gives a fact. The ledger points at Pell, the clerk. The gate log, a shift swap, the trader's description, seals under a cot and a night watch point at Vance. Paying the trader for her lead costs 20 M.

- Naming Vance weighs the facts the player holds. The night watch counts 2 and each other Vance fact 1. With 3 or more Kovac pays 150 M.
- Naming Pell with the ledger jails the wrong man.
- A name without enough behind it raises the alarm.
- Taking the trader's envelope pays 60 M and lets the thief go.
- An alarm of 2, or letting it go, loses the trail.

The world variable `depot_thief` keeps the outcome. Kovac greets by it and Ibo talks about it.

## Language

The talk window, journal and People tab take their words from `src/text/`, in English and Russian: note titles and sources as `journal.<id>.*`, locals as `local.<id>.*`. The ink text of a quest is English only for now, and shows as it is in Russian. Radio lines, including the Army wagon topic, are line ids like every other radio line.
