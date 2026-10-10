# Fury Road

An endless highway combat run north, with outposts as milestones, picked at New game. The principles and the exceptions to Roaming are in [DESIGN.md](../../DESIGN.md#game-modes). The numbers live in `FURY_ROAD` and `HIGHWAY` in `src/data/modes.ts`. The land comes from `src/sim/highway.ts`, and the run rules from `src/sim/fury-road.ts` and `src/sim/outposts.ts`.

## Mode rules

Each mode is a row of `GAME_MODES` in `src/data/modes.ts` with a record of rule flags. `modeRules()` in `src/sim/settings.ts` is the only reader, and each gate reads one flag. Roaming sets every flag on. Fury Road sets every flag off:

- `traffic`: no starting traffic, no spawn timers and no shops.
- `salvage`: no salvage at start or on renewal, no old-world loot spots, no salvage on a wreck, and spilled or dumped cargo is gone.
- `knockouts`: a beaten NPC is wrecked, and a player knockout ends the run.
- `yielding`: no NPC flees, offers or takes a truce, begs, spares, offers or takes surrender, complies, gives up a fight, backs off or leaves a fight for service. A truck with no gun keeps its fight and rams.
- `radio`: no calls, hails, horn or pleas.
- `rescue`: no beacon, tows or scrap patches. A stranded truck waits for good.
- `roadWrecks`: no random road wrecks.

A mode that turns on `traffic` or `rescue` needs a map with towns, so a new world throws on any other. The world settings apply as in Roaming.

## The highway

Fury Road plays on its own generated map, never on Icarus. The world seed builds the land. North in this mode is up the screen: the highway runs straight up it, bending less than 6° by seeded noise, and its height rises and falls under the road grade.

- The road is one carriageway of four northbound lanes, 2 tiles (8 m) each, with centers 1 and 3 tiles each side of the middle and a 1-tile shoulder, 10 tiles (40 m) of asphalt in all. Three dashed dividers and two solid edge lines mark it, with no middle line.
- A flat verge of hardpan and sand runs 13 tiles beside the asphalt on each side, so the drivable corridor is 36 tiles (144 m) wide: room for a full-speed U-turn and for a fight at gun range. Only poles, the odd ditched car and billboards stand near it. Past the verge come badlands of gravel, scrub and scree with rocks, crags and dead trees, then a ridge too steep to climb.
- An Old World power line runs along one verge of each stretch.

## Scenes

A stretch alternates open arenas of at least 36 tiles, where fights start, with hazard scenes: 3 in stretches 1 and 2, then 4. The first and last 24 and 30 tiles by the outposts stay clear. Each scene is laid from a recipe with a cause, and always leaves a way through on the road:

- Pileup: 3 to 6 car wrecks and burnt truck hulks over 1 or 2 lanes, slewed 20° to 80° off the road, with drums and junk spilled ahead.
- Jackknife: a bus or hauler hulk across two lanes at 60° to 90°, with 1 or 2 cars rear-ended behind it.
- Checkpoint: 2 or 3 barrier lines, each across two lanes and a shoulder on alternate sides, 10 tiles apart, so the road becomes a chicane. Sandbags sit behind each line, tank traps on its verge and an army truck beside one.
- Tank line: a dead tank on a verge and 6 to 10 tank traps in two staggered rows over 1 or 2 lanes, 3 to 4 tiles apart.
- Rockfall: a crag on the badlands edge and 6 to 12 rocks fanning onto the verge and the outer lane, smaller toward the road.
- Craters: 2 to 4 gravel dips on the lanes, with junk at their rims. They slow and jolt a truck but block nothing.
- Ramp: a Fallen Sun hull plate in one lane, 3 tiles wide, rising 0.35 over 5 tiles toward the north, sometimes just before a crater. A truck at speed flies off it. It is never the only way through.

Early stretches lean to pileups, rockfalls and craters, later ones to checkpoints and tank lines. A scene covers at most 2 of the 4 lanes up to stretch 2, then at most 3.

## Windows

The land is generated as you go, in windows of 320 by 320 tiles (1.28 km) along the screen's diagonal.

- Milestone 0 is the start, and milestone `j` stands 311 tiles (1.24 km) further up the road for each `j`. A window holds two milestones: the one the player last reached, near its lower right corner, and the next outpost, near its upper left one.
- Every height, ground type, prop and ramp is a pure function of the seed and its place along and across the road. So two windows agree exactly where they overlap, and a reload rebuilds the same land.
- Parking at the next outpost opens the window beyond it. The world moves 220 tiles down and right under the truck, so the truck stands on the same pad on the same ground. The trucks left behind, their wrecks, smoke, craters and states are gone.
- In the game the move autosaves and reloads the page onto the new window, with the boot step "Opening the road north". The payout line comes back in the log.
- Two closures shut each window's road from ridge to ridge: a burnt pileup of two staggered rows of hulks and cars behind the start, and the next outpost's checkpoint, two staggered barrier lines with sandbags and tank traps, 16 tiles past it. There is no way back past the last outpost.

## Outposts

An outpost stands at each milestone from 1 on: a walled fort with the Salvage Yard's walls, corner towers, gate and yard, set beside the road on a side drawn from the seed, with its gate facing the road. A concrete spur runs from the asphalt across the town pad, 5 by 7 tiles, to the gate. Its label shows `???` until the player sees it, then "Outpost N", and discovering it gives the discovery line and XP as any site does. It holds 2 parts from the garage table, plus 1 for every 2 milestones, up to 6, rolled when its window opens.

Parking on the pad of the next outpost while out of combat completes the stretch, in the same turn. A combat state ends 10 turns after the last hostile act, so the player wrecks the pursuers or outruns them. Completion pays 300 M's for stretch 1, 150 M's more for each later stretch, up to 1,200 M's, plus 60 M's for each wrecked truck of its groups, 15 M's more each stretch, up to 150 M's. The outpost is marked paid, so it never pays again, even after a reload. The surviving trucks of the stretch leave the road.

At a paid outpost the player can repair all or the basics at the garage price, buy fuel and supplies at the town price, buy a stock part onto the truck and buy parts for field patching at 1.5 times their value. Outposts buy nothing.

The run has no end. The HUD's run readout shows the stretch and the distance to its outpost, like `3: 640 m`, and its tooltip reads "Stretch 3: 640 m to Outpost 3".

## Hostile groups

Each stretch plans its groups from raider templates at a gear level. Stretch 1 has 1 light buggy ahead. Stretches 2 and 3 add a light buggy behind. Stretch 4 has standard buggies, one ahead and one behind, and stretch 5 three of them. Stretch 6 brings a gunwagon, stretch 7 heavy gear in two groups, 5 trucks in all, and stretch 8 loaded gear in three groups, 8 trucks in all. Every stretch past 8 repeats stretch 8, so danger rises for 8 stretches and then holds.

A group's anchor is the middle of one of its stretch's arenas past the first, drawn from the seed, so fights start in the open with the next scene ahead. A group ahead spawns when the player comes within 32 tiles of its anchor, at least 22 tiles ahead. A group behind spawns once the player passes its anchor, 24 tiles behind. Groups spawn in the lanes or on the verges, inside the window. No more than 8 group trucks are on the road at once, and a group waits until it fits. A group with no free lane spot tries again each turn and fails loudly after 20 turns.

Group trucks spawn with full tanks and no cargo. Each holds a feud on the player and hunts the player's position every turn until the stretch ends.

## Defeat

A player knockout ends the run as Wrecked. A stranded player can end the run from the stranded panel, which is the only way out of an empty tank or a broken drive with no parts to patch. The death screen names the mode, the last outpost reached and how far north the truck got, and offers Load save, Restart run with the same settings and a new seed, and New game.

A carried-over Fury Road save starts a fresh run at stretch 1 with its truck. So does a save from a build whose highway rules changed.

## Start

The run starts at milestone 0 in the inner right lane, heading up the screen. The Fury Road kit is a hauler with a cannon, a heavy MG, an MG, a workhorse diesel, a ram, two plates and a rack, a full tank, base supplies, 4 parts for field patching and 200 M's.
