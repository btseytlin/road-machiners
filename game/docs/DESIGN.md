# Road Machiners design

RoaM or Road Machiners is a turn-based post-apocalyptic wasteland RPG where you drive an armed truck. 3D world seen from an isometric camera. 

Inspired by Ex Machina, Space Rangers 2, Kenshi, Dustland Delivery, Caravaneer 2 and more.

# Staple Principles

1. Immersive role-playing sandbox

Simple deterministic systems that, when combined, produce a living immersive chaotic world of a post-apocalyptic society on armed trucks. Whenever reasonable, player and NPCs play by the same rules of this simulation. But never at the expense of player's fun.

2. Memorable rare tactical combat 

Peaceful time of traveling, shopping and looting is interrupted by occasional high-stakes combat encounters.

Combat is not just whoever has the best equipment wins or pure-micromanagement. It depends on choosing youre battles, preparation, tactics and risk-appetite. 

3. Discoverable mechanics and no hand-holding

Most things a player can do he can discover by watching NPCs do it or by trying.

4. Life is valued in the wasteland

In the wasteland, after the great catastrophe, life is valued. Robbery and blowing up each other's trucks are just business, but in most situations murder is too much. Even raiders consider killing a last resort.

5. Avoiding equipment snowballing

In RoaM, your truck, it's weapons and armor degrade and can be taken away from you. This doesn't end the game, but is a core part of the game. The player has to reinvent his loadout, which allows to try different approaches in a single playthrough, without being locked to a build. 

6. Game progression through actions

The player's progression in the game is not simply accumulating more money, gear or experience points. Those are all resources to achieve milestone actions that position them in the world.

7. Player is not the main character

The player is not a Chosen one, gets no plot armor or special treatment. It's down to the player's wits to get the upper hand over the harsh world. The game does not tell the player how to play or what is right. Being a raider, robbing other drivers or becoming the biggest scumbag in the wasteland are all valid paths if that's fun for the player.

8. New World vs Old World contrasts

The lore and atmosphere is based on contrasts between the pre-apocalypse Old World and the currently living New World. Armed trucks are riding around crashed spaceships on what used to be farming fields.

# Core systems

Each section states what a system is for and the rules it must keep. The detailed rules live in [docs/wiki/mechanics/](wiki/mechanics/), and the numbers and content tables in [docs/wiki/](wiki/README.md).

## Character

The driver is the only thing that stays with the player when the truck changes. Doing things earns experience, and the player spends it freely on ranks of five broad skills, each touching several activities. Hard actions teach more than easy ones, repeating one action on one target teaches less and less, and each kind of activity has a daily limit, so grinding never pays. Perks split each skill into two playstyles. A perk adds an action, breaks a rule or reveals information. It never multiplies a number the skill already grows.

Details: [character](wiki/mechanics/character.md), [skills tables](wiki/skills.md).

## Truck

The truck is equipment, not the character. It can be changed, upgraded, stripped and lost. The inventory grid is a top view of the truck where every cell is a tradeoff: a deck cell holds a gun, a scanner or cargo, never all three. Mass and engine power are soft limits: each kilogram and each gun costs speed, so no truck is best at everything. Every part has one job and one weakness, and no part beats another of its kind at everything but price. Parts wear, break down on the road and finally turn to junk, so a loadout never settles for good and old trucks give way to new ones.

Details: [truck](wiki/mechanics/truck.md), [items tables](wiki/items.md).

## Turns and driving

Travel and combat share one map and one clock, in Space Rangers 2 style. Planning is free and time runs only while a turn plays. A turn is a commitment: momentum carries into the next one, and all trucks move and fire at the same time. Physics decides slopes, bumps and crashes. Outside danger, automatic travel removes the busywork of driving. Roads are where drivers meet and help each other. Open ground is faster and lonelier.

Details: [turns, driving and combat](wiki/mechanics/turns.md).

## Combat

Fights are rare and decide a lot. Combat starts with a hostile act, not with a hostile in sight, and ends when the two trucks part, make a truce or one is knocked out. Choosing the fight, the loadout and the position beats having the biggest gun. Guns have roles: chippers strip armor, damagers wreck what lies behind it and precision guns hit without being hit, so every fight needs a plan. A round walks the truck's grid part by part, so the layout is the armor. Chances are shown with their causes, and the enemy's state can be heard and seen. Beating a truck pays nothing by itself; the loot is on the truck.

Details: [turns, driving and combat](wiki/mechanics/turns.md), [combat reference](wiki/combat.md).

## Defeat and recovery

Losing starts a new story instead of ending the game, in Kenshi style. A loss is usually a knockout: the winner loots, the loser wakes up and carries on. The player watches it happen on real turns, with no fade screens. A stranded truck is never stuck for good: other drivers tow and patch it for a fee, a beacon calls for help and a broke driver gets patched with scrap in town. Death is rare and comes only from injury. NPCs fall and recover by the same rules.

Details: [defeat and recovery](wiki/mechanics/defeat.md).

## Sight and detection

Information is a resource. Sight is short and blocked by hills, while engine sound, dust and scanners reveal trucks far away as vague contacts. A deck cell spent on a scanner is a cell not spent on a gun. NPCs see and hear by the same rules, so the player can hide, sneak and ambush, and be ambushed.

Details: [sight and detection](wiki/mechanics/detection.md).

## World

Icarus is one fixed region where danger is set by place, not by the player's level. The land tells the story of the Old World under the New World: farm fields, ruins and old highways around crash wreckage and truck roads. Towns and sites are fixed places that trucks use from pads outside their gates. Town guns make a gate a safe place to run to, and raider camps are the opposite. Time of day, sun, shade and weather change what a route costs in fuel, supplies, sight and engine heat.

Details: [world](wiki/mechanics/world.md), [world settings](wiki/mechanics/world-settings.md), [lore](lore.md), [visual design](VISUAL_DESIGN.md).

## NPCs

NPCs are drivers living their own lives by the same rules as the player. A driver has a set of hidden traits instead of a class, a goal stack for its long-term work and weighted decisions for the moments that matter. Anything a driver can do keeps a small chance, so a trader sometimes starts a fight and a scavenger sometimes robs. Drivers judge each other by danger and misjudge it a little. A driver keeps its word: partners in a deal never rob each other. Drivers know fixed places but learn about other trucks only through their own eyes and ears.

Details: [NPCs](wiki/mechanics/npcs.md), [NPC tables](wiki/npcs.md).

## Social

Every truck has a radio, as in Space Rangers 2. Talk is the main way the wasteland resolves things: directions, trade, tows, patches, aid, demands, truces and mercy. Most fights can end in a deal instead of a wreck. Helping others pays in experience and in goodwill. Robbing pays in cargo and in feuds. A driver's traits decide its voice and what it will talk about.

Details: [social](wiki/mechanics/social.md).

## Economy

The wasteland is a living economy that NPC traders move as much as the player. Every item has one value, and every price is a formula from it. Goods are cheap where they are made and dear far away, so profit comes from knowing routes, as in Dustland Delivery. Loot is finite and refills slowly, and nothing appears offscreen to keep the economy going. One turn of play is the unit of effort, and every price and reward is balanced against what a turn earns. Fuel and supplies limit how far a truck can go.

Details: [economy](wiki/mechanics/economy.md), [economy reference](wiki/economy.md), [prototype content](wiki/mechanics/content.md).

## Information

The game shows what the player needs to decide and hides what they should discover. The HUD shows state. The log tells important events and the story, never mechanical state like reloads. Hidden things, like a driver's traits, show themselves through behavior first.

In-character and out-of-character info is separated. For example, in talking NPCs never mention "turns", "quests" or things like that to avoid immersion-breaking. 