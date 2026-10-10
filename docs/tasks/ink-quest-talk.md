# Quest window, styled text and town talk in ink

**Status:** done
**Branch:** ink-quests-347 (from ink-quest-engine, with factory/issue-347 merged)
**Worktree:** .worktrees/ink-quests-347
**Goal:** At Bowl and Nose the People tab lists the locals, and picking one opens a quest window that plays that local's ink conversation with styled text and reveal effects. The #347 topics, journal notes, work offers and the wagon clue chain all run from ink. A save made mid-conversation reopens the window at its checkpoint on load. Confirmed by tests, the quest check, a playtest and screenshots of the window.
**Mode:** hands-off

## Context

- Stage 2 of 4 in `docs/tasks/ink-quest-engine.md`. Stage 1 gave the runner, saves and tools, with no UI.
- #347 runs town talk from TypeScript tables: `LOCAL_TOPICS` in `game/src/data/locals.ts`, the commands in `game/src/sim/dialogue-rules.ts`, and an inline conversation in the People tab, `peopleList()` in `game/src/ui/town.ts`.
- #347's facts behind topics are game state: discovered sites, `player.notes` for the journal, scavenged wrecks and the town board. The radio's wagon topic reads `player.notes` too.
- `<b>`-style angle-bracket markup passes through ink unchanged in lines and choices. Square brackets break choice syntax.
- Load replays a checkpoint's opening, so effects belong after a choice (stage 1 review).

## Design

### One quest window
- `QuestScreen` in `game/src/ui/quest-screen.ts` is a modal in `ModalScreens`. It shows whatever quest session is open: the speaker head, the lines, and the choices as buttons. Town talk, the radio handoff of stage 3 and full text quests of stage 4 all use it.
- Close leaves the quest. A new sim command, `leaveQuest(world)`, closes the session and clears the view.
- Boot and load open the window when a session is open, so a mid-conversation save resumes on screen.

### Styled text
- `game/src/ui/quest-text.ts` parses line markup into spans and renders them. Markup is `<name>text</name>` or `<name=value>text</name>`.
- Tags: `b` for bold, `i` for italic, `color=<role>` for a palette color, `shake` for trembling letters, and `pop` for bold words that slam in with the reveal.
- Line tags set presentation: `# reveal:all|word|char`, `# speed:slow|normal|fast`, `# img:<name>` and `# speaker:<name>`.
- The tag set lives in one registry, so a new effect is one entry plus its CSS. Unknown markup or tags fail `quests:check`.
- Reveal runs on CSS animation delays. A click, Space or Enter shows the rest at once. `prefers-reduced-motion` shows text at once.
- Images come from a registry of named art. It is empty for now, so no quest may use `img` until art exists.

### Town talk in ink
- Each local is one quest, `bowl_ruben.ink` and so on, with a `start` checkpoint holding the greeting and the topic hub. Topics are sticky choices that return to the hub, plus a way to leave.
- `LOCALS` keeps the id, name, role and town. Topics and lines move into ink. `NOTES` stays as the journal text.
- New game functions: `note(id)`, `has_note(id)`, `found(site)`, `searched(wreck)`, `has_work()`, `board_full()` and `take_work()`.
- The work topic tags its offer line `# work_offer`, and the window shows the town board's best contract under it, formatted as the Contracts tab formats it.
- The in-character check of #347 runs over every ink line.
- The sample quests are removed, with a save step that drops their state.

TDD: yes for the markup parser, the hooks and `leaveQuest`. The window and screenshots are checked by Playwright.

### Invariants
- IV1 — The window always shows the open session, and no session stays open without the window after boot.
- IV2 — Every #347 topic, condition, note and work offer behaves as before, now from ink.
- IV3 — Unknown markup or line tags fail the quest check.
- IV4 — Text can always be shown at once by a click, a key or reduced motion.
- IV5 — Effects run only after a choice, so a load never repeats a note or a contract.

## Plan

### PH1 — Markup and renderer
- `game/src/ui/quest-text.ts` (create): `parseMarkup(text) -> Span[]`, `lineStyle(tags) -> LineStyle`, `markupProblems(text, tags) -> string[]`, `renderLine(line, style, delayMs) -> { el, durationMs }` and the tag registries.
- `game/src/ui/quest-text.test.ts` (create): nesting, values, unknown tags, unclosed tags, reveal timing.
- `game/src/ui/style.css`: span classes and keyframes, with reduced motion.
- Commit: "Quest text gets markup and reveal effects"

### PH2 — Quest window
- `game/src/sim/quests.ts`: `leaveQuest(world, bundle)` closes the session and clears `live`.
- `game/src/ui/quest-screen.ts` (create) and `game/src/three/screens.ts`: the modal, shown while a session is open.
- `game/src/three/game.ts`: open the window after load when a session is open, and on any quest start.
- Commit: "One quest window plays any open quest"

### PH3 — Town hooks and content
- `game/src/sim/quests.ts`: the seven hooks. `game/src/data/quests/world.ink` declares them.
- `game/src/data/quests/*.ink`: six locals. Samples removed. `game/src/data/locals.ts` slimmed. `game/src/sim/dialogue-rules.ts` loses the topic commands.
- `peopleList()` in `game/src/ui/town.ts`: the People tab lists locals and starts their quest.
- `game/src/three/save-migrations.ts`: a step dropping the sample quests.
- Tests: hook tests, the wagon chain played through quests, the in-character check over ink, `quest-check` on the real bundle.
- Commit: "Bowl and Nose locals talk from ink"

### PH4 — Docs and checks
- `game/docs/architecture/quests.md`, `game/docs/wiki/mechanics/social.md`.
- Playwright screenshots of the People tab and the window in `tmp/`, and `npm run playtest`.
- Commit: "Docs cover the quest window and town talk in ink"

### Risks
- RK1 — `scripts/garage-ui-check.mjs` and the UI playtest may click #347's inline talk buttons. Update them in PH3.

## Verify

Result: passed

Happy-path:
- CK1 — the People tab opens Hattie, a digit picks the rumor, the journal gets the note, Escape leaves with the town screen still open — held, `tmp/talk-check.mjs` on the dev server with screenshots in `game/tmp/talk/`.
- CK2 — Dag's work offer shows the board's best takeable contract under the offer line — held, in the same browser check.
- CK3 — taking work by talk gives the same contracts, shops, trucks and events as the Contracts tab — held, `src/sim/locals.test.ts`.

Negative:
- CK4 — the board holds only a haul the truck cannot carry — broke at first: the old offer threw on accept. Now the offer skips it and Kovac says nothing fits.
- CK5 — a quest names an unknown note, site or wreck — held, each hook throws with the id.

Invariants:
- CK6 (IV1) — a save made mid-talk reloads with the session and the same choices, and no events — held, `src/three/save.test.ts`. The window shows whenever `live` is set.
- CK7 (IV2) — every #347 gate, note, work line and the wagon chain — held, `src/sim/locals.test.ts` plays them through the quests.
- CK8 (IV3) — unknown markup, an unclosed mark and an unknown tag — held, `src/test/quest-check.test.ts`.
- CK9 (IV4) — Space shows the whole answer at once — held, screenshot 4. Reduced motion is a CSS rule, not run.
- CK10 (IV5) — every effect sits after a choice — held, `npm run quests:check` tries a load at every walked state in both scenes.

Smoke: `npm run playtest` passed at 60 fps on the GPU. `npm run quests:check` passed for all six locals.

## Conclusion

Outcome: the six locals of Bowl and Nose talk from ink in the new talk window, with styled text, journal notes, work offers and the wagon chain, at 7ef4289c and the review fixes after it.

### Deviations from plan
- The talk window lies over the other screens instead of joining their one-at-a-time rule, so leaving a talk returns to the town screen.
- The checker walks each quest in a new game and a veteran world, and merges states by seen sections instead of visit counts up to 3. Six hubs at 3 counts each ran past the state limit.
- The checker cloned the whole terrain on every step. Scenes now freeze it as the game does, which made the walk 20 times faster.
- The sample quests moved to `game/src/test/quests/` as fixtures for the runner tests, since the locals hold no variables.
- RK1 did not occur: neither check clicks the People tab.

### Hands-off decisions
- ureview: fixed a stale error line in the talk window. It is now cleared before each command and on hide.
- ureview: fixed "Board is empty" said over a board of hauls the truck cannot take. A new query, `has_offers()`, gives Dag and Kovac a line for it.
