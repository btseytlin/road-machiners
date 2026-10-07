# NPCs

NPC behavior has three layers. Traits in `brain.traits` are permanent. A goal stack in `brain.goals` keeps long-term goals under interruptions. Decision points pick reactions by weighted chance. Every available option gets at least `MIN_CHANCE`. The owner code is `src/sim/npc-decisions.ts` for trait profiles and weighted rolls, `src/sim/npc-activities.ts` for the goal stack, `src/sim/npc-loadout.ts` for gear and `src/data/npcs.ts` for all the numbers below.

## Templates

<!-- wiki:npc-templates -->
| id | name | profession | faction | traits | extra traits (chance) | fight style | aggro range (tiles) | preferred range (tiles) | cap | spawn interval (turns) | spawn place |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| buggy | Raider outrider | Raider | raiders | raider | brave (0.15) | circle | 11 | 3 | 6 | 50 | {"kind":"camp"} |
| gunwagon | Gunwagon | Raider | raiders | raider | brave (0.15) | hold | 12 | 6 | 2 | 150 | {"kind":"camp"} |
| trader | Trader caravan | Trader | traders | trader | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 8 | 12 | {"kind":"town"} |
| scavenger | Scavenger | Scavenger | scavengers | scavenger | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 4 | 12 | {"kind":"town"} |
| bowlFarmer | Bowl Farmers patrol | Bowl Farmer | bowl | lawman, brave |  | hold | 0 | 0 | 3 | 70 | {"kind":"sites","ids":["bowl"]} |
| noseArmy | Nose Army patrol | Nose soldier | nose | lawman, brave |  | hold | 0 | 0 | 3 | 70 | {"kind":"sites","ids":["nose"]} |
| courier | Courier | Courier | couriers | courier | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 3 | 30 | {"kind":"town"} |
| roamer | Roamer | Roamer | roamers | roamer | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 3 | 30 | {"kind":"town"} |
| vulture | Vulture | Vulture | vultures | vulture | coward (0.6), scumbag (0.35), brave (0.1) | hold | 0 | 0 | 3 | 30 | {"kind":"town"} |
| convoy | Supply convoy | Convoy driver | convoys | supplier | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 2 | 100 | {"kind":"sites","ids":["bowl","nose"]} |
| convoyGuard | Convoy guard | Convoy guard | convoys | guard, brave | scumbag (0.25) | hold | 0 | 0 | 2 | 100 | {"kind":"escort","of":"convoy"} |
| merc | Merc | Merc | mercs | merc | scumbag (0.25), coward (0.25), brave (0.15) | hold | 0 | 0 | 3 | 70 | {"kind":"sites","ids":["bowl","nose"]} |
<!-- /wiki:npc-templates -->

## Traits

`robs` says when the driver may rob. Boldness multiplies the driver's own danger when it judges another truck.

<!-- wiki:traits -->
| id | robs | boldness | fuel margin | weight changes |
| --- | --- | --- | --- | --- |
| scavenger | offDuty | 1 | 1 | idle.scavenge +10, salvageSeen.loot +3, strandedSeen.tow +9, hostileSeen.fight +2, aidAsked.give  x2, needySeen.aid +0.02 |
| trader | offDuty | 1 | 0.75 | idle.trade +30, idle.haul +1, strandedSeen.tow +9, hostileSeen.fight  x0.002, attacked.fightBack  x0.1, ramChance.ram  x0.001, crashed.retaliate  x0.2, parley.truce +2, truceOffered.accept +4, mercyBegged.spare +3, threatened.comply +1, threatened.fightBack  x0.1, warnedOff.comply +1, warnedOff.fightBack  x0.1, escortSeen.hire +1, aidAsked.give  x2, needySeen.aid +0.02 |
| raider | offDuty | 1 | 1 | idle.raid +9, idle.patrol +6, contactHeard.investigate +10.8, hostileSeen.fight +7.2, strandedSeen.tow +9, crashed.retaliate +3, parley.truce  x0.3, parley.beg  x0.3, truceOffered.refuse +2, mercyBegged.finish +2, threatened.comply  x0.2, threatened.fightBack +2, warnedOff.comply  x0.2, warnedOff.fightBack +2 |
| scumbag | offDuty | 1.3 | 1 | preySeen.rob +0.45, crashed.retaliate +1 |
| coward | offDuty | 0.6 | 1.4 | hostileSeen.flee  x3, hostileSeen.fight  x0.5, attacked.flee  x3, attacked.fightBack  x0.3, parley.truce  x2, parley.beg  x3, threatened.flee  x3, threatened.comply +1, warnedOff.comply +1, escortSeen.hire  x3, fightWhim.veer  x3 |
| lawman | never | 1 | 1 | idle.patrol +20, idle.wait +2, idle.scavenge  x0.05, hostileSeen.fight +8, attacked.fightBack  x2, strandedSeen.tow +9, parley.truce  x0.3, parley.beg  x0.3, threatened.comply  x0.2, threatened.fightBack +2, warnedOff.comply  x0.2, warnedOff.fightBack +2 |
| courier | offDuty | 1 | 1 | idle.travel +20, idle.scavenge  x0.001, strandedSeen.tow +2, hostileSeen.fight  x0.1, threatened.comply +1, warnedOff.comply +1, escortSeen.hire +0.5 |
| roamer | offDuty | 1 | 1 | idle.explore +10, idle.trade +3, idle.scavenge +2, salvageSeen.loot +3, strandedSeen.tow +3, escortSeen.hire +0.2, aidAsked.give  x2, needySeen.aid +0.02 |
| vulture | offDuty | 1 | 1 | idle.prowl +10, idle.scavenge +2, salvageSeen.loot +20, crashed.retaliate +0.5 |
| supplier | never | 1 | 1 | idle.haul +30, idle.trade +15, idle.scavenge  x0.001, strandedSeen.tow +9, hostileSeen.fight  x0.002, attacked.fightBack  x0.1, threatened.comply +1, threatened.fightBack  x0.1, warnedOff.comply +1, warnedOff.fightBack  x0.1 |
| guard | never | 1 | 1 | idle.escort +30, idle.wait +5, idle.travel +1, idle.scavenge  x0.001, hostileSeen.fight +8, attacked.fightBack  x2, threatened.comply  x0.2, threatened.fightBack +2, warnedOff.comply  x0.2, warnedOff.fightBack +2 |
| merc | offDuty | 1 | 1 | idle.wait +10, idle.travel +1, idle.scavenge  x0.001, hostileSeen.fight +4, attacked.fightBack  x2, threatened.comply  x0.2, threatened.fightBack +2, warnedOff.comply  x0.2, warnedOff.fightBack +2 |
| brave | offDuty | 1.5 | 1 | hostileSeen.flee  x0.05, contactHeard.flee  x0.05, attacked.flee  x0.05, parley.truce  x0.05, parley.beg  x0.05, threatened.flee  x0.05, threatened.comply  x0.05, warnedOff.comply  x0.05, fightWhim.rush  x3 |
<!-- /wiki:traits -->

## Decisions

Base weights of every option at each decision point. Traits and states add or multiply them.

<!-- wiki:decisions -->
| decision | option | base weight |
| --- | --- | --- |
| hostileSeen | keep | 1 |
| hostileSeen | fight | 1.8 |
| hostileSeen | flee | 1 |
| contactHeard | keep | 1 |
| contactHeard | investigate | 0 |
| contactHeard | flee | 3 |
| attacked | keep | 0.5 |
| attacked | flee | 1 |
| attacked | fightBack | 2 |
| preySeen | keep | 1 |
| preySeen | rob | 0 |
| strandedSeen | keep | 1 |
| strandedSeen | tow | 0 |
| salvageSeen | keep | 1 |
| salvageSeen | loot | 0 |
| patchDeal | paid | 6 |
| patchDeal | ownParts | 3 |
| patchDeal | free | 1 |
| ramChance | keep | 1 |
| ramChance | ram | 9 |
| fightWhim | keep | 20 |
| fightWhim | rush | 1 |
| fightWhim | halt | 1 |
| fightWhim | veer | 1 |
| crashed | forgive | 4 |
| crashed | retaliate | 1 |
| parley | keep | 8 |
| parley | truce | 0.5 |
| parley | beg | 0.1 |
| truceOffered | accept | 2 |
| truceOffered | refuse | 1 |
| mercyBegged | spare | 3 |
| mercyBegged | finish | 1 |
| strandedFoe | offer | 9 |
| strandedFoe | spare | 1 |
| surrenderOffered | accept | 3 |
| surrenderOffered | refuse | 1 |
| threatened | comply | 1 |
| threatened | fightBack | 1 |
| threatened | flee | 1 |
| warnedOff | comply | 1 |
| warnedOff | refuse | 1 |
| warnedOff | fightBack | 1 |
| mugging | demand | 3 |
| mugging | attack | 2 |
| resume | resume | 9 |
| resume | new | 1 |
| idle | trade | 0 |
| idle | scavenge | 1 |
| idle | raid | 0 |
| idle | prowl | 0 |
| idle | wait | 0.1 |
| idle | patrol | 0 |
| idle | travel | 0 |
| idle | explore | 0 |
| idle | haul | 0 |
| idle | escort | 0 |
| escortSeen | keep | 1 |
| escortSeen | hire | 0 |
| hireOffered | take | 3 |
| hireOffered | decline | 1 |
| aidAsked | give | 1 |
| aidAsked | refuse | 9 |
| needySeen | keep | 1 |
| needySeen | aid | 0 |
<!-- /wiki:decisions -->

## States

A timed state between two vehicles, like a feud or a tow, is owned by `src/sim/states.ts`. A state that binds is a deal, and its two sides never rob each other. Turns is how long it lasts, and empty means no fixed limit.

<!-- wiki:state-kinds -->
| kind | turns | binds a deal |
| --- | --- | --- |
| feud | 10 | false |
| backedOff | 30 | false |
| tow |  | true |
| turnedDown |  | false |
| towPromise |  | false |
| answering | 20 | true |
| truce | 60 | false |
| grievance | 5 | false |
| plea | 20 | false |
| patch | 40 | true |
| trade | 20 | true |
| revenge | 2000 | false |
| escort |  | true |
| strayFire | 60 | false |
| aid | 20 | true |
| combat | 10 | false |
<!-- /wiki:state-kinds -->

## Gear levels

`src/sim/npc-loadout.ts` rolls each NPC a level and fills its truck toward it within budget and rated mass. The gun fill chance is the base chance that each free deck spot gets a gun after the main gun and the template minimum. The template's `gunFill` scales it.

<!-- wiki:gear-levels -->
| level | gun fill chance | armor share | budget mult | wear shift | cargo mult |
| --- | --- | --- | --- | --- | --- |
| poor | 0 | 0.5 | 0.6 | 1 | 0.5 |
| light | 0.1 | 1 | 0.85 | 0 | 0.75 |
| standard | 0.25 | 1 | 1.15 | 0 | 1 |
| heavy | 0.45 | 1 | 1.6 | -1 | 1 |
| loaded | 0.8 | 1 | 2.4 | -2 | 1.5 |
<!-- /wiki:gear-levels -->

## Numbers

<!-- wiki:numbers -->
| path | value |
| --- | --- |
<!-- /wiki:numbers -->
