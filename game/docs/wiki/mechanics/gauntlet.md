# Gauntlet

A highway combat run between outposts, picked at New game. The principles and the exceptions to Roaming are in [DESIGN.md](../../DESIGN.md#game-modes). The numbers live in `GAUNTLET` in `src/data/gauntlet.ts`, and the rules in `src/sim/gauntlet.ts`, `src/sim/gauntlet-layout.ts` and `src/sim/outposts.ts`.

## Mode rules

Each mode is a row of `GAME_MODES` in `src/data/modes.ts` with a record of rule flags. `modeRules()` in `src/sim/settings.ts` is the only reader, and each gate reads one flag. Roaming sets every flag on. Gauntlet sets every flag off:

- `traffic`: no starting traffic, no spawn timers and no shops.
- `salvage`: no salvage at start or on renewal, no salvage on a wreck, and spilled or dumped cargo is gone.
- `knockouts`: a beaten NPC is wrecked, and a player knockout ends the run.
- `yielding`: no NPC flees, offers or takes a truce, begs, spares, offers or takes surrender, complies, gives up a fight, backs off or leaves a fight for service. A truck with no gun keeps its fight and rams.
- `radio`: no calls, hails, horn or pleas.
- `rescue`: no beacon, tows or scrap patches. A stranded truck waits for good.
- `roadWrecks`: no random road wrecks.

The world settings apply as in Roaming.

## Course

The world seed picks one of the two Bowl to Nose roads and a direction from its own stream. The course runs from 24 tiles outside the start town to 24 tiles outside the end town, about 600 tiles. It splits into 4 stretches, each up to 12% longer or shorter than an even split. The player starts on the course, in a lane, heading along it.

The road is 6 tiles wide and holds four lanes, with centers at 0.75 and 2.25 tiles each side of the middle. Each stretch has obstacle rows: 2, 3, 3 and 4 rows. A row is a wreck, a barrier, a tank trap or drums in 1 lane in the first two stretches, and in 1 or 2 lanes after. Rows stand at least 14 tiles apart, 24 tiles past the start and 16 tiles from an outpost, and never on a bridge deck or near a site. Open ground beside the road is always drivable.

## Outposts

An outpost stands at the end of each stretch, 7 tiles beside the road, on the side with clear ground. It has a pad of 3 tiles radius, a guard post, a shack, drums and a barrier, and a world label "Outpost N". Each outpost holds 2, 3, 4 and 5 parts from the garage table.

Parking on the pad of the next outpost while out of combat completes the stretch, in the same turn. A combat state ends 10 turns after the last hostile act, so the player wrecks the pursuers or outruns them. Completion pays 150, 250, 350 and 500 M's for the stretch, plus 30, 40, 50 and 60 M's for each wrecked truck of its groups. The outpost is marked paid, so it never pays again, even after a reload. The surviving trucks of the stretch leave the road. The game autosaves on arrival.

At a paid outpost the player can repair all or the basics at the garage price, buy fuel and supplies at the town price, buy a stock part onto the truck and buy parts for field patching at 1.5 times their value. Outposts buy nothing.

After the fourth outpost the run is complete. No more groups come, and the world stays playable.

## Hostile groups

Each stretch plans its groups from raider templates at a gear level. Stretch 1 has 1 light buggy, stretch 2 has two light buggies, one ahead and one behind, stretch 3 has three standard buggies in two groups, and stretch 4 has three groups of three heavy trucks with gunwagons. A group has an anchor along its stretch. A group ahead spawns when the player comes within 32 tiles of its anchor, at least 22 tiles ahead. A group behind spawns once the player passes its anchor, 24 tiles behind. No more than 8 group trucks are on the road at once, and a group waits until it fits. A group with no free lane spot tries again each turn and fails loudly after 20 turns.

Group trucks spawn with full tanks and no cargo. Each holds a feud on the player and hunts the player's position every turn until the stretch ends.

## Defeat

A player knockout ends the run as Wrecked. A stranded player can end the run from the stranded panel, which is the only way out of an empty tank or a broken drive with no parts to patch. The death screen shows the stretch reached and offers Load save, Restart run with the same settings and a new seed, and New game.

A carried-over Gauntlet save starts a fresh run at stretch 1 with its truck.

## Start

The Gauntlet kit is a hauler with a cannon, a heavy MG, an MG, a workhorse diesel, a ram, two plates and a rack, a full tank, base supplies, 4 parts for field patching and 200 M's.
