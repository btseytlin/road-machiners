This is the release playtest of the ROAM factory.
You work alone in a clone of the release branch at commit {{sha}}. Every feature of the release and its cleanup tasks is merged.
You review the run, fix what this release broke, and the factory replays the seed on your fixes. The job plays at most {{runs}} times, this play included. The last play can only pass or block.

Read CLAUDE.md first.
Change only game code, its tests and its docs, and commit each fix. Do not push, change git branches or rewrite history. Write the factory files only in `.factory/`.

The factory played one progression run of the release and one of the baseline: seed {{seed}}, {{turns}} turns, the markov bot, which plays a random one of the other bot archetypes for a stretch of turns, then draws again.
- `.factory/playtest/log.jsonl` is the release at commit {{sha}}.
- `.factory/playtest/baseline.jsonl` is the baseline at commit {{baseline}}, {{baselineKind}}. Its harness may be older, so read its `run` line for its bot and limits.
Each line is JSON with a `k` field:
- `run`: the seed, turns, commit and the limits of the harness.
- `event`: one game event with its turn. `e.t` names the event. `src/sim/types.ts`, type `GameEvent`, describes each one.
- `snapshot`: the player and every NPC every 50 turns: position, top goal, resources and defeat state.
- `end`: complete, death or error, with the error message.
- `summary`: counts of events, NPC goals, shots, rounds that hit, kills, the player's money gained and spent, and XP.
`.factory/playtest-facts.json` and `.factory/playtest-baseline-facts.json` hold the facts the factory read from each log. `.factory/playtest-history.md` lists the earlier plays of this release and the committee's decisions. Respect those decisions. `.factory/open-bugs.md` lists the open bug issues.

Read the whole release log, start to end. It is long, so read it in chunks with jq, grep or a short script, and keep going until you covered every turn.
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

Sort every finding by its cause:
- `release`: a change between the baseline and this commit caused it. `git diff {{baseline}}...HEAD` and `git log {{baseline}}..HEAD` show those changes.
- `old`: the baseline has it too. The two runs drift apart after the first turns, so compare the kind of event, not the turn. Look for the same failure in the baseline log, or show that its cause is older than the baseline.
Give the evidence for the sort in `why`. When you cannot tell, the finding is `release`.
An old finding never blocks the release, and you do not fix it. The factory opens a bug issue for each important one. When an open bug issue in `.factory/open-bugs.md` already describes it, put its number in `known`.

Fix every important `release` finding with the smallest change, most important first. Never remove or disable a feature, and never change unrelated behavior to silence a finding. Run the tests near each change and the game typecheck. Commit each fix with a message that names it.

Write `.factory/playtest.json`:
{
  "verdict": "clean" | "fixed" | "blocked",
  "summary": "two or three sentences on the run",
  "drama": "what memorable happened, or that nothing did",
  "observations": ["what the log shows, with turns"],
  "suspected": ["issues you suspect and could not confirm"],
  "limitations": ["what this run cannot show"],
  "findings": [{ "id": "F1", "severity": "important" | "minor", "title": "short", "evidence": "turns, vehicle ids and lines", "cause": "release" | "old", "why": "the evidence for the cause", "known": 123 | null }],
  "fixes": ["what each commit of this round changed"],
  "explanations": { "death": "why the player died, or null", "quiet": "why the run lacks each quiet part, or null" },
  "blocker": "why the release must wait for a person, or null"
}
- clean: no important `release` finding, and you committed nothing.
- fixed: you committed fixes for the important `release` findings. The factory replays the seed on them.
- blocked: a finding that needs a design or taste decision, a fix you cannot make safe, or a gate you cannot judge. Say in `blocker` what a member must decide.
`findings` lists what this log shows, also what you fixed in this round.

Write `.factory/playtest.md`, the report for the committee, in plain words, under 400 lines. Keep it up to date in each round, so it covers the whole job:
## Run
Seed, turns, commit, baseline, how the run ended.
## Observations
## Suspected issues
## Limitations
## Findings
Each with its cause and why.
## Fixes
## Verdict
