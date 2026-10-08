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

ID: R6
repo: game
what: TOW.base 40 and TOW.perTile 1.5 in game/src/data/tow.ts were set from a guessed profit of one trade run, never checked against what a player earns. A tow of about 240 tiles cost about 400 with no cap. Issue #97 fixed it by deriving the fee from EFFORT.wage tier 1 with a cap of about 167.
cost: Stranded players got paid tow offers of 300 to 400, about 2.4 days of tier-1 earnings, so a rescue became another money dead end. It shipped until release 2026-10-07. It repeats the class of R5: a price set from an unmeasured number.

ID: R7
repo: game
what: restoreDrive() in game/src/phys/drive.ts copied only the top level of the snapshot, so the restored drive shared its obstacle, body and memory records with the playback snapshot. A main-thread sync then wrote new collider handles into the snapshot that the worker read for the next turn. Rapier got a missing handle and threw "Cannot read properties of null (reading 'handle')" in removeCollider. The bug came in on 2026-09-30 and issue #96 fixed it by deep-copying the records and checking every handle with a named error.
cost: A player on /dev/ could not advance past turn T58, and every retry failed the same way because the bad records carried into the next drive. The game was not saved, so the progress since the last save was lost to a reload. The bug shipped in release 2026-10-01 and stayed until release 2026-10-07, so held-Space and auto-travel turns near props could stop any player's game.

ID: R8
repo: game
what: A tower's `answering` claim on a stranded truck had no timer, and parked on a fixed approach-side spot without checking whether another truck stood there. A tower that could not get through kept its tow goal and its claim for good, since the unstick move counted as progress and no stall was raised. While it held the claim, no other driver could answer. Issue #94 fixed it with a 20-turn claim timer in sight and out of combat, and a free parking spot around the client.
cost: A tow responder rammed a city patrol on its approach and was killed by its gatling. A blocked tower could leave a stranded truck with no rescue, which breaks the DESIGN.md rule that a stranded truck is never stuck for good. The untimed claim shipped in releases 2026-09-30 and 2026-10-01 and stayed until release 2026-10-07.

ID: R9
repo: game
what: offer() in game/src/sim/tow.ts gave a stranded player the full route fee whatever the player's money was, and payTow() in game/src/sim/states.ts took it on arrival even into debt. An NPC client already paid only what it could, so a broke NPC was towed free while a broke player was not. Issue #93 fixed it by making an NPC's offer to a player with money 0 or less free, decided at the offer, with its own "No charge" radio line.
cost: A stranded player with no money got a rescue offer that could not be paid, and accepting it put the player into debt, where nothing can be bought. It shipped until release 2026-10-07. It repeats the class of R6 and R8: a rescue for a stranded player that ends in a dead end.
