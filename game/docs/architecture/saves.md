# Saves

## Storage

- Saves and run logs live in IndexedDB, in one database per save scope named like the old save key. The `saves` store holds one save envelope per slot. The `log` store holds run log records by run id and sequence number. `src/three/save-db.ts` owns both.
- IndexedDB stores objects as they are, so a save is a plain object, not a JSON string. Each write is one transaction with strict durability, so it lands whole or not at all. Its quota is a share of the disk, not the 5 MB of local storage.
- `SaveSlots` mirrors every save in memory, so the game reads and writes slots at once. A write goes on to the database in the background. A failed write shows a note in the HUD and goes to the crash handling. Load and New game wait for every pending save and log write before they reload the page.
- Boot asks the browser for persistent storage, so it does not evict saves under disk pressure. A refusal leaves saves best-effort, as local storage was.
- Older builds kept saves in local storage. Boot moves each of them into the database and then deletes its local storage key. A local storage save replaces a database slot only when its `savedAt` is newer, since a tab of an old build may still write there. A save that did not parse moves as its text, and load reports it as unreadable.

## Slots and boot

- `src/three/save.ts` stores the world in a save envelope `{ format, savedAt, runId, world }` and restores it on boot.
- `src/three/save-slots.ts` owns the slots: `CONFIG.saveSlots` manual slots, the Autosave (every `CONFIG.saveTurns` completed turns and after each command in town) and the Day start autosave (the first turn of each game day). The Save and Load panels in `src/ui/save-panel.ts` pick a slot. The Save and Load entries of the Menu button in the top right open the panels.
- Load and a confirmed New game leave a boot request in session storage and reload. Boot reads the request and removes it. Without one, it loads the newest save by `savedAt`.
- Boot's New game runs `clearGame()`, which deletes the autosaves and everything else the run keeps in storage but not the manual slots or sound settings, then writes the Autosave at once. Later unsaved changes are lost on reload.
- World setup: New game opens the New game screen in `src/ui/new-game.ts`, and only its Start writes a boot request. A new game request holds the picked mode and world settings as JSON, and `takeBootRequest()` removes it before it checks them with `parseSetup()`, so it is used once even when it is bad. Boot builds the world with that setup and saves it at once. Load runs `parseSetup()` on the saved setup, and a bad one is a `SaveError` that leads to the save screen. Rescue keeps the valid settings, resets the bad ones with `repairSetup()` and lists each reset in the carry report. `src/sim/settings.ts` owns the setup, and [world settings](../wiki/mechanics/world-settings.md) has the rules.
- A save holds only what load cannot rebuild. Load takes the terrain and the baked props from the map file, rebuilds the player's visible tiles, contacts and seen clouds with `refreshVision()`, and starts trails, events and removed vehicles empty, since they only animate the last turn. A broken prop is saved as its id and turn. An open quest is saved as its last checkpoint, and load restarts it there, as [Quests](quests.md#saves) describes.
- `player.explored` is saved as a base64 bitset.
- A save records the map file's hash and does not load on another map.
- A build with `SAVE_SCOPE` set stores its saves in its own database, so builds served from one site keep separate saves.
- A dead world is never saved.
- A write the browser refuses (a full disk quota) leaves the slot's old save in the database and the new one in the memory mirror. The game notes "The game could not save" in the log and reports the error. Boot and rescue continue unsaved. Nothing is cleared to make room.

## Run log

- `src/three/run-log.ts` records what happened to the player over a run, for analysis after the fact. It does not replay the game and never feeds the sim.
- A run gets a random run id at New game. The save envelope carries it, and a rescue keeps it. A save from before run ids belongs to the run `legacy-<seed>`.
- The game hands the log every world it takes: after each command, at the start of each turn's playback and after a talk. The log writes each world once and each events array once, since a world built by spreading another shares its events. The database numbers records inside the write, so two tabs on one run never take the same number.
- It keeps the player's outcomes: deaths, knockouts, money, contracts, discoveries, skill-ups, kills and knockouts the player was part of, tows, escorts, aid and jobs. Each truck an event names comes with its name, faction and chassis. Shots, spawns, NPC moves, talk, weather and XP practice stay out.
- A `change` record follows every world where the player's money, parts or goods changed, with the money delta and the parts gained and lost. Buys, sales, loot and refits have no event, so they show here.
- A `day` snapshot follows the first world of each session and of each game day: money, skill levels, XP by source, perks, chassis, mounted and stored part value, health, fuel, supplies and knockouts.
- The log is append-only. Each session starts with a `start` record, or a `loaded` record with the slot. A script that wants one timeline drops the records after a `loaded` record's turn that came before it.
- The Save panel's Export run log button downloads the run as JSON Lines: a header with the run id, game version, seed and map hash, then one record per line. Export save downloads the current game as a save envelope in JSON.

## Versions

A save records its format, `SAVE_FORMAT` in `src/three/save-migrations.ts`. The Help entry of the Menu shows the game version, which `src/version.ts` builds from the save format and git as `SAVE_MAJOR.minor.commits+hash`, so nobody edits it by hand. Load migrates an old save to the current format, as Save migrations in `CLAUDE.md` describes.

## Rescue

A save that cannot load, from another map, another major format, a newer minor format or with an invalid shape, shows the save screen: Migrate save, New game, which opens the setup screen in `src/ui/new-game.ts` like every New game route (the Menu, the death screen and this one), or Download save, which hands the player the stored save as a file to attach to a bug report. `src/three/save-rescue.ts` reads the raw save defensively, `carriedWorld()` in `src/sim/world.ts` rebuilds the world on the current map from a new game and carries the skill ranks, XP, perks, money, truck, parts with wear, garage storage, cargo, fuel, supplies, discovered places and valid world settings, parks the truck on a town pad and refunds what no longer fits, and `src/ui/save-screen.ts` shows the choice and the report. Unknown ids are lost and listed. The rescue writes the new save at once.

## Migration details

- The save format has a major and a minor number. A save loads only in its own major format. Load carries it from its minor format to the current one.
- The saved shape is everything in `World` that `saveOf()` writes. A change to a type it reaches in `src/sim/types.ts` changes the shape. A rename or removal of a content id in `src/data/`, like a part or good id, changes it too.
- The minor format is the number of steps in `MIGRATIONS`, and a new step raises the game version's y. A major bump empties `MIGRATIONS` and raises the game version's x. Saves of an older major carry over through the save screen, which keeps progression and rebuilds the world. A new map file needs no bump, since saves on another map carry over the same way.
- A new field gets what a new game would give, or a value derived from saved data. A renamed field or id moves. A removed field or id is dropped, and removed parts or goods turn into their sale value in cash.
- Each step's test feeds it a trimmed save of format N from `src/three/save-fixtures/`, holding the fields the step changes, and checks the result.
- `src/three/save-shape.json` records the saved shape of a new game under the current format. A test fails when the shape changes without a new format. `npm run save:shape` refuses to record a new shape under an old format. It also records the saved quest variable names and checkpoints, and refuses a lost one under an old format.
- The game version comes from the commit that first records the current format in `save-shape.json`. Git's search skips merge commits, so a new format must land in a plain commit, not in a merge resolution.
