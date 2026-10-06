# World settings

The game mode and world settings a player picks at New game. The principles behind them are in [DESIGN.md](../../DESIGN.md).

New game, from the top-right menu, the death screen or the boot save screen, opens one New game screen. The player picks a game mode and may open World Settings. Back, or Escape, closes the screen and changes nothing: the running world and its autosaves stay. Start asks first. It then deletes the autosaves, keeps the save slots and starts the new world.

Roaming is the only mode: the open wasteland, today's sandbox. A future mode is a new row in `GAME_MODES` in `src/data/modes.ts`.

## The settings

Each setting is a multiplier on the base rule numbers in `RULES`. 100% is the standard game. Every setting runs from 50% to 200% in steps of 25%. Below 50% a fight could drag on without end and a truck could hardly run dry. At 200% fuel use the starting tank still covers the Bowl to Nose road trip, with about 72% of the tank.

- Damage scales every gun round, splash, stray round, town guard round, crash, ram, ground crash and landing, for every truck. Starving, wear from driving and prop scrapes do not change.
- Fuel use scales the fuel every truck burns per tile. NPC refuel plans and far NPC travel follow. The leak of a broken tank does not change.
- Supply use scales the supplies every crew eats per turn. Healing's extra supplies and starving do not change.

The settings apply to every truck alike: the player, NPCs near and far, and the town guards.

## Saves

The world saves its mode and settings. Every load uses them, so two saves with different settings stay apart. A world keeps the multipliers it was started with, so a later build that changes a setting's default does not retune it. A later build that rebalances `RULES` itself changes every world.

A save from before world settings loads as Roaming at 100% for every setting, which is how it played. A save with a bad setting, like a value out of bounds, does not load. The save screen offers to migrate it, and the migration resets each bad setting to 100% and says so.

The `?` menu shows the world's mode and settings under the version, and a bug report carries them.

## Which rules are settings

Every `RULES` field, the new-game fields of `src/config.ts` and the nearby data tables, with what each is and why.

Exposed now:

- `weaponDamage` and `crashDamage`, together as Damage.
- `fuelUseFactor` as Fuel use.
- `suppliesPerTurn` as Supply use.

Safe to vary per run later. Each needs its own NPC and economy work, so each is a follow-up:

- Start: the start kit and a fixed seed in `src/config.ts`, and the start money in `src/data/start.ts`.
- Traffic: the NPC spawn timers and template weights in `src/data/`.
- Recovery: `healPerTurn`, `healSupplies`, `townHealMult` and `starveDamage`.
- Town aid: `townPatch`, `scrapPatch` and `defeatPatch`. These give value for free, so a higher setting would mint value.
- Loot refill: wreck clearing and regrowth days (`BREAKABLE.regrowDays` and the salvage refill timers).

Fixed:

- Driving and physics. Changing these breaks routes, unsticking, the no-stall guarantee or the physics step: `substeps`, `crawlSpeed`, `arriveRadius`, `throttleZones`, `reclickRadius`, `passRadius`, `minAimDistance`, `cornerSlack`, `parkedSpeed`, `yieldDistance`, `maxBulge`, `meetStep`, `reverse`, `stranded`, `unstick`, `npcStuckTurns`, `npcRecoveryTurns` and `BREAKABLE.breakSpeed`, `BREAKABLE.slowdown` and `BREAKABLE.routeCost`.
- Truck balance. Every part has one job, and a per-run value would reprice every part: `accelScale`, `overdriveBoost`, `overloadExponent`, `gunDragMax`, `gunDragCurve`, `minSpeedCap`, `limpSpeed`, `wheelLoss`, `lowFuelThreshold`, `lowFuelSpeedFactor`, `refitTurnsPerPart`, `baseSupplies` and `tankLeak`.
- The shape of combat. These decide who wins a fight, not how fast it goes, and Damage already sets the pace: `ramDamage`, `hardCrashSpeed`, `cellPen`, `crashPen`, `groundCrash`, `landingDamage`, `collisionMinImpact`, the `crit` fields, `rangeFalloff`, `leadError`, `shake`, `stillSpeed`, `stillSpread`, `cellMeters`, `minHit`, `maxHit`, `stray`, `guards` and `BREAKABLE.damage`.
- Life is valued. Death is rare and comes only from injury: `npcDeathChance`, `cabKnock`, `cabHealthShare`, `starveFloor`, `maxHealth`, `knockoutMaxTurns` and `surrenderParts`.
- Progression. XP comes only from use, and grinding must not pay: `killXp`.
- World bookkeeping, which is not gameplay: `wreckRadiusScale`, `maxKillWrecks`, `retreatTeleportTurns` and `suppliesLow`.
- Device and playback preferences. These are not world rules and stay out of the save: the debug console's `CHEATS`, the playback and timing fields of `src/config.ts`, and its save interval and slot count.
