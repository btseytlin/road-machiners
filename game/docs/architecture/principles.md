# Architecture principles

These are the architecture principles of this project. Each one has a rule, the reason behind it and a check a plan must answer when a change touches it. A design that deviates from a principle names it and says why. [The incident log](../../../docs/incident-log.md) has the full entries behind the incidents named here. The review in the factory checks every change against these principles.

## 1. One rulebook for every truck

The player and NPCs go through the same rule functions. The only allowed split is the level of detail near and far from the player, and `src/sim/far.ts` owns that split. A rule that branches on the player does so only because DESIGN.md says so.

Why: DESIGN.md asks that player and NPCs play by the same rules. A split that leaks into a rule is hard to see and changes the game for one side only.

Plan check: name every place where the change treats the player differently from NPCs, and the design reason for each.

## 2. The simulation owns the rules, and everything else reads them

Rendering, UI, harnesses and tools call sim functions and commands. They never keep their own copy of a rule. A harness that needs less detail switches the level of detail through the sim, never through a rewritten rule.

Why: the old economy harness kept its own copies of travel, fights and part wear. It measured a different game, and prices were set from it.

Plan check: list each rule the change reads outside `src/sim/`, and name the sim function that owns it.

## 3. Hot code uses an index

Code that runs per turn, per frame, per truck or per pair never scans a whole world list. It queries an index. `ObstacleBuckets` in `src/sim/nav/buckets.ts` answers questions about obstacles near a point or along a segment. `RoadIndex` answers questions about roads. Cached nav layers in `src/sim/nav/layer.ts` hold route data.

A filter over `world.obstacles`, `world.roads` or `world.vehicles` inside a function that runs per point, per segment or per check is a violation. So is a filter that only narrows the list after a full pass over it.

Derived data that many calls need is built once and cached, never rebuilt per call.

Why: full scans in hot code were found and fixed four times, and new code kept adding them.

Plan check: for each new loop in hot code, name the size of the list, the rate of the calls and the index the code uses.

Incidents: R1, R2, R3, R4.

## 4. Value is conserved, and every source and sink has a name

Money, parts and goods move between owners. They appear or vanish only in places the design names. A new way to create or destroy value is a design decision, never a side effect.

Why: DESIGN.md says nothing appears offscreen to keep the economy going. An unnamed source, like a free new loadout for every recovered raider, turns fights into a source of unlimited gear.

Plan check: list every source or sink of value the change adds or changes, with how much it pays and how often.

## 5. Save facts, derive the rest

`World` holds facts only. Derived data and caches live outside it and are rebuilt from the facts. A cache key compares ids, not object identity, because the world is cloned every turn. Any change to a type reachable from `World` needs a save migration, as [Saves](saves.md) and `CLAUDE.md` describe.

Why: a stored derived value drifts away from the facts it came from. Players keep their saves across updates.

Plan check: name each saved type the change touches and its migration, and each new cache with its key.

## 6. Same seed, same game

All sim randomness goes through `src/sim/rng.ts` with its state in the world. Each concern draws from its own stream: shops from `world.marketRng` and driver names from `world.nameRng`. A new concern whose draws must not shift others gets its own stream. Render and audio may use `Math.random()` or `src/render/noise.ts`.

Why: harness runs, replays and bug reports mean something only when a run repeats exactly.

Plan check: name each new random draw and the stream it uses.

## 7. Impossible states fail loud

A rule throws on a state that should never happen. It never returns a default, a zero or an empty result in its place. A driver that stops making progress raises a `stall` event, and a stall is always a bug.

Why: a silent default turns a bug into a wrong number that nobody notices until the balance is off.

Plan check: name the new invariants and where each one throws.
