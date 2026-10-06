# Economy

Items and goods are in [items.md](items.md). The owner code is `src/sim/economy.ts` for paid transactions, `src/sim/market.ts` for shops and contracts, `src/sim/wear.ts` for part condition and `src/data/market.ts` for shop profiles, the effort model and contract terms.

## Value and price

Every price derives from an item's value. A shop sells at value plus a spread of `ECONOMY.spread`, and buys at value minus it, before the Social skill. A truck on the road adds `ECONOMY.roadSpread` on top. Shops make some goods cheaply and need others: `PRICE_FACTOR.make` scales a made good's price. Distance from the source adds `DISTANCE_PREMIUM.perTile` per tile. A part's value is scaled by its wear step with `CONDITION.valueFactor`. The lowest price of a part is its scrap value, `ECONOMY.scrapPerKg` per kilogram.

## Effort model

A value should match the effort it takes to earn. `EFFORT.wage` is the money per turn at each tier and `EFFORT.bands` is the effort range in turns for each tier and item kind. The `npm run econ` command measures wages with bots.

## Goods pressure and drift

Each unit traded moves a good's price by the shop's pressure per unit, and the pressure is limited to `PRESSURE_MAX` on either side of the base price. Pressure drifts back by the shop's drift per turn. Fuel costs `ECONOMY.supplyPrice.fuel` and supplies `ECONOMY.supplyPrice.supplies` per unit.

## Shops

A shop holds a finite, random stock of parts and restocks every so many turns. Only garages repair. Stalls trade, sell and fuel. The `src/sim/market.ts` rolls draw from a separate random stream, so a shop change never shifts combat.

<!-- wiki:shops -->
| id | kind | makes | needs | goods | supplies | stock size (parts) | restock (turns) | pressure per unit | drift per turn | contract slots |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bowl | garage | scrap, grain, textiles, meds, electronics, parts | salt, tools, batteries, fuelDrums, water | scrap, salt, meds, grain, textiles, tools, batteries, electronics, parts, fuelDrums, water | fuel, supplies | 8 to 12 | 400 | 0.005 | 0.0075 | 3 |
| nose | garage | salt, tools, batteries | scrap, grain, textiles, meds, electronics, parts, fuelDrums, water | scrap, salt, meds, grain, textiles, tools, batteries, electronics, parts, fuelDrums, water | fuel, supplies | 8 to 12 | 400 | 0.005 | 0.0075 | 3 |
| salvage-yard | stall | scrap, parts | tools | scrap, parts, tools | fuel, supplies | 2 to 4 | 300 | 0.02 | 0.0075 | 1 |
| granary | stall | grain | salt, textiles | grain, salt, textiles | fuel, supplies | 2 to 4 | 300 | 0.02 | 0.0075 | 1 |
| pump-station | stall | batteries | scrap, parts | batteries, scrap, parts | fuel, supplies | 2 to 4 | 300 | 0.02 | 0.0075 | 1 |
<!-- /wiki:shops -->

## Repair and wear

Repair costs `ECONOMY.repairShare` of a part's value per share of HP restored. A part gains a wear step each time it drops to 0 HP, up to `CONDITION.maxWear`, and each step costs `CONDITION.hpLoss` of its max HP. Wear hits come at `WEAR.chancePerTile` per part per tile driven. A field repair never lifts a part above `REPAIR.fieldCapShare` of its max HP and takes `REPAIR.turnsPerPart` turns per unit of parts. A roadside patch gives `PATCH.share` of max HP.

## Contracts

The player holds at most `CONTRACTS.maxActive` contracts. A contract's window counts from the turn the player accepts it. A haul has a window of `CONTRACTS.haul.durationFactor` times its estimated travel, and pays `CONTRACTS.haul.rewardFactor` tier wages. A share `CONTRACTS.haul.rush.chance` of hauls are rush jobs: their window is `CONTRACTS.haul.rush.durationFactor` times the estimated travel, and they pay `CONTRACTS.haul.rush.premium` times the standard reward. A fetch pays the part's price plus a search fee of `CONTRACTS.fetch.searchFeeTurns` turns of wage. A bounty pays `CONTRACTS.bounty.valueShare` of the target's worth when the player claims it at the shop that posted it, after a knockout or kill of any truck of its type.

## Upkeep

The player's truck pays no upkeep. NPC drivers pay under `NPC_UPKEEP`.

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
| `ECONOMY.spread` | 0.2 |
| `ECONOMY.roadSpread` | 0.3 |
| `PRICE_FACTOR.make` | 0.75 |
| `DISTANCE_PREMIUM.perTile` | 0.0021 |
| `CONDITION.valueFactor` | 1, 0.7, 0.55, 0.45, 0.35 |
| `ECONOMY.scrapPerKg` | 0.19 |
| `EFFORT.wage` | {"1":0.37,"2":1,"3":2.2} |
| `EFFORT.bands` | {"1":{"weapon":[250,700],"engine":[250,700],"armor":[250,700],"cargo":[250,700],"scanner":[250,700],"store":[250,700],"chassis":[5000,7500],"good":[40,100]},"2":{"weapon":[180,480],"engine":[180,480],"armor":[180,480],"cargo":[180,480],"scanner":[180,480],"store":[180,480],"chassis":[2800,4200],"good":[50,100]},"3":{"weapon":[180,380],"engine":[180,380],"armor":[180,380],"cargo":[180,380],"scanner":[180,380],"store":[180,380],"chassis":[1900,2800],"good":[40,80]}} |
| `ECONOMY.supplyPrice.fuel` | 3 |
| `ECONOMY.supplyPrice.supplies` | 5 |
| `ECONOMY.repairShare` | 0.85 |
| `CONDITION.maxWear` | 4 |
| `CONDITION.hpLoss` | 0.1 |
| `WEAR.chancePerTile` | 0.00055 |
| `REPAIR.fieldCapShare` | 0.7 |
| `REPAIR.turnsPerPart` | 2 |
| `PATCH.share` | 0.25 |
| `CONTRACTS.maxActive` | 3 |
| `CONTRACTS.haul.durationFactor` | 8 |
| `CONTRACTS.haul.rewardFactor` | 5 |
| `CONTRACTS.haul.rush.chance` | 0.25 |
| `CONTRACTS.haul.rush.durationFactor` | 1.5 |
| `CONTRACTS.haul.rush.premium` | 1.75 |
| `CONTRACTS.fetch.searchFeeTurns` | 240 |
| `CONTRACTS.bounty.valueShare` | 0.2 |
<!-- /wiki:numbers -->
