This is the release playtest of the ROAM factory.
You work alone in a clone of the release branch at commit {{sha}}. Every feature of the release and its cleanup tasks is merged.
This is run {{run}} of at most {{runs}} for this release.

Read CLAUDE.md first.
Do not change the game, git state or any file outside `.factory/`. This stage only reviews. Fixes run as a release task.

The factory played one progression run: seed {{seed}}, {{turns}} turns, the mixed bot, which plays trader, scavenger and fighter goals one in-game day each.
Its full log is `.factory/playtest/log.jsonl`. Each line is JSON with a `k` field:
- `run`: the seed, turns, commit and the limits of the harness.
- `event`: one game event with its turn. `e.t` names the event. `src/sim/types.ts`, type `GameEvent`, describes each one.
- `snapshot`: the player and every NPC every 50 turns: position, top goal, resources and defeat state.
- `end`: complete, death or error, with the error message.
- `summary`: counts of events, NPC goals, shots, hits, kills, money and XP.
`.factory/playtest-facts.json` holds the facts the factory read from the log. `.factory/playtest-history.md` lists the earlier runs of this release and the committee's decisions. Respect those decisions.

Read the whole log, start to end. It is long, so read it in chunks with jq, grep or a short script, and keep going until you covered every turn.
Check:
- movement and goals: trucks that go somewhere and arrive, goals that start and end, trucks that stop moving, stall events.
- interactions: trade, scavenging, tows, aid, calls, jobs and contracts, and who did them.
- combat: shots, hits, part damage, knockouts, kills and deaths. Whether fights start for a reason and end.
- progression: XP by source, level ups, money, fuel and supplies over the run. Resources that run out, pile up or never move.
- errors: an error ending, a stall, impossible values like negative money, NaN or positions off the map, and repeated loops.
- drama: whether anything memorable happens, or the run is empty.
The harness has limits. Every truck travels in far mode, so physics, close driving and crashes never run, and the bot makes only the choices its archetype makes. Never claim coverage of what the run cannot show. Name those gaps as limitations.
To confirm a suspicion, read the code, run the tests near it, or play a short run with `npm run progression:playthrough -- --seed {{seed}} --turns <n> --out tmp/check.jsonl`.

A finding is important when a player would hit it: a crash, a stall, a broken rule, a dead feature, a resource or progression curve that breaks the game, or combat that kills for no reason.
A finding is minor when it is cosmetic, rare or a matter of taste.
Every death and every quiet part listed in the facts needs a reason from the log. A death is fine when the log shows how it came about and it fits the game. A run with no fights or no trade is fine only when the log shows why.

Write `.factory/playtest.json`:
{
  "verdict": "clean" | "fix" | "blocked",
  "summary": "two or three sentences on the run",
  "drama": "what memorable happened, or that nothing did",
  "observations": ["what the log shows, with turns"],
  "suspected": ["issues you suspect and could not confirm"],
  "limitations": ["what this run cannot show"],
  "findings": [{ "id": "F1", "severity": "important" | "minor", "title": "short", "evidence": "turns, vehicle ids and lines" }],
  "plan": [{ "priority": 1, "finding": "F1", "change": "the smallest concrete fix, with files", "tests": "the tests to run or add" }],
  "explanations": { "death": "why the player died, or null", "quiet": "why the run lacks each quiet part, or null" },
  "blocker": "why the release must wait for a person, or null"
}
- clean: no important finding. Minor findings stay listed, and the plan may be empty.
- fix: at least one important finding, and a plan of the smallest fixes, most important first. Never plan to remove or disable a feature, and never change unrelated behavior to silence a finding.
- blocked: a finding that needs a design or taste decision, a fix you cannot make safe, or a gate you cannot judge. Say in `blocker` what a member must decide.

Write `.factory/playtest.md`, the report for the committee, in plain words, under 400 lines:
## Run
Seed, turns, commit, how the run ended.
## Observations
## Suspected issues
## Limitations
## Findings
## Fix plan
## Verdict
