# Incident log

An entry is a bug that cost players, saves, data or a lot of work, or that repeats a known class. The factory adds entries from shipped bug fixes. The change review reads this file and treats a repeat of an entry as a serious finding.

Each entry has four lines: `ID`, `repo`, `what` and `cost`. The repo is `game` or `factory`. Ids run R1, R2 and so on. A blank line separates entries.

ID: R1
repo: game
what: Terrain, elevation, ground scatter and obstacle placement measured the distance to every road segment for every point. Commits 03c81e69 and 962f671b fixed it with RoadIndex.
cost: Map and world setup ran slowly until two fixes on two days. The same full scan was written again in a second place after the first fix.

ID: R2
repo: game
what: Route planning rebuilt the nav data and tested every blocker for every segment. Commit 3a977fde fixed it with cached nav layers and ObstacleBuckets.
cost: Route planning took most of a turn. The index existed after this fix, and later code still did not use it.

ID: R3
repo: game
what: Commit 8dd44e05 added propsNear() to limit sight checks to nearby props. It still filters all 2148 world.obstacles on every check, so it only narrows the list after a full pass.
cost: On 2026-10-02 a profile showed sight checks take 32% of headless turn time. One in-game day costs 49 seconds, so a 30-day tuning run takes about 25 minutes. Balance tuning waits on that.

ID: R4
repo: game
what: Derived data was rebuilt on every call. Gun layout scoring in armor.ts built one tall-part map per gun in commit 99230d56. NPC loadouts recomputed the armed choices on every roll in commit 9241e607.
cost: Two more slow spots found by hand in two days, each fixed alone. The class kept coming back.

ID: R5
repo: game
what: EFFORT.wage tier 1 in game/src/data/market.ts was set on 2026-09-28 from an `npm run econ` run whose 30-day calibration crashed with "No sellable part". Tiers 2 and 3 were never measured. Every item price was set from that wage the same day in commit 4c78d169.
cost: On 2026-10-02 the same harness measured 0.23 over 30 days and 0.80 over 5 days. The contracts bot lost money with 48 taken and 2 done. The greedy bot ended below the haul-only bot. Prices across the game rest on an unmeasured number.
