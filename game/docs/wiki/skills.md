# Skills

Skills and perks are owned by `src/sim/progress.ts`, and the numbers live in `src/data/skills.ts`. `practice()` is the only way to gain XP, and it adds to one shared pool. `buyRank()` spends the pool on the next rank of any skill, in order, for good. Each XP source belongs to an activity family, named by its skill, and each family has its own daily cap. Every practice event names a target, and repeats on one target pay less by the source's repeat factor. The count of earlier events halves every `XP_RULES.repeatHalfLife` turns.

## Skills

<!-- wiki:skills -->
| id | name | earns XP from | effects per rank |
| --- | --- | --- | --- |
| driving | Driving | rough ground, rams, escapes | {"turnRate":0.1,"crashDamage":0.1,"roughSpeed":0.1,"crawl":0.1} |
| perception | Perception | hits, contacts, discoveries | {"spread":0.05,"sight":0.04,"hearing":0.08,"contactFix":0.08} |
| machining | Machining | field jobs, patches, searches | {"repair":0.1,"fieldCap":0.04,"refit":0.08,"search":0.08,"engineHeat":0.08} |
| toughness | Toughness | heat, damage taken, knockouts | {"supplies":0.12,"maxHealth":0.06,"cabShare":0.08,"heatDrain":0.08} |
| social | Social | trade profit, deals, contracts, radio | {"priceSpread":0.02,"towFee":0.06,"patchPrice":0.06,"robberyDanger":0.08} |
<!-- /wiki:skills -->

## Rank costs

<!-- wiki:rank-costs -->
| rank | xp cost |
| --- | --- |
| 1 | 200 |
| 2 | 400 |
| 3 | 600 |
| 4 | 800 |
| 5 | 1000 |
<!-- /wiki:rank-costs -->

## XP sources

<!-- wiki:xp-sources -->
| source | activity family | weight (xp per unit) | scaled by difficulty | repeat factor |
| --- | --- | --- | --- | --- |
| roughTiles | driving | 0.5 | true | 0.9 |
| ram | driving | 0.25 | true | 0.7 |
| escape | driving | 8 | true | 0.25 |
| hit | perception | 6 | true | 0.95 |
| contact | perception | 0.25 | true | 0.5 |
| discover | perception | 10 | false | 0 |
| fieldJob | machining | 0.75 | false | 0.7 |
| patch | machining | 75 | false | 0.5 |
| search | machining | 80 | false | 0 |
| heat | toughness | 0.3 | true | 0.9 |
| damage | toughness | 1.5 | false | 0.95 |
| knockout | toughness | 100 | false | 0.5 |
| profit | social | 0.024 | false | 0.8 |
| deal | social | 30 | false | 0.5 |
| call | social | 8 | false | 0 |
| honk | social | 2 | false | 0 |
| contract | social | 1 | false | 0.8 |
| freeTow | social | 0.024 | false | 0.5 |
| aid | social | 0.024 | false | 0.5 |
<!-- /wiki:xp-sources -->

## Perks

<!-- wiki:perks -->
| id | name | skill | rank | rule |
| --- | --- | --- | --- | --- |
| rammer | Rammer | driving | 2 | A ram on a hostile truck stalls its engine for one turn. |
| coldRunning | Cold running | driving | 2 | Below half speed, your engine is heard only inside sight. |
| steadyAim | Steady aim | driving | 4 | Your own speed adds no scatter to your shots. |
| dustScreen | Dust screen | driving | 4 | At top speed on dusty ground, your dust blocks sight like a hill. |
| readDriver | Read the driver | perception | 2 | You see the traits of other drivers. |
| spotter | Spotter | perception | 2 | Mark a seen truck, and it stays tracked for a day. |
| cargoEye | Cargo eye | perception | 4 | You see the goods and spare parts in any seen truck. |
| nightEyes | Night eyes | perception | 4 | Night does not halve your sight. |
| welder | Welder | machining | 2 | A field job turns 3 scrap metal into a scrap armor sheet. |
| cannibal | Cannibal | machining | 2 | Taking a part from a wreck or a knocked-out truck takes one turn. |
| rebuild | Rebuild | machining | 4 | A town garage can repair a junk part to its last wear step, once per part. |
| roadMechanic | Road mechanic | machining | 4 | Drivers pay double for the patches you do. |
| desertRat | Desert rat | toughness | 2 | Noon sun heats your engine like morning sun. |
| stormRider | Storm rider | toughness | 2 | Dust storms do not cut your sight or aim. |
| fightThrough | Fight through | toughness | 4 | A broken cab, or a hit on a cab below half, does not knock you out while health is above half. |
| longHaul | Long haul | toughness | 4 | You heal while driving, not only while parked. |
| marketEars | Market ears | social | 2 | A trader you call tells you the prices of the last town it left, as they were then. |
| rumorMill | Rumor mill | social | 2 | A driver you call marks a wreck or site it passed. |
| paidTruce | Paid truce | social | 4 | You can pay a hostile driver to end its feud with you. |
| bountyTalk | Bounty talk | social | 4 | A raider that gives up to you counts for bounty contracts. |
<!-- /wiki:perks -->

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
| `XP_RULES.repeatHalfLife` | 200 |
<!-- /wiki:numbers -->
