# NPCs, combat and deals

## Behavior

NPC behavior has three layers. Traits in `brain.traits` are permanent and replace classes. A goal stack in `brain.goals` keeps long-term goals under interruptions. Decision points pick reactions by weighted chance with world RNG. A weight of 0 is only for an option the driver physically cannot take or its traits forbid. Each trait's `robs` field forbids robbing always or while the driver follows a leader. Every available option gets at least `MIN_CHANCE`.

- `src/sim/npc-decisions.ts` owns trait profiles, option availability, the weighted rolls and robbery checks.
- `holdsOffRobbery()` in `npc-decisions.ts` owns the stranded robbery rule: option availability, wanting loot, and the give-up step in `thinkNpc()` all call it.
- `src/sim/npc-activities.ts` owns the goal stack and fires the decision points in `thinkNpc()`.
- `src/sim/npc-repair.ts` picks the part, the shady spot and the jobs for field repair goals.
- A scavenge goal at a territory targets one loot spot stock, not the territory, and a trip to one ends at the road end that enters it, never a pad. Hunting grounds hold a ring inside each territory. No NPC goal destination lies in a hazard zone, since `src/sim/nav/layer.ts` blocks zones for routes and the grounds lie outside them.
- `src/data/npcs.ts` holds traits, decision weights, state durations, thresholds and weighted spawn equipment tables.
- `src/sim/npc-loadout.ts` rolls each NPC a gear level from `GEAR_LEVELS`, from poor to loaded, and fills the truck within its budget and rated mass, using world RNG. Each free deck spot rolls that level's fill chance times the template's `gunFill` for one more gun, and armor targets that level's share of edge cells. Armor fills whole sides, the cab lanes first, and extra guns go where they cover sides the others miss. Equipment budgets do not spend driver wallets.
- NPCs know fixed places but perceive current vehicles only through their own sight and detection. `src/sim/detect.ts` gives player and NPCs the same sound, dust and scanner contacts.
- `src/sim/memory.ts` owns driver memories in `brain.memories`: the subject rule, `remember()`, `recall()` and the daily expiry in `forgetOld()`, run every turn. It is the only writer, and a test enforces it. A new memory kind adds a `MemoryFact` member, a lifetime in `MEMORY.turns` and a save step, and lands with the code that reads it. Talk about prices reads only memories, never live shops: `tradeTip()` and `lastTownMemory()` in `src/sim/dialogue-rules.ts` give the trading tip and the Market ears prices.
- A driver never waits without an end. `watchStalls()` gives up the top goal of a driver with no new tile, job turn or goal for `NPC_BEHAVIOR.stallTurns` turns, and sends an idle one to explore. Each give-up logs a `stall` event, which is always a bug, and `npm run stuck` and every recording fail on it.

## States and hostility

`src/sim/states.ts` holds timed states between two vehicles, like a feud or a tow. A state ends as expired, fulfilled or broken, and its hook for that ending runs once.

- Faction and feuds make trucks hostile, and a truce cancels faction hostility. A raider skips a truck with no loot unless they feud.
- Lawmen, the Bowl Farmers and Nose Army patrols, are hostile to raiders loot or not, and `callLawmen()` in `src/sim/combat.ts` sets every lawman in sight on whoever fires the first shot at a neutral NPC or starts robbing one.
- A crash between trucks at peace starts no feud. It leaves the NPC victim a grievance, which it forgives or answers with a feud.
- A `combat` state runs from an aggressor to its target. `recordAttack()` and `noteEngagements()` (fight goals in sight) in `src/sim/combat.ts` start or refresh it, it lasts `STATE_TURNS.combat` turns, and it breaks once the two trucks are no longer hostile. `inCombat()` and `inCombatWithOther()` in `src/sim/combat.ts` are the one test for whether a driver is in combat. A hostile in sight is a warning only, so no other code decides combat from sight.
- A state kind that `binds` is a deal. `boundTo()` and `givesWord()` in `src/sim/states.ts` answer who gave whom its word. The two sides never rob each other. The holder starts no decision `src/sim/npc-decisions.ts` marks as a venture, except about its partner. An attack by a partner gives the victim revenge.

## Combat

`src/sim/combat.ts` runs simultaneous fire and decides hostility. `src/sim/armor.ts` walks a round through the part grid, and its `openSides()` gives the sides a mounted gun can fire toward past tall parts. `vehicleStats()` carries them on each weapon, and auto-mounting picks deck spots that keep them open. `src/sim/crash-contact.ts` owns crash damage and `src/sim/defeat.ts` knockouts. A broken cab knocks out the player and NPCs alike, and `RULES.npcDeathChance` turns an NPC into a wreck instead. A knocked-out NPC is nobody's foe until it retreats home and refits, and `defeat.ts` owns that retreat. `src/sim/stats.ts` is the one source for speed, turning and capacity. Working guns draw power from the engine's capacity and slow the truck, see `gunDrag()`.

## Dialogue and deals

- `src/sim/dialogue.ts` runs radio calls and the horn. Topics live in `src/data/dialogue.ts` as lines and replies that name conditions, effects and prepare steps in `src/sim/dialogue-rules.ts`. A new topic is data plus any new named rule. `talkOf()` is the one place talk reads traits.
- `src/sim/parley.ts` owns what truces, mercy and threats do, for NPCs and the player alike. It also owns the stripping of a stranded player: a robber alone with one radios the `surrender` strip offer once, any other driver radios the plain `giveUp` offer that takes nothing, and `aimAt()` sends its shots at the cab after a refusal. It also owns pile claims: an NPC handed a pile claims it, warns other drivers off through `threatened` and the `claim` topic, and fights a refusal or a take in its sight. The claim's data and lapse live in `src/sim/salvage.ts`, and a claimant starts no venture while it holds one.
- Deals that outlive a call, like a tow or a patch, are states in `src/sim/states.ts`, and their fulfilled hook pays once.
- `src/sim/tow.ts` owns tows: NPCs tow the player and each other, and the player tows NPCs for a fee or for free. An NPC's offer to a broke player is free (fee 0, decided at the offer, with its own `towFree` radio topic). Raiders tow only raiders, and only raiders or the player tow a raider. A truck on a tow rope has no physics body and trails its tower.
- A tower's `answering` claim has a state timer of 20 turns. It holds while the tower cannot see its client or the client is in combat, and `lapseClaim()` logs `towDropped` with reason `blocked` on expiry. `towInvalid()` then drops the tower's goal. `src/sim/meeting-stop.ts` picks the parking spot beside a truck or stock, and goes around a truck that stands on the approach side.
- `tow.ts` also owns escorts: an `escort` state makes its holder follow the other truck, fight its attackers, tow it when stranded and collect the fee on arrival. The `follow` goal is the reusable group activity. It holds while its driver keeps any following state toward the leader, so new group work adds a state kind, not a goal. Mercs are hired through the `escortSeen` and `hireOffered` decisions, and convoy guards hold a free escort with no destination.
- `src/sim/patch.ts` owns roadside patches.
- `src/sim/aid.ts` owns fuel and supply aid: an `aid` state that moves the goods after a one-turn handover the player starts with [E] while both trucks are parked side by side, agreed through the `offerAid`, `askAid` and `aidOffer` topics and the `needySeen` decision.
