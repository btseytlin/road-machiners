# Game wiki

Reference for the numbers and content of Road Machiners, for people and agents who would otherwise search the code. Design intent lives in [DESIGN.md](../DESIGN.md). Each page below mixes prose with tables generated from `src/data/`.

Pages:

- [items.md](items.md): chassis, weapons, engines, armor, cargo, scanners, stores, utilities, core parts and goods.
- [combat.md](combat.md): how a turn of fire, armor and crashes resolves.
- [economy.md](economy.md): prices, shops, contracts and upkeep.
- [npcs.md](npcs.md): NPC templates, traits, decisions and states.
- [skills.md](skills.md): skills, XP and perks.
- [assets.md](assets.md): models and sound cues.

Mechanics pages hold the detailed rules of each system in prose, one page per section of DESIGN.md:

- [character.md](mechanics/character.md): skills, XP and perks.
- [truck.md](mechanics/truck.md): the grid, refits, mass, gun power draw, utilities, the claymore ram, wear and field repair.
- [turns.md](mechanics/turns.md): turns, orders, routes, crashes, guns, armor and using utilities.
- [defeat.md](mechanics/defeat.md): knockouts, looting, stranding, tows, healing, death and saves.
- [detection.md](mechanics/detection.md): sight, sound, dust, scanners and flares.
- [world.md](mechanics/world.md): the map, sites, time of day, weather and engine heat.
- [world-settings.md](mechanics/world-settings.md): game modes, the world settings picked at New game, and which rules are settings.
- [npcs.md](mechanics/npcs.md): NPC activities, traits, states and escorts.
- [social.md](mechanics/social.md): radio topics and the horn.
- [economy.md](mechanics/economy.md): prices, shops, contracts, hidden salvage, fuel and supplies.
- [content.md](mechanics/content.md): what the prototype contains.

## Generated blocks

A table sits between `<!-- wiki:<id> -->` and `<!-- /wiki:<id> -->`. `npm run wiki` rewrites every block from the code and leaves the prose alone. Never edit a block by hand. Every page ends with a `numbers` block: each data path the page's prose names, like `RULES.leadError`, with its current value.

`npm test` runs `src/wiki/wiki.test.ts`. It fails when a block differs from the fresh render, when a data path in prose no longer resolves, when a `src/` file named in prose is gone, or when a table id is on no page or on two. Fix a failure by running `npm run wiki`. If a path no longer resolves, fix the prose. The check does not notice a change to the logic of a formula, so re-read the prose when its owner file changes.

## Units

Tables show sim units and name the unit in the header: tiles, turns, kilograms, degrees and grid cells. Speeds are tiles per turn. Sizes that matter to display are converted in `src/ui/units.ts`.

One tile is `PHYSICS.metersPerTile` meters.

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
| `RULES.leadError` | 4.5 |
| `PHYSICS.metersPerTile` | 4 |
<!-- /wiki:numbers -->
