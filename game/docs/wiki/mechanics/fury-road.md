# Fury Road

An endless highway combat run north, with outposts as milestones, picked at New game. The principles and the exceptions to Roaming are in [DESIGN.md](../../DESIGN.md#game-modes). The numbers live in `FURY_ROAD` and `HIGHWAY` in `src/data/fury-road.ts`. The land comes from `src/sim/highway.ts`, and the run rules from `src/sim/fury-road.ts` and `src/sim/outposts.ts`.

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

Fury Road plays on its own generated map, never on Icarus. The world seed builds the land: a four-lane asphalt highway runs north through open desert, between low ridges that rise into valley walls at the map edges. Map north is up the map, toward the upper right of the screen.

- The road is 6 tiles (24 m) wide and holds four lanes, with centers at 0.75 and 2.25 tiles each side of the middle. Faded paint marks its edges, a middle line and dashed dividers. Its line bends gently by seeded noise, never tighter than a 60 tile radius, and its height rises and falls under the road grade.
- A hard shoulder of hardpan runs beside the asphalt. Past it the ground is sand, hardpan, scrub, gravel and scree, with rocks, crags, dead trees, car wrecks and dead trucks on the shoulders, poles and the odd billboard.
- Each stretch has obstacle rows: 2 in stretch 1, one more every 2 stretches, up to 5. A row is a car wreck, a barrier, a tank trap or drums in 1 lane in stretches 1 and 2, and in 1 or 2 lanes after. Rows stand at least 14 tiles apart and 16 tiles from an outpost. Open ground beside the road is always drivable.

## Windows

The land is generated as you go, in windows of 320 by 320 tiles (1.28 km).

- Milestone 0 is the start, and milestone `j` stands 240 tiles (960 m) further north for each `j`. A window holds two milestones: the one the player last reached, 40 tiles inside its south edge, and the next outpost, 40 tiles inside its north edge.
- Every height, ground type and prop is a pure function of the seed and its place north of the start. So two windows agree exactly where they overlap, and a reload rebuilds the same land.
- Parking at the next outpost opens the window beyond it. The world moves 240 tiles south under the truck, so the truck stands on the same pad on the same ground. The trucks left behind, their wrecks, smoke, craters and states are gone.
- In the game the move autosaves and reloads the page onto the new window, with the boot step "Opening the road north". The payout line comes back in the log.
- A barricade of tank traps and barriers closes the road near the south edge of each window, and a barrier line stands across the road just past the unreached outpost, its checkpoint. The valley walls close the sides. There is no way back past the last outpost.

## Outposts

An outpost stands at each milestone from 1 on, 7 tiles beside the road on a side drawn from the seed. It has a concrete pad of 3 tiles radius, a guard post, a shack, drums and a barrier, and a world label "Outpost N". It holds 2 parts from the garage table, plus 1 for every 2 milestones, up to 6, rolled when its window opens.

Parking on the pad of the next outpost while out of combat completes the stretch, in the same turn. A combat state ends 10 turns after the last hostile act, so the player wrecks the pursuers or outruns them. Completion pays 300 M's for stretch 1, 150 M's more for each later stretch, up to 1,200 M's, plus 60 M's for each wrecked truck of its groups, 15 M's more each stretch, up to 150 M's. The outpost is marked paid, so it never pays again, even after a reload. The surviving trucks of the stretch leave the road.

At a paid outpost the player can repair all or the basics at the garage price, buy fuel and supplies at the town price, buy a stock part onto the truck and buy parts for field patching at 1.5 times their value. Outposts buy nothing.

The run has no end. The HUD's run readout shows the stretch and the distance to its outpost, like `3: 640 m`.

## Hostile groups

Each stretch plans its groups from raider templates at a gear level. Stretch 1 has 1 light buggy ahead. Stretches 2 and 3 add a light buggy behind. Stretch 4 has standard buggies, one ahead and one behind, and stretch 5 three of them. Stretch 6 brings a gunwagon, stretch 7 heavy gear in two groups, 5 trucks in all, and stretch 8 loaded gear in three groups, 8 trucks in all. Every stretch past 8 repeats stretch 8, so danger rises for 8 stretches and then holds.

A group has an anchor along its stretch. A group ahead spawns when the player comes within 32 tiles of its anchor, at least 22 tiles ahead. A group behind spawns once the player passes its anchor, 24 tiles behind. Groups spawn in the lanes, inside the window. No more than 8 group trucks are on the road at once, and a group waits until it fits. A group with no free lane spot tries again each turn and fails loudly after 20 turns.

Group trucks spawn with full tanks and no cargo. Each holds a feud on the player and hunts the player's position every turn until the stretch ends.

## Defeat

A player knockout ends the run as Wrecked. A stranded player can end the run from the stranded panel, which is the only way out of an empty tank or a broken drive with no parts to patch. The death screen shows the last outpost reached and how far north the truck got, and offers Load save, Restart run with the same settings and a new seed, and New game.

A carried-over Fury Road save starts a fresh run at stretch 1 with its truck. So does a save from a build whose highway rules changed.

## Start

The run starts at milestone 0 in the second lane, heading north. The Fury Road kit is a hauler with a cannon, a heavy MG, an MG, a workhorse diesel, a ram, two plates and a rack, a full tank, base supplies, 4 parts for field patching and 200 M's.
