# Quest pages, art support and the depot rewrite

**Status:** done
**Branch:** ink-quests-347
**Worktree:** .worktrees/ink-quests-347
**Goal:** A quest picks a transcript or a page view. The page view shows art, one page of text with its choices, and the quest's stats and facts, like Roadwarden with Space Rangers 2 paging. Quests can show pictures, and paid choices show greyed when the player is short. The depot quest shows raw facts and lets the player draw the conclusion. Confirmed by tests, the quest check, a browser check and the playtest.
**Mode:** interactive

## Context

- The talk window was one growing transcript for every quest, which suits short talk but not a scene that needs full attention.
- The depot quest told its conclusions: "Too neat", "Vance asks often", "Too cheap for a trader with no well". An evidence counter did the deduction for the player.
- `# img:` existed with no art list and no place to show a picture.

## Design

- Top tags of a quest file set its view, stats and facts. They are compiled into the bundle.
- Line tags `place`, `page`, `row`, `head` and `img` shape the page. A choice tag `cost` gates and charges money.
- The depot quest drops the evidence counter. Leads show documents and scenes, facts record raw observations, and Kovac weighs the facts behind the name the player picks.
- Art files come later. `QUEST_ART` in `src/data/quest-art.ts` registers them.

TDD: no. The behavior was shaped by the mockups the user approved, and tests followed each piece.

## Verify

Result: passed

- CK1 — `npm run quests:check` walks the depot quest in 9,831 states over its worlds and passes every quest.
- CK2 — the cost choice charges 20 M, shows locked with 19 M and throws on a locked pick — held, `src/sim/locals.test.ts`.
- CK3 — unknown top tags, a bad view, a stat on no number and a fact on no true or false variable fail the build — held, `src/test/quest-compile.test.ts`.
- CK4 — a save at 2.36 drops the removed depot counters at 2.37 — held, `src/three/save-migrations.test.ts`.
- CK5 — browser: Kovac talks as a transcript, the depot quest opens as pages, the leads show tables and facts, and the caught ending pays 150 M — held, `game/tmp/page-check.mjs`, screenshots in `game/tmp/page/`.
- CK6 — the Leave button covered the first stat in the page view — broke at first, fixed in CSS.
- Smoke: `npm run playtest` passes at 60 fps.

## Conclusion

Outcome: both views, art support, cost choices and the rewritten depot quest work end to end.

### Deviations from plan
- Kovac first let the player pick facts one by one at the accusation. Every subset of facts multiplied the checker's states past 35,000 without an end. The accusation is now one pick of a name, and Kovac reviews every fact the player holds in turn.
