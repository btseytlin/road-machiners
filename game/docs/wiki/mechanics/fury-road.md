# Fury Road

An endless highway combat run north, with outposts as milestones, picked at New game. The principles and the exceptions to Roaming are in [DESIGN.md](../../DESIGN.md#game-modes). The numbers live in `FURY_ROAD` and `HIGHWAY` in `src/data/modes.ts`. The land comes from `src/sim/highway.ts`, and the run rules from `src/sim/fury-road.ts` and `src/sim/outposts.ts`.

## Mode rules

Each mode is a row of `GAME_MODES` in `src/data/modes.ts`: its rule flags, its start kit and the map a new world of it is laid on, `icarus` or `highway`. `src/sim/settings.ts` is the only reader: `modeRules()` for a world, and `modeRulesOf()` and `modeMap()` for a setup with no world yet. Each gate reads one flag, and no code outside the mode table and the mode picker tests a mode's id. Roaming sets every flag on but `run`. Fury Road sets only `run`:

- `traffic`: no starting traffic, no spawn timers and no shops.
- `looting`: no salvage at start or on renewal, no old-world loot spots, no salvage on a wreck, no story wrecks, no cargo handovers, and spilled or dumped cargo is gone.
- `knockouts`: a beaten NPC is wrecked, and a player knockout ends the run.
- `yielding`: no NPC flees, offers or takes a truce, begs, spares, offers or takes surrender, complies, gives up a fight, backs off or leaves a fight for service. A truck with no gun keeps its fight and rams.
- `radio`: no calls, hails, horn or pleas.
- `rescue`: no beacon, tows or scrap patches. A stranded truck waits for good.
- `roadWrecks`: no random road wrecks.
- `run`: the world plays a run of stretches between outposts, with hostile groups and payouts. The run's own rules act only on the trucks of its groups, so they need no other check.

A mode that turns on `traffic` or `rescue` needs a map with towns, so a new world throws on any other. The world settings apply as in Roaming.

## The highway

Fury Road plays on its own generated map, never on Icarus. The world seed builds the land. North in this mode is map north, which the fixed camera draws from the bottom left of the screen toward the top right, about 27° above the horizontal. The road's height rises and falls under the road grade.

Each stretch bends once. The road runs straight for 60 tiles after each outpost and before the next one, so the forts, closures and window overlaps stand on straight road. Between them it swings to one side and back: 16 to 36 tiles off its line, to a side drawn from the seed, over two cosine ramps of about 95 tiles each. One stretch in five stays straight. The heading stays within 35° of north, so on screen the road always climbs to the right, between about 8° and 60° above the horizontal, and no bend is tighter than a radius of 40 tiles. The bend numbers live in `HIGHWAY`.

- The road is one carriageway of four northbound lanes, 2 tiles (8 m) each, with centers 1 and 3 tiles each side of the middle and a 1-tile shoulder, 10 tiles (40 m) of asphalt in all. Three dashed dividers and two solid edge lines mark it, with no middle line.
- A flat verge of hardpan and sand runs 13 tiles beside the asphalt on each side, so the drivable corridor is 36 tiles (144 m) wide: room for a full-speed U-turn and for a fight at gun range. Hardpan is barely slower than asphalt, so a route through a bend takes the racing line on the inside verge. Only poles, the odd ditched car and billboards stand near it. Past the verge come badlands of gravel, scrub and scree with rocks, crags and dead trees, then a ridge too steep to climb.
- An Old World power line runs along one verge of each stretch.

## Scenes

A stretch alternates open arenas of at least 36 tiles, where fights start, with hazard scenes: 3 in stretches 1 and 2, then 4. The first and last 24 and 30 tiles by the outposts stay clear. Each scene is laid from a recipe with a cause, and always leaves a way through on the road:

- Pileup: 3 to 6 car wrecks and burnt truck hulks over 1 or 2 lanes, slewed 20° to 80° off the road, with drums and junk spilled ahead.
- Jackknife: a bus or hauler hulk across two lanes at 60° to 90°, with 1 or 2 cars rear-ended behind it.
- Checkpoint: 2 or 3 barrier lines, each across two lanes and a shoulder on alternate sides, 10 tiles apart, so the road becomes a chicane. Sandbags sit behind each line, tank traps on its verge and an army truck beside one.
- Tank line: a dead tank on a verge and 6 to 10 tank traps in two staggered rows over 1 or 2 lanes, 3 to 4 tiles apart.
- Rockfall: a crag on the badlands edge and 6 to 12 rocks fanning onto the verge and the outer lane, smaller toward the road. The rocks keep 0.6 tiles apart, so they stay apart on the inside of a bend.
- Craters: 2 to 4 gravel dips on the lanes, with junk at their rims. They slow and jolt a truck but block nothing.
- Ramp: a Fallen Sun hull plate in one lane, 3 tiles wide, rising 0.35 over 5 tiles toward the north, sometimes just before a crater. A truck at speed flies off it. It is never the only way through.

Early stretches lean to pileups, rockfalls and craters, later ones to checkpoints and tank lines. A scene covers at most 2 of the 4 lanes up to stretch 2, then at most 3.

## Windows

The land is generated as you go, in windows of 410 by 410 tiles (1.64 km), each 310 tiles further north than the last.

- Milestone 0 is the start, and milestone `j` stands 310 tiles (1.24 km) further up the road for each `j`. A window holds two milestones on its middle column: the one the player last reached, 50 tiles from its south edge, and the next outpost, 50 tiles from its north edge.
- Every height, ground type, prop and ramp is a pure function of the seed and its place along and across the road. So two windows agree exactly where they overlap, and a reload rebuilds the same land.
- Waiting for the road at a paid outpost opens the window beyond it. The world moves 310 tiles south under the truck, so the truck stands on the same pad on the same ground. The wrecks, smoke, craters and states left behind are gone.
- In the game the wait autosaves and reloads the page onto the new window, with the boot step "Opening the road north".
- Two closures shut each window's road from ridge to ridge: a burnt pileup of two staggered rows of hulks and cars 26 tiles behind the last outpost, and the next outpost's checkpoint, two staggered barrier lines with sandbags and tank traps, 16 tiles past it. There is no way back past the last outpost.

## Outposts

An outpost stands at each milestone from 1 on: a walled fort with the Salvage Yard's walls, corner towers, gate and yard, set beside the road on a side drawn from the seed, with its gate facing the road. A concrete spur runs from the asphalt across the town pad, 5 by 7 tiles, to the gate. Its label shows `???` until the player sees it, then "Outpost N", and discovering it gives the discovery line and XP as any site does. It holds 2 parts from the garage table, plus 1 for every 2 milestones, up to 6, rolled when its window opens.

Parking on the pad of the next outpost wins the level in that turn, in combat or out. It pays 300 M's for stretch 1, 150 M's more for each later stretch, up to 1,200 M's, plus 60 M's for each wrecked truck of its groups, 15 M's more each stretch, up to 150 M's. The outpost is marked paid, so it never pays again, even after a reload. The surviving trucks of the stretch leave the road and their fights end, so the player is out of combat at once. Their wrecks give no pay.

Between levels nothing spawns, even if the player drives off the pad and back. At a paid outpost the player can repair all or the basics at the garage price, buy fuel and supplies at the town price, buy a stock part onto the truck and buy parts for field patching at 1.5 times their value. Each outpost stocks exactly two parts of every part type, rolled from the seed when the outpost is made and kept in the save. Outposts buy nothing. The next level starts only when the player, parked on the pad, presses Wait for the road on the outpost screen.

The run has no end. The HUD's run readout shows the stretch and the distance to its outpost, like `3: 640 m`, and its tooltip reads "Stretch 3: 640 m to Outpost 3". Between levels it shows the next stretch at its full length.

## Hostile groups

Each stretch plans its groups: their sizes and gear level from its wave, each truck's template from the pool and each group's side.

| Stretch | Group sizes | Gear |
|---|---|---|
| 1 | 1 | light |
| 2 and 3 | 1, 1 | light |
| 4 | 1, 1 | standard |
| 5 | 2, 1 | standard |
| 6 | 2, 2 | standard |
| 7 | 3, 2 | heavy |
| 8 and on | 3, 3, 2 | loaded |

Every stretch past 8 repeats stretch 8, so danger rises for 8 stretches and then holds.

The pool holds every NPC template, so a group mixes every kind of vehicle and driver. Stretches 1 and 2 draw buggies, couriers, scavengers, roamers and traders. Stretches 3 to 5 add gunwagons, vultures, mercs and Bowl farmers, and from stretch 6 Nose army trucks, convoys and convoy guards join. Each truck takes its own template's loadout at the group's gear level. A new template must join the pool in `FURY_ROAD`, and a test fails until it does.

A group comes from ahead, behind, the left or the right, never from the side of the group before it:

- ahead: on the road 22 tiles ahead of the player, in the lanes or on the verges;
- behind: on the road 24 tiles behind;
- left or right: 6 tiles ahead and 22 tiles across, in the badlands, with more trucks 3 tiles apart along the road.

Every spot is inside the window and between its two milestones. No more than 8 group trucks are on the road at once, and a group waits until it fits. A group with no free spot tries again each turn and fails loudly after 20 turns.

Encounters are paced in time. An encounter is on while a live group truck is within 30 tiles of the player. The next group spawns after 20 quiet turns, about 20 seconds of driving, and a level's first group 20 turns after the level starts. Groups spawn in plan order, where the player is, so a fight may meet a scene.

Group trucks spawn with full tanks and no cargo. Each holds a feud on the player and hunts the player's position every turn until the level ends. A group truck races in under overdrive, the same 1.33 boost as the player's, until it first comes within 12 tiles of the player or fights it. From then on it drives at its normal speed for good. An NPC's overdrive costs no engine heat, since only the player's engine heats. A truck with no gun rams.

## Defeat

A player knockout ends the run as Wrecked. A stranded player can end the run from the stranded panel, which is the only way out of an empty tank or a broken drive with no parts to patch. The death screen names the mode, the last outpost reached and how far north the truck got, and offers Load save, Restart run with the same settings and a new seed, and New game.

A carried-over Fury Road save starts a fresh run at stretch 1 with its truck. So does a save from a build whose highway rules changed.

## Start

The run starts at milestone 0 in the inner right lane, heading north toward the top right of the screen. The Fury Road kit is a scout with one MG, a stock engine, a Rebar cage on the front and another on the back, a full tank, base supplies, 4 parts for field patching and 200 M's. It is the same every run.
