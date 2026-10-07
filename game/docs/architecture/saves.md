# Saves

## Slots and boot

- `src/three/save.ts` stores the whole world except the terrain in a save envelope `{ format, savedAt, world }` and restores it on boot.
- `src/three/save-slots.ts` owns the slots: `CONFIG.saveSlots` manual slots, the Autosave (every `CONFIG.saveTurns` completed turns and after each command in town, at the pre-slots key) and the Day start autosave (the first turn of each game day), each in its own local storage key. The Save and Load panels in `src/ui/save-panel.ts` pick a slot. The Save button in the top right opens the Save panel.
- Load and New game leave a boot request in session storage and reload. Boot reads the request and removes it. Without one, it loads the newest save by `savedAt`.
- Boot's New game runs `clearGame()`, which deletes the autosaves and everything else the run keeps in storage but not the manual slots or sound settings, then writes the Autosave at once. Later unsaved changes are lost on reload.
- `player.explored` is saved as a base64 bitset, so every slot fits the local storage quota.
- The terrain comes from the map file on load. A save records the map file's hash and does not load on another map.
- A build with `SAVE_SCOPE` set stores its save under its own key, so builds served from one site keep separate saves.
- A dead world is never saved.
- A write that hits the storage quota throws `SaveQuotaError` and leaves the slot's old save and every other key alone. The manual Save and the automatic saves note "Not saved" in the log. Boot and rescue continue unsaved. Nothing is cleared to make room.

## Versions

A save records its format, `SAVE_FORMAT` in `src/three/save-migrations.ts`. The `?` menu shows the game version, which `src/version.ts` builds from the save format and git as `SAVE_MAJOR.minor.commits+hash`, so nobody edits it by hand. Load migrates an old save to the current format, as Save migrations in `CLAUDE.md` describes.

## Rescue

A save that cannot load, from another map, another major format, a newer minor format or with an invalid shape, shows the save screen: Migrate save or New game behind a confirm. `src/three/save-rescue.ts` reads the raw JSON defensively, `carriedWorld()` in `src/sim/world.ts` rebuilds the world on the current map from a new game and carries the skill ranks, XP, perks, money, truck, parts with wear, garage storage, cargo, fuel, supplies and discovered places, parks the truck on a town pad and refunds what no longer fits, and `src/ui/save-screen.ts` shows the choice and the report. Unknown ids are lost and listed. The rescue writes the new save at once.

## Migration details

- The save format has a major and a minor number. A save loads only in its own major format. Load carries it from its minor format to the current one.
- The saved shape is everything in `World` but the terrain. A change to a type it reaches in `src/sim/types.ts` changes the shape. A rename or removal of a content id in `src/data/`, like a part or good id, changes it too.
- The minor format is the number of steps in `MIGRATIONS`, and a new step raises the game version's y. A major bump empties `MIGRATIONS` and raises the game version's x. Saves of an older major carry over through the save screen, which keeps progression and rebuilds the world. A new map file needs no bump, since saves on another map carry over the same way.
- A new field gets what a new game would give, or a value derived from saved data. A renamed field or id moves. A removed field or id is dropped, and removed parts or goods turn into their sale value in cash.
- Each step's test feeds it a trimmed save of format N from `src/three/save-fixtures/`, holding the fields the step changes, and checks the result.
- `src/three/save-shape.json` records the saved shape of a new game under the current format. A test fails when the shape changes without a new format. `npm run save:shape` refuses to record a new shape under an old format.
