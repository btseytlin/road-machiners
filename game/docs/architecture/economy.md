# Economy, jobs and progression

## Economy

- `src/sim/resources.ts` accesses driver resources. NPC fuel and supplies use the player base rules.
- `src/sim/economy.ts` owns paid transactions and part prices, and the scrap patch that gets a broke, stranded or low-on-fuel player moving again at a town. `scrapFuel` is the shared top-up to 40% of the tank that NPC service also uses for a broke driver at a serving site.
- `src/sim/salvage.ts` owns site and wreck stock shared by all collectors, and its daily renewal. It also owns looting a knocked-out NPC truck, where installed parts come off in a refit job whose pickup names the truck. Sites slowly restock, and so do the loot spots of a territory: each baked spot prop gets a stock with its own id and reach at world creation (`isLootSpot`, `spotTable` in `src/sim/territory.ts`) (by the site rule). Looted road wrecks are replaced beyond the player's gray vision.
- NPCs trade, sell and fuel at stalls as well as town garages, and stalls fuel and repair them like garages, except raiders, who sell cargo and get repairs only at their camps. A camp is a fence paying `campGoodPrice()`, with no shop state.
- `src/sim/market.ts` owns shops: goods price pressure, finite part stock, restocks and contract boards. Its rolls draw from `world.marketRng`, a separate stream, so shop changes never shift combat or NPC randomness. `src/data/market.ts` holds shop profiles, the effort model and contract terms.
- Money is whole cents in the sim and data, 100 to an M (`UNITS.centsPerM`). `moneyAmount()` and `moneyText()` in `src/ui/units.ts` are the one money display, and the HUD's `moneyLabel()` builds on them.
- `src/sim/wear.ts` owns part condition: max HP, worn stats, wear steps and junk. Only it writes part HP, and a test enforces that.

## Jobs

`src/sim/jobs.ts` owns parked multi-turn jobs, which moving cancels. Refits, field repair in `src/sim/repair.ts` and searches in `src/sim/search.ts` are jobs. `src/sim/inventory.ts` holds the inventory commands, and `src/sim/grid.ts` answers grid queries. `workOf()` in `src/sim/states.ts` is the one source for timed work a truck does. That is its job or a state whose kind declares work, like a patch. The HUD and the markers over NPCs read only it, so new timed work gets a progress bar.

## Sites

`src/sim/sites.ts` owns site gates and pads. Trucks never enter a site. Gates lie where roads cross the site edge. Small locations keep one gate, and towns and large locations keep one per road. Each gate has a pad outside it. Services, salvage, NPC visits and site clicks all use pads.

## Progression

`src/sim/progress.ts` owns XP, skill ranks and perks. `practice()` is the only way to gain XP, and `xpFor()` is its pure rule. XP goes into the shared pool `player.xp`, and each source's skill names the activity family whose daily cap it counts against. `buyRank()` is the only way to raise a rank, and `skillEffect()` and perk prerequisites read `player.ranks`. Every practice event names a target, and repeats on one target pay less by the source's `repeat` factor. A new XP hook needs a target that a player cannot renew for free. `skillEffect()` and `vehicleHasPerk()` return nothing for any truck but the player's. XP sources, costs, caps, effects and perks live in `src/data/skills.ts`. `src/sim/progression/` holds the bots, the recorder and the replay behind the `progression:` commands. The recorder bots spend the pool with `buyCheapestRanks()`, so their runs play with the effects their XP pays for. Replay reuses `xpFor()`, so tuning XP numbers needs no new recording.
